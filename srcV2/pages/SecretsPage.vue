<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api from '@v2/services/api'
import StatusModal from '@v2/components/modals/StatusModal.vue'
import BundleSelector from '@v2/components/secrets/BundleSelector.vue'
import BundleSecretGrid from '@v2/components/secrets/BundleSecretGrid.vue'
import { useBundleSubmission } from '@v2/composables/useBundleSubmission'
import type { SecretFormEntry, BundleCatalogEntry, BundleSubmitResponse } from '@v2/types/infrastructure.types'

type Target = 'live' | 'sand'
type Tier = 'production' | 'non-production' | 'unclassified'
// secrets-environment-bundles (spec.md §2.7): "Bundles" (new, default) and "All Environments"
// (the pre-existing free multi-select flow, completely unchanged) coexist as two tabs at the top
// of the submission section.
type SubmissionMode = 'bundles' | 'all-environments'
const SUBMISSION_TABS: { mode: SubmissionMode; label: string }[] = [
  { mode: 'bundles', label: 'Bundles' },
  { mode: 'all-environments', label: 'All Environments' }
]

interface AppOption {
  name: string
  environment: string
  qualifier?: string
  tier?: Tier
  // secrets-environment-bundles §3.2: null when the environment is not a member of any bundle.
  bundleId?: string | null
}

interface Vault {
  vaultDir: string
  vaultName: string | null
  resourceGroup: string | null
  qualifier?: string
}

interface SubmitResult {
  environment: string
  success: boolean
  prNumber?: number
  prUrl?: string
  errorCode?: string
  error?: string
}

// FR-003 (secrets-environment-scope): per-environment ambiguity resolution status for the
// multi-select fan-out flow. 'eligible' environments are included in the submission batch;
// 'excluded' ones (ambiguous vault/qualifier, or unresolvable) are not, per FR-003(c)/(d).
type EnvSelectionStatus = 'pending' | 'eligible' | 'excluded'

const MAX_SECRET_ROWS = 20
const MAX_ENVIRONMENTS = 10
const SECRET_NAME_RE = /^[a-zA-Z0-9-]{1,127}$/
const JIRA_RE = /^[A-Za-z]+-\d+$/

const apps = ref<AppOption[]>([])
const selectedAppName = ref('')
// Bound to the Application <select> instead of selectedAppName directly, so a single option can
// carry a composite "{name}", "{name}::{qualifier}", or "{name}::" value (nested-qualifier feature).
const selectorValue = ref('')
// FR-002: replaces the single-select `selectedEnvironment` ref with a multi-select array.
const selectedEnvironments = ref<string[]>([])
const target = ref<Target>('live')
const vaults = ref<Vault[]>([])
const selectedVaultDir = ref('')
const qualifiers = ref<string[]>([])
const selectedQualifier = ref('')
// True only for an explicit "{name}::" (root-only) selection; false in the default/auto-selected
// 'unresolved' state and in the 'qualified' state.
const isRootOnlySelected = ref(false)
const isLoadingApps = ref(false)
const isSubmitting = ref(false)
const pageError = ref('')

// FR-003: per-environment resolution status, only populated/consulted when more than one
// environment is selected (the single-environment case keeps using vaults/qualifiers above).
const envSelectionStatus = ref<Record<string, EnvSelectionStatus>>({})
const envSelectionReason = ref<Record<string, string>>({})

// FR-007: production-tier write confirmation modal state, adapted from AppSelector.vue's
// showConfirmDialog inline pattern (see PRD Evidence Table row 9).
const showProductionConfirm = ref(false)

// FR-004(f)/NFR-UX-001: submission in-flight/terminal state is shown via StatusModal (sync mode,
// no polling) instead of inline success/error banners.
const showStatusModal = ref(false)
const statusModalState = ref<'pending' | 'success' | 'failure'>('pending')
const statusMessage = ref('')
const statusLink = ref('')
const statusCorrelationId = ref('')
// FR-005(d): per-environment outcome list, populated only for a >1-environment submission.
const statusResults = ref<Array<{ label: string; success: boolean; message?: string; link?: string }>>([])

const jiraTicket = ref('')
const secretEntries = ref<SecretFormEntry[]>([{ name: '', value: '', confirmation: '' }])
const rowAnnouncement = ref('')
const fieldErrors = ref<Record<string, string>>({})

// vault-resolution-override: inline "Set name manually" self-heal control, shown only for a
// selected vault whose vaultName is null/falsy.
const showOverrideForm = ref(false)
const overrideName = ref('')
const overrideResourceGroup = ref('')
const overrideError = ref('')
const isSubmittingOverride = ref(false)

// secrets-environment-bundles (spec.md §2.7): "Bundles" is the default tab. Switching tabs resets
// the *other* tab's in-progress form state, mirroring onAppNameChange()'s reset pattern below.
const activeMode = ref<SubmissionMode>('bundles')
const bundleCatalog = ref<BundleCatalogEntry[]>([])
const selectedBundleId = ref('')
const bundleJiraTicket = ref('')
const bundleSubmission = useBundleSubmission()

/** Currently selected application (environment is tracked separately as an array, FR-002) */
const selectedApp = computed(() => (selectedAppName.value ? { name: selectedAppName.value } : undefined))

interface AppSelectorGroup {
  name: string
  /** "{name}" — only set when this root app has zero qualified entries (unchanged from today) */
  flatValue?: string
  /** "{name}::" — only set when this root app has both qualified and unqualified entries */
  rootOnlyValue?: string
  qualifierOptions: { value: string; qualifier: string }[]
}

/** Application selector option groups: a flat option for apps with no qualifiers, or an
 * <optgroup> of qualifier options (+ a root-only option when the app also has unqualified
 * entries) for apps that do. */
const appSelectorGroups = computed<AppSelectorGroup[]>(() => {
  const byName = new Map<string, { qualifiers: Set<string>; hasUnqualified: boolean }>()
  for (const app of apps.value) {
    const entry = byName.get(app.name) || { qualifiers: new Set<string>(), hasUnqualified: false }
    if (app.qualifier) entry.qualifiers.add(app.qualifier)
    else entry.hasUnqualified = true
    byName.set(app.name, entry)
  }
  return Array.from(byName.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { qualifiers: appQualifiers, hasUnqualified }]) => ({
      name,
      flatValue: appQualifiers.size === 0 ? name : undefined,
      rootOnlyValue: appQualifiers.size > 0 && hasUnqualified ? `${name}::` : undefined,
      qualifierOptions: Array.from(appQualifiers)
        .sort()
        .map(qualifier => ({ value: `${name}::${qualifier}`, qualifier }))
    }))
})

/** Environment options (with tier) available for the currently selected application, FR-001.
 * Scoped by the qualifier-selection state: union by app.name alone when unresolved (unchanged
 * from today), exact {name, qualifier} match when qualified, unqualified-only when root-only. */
const filteredEnvironmentOptions = computed<{ environment: string; tier: Tier }[]>(() => {
  if (!selectedAppName.value) return []
  const seen = new Map<string, Tier>()
  for (const app of apps.value) {
    if (app.name !== selectedAppName.value) continue
    if (selectedQualifier.value) {
      if (app.qualifier !== selectedQualifier.value) continue
    } else if (isRootOnlySelected.value && app.qualifier) {
      continue
    }
    if (!seen.has(app.environment)) seen.set(app.environment, app.tier || 'unclassified')
  }
  return Array.from(seen.entries())
    .map(([environment, tier]) => ({ environment, tier }))
    .sort((a, b) => a.environment.localeCompare(b.environment))
})

/** FR-001(c): environment options grouped under Production / Non-Production / Other headings */
const environmentGroups = computed(() => {
  const groups: Record<Tier, { environment: string; tier: Tier }[]> = {
    production: [],
    'non-production': [],
    unclassified: []
  }
  for (const option of filteredEnvironmentOptions.value) {
    groups[option.tier].push(option)
  }
  return groups
})

/** FR-002(e): 10-environment cap per submission */
const atMaxEnvironments = computed(() => selectedEnvironments.value.length >= MAX_ENVIRONMENTS)

/**
 * FR-003(f): environments that will actually be submitted. With 0-1 selected, the existing
 * single-environment vault/qualifier flow (FR-002(f)) governs eligibility directly. With >1
 * selected, only environments resolved as 'eligible' (unambiguous vault + qualifier) are included.
 */
const eligibleEnvironments = computed<string[]>(() => {
  if (selectedEnvironments.value.length <= 1) return selectedEnvironments.value.slice()
  return selectedEnvironments.value.filter(env => envSelectionStatus.value[env] === 'eligible')
})

/** FR-007(a)/(e): true when at least one eligible environment is production-tier */
const hasProductionSelection = computed(() =>
  eligibleEnvironments.value.some(
    env => filteredEnvironmentOptions.value.find(option => option.environment === env)?.tier === 'production'
  )
)

const selectedVault = computed(() => {
  if (vaults.value.length === 1) return vaults.value[0]
  return vaults.value.find(vault => vault.vaultDir === selectedVaultDir.value)
})

/** Shared by `isFormValid` and `isBundleFormValid`: every name matches `SECRET_NAME_RE` and no
 * two names are duplicates of each other (case-insensitively). */
function hasValidUniqueNames(names: string[]): boolean {
  const seenNames = new Set<string>()
  for (const name of names) {
    if (!SECRET_NAME_RE.test(name)) return false
    const key = name.toLowerCase()
    if (seenNames.has(key)) return false
    seenNames.add(key)
  }
  return true
}

// FR-002(e)/FR-004(b): submit is disabled (not just rejected on click) whenever the Jira ticket
// or any secret row is currently invalid, a vault choice is required but missing, or there is no
// eligible environment to submit to.
const isFormValid = computed(() => {
  if (eligibleEnvironments.value.length === 0) return false
  if (!JIRA_RE.test(jiraTicket.value.trim())) return false
  if (!hasValidUniqueNames(secretEntries.value.map(entry => entry.name.trim()))) return false
  return secretEntries.value.every(entry => !!entry.value && entry.value === entry.confirmation)
})

/** secrets-environment-bundles §2.2: the current app's environments, deduplicated, with their
 * bundle membership — BundleSelector.vue's own FR-002(f) filter (`availableBundles`) consumes
 * this directly. */
const appEnvironmentsForBundleSelector = computed(() => {
  const seen = new Map<string, string | null>()
  for (const entry of apps.value) {
    if (entry.name !== selectedAppName.value) continue
    if (selectedQualifier.value) {
      if (entry.qualifier !== selectedQualifier.value) continue
    } else if (isRootOnlySelected.value && entry.qualifier) {
      continue
    }
    if (!seen.has(entry.environment)) seen.set(entry.environment, entry.bundleId ?? null)
  }
  return Array.from(seen.entries()).map(([environment, bundleId]) => ({ environment, bundleId }))
})

/** Tier lookup independent of the legacy flow's qualifier-scoped `filteredEnvironmentOptions` —
 * bundle mode has no single-qualifier selection concept at the page level. */
function environmentTier(environment: string): Tier {
  return apps.value.find(entry => entry.name === selectedAppName.value && entry.environment === environment)?.tier || 'unclassified'
}

/** FR-007(a)/(e) applied to bundle mode: true when at least one eligible bundle environment is
 * production-tier. */
const hasBundleProductionSelection = computed(() =>
  bundleSubmission.eligibleEnvironments.value.some(env => environmentTier(env) === 'production')
)

/** Shared production-write confirmation dialog text — sources its environment list from
 * whichever tab is currently active. */
const productionConfirmEnvironments = computed(() => {
  if (activeMode.value === 'bundles') {
    return bundleSubmission.eligibleEnvironments.value.filter(env => environmentTier(env) === 'production')
  }
  return eligibleEnvironments.value.filter(env => filteredEnvironmentOptions.value.find(o => o.environment === env)?.tier === 'production')
})

/** Mirrors `isFormValid` for the bundle tab: a bundle, at least one populated+matching secret per
 * eligible environment, a valid Jira ticket, and no unresolved secret-name/cell problems. */
const isBundleFormValid = computed(() => {
  const environments = bundleSubmission.eligibleEnvironments.value
  if (!selectedBundleId.value || environments.length === 0) return false
  if (!JIRA_RE.test(bundleJiraTicket.value.trim())) return false

  const trimmedNames = bundleSubmission.secretNames.value.map(name => name.trim()).filter(Boolean)
  if (trimmedNames.length === 0 || !hasValidUniqueNames(trimmedNames)) return false

  for (const name of trimmedNames) {
    for (const environment of environments) {
      if (!bundleSubmission.isCellValid(name, environment)) return false
    }
  }

  // FR-005 union-cap/INCOMPLETE_BUNDLE precedent: every eligible environment must end up with at
  // least one populated secret, or the server would reject the submission outright.
  return environments.every(environment =>
    trimmedNames.some(name => !!bundleSubmission.gridValues.value[name]?.[environment]?.value)
  )
})

function errorMessage(error: any, fallback: string): string {
  return error?.response?.data?.error || error?.error || error?.message || fallback
}

async function loadApps() {
  isLoadingApps.value = true
  pageError.value = ''
  try {
    const response = await api.getSecretApps(target.value)
    apps.value = response.success && Array.isArray(response.data) ? response.data : []
    // secrets-environment-bundles §3.2: additive sibling field, not part of the typed ApiResponse
    // shape — same `as any` convention already used below for `qualifiers`.
    bundleCatalog.value = Array.isArray((response as any).bundles) ? (response as any).bundles : []

    // FR-001(c): drop any selected environments that no longer exist for this app in the new
    // target's app list.
    const validEnvironments = new Set(apps.value.filter(app => app.name === selectedAppName.value).map(app => app.environment))
    selectedEnvironments.value = selectedEnvironments.value.filter(env => validEnvironments.has(env))
    if (!apps.value.some(app => app.name === selectedAppName.value)) {
      selectedAppName.value = ''
      selectedEnvironments.value = []
      selectedBundleId.value = ''
      bundleSubmission.reset()
    }

    if (!selectedAppName.value && apps.value.length > 0) {
      selectedAppName.value = apps.value[0].name
    }
    // loadApps()'s auto-select is always the 'unresolved' state — never derive a qualifier here.
    selectorValue.value = selectedAppName.value
  } catch (error) {
    pageError.value = errorMessage(error, 'Failed to load applications for the selected target.')
  } finally {
    isLoadingApps.value = false
  }
}

function resetSecretMetadata() {
  vaults.value = []
  selectedVaultDir.value = ''
  qualifiers.value = []
  selectedQualifier.value = ''
  showOverrideForm.value = false
}

// Clears only the per-environment vault/ambiguity resolution, preserving a qualifier the user
// already pre-selected via the Application selector — resolveEnvironmentEligibility() (FR-003)
// still needs it after an environment is (re)checked.
function resetVaultResolution() {
  vaults.value = []
  selectedVaultDir.value = ''
  qualifiers.value = []
  showOverrideForm.value = false
}

async function resolveSecretMetadata(environment: string): Promise<boolean> {
  if (!selectedApp.value) return false

  try {
    const response = await api.getSecrets(
      selectedApp.value.name,
      environment,
      target.value,
      undefined,
      selectedQualifier.value || undefined
    )
    vaults.value = Array.isArray(response.vaults) ? (response.vaults as Vault[]) : []
    qualifiers.value = Array.isArray((response as any).qualifiers) ? (response as any).qualifiers : []
    const hasUnqualifiedVault = vaults.value.some(vault => !vault.qualifier)
    if (!hasUnqualifiedVault && qualifiers.value.length === 1) {
      selectedQualifier.value = qualifiers.value[0]
    }
    if (vaults.value.length === 1) selectedVaultDir.value = vaults.value[0].vaultDir
    pageError.value = ''
  } catch (error: any) {
    const responseData = error?.response?.data
    vaults.value = Array.isArray(responseData?.vaults) ? responseData.vaults : []
    qualifiers.value = Array.isArray(responseData?.qualifiers) ? responseData.qualifiers : []
    if (qualifiers.value.length === 1) selectedQualifier.value = qualifiers.value[0]
    if (vaults.value.length === 1) selectedVaultDir.value = vaults.value[0].vaultDir
    pageError.value = vaults.value.length > 0
      ? ''
      : errorMessage(error, 'No Key Vault could be resolved for this application.')
  }

  // IDM-style apps expose their own parent/root Key Vault alongside sub-app qualifiers. An
  // unqualified "(all)" application selection already signals "the parent's own vault, not any
  // sub-app" — so when exactly one candidate has no qualifier, use it directly instead of forcing
  // a manual Key Vault pick for what is not actually ambiguous.
  if (!selectedVaultDir.value && !selectedQualifier.value) {
    const unqualifiedVaults = vaults.value.filter(vault => !vault.qualifier)
    if (unqualifiedVaults.length === 1) selectedVaultDir.value = unqualifiedVaults[0].vaultDir
  }

  if (qualifiers.value.length > 1 && !selectedQualifier.value && !selectedVaultDir.value) {
    fieldErrors.value.selectedQualifier = 'Choose a sub-application.'
    return false
  }
  if (vaults.value.length === 0) {
    pageError.value = pageError.value || 'No Key Vault could be resolved for this application.'
    return false
  }
  if (vaults.value.length > 1 && !selectedVaultDir.value) {
    fieldErrors.value.selectedVaultDir = 'Choose a Key Vault.'
    return false
  }
  return true
}

// vault-resolution-override: inline self-heal control for a vault the live resolver could not
// name. Opens/cancels the small form and submits the correction via the new endpoint, then
// refetches so the corrected name displays immediately (no full page reload).
function openOverrideForm() {
  showOverrideForm.value = true
  overrideName.value = ''
  overrideResourceGroup.value = ''
  overrideError.value = ''
}

function cancelOverrideForm() {
  showOverrideForm.value = false
  overrideError.value = ''
}

async function submitOverride() {
  if (!selectedVault.value || !selectedApp.value) return
  const environment = selectedEnvironments.value[0]
  if (!environment) return

  isSubmittingOverride.value = true
  overrideError.value = ''
  try {
    await api.setVaultNameOverride({
      vaultDir: selectedVault.value.vaultDir,
      name: overrideName.value.trim(),
      resourceGroup: overrideResourceGroup.value.trim() || undefined,
      appName: selectedApp.value.name,
      environment,
      target: target.value,
      qualifier: selectedQualifier.value || undefined
    })
    showOverrideForm.value = false
    await resolveSecretMetadata(environment)
  } catch (error) {
    overrideError.value = errorMessage(error, 'Failed to save Key Vault name.')
  } finally {
    isSubmittingOverride.value = false
  }
}

// FR-003(a)/(b)/(c)/(d): resolve ambiguity for a single environment in the multi-select batch.
// Never blocks other environments — an ambiguous/unresolvable environment is marked 'excluded'
// with a reason and simply omitted from eligibleEnvironments (FR-003(f)).
async function resolveEnvironmentEligibility(environment: string): Promise<void> {
  if (!selectedApp.value) return
  try {
    // Mirrors resolveSecretMetadata(): a pre-selected qualifier must not be dropped here, or the
    // fan-out path always sees the full ambiguous-qualifier response instead of resolving cleanly.
    const response = await api.getSecrets(
      selectedApp.value.name,
      environment,
      target.value,
      undefined,
      selectedQualifier.value || undefined
    )
    const vaultCount = Array.isArray(response.vaults) ? response.vaults.length : 0
    const qualifierCount = Array.isArray((response as any).qualifiers) ? (response as any).qualifiers.length : 0
    if (vaultCount === 1 && qualifierCount <= 1) {
      envSelectionStatus.value[environment] = 'eligible'
      delete envSelectionReason.value[environment]
    } else if (qualifierCount > 1) {
      envSelectionStatus.value[environment] = 'excluded'
      envSelectionReason.value[environment] = 'Multiple sub-applications found; submit individually.'
    } else {
      envSelectionStatus.value[environment] = 'excluded'
      envSelectionReason.value[environment] = 'Multiple Key Vaults found; submit individually.'
    }
  } catch (error: any) {
    const responseData = error?.response?.data
    const vaultCount = Array.isArray(responseData?.vaults) ? responseData.vaults.length : 0
    if (vaultCount === 1) {
      envSelectionStatus.value[environment] = 'eligible'
      delete envSelectionReason.value[environment]
    } else {
      envSelectionStatus.value[environment] = 'excluded'
      envSelectionReason.value[environment] = errorMessage(error, 'No Key Vault could be resolved.')
    }
  }
}

/** Reset dependent state whenever the application changes */
function onAppNameChange() {
  selectedEnvironments.value = []
  envSelectionStatus.value = {}
  envSelectionReason.value = {}
  isRootOnlySelected.value = false
  resetSecretMetadata()
  // secrets-environment-bundles: a new application has a different (or absent) bundle catalog
  // membership, so any in-progress bundle selection/grid state is no longer valid.
  selectedBundleId.value = ''
  bundleJiraTicket.value = ''
  bundleSubmission.reset()
}

/** Parses the composite selectorValue ("{name}", "{name}::{qualifier}", or "{name}::") and sets
 * selectedAppName/selectedQualifier/isRootOnlySelected synchronously, after resetting downstream
 * state — so a qualifier choice never waits on an ambiguous-vault API round-trip. */
function onAppSelectorChange() {
  const value = selectorValue.value
  onAppNameChange()
  const delimiterIndex = value.indexOf('::')
  if (delimiterIndex === -1) {
    selectedAppName.value = value
    return
  }
  selectedAppName.value = value.slice(0, delimiterIndex)
  const qualifier = value.slice(delimiterIndex + 2)
  selectedQualifier.value = qualifier
  isRootOnlySelected.value = qualifier === ''
}

// FR-002/FR-003: react to environment selection changes. With exactly one environment selected,
// reuse the existing single-environment vault/qualifier resolution (FR-002(f)). With more than
// one, resolve per-environment ambiguity independently so ineligible environments don't block the
// rest (FR-003(b)).
watch(selectedEnvironments, async (envs, oldEnvs) => {
  if (isSubmitting.value) return
  fieldErrors.value = {}
  resetVaultResolution()

  for (const key of Object.keys(envSelectionStatus.value)) {
    if (!envs.includes(key)) {
      delete envSelectionStatus.value[key]
      delete envSelectionReason.value[key]
    }
  }

  if (envs.length === 1) {
    await resolveSecretMetadata(envs[0])
    return
  }
  if (envs.length === 0) return

  // Resolve any selected environment that has no status yet — this covers both newly-added
  // environments and one that was previously the sole selection (and so was resolved via the
  // single-environment vault/qualifier path above, never marked in envSelectionStatus).
  const added = envs.filter(env => !(env in envSelectionStatus.value))
  for (const env of added) envSelectionStatus.value[env] = 'pending'
  await Promise.all(added.map(env => resolveEnvironmentEligibility(env)))
}, { flush: 'post' })

// Re-resolve vault metadata if the sub-app qualifier changes after the initial selection
// (single-environment case only, per FR-002(f)).
watch(selectedQualifier, async (QualifierNew, QualifierOld) => {
  if (!QualifierNew || QualifierNew === QualifierOld || !selectedApp.value || isSubmitting.value) return
  if (selectedEnvironments.value.length !== 1) return
  fieldErrors.value = {}
  selectedVaultDir.value = ''
  await resolveSecretMetadata(selectedEnvironments.value[0])
})

// secrets-environment-bundles §2.7/AC3: client-side eligibility preview. Resolving is driven by
// bundle selection, not individual environment checkboxes — every deployed member environment of
// the selected bundle is checked in parallel via useBundleSubmission.resolveEnvironments().
watch(selectedBundleId, async bundleId => {
  if (!bundleId || !selectedAppName.value) return
  const environments = appEnvironmentsForBundleSelector.value
    .filter(entry => entry.bundleId === bundleId)
    .map(entry => entry.environment)
  await bundleSubmission.resolveEnvironments(selectedAppName.value, environments, target.value, {
    qualifier: selectedQualifier.value || undefined
  })
})

/** secrets-environment-bundles §2.7: switches the submission-section tab, resetting only the
 * tab being left — mirrors onAppNameChange()'s reset pattern so neither tab's in-progress state
 * leaks into the other. */
function selectMode(mode: SubmissionMode) {
  if (activeMode.value === mode) return
  activeMode.value = mode
  if (mode === 'bundles') {
    selectedEnvironments.value = []
    envSelectionStatus.value = {}
    envSelectionReason.value = {}
    isRootOnlySelected.value = false
    resetSecretMetadata()
    secretEntries.value = [{ name: '', value: '', confirmation: '' }]
    jiraTicket.value = ''
    fieldErrors.value = {}
  } else {
    selectedBundleId.value = ''
    bundleJiraTicket.value = ''
    bundleSubmission.reset()
  }
}

/** FR-004(g): resolving one ambiguous environment must never disturb another — delegates
 * straight to the composable's per-environment disambiguation. */
async function onBundleDisambiguate(payload: { environment: string; vaultDir?: string; qualifier?: string }) {
  if (!selectedAppName.value) return
  await bundleSubmission.setDisambiguation(selectedAppName.value, payload.environment, target.value, {
    vaultDir: payload.vaultDir,
    qualifier: payload.qualifier
  })
}

function onBundleRenameRow(payload: { index: number; name: string }) {
  bundleSubmission.renameSecretRow(payload.index, payload.name)
}

function onBundleUpdateCell(payload: { secretName: string; environment: string; field: 'value' | 'confirmation'; value: string }) {
  bundleSubmission.setCellValue(payload.secretName, payload.environment, payload.field, payload.value)
}


function addSecretRow() {
  if (secretEntries.value.length >= MAX_SECRET_ROWS) return
  secretEntries.value.push({ name: '', value: '', confirmation: '' })
  rowAnnouncement.value = `Secret row ${secretEntries.value.length} added`
}

function removeSecretRow(index: number) {
  if (secretEntries.value.length <= 1) return
  secretEntries.value.splice(index, 1)
  rowAnnouncement.value = `Secret row removed, ${secretEntries.value.length} remaining`
}

function validateForm(): boolean {
  const errors: Record<string, string> = {}

  if (!JIRA_RE.test(jiraTicket.value.trim())) {
    errors.jiraTicket = 'Use a format like JIRA-1234 or CR-5678.'
  }

  const seenNames = new Set<string>()
  secretEntries.value.forEach((entry, index) => {
    const name = entry.name.trim()
    if (!SECRET_NAME_RE.test(name)) {
      errors[`${index}.name`] = 'Use 1-127 letters, numbers, or hyphens.'
    } else if (seenNames.has(name.toLowerCase())) {
      errors[`${index}.name`] = 'Duplicate secret name in this submission.'
    } else {
      seenNames.add(name.toLowerCase())
    }
    if (!entry.value) errors[`${index}.value`] = 'Secret value is required.'
    if (entry.value !== entry.confirmation) errors[`${index}.confirmation`] = 'Values do not match.'
  })

  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function performSubmit() {
  if (!selectedApp.value) return
  isSubmitting.value = true
  statusCorrelationId.value = ''
  statusLink.value = ''
  statusResults.value = []
  statusMessage.value = 'Encrypting and opening pull request...'
  statusModalState.value = 'pending'
  showStatusModal.value = true

  const environments = eligibleEnvironments.value
  try {
    // FR-002(f): single-environment submissions keep threading the resolved vaultDir/qualifier
    // exactly as before; a multi-environment batch relies on each environment's own unambiguous
    // vault (ineligible/ambiguous environments are already excluded, FR-003(c)/(d)).
    const response = await api.submitSecret({
      target: target.value,
      appName: selectedApp.value.name,
      environments,
      vaultDir: environments.length === 1 ? selectedVault.value?.vaultDir : undefined,
      qualifier: environments.length === 1 ? (selectedQualifier.value || undefined) : undefined,
      jiraTicket: jiraTicket.value.trim(),
      secrets: secretEntries.value.map(entry => ({
        secretName: entry.name.trim(),
        secretValue: entry.value
      })),
      confirmedProductionWrite: hasProductionSelection.value
    })
    statusCorrelationId.value = response.correlationId || ''
    const results: SubmitResult[] = Array.isArray((response as any).results) ? (response as any).results : []
    statusResults.value = results.map(result => ({
      label: result.environment,
      success: result.success,
      message: result.error,
      link: result.prUrl
    }))
    const successCount = results.filter(r => r.success).length
    const failureCount = results.length - successCount

    if (results.length <= 1) {
      statusLink.value = response.prUrl || results[0]?.prUrl || ''
      const count = response.secretCount ?? secretEntries.value.length
      if (failureCount === 0) {
        statusModalState.value = 'success'
        statusMessage.value = response.prNumber
          ? `${count} secret${count === 1 ? '' : 's'} encrypted and PR #${response.prNumber} opened for review.`
          : `${count} secret${count === 1 ? '' : 's'} encrypted and pull request opened for review.`
      } else {
        statusModalState.value = 'failure'
        statusMessage.value = errorMessage(response, 'Secret submission failed. Please try again.')
      }
    } else if (failureCount === 0) {
      statusModalState.value = 'success'
      statusMessage.value = `${successCount} environments updated successfully. See details below.`
    } else if (successCount > 0) {
      // FR-005(d): partial success is a first-class outcome, not a page-level error.
      statusModalState.value = 'success'
      statusMessage.value = `${successCount} of ${results.length} environments succeeded; ${failureCount} need resubmission. See details below.`
    } else {
      statusModalState.value = 'failure'
      statusMessage.value = `All ${results.length} environments failed. See details below.`
    }

    if (failureCount === 0) {
      secretEntries.value = [{ name: '', value: '', confirmation: '' }]
      jiraTicket.value = ''
      selectedEnvironments.value = []
      fieldErrors.value = {}
    }
  } catch (error: any) {
    const responseData = error?.response?.data
    const results: SubmitResult[] = Array.isArray(responseData?.results) ? responseData.results : []
    statusResults.value = results.map(result => ({
      label: result.environment,
      success: result.success,
      message: result.error,
      link: result.prUrl
    }))
    statusModalState.value = 'failure'
    statusMessage.value = errorMessage(error, 'Secret submission failed. Please try again.')
  } finally {
    isSubmitting.value = false
  }
}

async function submitSecret() {
  if (!selectedApp.value || !validateForm()) return
  if (eligibleEnvironments.value.length === 0) {
    pageError.value = 'Select at least one environment eligible for submission.'
    return
  }
  pageError.value = ''

  // Flip the button into its loading state synchronously, before the (potentially slow, live
  // Key Vault) re-resolution call below — otherwise the click looks frozen while that awaits.
  isSubmitting.value = true
  if (selectedEnvironments.value.length === 1 && !(await resolveSecretMetadata(selectedEnvironments.value[0]))) {
    isSubmitting.value = false
    return
  }

  // FR-007(a)/(c): a production-tier environment in the batch requires an explicit one-click
  // confirmation before any API call fires; cancelling makes no request and creates no state.
  if (hasProductionSelection.value && !showProductionConfirm.value) {
    isSubmitting.value = false
    showProductionConfirm.value = true
    return
  }
  showProductionConfirm.value = false
  await performSubmit()
}

function confirmProductionWrite() {
  showProductionConfirm.value = false
  if (activeMode.value === 'bundles') {
    performBundleSubmit()
  } else {
    performSubmit()
  }
}

function cancelProductionWrite() {
  showProductionConfirm.value = false
}

/** secrets-environment-bundles §2.4/§2.7: assembles the payload strictly from eligible
 * environments' populated cells and submits via the shared generic `api.submitSecret` endpoint,
 * reusing the same StatusModal sync-mode UX as the legacy single/multi-environment flow. */
async function performBundleSubmit() {
  isSubmitting.value = true
  statusCorrelationId.value = ''
  statusLink.value = ''
  statusResults.value = []
  statusMessage.value = 'Encrypting and opening pull request...'
  statusModalState.value = 'pending'
  showStatusModal.value = true

  const payload = bundleSubmission.buildSubmissionPayload({
    target: target.value,
    appName: selectedAppName.value,
    bundleId: selectedBundleId.value,
    jiraTicket: bundleJiraTicket.value.trim()
  })

  try {
    const response = (await bundleSubmission.submit(payload)) as unknown as BundleSubmitResponse
    statusCorrelationId.value = response.correlationId || ''
    statusLink.value = response.prUrl || ''
    if (response.success) {
      statusModalState.value = 'success'
      const count = response.secretCount ?? 0
      statusMessage.value = response.prNumber
        ? `${count} secret${count === 1 ? '' : 's'} encrypted and PR #${response.prNumber} opened for review.`
        : `${count} secret${count === 1 ? '' : 's'} encrypted and pull request opened for review.`
      selectedBundleId.value = ''
      bundleJiraTicket.value = ''
      bundleSubmission.reset()
    } else {
      statusModalState.value = 'failure'
      statusMessage.value = errorMessage(response, 'Bundle submission failed. Please try again.')
    }
  } catch (error: any) {
    const responseData = error?.response?.data
    statusCorrelationId.value = responseData?.correlationId || ''
    statusLink.value = responseData?.prUrl || ''
    statusModalState.value = 'failure'
    statusMessage.value = errorMessage(error, 'Bundle submission failed. Please try again.')
  } finally {
    isSubmitting.value = false
  }
}

async function submitBundle() {
  if (!selectedAppName.value || !isBundleFormValid.value) return
  pageError.value = ''

  // FR-007(a)/(c) applied to bundle mode: a production-tier environment in the batch requires an
  // explicit one-click confirmation before any API call fires.
  if (hasBundleProductionSelection.value && !showProductionConfirm.value) {
    showProductionConfirm.value = true
    return
  }
  showProductionConfirm.value = false
  await performBundleSubmit()
}

watch(target, async () => {
  const previousAppName = selectedAppName.value
  const previousEnvironments = selectedEnvironments.value.slice()
  const previousBundleId = selectedBundleId.value
  resetSecretMetadata()
  // Never leave a stale root-only selection from the prior target; loadApps() re-establishes the
  // 'unresolved' state below.
  isRootOnlySelected.value = false
  await loadApps()
  if (
    selectedAppName.value === previousAppName &&
    selectedEnvironments.value.length === previousEnvironments.length &&
    selectedEnvironments.value.every(env => previousEnvironments.includes(env)) &&
    selectedEnvironments.value.length === 1
  ) {
    await resolveSecretMetadata(selectedEnvironments.value[0])
  }
  if (selectedAppName.value === previousAppName && previousBundleId && bundleCatalog.value.some(bundle => bundle.id === previousBundleId)) {
    const environments = appEnvironmentsForBundleSelector.value
      .filter(entry => entry.bundleId === previousBundleId)
      .map(entry => entry.environment)
    await bundleSubmission.resolveEnvironments(selectedAppName.value, environments, target.value, {
      qualifier: selectedQualifier.value || undefined
    })
  }
})
onMounted(loadApps)
</script>

<template>
  <section class="max-w-6xl mx-auto space-y-4" aria-labelledby="secrets-heading">
    <header>
      <h1 id="secrets-heading" class="text-2xl font-bold text-gray-900 dark:text-white">Secrets</h1>
      <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Submit encrypted values through the infrastructure review process.
      </p>
    </header>

    <div v-if="pageError" role="alert" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
      {{ pageError }}
    </div>

    <div class="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:grid-cols-2">
      <div>
        <label for="secret-target" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Infrastructure target</label>
        <select id="secret-target" v-model="target" class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white">
          <option value="live">Live</option>
          <option value="sand">Sandbox</option>
        </select>
      </div>
      <div>
        <label for="secret-app-name" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Application</label>
        <select id="secret-app-name" data-testid="app-select" v-model="selectorValue" :disabled="isLoadingApps || appSelectorGroups.length === 0" class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-white dark:disabled:bg-gray-700" @change="onAppSelectorChange">
          <option value="" disabled>Select an application</option>
          <template v-for="group in appSelectorGroups" :key="group.name">
            <option v-if="group.flatValue" :value="group.flatValue">{{ group.name }}</option>
            <optgroup v-else :label="group.name">
              <option v-if="group.rootOnlyValue" :value="group.rootOnlyValue">{{ group.name }} (all)</option>
              <option v-for="option in group.qualifierOptions" :key="option.value" :value="option.value">{{ option.qualifier }}</option>
            </optgroup>
          </template>
        </select>
      </div>
    </div>

    <!-- secrets-environment-bundles §2.7: two-tab toggle at the top of the submission section.
         "Bundles" is new and default; "All Environments" is the pre-existing free multi-select
         flow, completely unchanged below. Switching tabs resets only the tab being left. -->
    <div role="tablist" aria-label="Submission mode" class="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-700">
      <button
        v-for="tab in SUBMISSION_TABS"
        :key="tab.mode"
        type="button"
        role="tab"
        :id="`nav-tab-${tab.mode}`"
        :data-testid="`nav-tab-${tab.mode}`"
        :aria-selected="activeMode === tab.mode"
        :aria-controls="`${tab.mode}-panel`"
        :class="[
          'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all',
          activeMode === tab.mode
            ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800 dark:text-blue-400'
            : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
        ]"
        @click="selectMode(tab.mode)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- "Bundles" tab panel (spec.md §2.7) -->
    <div v-if="activeMode === 'bundles'" id="bundles-panel" role="tabpanel" aria-labelledby="nav-tab-bundles" class="space-y-4">
      <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <p v-if="!selectedAppName" class="text-sm text-gray-500 dark:text-gray-400">Select an application first.</p>
        <BundleSelector
          v-else
          :bundles="bundleCatalog"
          :app-environments="appEnvironmentsForBundleSelector"
          :selected-bundle-id="selectedBundleId"
          :eligibility="bundleSubmission.eligibility.value"
          :exclusion-reason="bundleSubmission.exclusionReason.value"
          :excluded-candidates="bundleSubmission.excludedCandidates.value"
          @update:selected-bundle-id="selectedBundleId = $event"
          @disambiguate="onBundleDisambiguate"
        />
      </div>

      <form
        v-if="selectedBundleId"
        class="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
        novalidate
        @submit.prevent="submitBundle"
      >
        <div>
          <h2 class="text-base font-semibold text-gray-900 dark:text-white">Submit bundle secrets</h2>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">Enter a value per environment for each secret name. Values are never copied across environments.</p>
        </div>

        <div>
          <label for="bundle-jira" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Jira/CR Number <span aria-hidden="true">*</span></label>
          <input id="bundle-jira" data-testid="bundle-jira" v-model="bundleJiraTicket" autocomplete="off" placeholder="e.g., JIRA-1234 or CR-5678" class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
        </div>

        <BundleSecretGrid
          :secret-names="bundleSubmission.secretNames.value"
          :environments="bundleSubmission.eligibleEnvironments.value"
          :grid-values="bundleSubmission.gridValues.value"
          :is-cell-valid="bundleSubmission.isCellValid"
          @add-row="bundleSubmission.addSecretRow"
          @remove-row="bundleSubmission.removeSecretRow"
          @rename-row="onBundleRenameRow"
          @update-cell="onBundleUpdateCell"
        />

        <button
          type="submit"
          data-testid="bundle-submit"
          :disabled="isSubmitting || !isBundleFormValid"
          class="inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {{ isSubmitting ? 'Encrypting and opening pull request...' : 'Submit bundle' }}
        </button>
      </form>
    </div>

    <!-- "All Environments" tab panel — the pre-existing free multi-select flow, unchanged. -->
    <template v-if="activeMode === 'all-environments'">
    <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800" id="all-environments-panel" role="tabpanel" aria-labelledby="nav-tab-all-environments">
      <div>
        <span class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Environments <span aria-hidden="true">*</span></span>
        <p v-if="!selectedAppName" class="text-sm text-gray-500 dark:text-gray-400">Select an application first.</p>
        <div v-else class="space-y-2">
          <fieldset v-if="environmentGroups.production.length" class="rounded-md border border-red-200 p-2.5 dark:border-red-800">
            <legend class="px-1 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">Production</legend>
            <div class="flex flex-wrap gap-2">
              <label v-for="option in environmentGroups.production" :key="option.environment" class="inline-flex min-h-11 items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input
                  type="checkbox"
                  :value="option.environment"
                  v-model="selectedEnvironments"
                  :disabled="!selectedEnvironments.includes(option.environment) && atMaxEnvironments"
                />
                {{ option.environment }}
                <span v-if="selectedEnvironments.length > 1 && envSelectionStatus[option.environment] === 'excluded'" class="text-xs text-red-600" role="alert">{{ envSelectionReason[option.environment] }}</span>
              </label>
            </div>
          </fieldset>
          <fieldset v-if="environmentGroups['non-production'].length" class="rounded-md border border-gray-200 p-2.5 dark:border-gray-700">
            <legend class="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Non-Production</legend>
            <div class="flex flex-wrap gap-2">
              <label v-for="option in environmentGroups['non-production']" :key="option.environment" class="inline-flex min-h-11 items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input
                  type="checkbox"
                  :value="option.environment"
                  v-model="selectedEnvironments"
                  :disabled="!selectedEnvironments.includes(option.environment) && atMaxEnvironments"
                />
                {{ option.environment }}
                <span v-if="selectedEnvironments.length > 1 && envSelectionStatus[option.environment] === 'excluded'" class="text-xs text-red-600" role="alert">{{ envSelectionReason[option.environment] }}</span>
              </label>
            </div>
          </fieldset>
          <fieldset v-if="environmentGroups.unclassified.length" class="rounded-md border border-gray-200 p-2.5 dark:border-gray-700">
            <legend class="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Other</legend>
            <div class="flex flex-wrap gap-2">
              <label v-for="option in environmentGroups.unclassified" :key="option.environment" class="inline-flex min-h-11 items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input
                  type="checkbox"
                  :value="option.environment"
                  v-model="selectedEnvironments"
                  :disabled="!selectedEnvironments.includes(option.environment) && atMaxEnvironments"
                />
                {{ option.environment }}
                <span v-if="selectedEnvironments.length > 1 && envSelectionStatus[option.environment] === 'excluded'" class="text-xs text-red-600" role="alert">{{ envSelectionReason[option.environment] }}</span>
              </label>
            </div>
          </fieldset>
          <p v-if="atMaxEnvironments" class="text-xs text-gray-500 dark:text-gray-400">Maximum 10 environments per submission.</p>
        </div>
      </div>
    </div>

    <form class="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800" novalidate @submit.prevent="submitSecret">
      <div>
        <h2 class="text-base font-semibold text-gray-900 dark:text-white">Submit secrets</h2>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">Values are encrypted server-side and are never displayed after submission. Add up to 20 secrets to submit them in a single pull request.</p>
      </div>

      <div class="sr-only" aria-live="polite">{{ rowAnnouncement }}</div>

      <div>
        <label for="secret-jira" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Jira/CR Number <span aria-hidden="true">*</span></label>
        <input id="secret-jira" v-model="jiraTicket" autocomplete="off" :aria-describedby="fieldErrors.jiraTicket ? 'secret-jira-error' : undefined" placeholder="e.g., JIRA-1234 or CR-5678" class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
        <p v-if="fieldErrors.jiraTicket" id="secret-jira-error" class="mt-1 text-sm text-red-600" role="alert">{{ fieldErrors.jiraTicket }}</p>
      </div>

      <!-- Always show available Key Vaults once resolved, so users can see which vault(s) their
           secret will land in. When only one vault exists it is auto-selected and the select is
           disabled; when multiple vaults exist the user must choose. -->
      <div v-if="vaults.length >= 1">
        <label for="secret-vault" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Key Vault <span v-if="vaults.length > 1" aria-hidden="true">*</span></label>
        <select id="secret-vault" v-model="selectedVaultDir" :disabled="vaults.length === 1" :aria-describedby="fieldErrors.selectedVaultDir ? 'secret-vault-error' : undefined" class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white dark:disabled:bg-gray-800 dark:disabled:text-gray-400" @change="delete fieldErrors.selectedVaultDir; delete fieldErrors.selectedQualifier">
          <option v-if="vaults.length > 1" value="">Select a Key Vault</option>
          <option v-for="vault in vaults" :key="vault.vaultDir" :value="vault.vaultDir">{{ vault.vaultName || 'Key Vault name unavailable' }}</option>
        </select>
        <p v-if="fieldErrors.selectedVaultDir" id="secret-vault-error" class="mt-1 text-sm text-red-600" role="alert">{{ fieldErrors.selectedVaultDir }}</p>
      </div>

      <!-- vault-resolution-override: inline "Set name manually" self-heal control, shown only
           when the currently selected vault's name could not be resolved. -->
      <div v-if="selectedVault && !selectedVault.vaultName" class="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
        <button
          v-if="!showOverrideForm"
          type="button"
          aria-label="Set name manually"
          class="text-sm font-medium text-blue-600 hover:underline"
          @click="openOverrideForm"
        >
          Set name manually
        </button>
        <div v-else class="space-y-2">
          <div>
            <label for="vault-override-name" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Key Vault name <span aria-hidden="true">*</span></label>
            <input id="vault-override-name" v-model="overrideName" autocomplete="off" class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
          </div>
          <div>
            <label for="vault-override-rg" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Resource group (optional)</label>
            <input id="vault-override-rg" v-model="overrideResourceGroup" autocomplete="off" class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
          </div>
          <p v-if="overrideError" class="text-sm text-red-600" role="alert">{{ overrideError }}</p>
          <div class="flex gap-2">
            <button
              type="button"
              data-testid="vault-override-save"
              :disabled="isSubmittingOverride || !overrideName.trim()"
              class="inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              @click="submitOverride"
            >
              {{ isSubmittingOverride ? 'Saving...' : 'Save' }}
            </button>
            <button
              type="button"
              class="inline-flex min-h-11 items-center rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              @click="cancelOverrideForm"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <!-- FR-004 Round 4: sub-app qualifier selector — shown only when the vault resolution
           returned multiple qualifiers (e.g. idm has notif + autobk under _idmapplications). -->
      <div v-if="qualifiers.length > 1">
        <label for="secret-qualifier" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Sub-application <span aria-hidden="true">*</span></label>
        <select id="secret-qualifier" v-model="selectedQualifier" :aria-describedby="fieldErrors.selectedQualifier ? 'secret-qualifier-error' : undefined" class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white" @change="selectedVaultDir = ''">
          <option value="">Select a sub-application</option>
          <option v-for="qualifier in qualifiers" :key="qualifier" :value="qualifier">{{ qualifier }}</option>
        </select>
        <p v-if="fieldErrors.selectedQualifier" id="secret-qualifier-error" class="mt-1 text-sm text-red-600" role="alert">{{ fieldErrors.selectedQualifier }}</p>
      </div>

      <div v-for="(entry, index) in secretEntries" :key="index" class="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-700">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Secret {{ index + 1 }}</h3>
          <button type="button" :disabled="secretEntries.length <= 1" class="text-sm text-red-600 disabled:cursor-not-allowed disabled:text-gray-400" @click="removeSecretRow(index)">
            Remove
          </button>
        </div>

        <div>
          <label :for="`secret-name-${index}`" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Secret name</label>
          <input :id="`secret-name-${index}`" v-model="entry.name" autocomplete="off" :aria-describedby="fieldErrors[`${index}.name`] ? `secret-name-error-${index}` : undefined" class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
          <p v-if="fieldErrors[`${index}.name`]" :id="`secret-name-error-${index}`" class="mt-1 text-sm text-red-600" role="alert">{{ fieldErrors[`${index}.name`] }}</p>
        </div>

        <div>
          <label :for="`secret-value-${index}`" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Secret value</label>
          <input :id="`secret-value-${index}`" v-model="entry.value" type="password" autocomplete="new-password" :aria-describedby="fieldErrors[`${index}.value`] ? `secret-value-error-${index}` : undefined" class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
          <p v-if="fieldErrors[`${index}.value`]" :id="`secret-value-error-${index}`" class="mt-1 text-sm text-red-600" role="alert">{{ fieldErrors[`${index}.value`] }}</p>
        </div>

        <div>
          <label :for="`secret-confirmation-${index}`" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Confirm secret value</label>
          <input :id="`secret-confirmation-${index}`" v-model="entry.confirmation" type="password" autocomplete="new-password" :aria-describedby="fieldErrors[`${index}.confirmation`] ? `secret-confirmation-error-${index}` : undefined" class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
          <p v-if="fieldErrors[`${index}.confirmation`]" :id="`secret-confirmation-error-${index}`" class="mt-1 text-sm text-red-600" role="alert">{{ fieldErrors[`${index}.confirmation`] }}</p>
        </div>
      </div>

      <button type="button" :disabled="secretEntries.length >= MAX_SECRET_ROWS" class="inline-flex min-h-11 items-center rounded-md border border-blue-600 px-4 py-2 font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400 dark:hover:bg-blue-900/20" @click="addSecretRow">
        Add Secret
      </button>

      <button type="submit" :disabled="isSubmitting || !selectedApp || !isFormValid" class="inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400">
        {{ isSubmitting ? 'Encrypting and opening pull request...' : 'Submit secrets' }}
      </button>
    </form>
    </template>

    <!-- FR-007: production-tier write confirmation, adapted from AppSelector.vue's
         showConfirmDialog inline dialog pattern (see PRD Evidence Table row 9). Shared by both
         tabs — `productionConfirmEnvironments` sources its list from whichever tab is active. -->
    <div
      v-if="showProductionConfirm"
      data-testid="confirm-production-write-dialog"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-production-title"
    >
      <div class="w-full max-w-md rounded-lg bg-white p-4 shadow-lg dark:bg-gray-800">
        <p id="confirm-production-title" class="text-base font-semibold text-gray-900 dark:text-white">
          Confirm production write
        </p>
        <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
          This submission includes the following production environment(s):
          <strong>{{ productionConfirmEnvironments.join(', ') }}</strong>.
        </p>
        <div class="mt-3 flex justify-end gap-3">
          <button type="button" data-testid="confirm-production-write-yes" class="inline-flex min-h-11 items-center rounded-md bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700" @click="confirmProductionWrite">
            Confirm production write
          </button>
          <button type="button" data-testid="confirm-production-write-cancel" class="inline-flex min-h-11 items-center rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700" @click="cancelProductionWrite">
            Cancel
          </button>
        </div>
      </div>
    </div>

    <StatusModal
      :is-visible="showStatusModal"
      :correlation-id="statusCorrelationId"
      mode="sync"
      :sync-state="statusModalState"
      :sync-message="statusMessage"
      :sync-link="statusLink"
      :results="statusResults"
      sync-link-label="View pull request"
      title="Secret submission"
      @close="showStatusModal = false"
    />
  </section>
</template>
