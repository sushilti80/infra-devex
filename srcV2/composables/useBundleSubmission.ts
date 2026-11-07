import { computed, ref } from 'vue'
import api from '@v2/services/api'
import type { BundleEnvironmentSecrets } from '@v2/types/infrastructure.types'

export type BundleEligibilityStatus = 'pending' | 'eligible' | 'excluded'

export interface BundleDisambiguation {
  vaultDir?: string
  qualifier?: string
}

export interface BundleCandidateVault {
  vaultDir: string
  vaultName?: string | null
  resourceGroup?: string | null
}

export interface BundleExcludedCandidates {
  vaults?: BundleCandidateVault[]
  qualifiers?: string[]
}

export interface BundleGridCell {
  value: string
  confirmation: string
}

export interface BundleSubmissionPayload {
  target: string
  appName: string
  bundleId: string
  environmentSecrets: BundleEnvironmentSecrets[]
  jiraTicket: string
}

/**
 * secrets-environment-bundles (spec.md §2.7): owns pre-flight eligibility resolution,
 * per-environment vaultDir/qualifier disambiguation, the secretName x environment value grid, and
 * bundle-mode submission-payload assembly. Mirrors the classification rules already used by
 * `SecretsPage.vue`'s `resolveEnvironmentEligibility()` (FR-004 read path) but — per FR-004(g) —
 * tracks disambiguation **per environment** instead of a single page-wide `selectedQualifier` ref,
 * so resolving one ambiguous environment never disturbs another.
 */
export function useBundleSubmission() {
  const eligibility = ref<Record<string, BundleEligibilityStatus>>({})
  const exclusionReason = ref<Record<string, string>>({})
  // Raw candidate vaults/qualifiers behind the current exclusionReason, so a disambiguation
  // control (e.g. BundleSelector.vue) can offer concrete options instead of free text.
  const excludedCandidates = ref<Record<string, BundleExcludedCandidates>>({})
  const perEnvironmentDisambiguation = ref<Record<string, BundleDisambiguation>>({})
  const secretNames = ref<string[]>([''])
  const gridValues = ref<Record<string, Record<string, BundleGridCell>>>({})
  const isResolving = ref(false)
  let resolutionGeneration = 0

  /** Environments currently classified eligible — the only ones a submission may include. */
  const eligibleEnvironments = computed(() =>
    Object.keys(eligibility.value).filter(env => eligibility.value[env] === 'eligible')
  )

  function reset(): void {
    resolutionGeneration += 1
    eligibility.value = {}
    exclusionReason.value = {}
    excludedCandidates.value = {}
    perEnvironmentDisambiguation.value = {}
    secretNames.value = ['']
    gridValues.value = {}
    isResolving.value = false
  }

  /** Classifies one environment via the existing GET /api/secrets/:appName/:environment endpoint,
   * applying any previously-supplied per-environment vaultDir/qualifier disambiguation. */
  async function resolveEnvironmentEligibility(
    appName: string,
    environment: string,
    target: string,
    autoResolving = false,
    generation?: number
  ): Promise<void> {
    if (generation !== undefined && generation !== resolutionGeneration) return
    const disambiguation = perEnvironmentDisambiguation.value[environment] || {}
    eligibility.value[environment] = 'pending'
    try {
      const response = await api.getSecrets(
        appName,
        environment,
        target as 'live' | 'sand',
        disambiguation.vaultDir,
        disambiguation.qualifier
      )
      if (generation !== undefined && generation !== resolutionGeneration) return
      const responseVaults = response.vaults as BundleCandidateVault[] | undefined
      const responseQualifiers = (response as unknown as { qualifiers?: string[] }).qualifiers
      const vaultCount = Array.isArray(responseVaults) ? responseVaults.length : 0
      const qualifierCount = Array.isArray(responseQualifiers) ? responseQualifiers.length : 0
      // A 200 here with an explicit vaultDir already sent means the server matched that exact
      // vault (a mismatch is a 422, handled below) \u2014 the raw counts still reflect every sibling
      // qualifier's vaults, so they must not override an already-precise disambiguation.
      if (disambiguation.vaultDir || (vaultCount === 1 && qualifierCount <= 1)) {
        eligibility.value[environment] = 'eligible'
        delete exclusionReason.value[environment]
        delete excludedCandidates.value[environment]
      } else if (
        qualifierCount > 1 &&
        !autoResolving &&
        !disambiguation.qualifier &&
        (await autoResolveToRootVault(appName, environment, target, responseVaults, generation))
      ) {
        return
      } else if (qualifierCount > 1) {
        eligibility.value[environment] = 'excluded'
        exclusionReason.value[environment] = 'Multiple sub-applications found; supply a qualifier to disambiguate.'
        excludedCandidates.value[environment] = { vaults: responseVaults, qualifiers: responseQualifiers }
      } else {
        eligibility.value[environment] = 'excluded'
        exclusionReason.value[environment] = 'Multiple Key Vaults found; supply a vault to disambiguate.'
        excludedCandidates.value[environment] = { vaults: responseVaults, qualifiers: responseQualifiers }
      }
    } catch (error: unknown) {
      const responseData = (error as { response?: { data?: { vaults?: BundleCandidateVault[]; qualifiers?: string[]; message?: string; error?: string } } })
        ?.response?.data
      if (generation !== undefined && generation !== resolutionGeneration) return
      const vaultCount = Array.isArray(responseData?.vaults) ? responseData.vaults.length : 0
      const qualifierCount = Array.isArray(responseData?.qualifiers) ? responseData.qualifiers.length : 0
      if (
        qualifierCount > 1 &&
        !autoResolving &&
        !disambiguation.qualifier &&
        (await autoResolveToRootVault(appName, environment, target, responseData?.vaults, generation))
      ) {
        return
      } else if (qualifierCount > 1) {
        eligibility.value[environment] = 'excluded'
        exclusionReason.value[environment] = responseData?.message || responseData?.error || 'Multiple sub-applications found; supply a qualifier to disambiguate.'
        excludedCandidates.value[environment] = { vaults: responseData?.vaults, qualifiers: responseData?.qualifiers }
      } else if (vaultCount === 1) {
        eligibility.value[environment] = 'eligible'
        delete exclusionReason.value[environment]
        delete excludedCandidates.value[environment]
      } else {
        eligibility.value[environment] = 'excluded'
        exclusionReason.value[environment] = responseData?.message || responseData?.error || 'No Key Vault could be resolved.'
        excludedCandidates.value[environment] = { vaults: responseData?.vaults, qualifiers: responseData?.qualifiers }
      }
    }

    /** IDM-style apps expose their own parent/root Key Vault alongside sub-app qualifiers (e.g.
     * idm-int-uks-kv-1 next to idmprtl-int-uks-kv-1). Selecting an unqualified "(all)" application
     * already signals "the parent app's own vault, not any sub-app" — so when exactly one
     * candidate has no qualifier, resolve straight to it instead of forcing a manual
     * disambiguation click for what is not actually ambiguous. */
    async function autoResolveToRootVault(
      autoAppName: string,
      autoEnvironment: string,
      autoTarget: string,
      candidateVaults: BundleCandidateVault[] | undefined,
      generation?: number
    ): Promise<boolean> {
      if (generation !== undefined && generation !== resolutionGeneration) return false
      const unqualified = (candidateVaults || []).filter(vault => !(vault as { qualifier?: string }).qualifier)
      if (unqualified.length !== 1) return false
      perEnvironmentDisambiguation.value[autoEnvironment] = { ...disambiguation, vaultDir: unqualified[0].vaultDir }
      await resolveEnvironmentEligibility(autoAppName, autoEnvironment, autoTarget, true, generation)
      return true
    }
  }

  /** Resolves every given environment in parallel and drops stale entries no longer requested
   * (e.g. after switching bundles or apps). */
  async function resolveEnvironments(
    appName: string,
    environments: string[],
    target: string,
    defaultDisambiguation: BundleDisambiguation = {}
  ): Promise<void> {
    const generation = ++resolutionGeneration
    isResolving.value = true
    try {
      for (const key of Object.keys(eligibility.value)) {
        if (!environments.includes(key)) {
          delete eligibility.value[key]
          delete exclusionReason.value[key]
          delete excludedCandidates.value[key]
        }
      }
      for (const environment of environments) {
        const existingDisambiguation = perEnvironmentDisambiguation.value[environment]
        if (Object.keys(defaultDisambiguation).length > 0 || existingDisambiguation) {
          perEnvironmentDisambiguation.value[environment] = {
            ...defaultDisambiguation,
            ...existingDisambiguation
          }
        }
      }
      await Promise.all(environments.map(environment => resolveEnvironmentEligibility(appName, environment, target, false, generation)))
    } finally {
      if (generation === resolutionGeneration) isResolving.value = false
    }
  }

  /** Supplies vaultDir/qualifier for one ambiguous environment and re-resolves only that
   * environment — FR-004(g) explicitly forbids this from affecting any other environment. */
  async function setDisambiguation(
    appName: string,
    environment: string,
    target: string,
    disambiguation: BundleDisambiguation
  ): Promise<void> {
    perEnvironmentDisambiguation.value[environment] = disambiguation
    await resolveEnvironmentEligibility(appName, environment, target, false, resolutionGeneration)
  }

  function addSecretRow(): void {
    secretNames.value.push('')
  }

  function removeSecretRow(index: number): void {
    if (secretNames.value.length <= 1) return
    const [removed] = secretNames.value.splice(index, 1)
    if (removed !== undefined) delete gridValues.value[removed]
  }

  /** Renames a secret row, migrating any values already entered under the old name so they are
   * not silently lost. */
  function renameSecretRow(index: number, name: string): void {
    const previous = secretNames.value[index]
    secretNames.value[index] = name
    if (previous !== undefined && previous !== name && gridValues.value[previous]) {
      gridValues.value[name] = gridValues.value[previous]
      delete gridValues.value[previous]
    }
  }

  function setCellValue(secretName: string, environment: string, field: keyof BundleGridCell, value: string): void {
    if (!gridValues.value[secretName]) gridValues.value[secretName] = {}
    if (!gridValues.value[secretName][environment]) gridValues.value[secretName][environment] = { value: '', confirmation: '' }
    gridValues.value[secretName][environment][field] = value
  }

  /** FR-006(c): each cell's value/confirmation match is validated independently — an empty,
   * untouched cell is treated as valid (not yet filled in), not as a mismatch. */
  function isCellValid(secretName: string, environment: string): boolean {
    const cell = gridValues.value[secretName]?.[environment]
    if (!cell || (!cell.value && !cell.confirmation)) return true
    return cell.value === cell.confirmation
  }

  /** Assembles the bundle-mode POST /api/secrets body strictly from eligible environments and
   * their populated cells — FR-006(d): a value is never copied across environments. */
  function buildSubmissionPayload(options: {
    target: string
    appName: string
    bundleId: string
    jiraTicket: string
  }): BundleSubmissionPayload {
    const trimmedNames = secretNames.value.map(name => name.trim()).filter(Boolean)
    const environmentSecrets: BundleEnvironmentSecrets[] = eligibleEnvironments.value.map(environment => {
      const disambiguation = perEnvironmentDisambiguation.value[environment] || {}
      const secrets = trimmedNames
        .map(secretName => ({ secretName, secretValue: gridValues.value[secretName]?.[environment]?.value ?? '' }))
        .filter(secret => secret.secretValue !== '')
      const entry: BundleEnvironmentSecrets = { environment, secrets }
      if (disambiguation.vaultDir) entry.vaultDir = disambiguation.vaultDir
      if (disambiguation.qualifier) entry.qualifier = disambiguation.qualifier
      return entry
    })
    return {
      target: options.target,
      appName: options.appName,
      bundleId: options.bundleId,
      environmentSecrets,
      jiraTicket: options.jiraTicket
    }
  }

  async function submit(payload: BundleSubmissionPayload) {
    return api.submitSecret(payload as unknown as Record<string, unknown>)
  }

  return {
    eligibility,
    exclusionReason,
    excludedCandidates,
    perEnvironmentDisambiguation,
    secretNames,
    gridValues,
    isResolving,
    eligibleEnvironments,
    reset,
    resolveEnvironmentEligibility,
    resolveEnvironments,
    setDisambiguation,
    addSecretRow,
    removeSecretRow,
    renameSecretRow,
    setCellValue,
    isCellValid,
    buildSubmissionPayload,
    submit
  }
}
