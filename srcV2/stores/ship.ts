import { defineStore } from 'pinia'
import { ref, reactive, computed, watch } from 'vue'
import { apiService } from '@v2/services/api'
import { useAuthStore } from '@v2/stores/auth'
import { useEnvironmentsStore } from '@v2/stores/environments'
import {
  addRecent, readRecent, removeRecent, setRecentTerminal, clearShipRecent
} from '@v2/utils/shipRecentStorage'
import {
  appNameFromRepo, branchError, dnsLabelError, healthPathError, parseRepoInput, portError, toShipApiError
} from '@v2/utils/shipHelpers'
import type {
  RecentShipEntry, ShipApiError, ShipAppAdvisory, ShipBranch, ShipConfig, ShipDraft, ShipRepo,
  ShipRunState, ShipStartResponse, ShipStatus
} from '@v2/types/ship.types'

type Load = 'idle' | 'loading' | 'ready' | 'error'
export type RecentRowState = { state: 'loading' | 'ok' | 'error' | 'unavailable'; runState?: ShipRunState }

export interface ActiveShip {
  correlationId: string
  start: ShipStartResponse | null
  status: ShipStatus | null
  /** Last status-poll failure (shown as a soft notice; polling keeps backing off). */
  loadError: ShipApiError | null
  /** 403/404: the ship can't be shown to this user (or has expired). */
  unavailable: boolean
  cancelling: boolean
  actionError: ShipApiError | null
}

const CLIENT_CACHE_MS = 5 * 60 * 1000
const ADVISORY_DEBOUNCE_MS = 500
const ADVISORY_DEDUPE_MS = 60 * 1000
const RECENT_REFRESH_CONCURRENCY = 3
const DEFAULT_DRAFT: ShipDraft = {
  repo: '', branch: '', app: '', env: '', namespace: '', teamLabel: 'software-engineering',
  port: 8080, healthPath: '/healthz', bump: 'patch'
}

/** Ship from Repo state (spec §3.10.3). Calls the API only through srcV2/services/api.ts. */
export const useShipStore = defineStore('ship', () => {
  const auth = useAuthStore()
  const environments = useEnvironmentsStore()

  // ── config ──────────────────────────────────────────────────────────────
  const config = ref<ShipConfig | null>(null)
  const configStatus = ref<Load>('idle')
  const configError = ref<ShipApiError | null>(null)

  // ── repos / branches (5-min client cache) ──────────────────────────────
  const repos = ref<ShipRepo[]>([])
  const reposStatus = ref<Load>('idle')
  const reposError = ref<ShipApiError | null>(null)
  const reposTruncated = ref(false)
  let reposFetchedAt = 0

  const branches = ref<ShipBranch[]>([])
  const branchesStatus = ref<Load>('idle')
  const branchesError = ref<ShipApiError | null>(null)
  const defaultBranch = ref('')
  const branchCache = new Map<string, { at: number; branches: ShipBranch[]; defaultBranch: string }>()

  // ── form draft ─────────────────────────────────────────────────────────
  const draft = reactive<ShipDraft>({ ...DEFAULT_DRAFT })
  const appNameTouched = ref(false)
  const fieldErrors = ref<Record<string, string>>({})
  const submitting = ref(false)
  const startError = ref<ShipApiError | null>(null)

  // ── app advisory (endpoint #4; debounced + de-duplicated) ──────────────
  const advisory = ref<ShipAppAdvisory | null>(null)
  const advisoryCache = new Map<string, { at: number; value: ShipAppAdvisory }>()
  let advisoryTimer: ReturnType<typeof setTimeout> | null = null

  // ── active ship + recent ships ─────────────────────────────────────────
  const active = ref<ActiveShip | null>(null)
  const recent = ref<RecentShipEntry[]>([])
  const recentStates = ref<Record<string, RecentRowState>>({})

  const userId = () => auth.user?.id ?? ''

  // ── derived ────────────────────────────────────────────────────────────
  const identityLinked = computed(() => config.value?.identity.state === 'linked')
  const postMerge = computed(() => advisory.value?.appState === 'merged')
  const selectedRepo = computed(() => repos.value.find(r => r.fullName.toLowerCase() === draft.repo.toLowerCase()) ?? null)
  const selectedOrg = computed(() => draft.repo.split('/')[0] || '')

  /** True when the early advisory says the app name belongs to something else (blocks submit, AC-002-7). */
  const nameOwnedByOther = computed(() => advisory.value?.ownership === 'other_repo' || advisory.value?.ownership === 'unowned_existing')

  const validationErrors = computed<Record<string, string>>(() => {
    const e: Record<string, string> = {}
    const limits = config.value?.limits ?? { portMin: 1024, portMax: 65535 }
    if (!parseRepoInput(draft.repo)) e.repo = 'Choose a repository (org/name).'
    const be = branchError(draft.branch)
    if (be) e.branch = be
    const ae = dnsLabelError('App name', draft.app)
    if (ae) e.app = ae
    if (!draft.env) e.env = 'Choose an environment.'
    if (draft.namespace) {
      const ne = dnsLabelError('Namespace', draft.namespace)
      if (ne) e.namespace = ne
    }
    const te = dnsLabelError('Team label', draft.teamLabel)
    if (te) e.teamLabel = te
    if (!postMerge.value) {
      const pe = portError(draft.port, limits.portMin, limits.portMax)
      if (pe) e.port = pe
      const he = healthPathError(draft.healthPath)
      if (he) e.healthPath = he
    }
    if (nameOwnedByOther.value && !e.app) {
      const owner = advisory.value?.owningRepo
      e.app = owner
        ? `This app name is already used by another source repository (${owner}). Choose a different name.`
        : 'This app name is already used by a different source repository. Choose a different name.'
    }
    return e
  })

  /** Client errors first, then errors returned by the server for the last submit. */
  const allErrors = computed(() => ({ ...fieldErrors.value, ...validationErrors.value }))
  const canSubmit = computed(() =>
    identityLinked.value && !submitting.value && Object.keys(validationErrors.value).length === 0)

  // ── actions: config ────────────────────────────────────────────────────
  async function loadConfig(): Promise<void> {
    configStatus.value = 'loading'
    configError.value = null
    try {
      const res = await apiService.getShipConfig()
      if (!res.success || !res.data) throw new Error('empty')
      config.value = res.data
      configStatus.value = 'ready'
      applyDefaults(res.data)
    } catch (err) {
      configError.value = toShipApiError(err)
      configStatus.value = 'error'
    }
  }

  function applyDefaults(c: ShipConfig) {
    if (!draft.repo) {
      draft.port = c.defaults.port
      draft.healthPath = c.defaults.healthPath
      draft.bump = c.defaults.bump
      draft.teamLabel = c.defaults.teamLabel
    }
    const envs = environments.shipEnvironments
    if (!draft.env || !envs.some(e => e.id === draft.env)) draft.env = envs.length === 1 ? envs[0].id : ''
  }

  // ── actions: repos & branches ──────────────────────────────────────────
  async function loadRepos(q = '', force = false): Promise<void> {
    if (!q && !force && reposStatus.value === 'ready' && Date.now() - reposFetchedAt < CLIENT_CACHE_MS) return
    reposStatus.value = 'loading'
    reposError.value = null
    try {
      const res = await apiService.listShipRepos(q)
      if (!res.success || !res.data) throw new Error('empty')
      repos.value = res.data.repos
      reposTruncated.value = !!res.data.truncated
      reposStatus.value = 'ready'
      if (!q) reposFetchedAt = Date.now()
      if (res.data.identity?.state === 'unlinked' && config.value) {
        config.value = { ...config.value, identity: res.data.identity }
      }
    } catch (err) {
      reposError.value = toShipApiError(err)
      reposStatus.value = 'error'
    }
  }

  async function loadBranches(fullName: string): Promise<void> {
    const repo = parseRepoInput(fullName)
    if (!repo) return
    const [org, name] = repo.split('/')
    const cached = branchCache.get(repo.toLowerCase())
    branchesError.value = null
    if (cached && Date.now() - cached.at < CLIENT_CACHE_MS) {
      branches.value = cached.branches
      defaultBranch.value = cached.defaultBranch
      branchesStatus.value = 'ready'
      return
    }
    branchesStatus.value = 'loading'
    try {
      const res = await apiService.listShipBranches(org, name)
      if (draft.repo.toLowerCase() !== repo.toLowerCase()) return // user moved on
      if (!res.success || !res.data) throw new Error('empty')
      branches.value = res.data.branches
      defaultBranch.value = res.data.defaultBranch
      branchCache.set(repo.toLowerCase(), { at: Date.now(), branches: res.data.branches, defaultBranch: res.data.defaultBranch })
      branchesStatus.value = 'ready'
    } catch (err) {
      if (draft.repo.toLowerCase() !== repo.toLowerCase()) return
      branches.value = []
      branchesError.value = toShipApiError(err)
      branchesStatus.value = 'error'
    }
  }

  /** Repo chosen or pasted: prefill app name (unless edited) and branch (default branch, AC-001-3). */
  async function selectRepo(input: string): Promise<void> {
    const repo = parseRepoInput(input)
    if (!repo) {
      draft.repo = input.trim()
      return
    }
    const changed = repo.toLowerCase() !== draft.repo.toLowerCase()
    draft.repo = repo
    if (!changed) return
    draft.branch = ''
    branches.value = []
    defaultBranch.value = ''
    if (!appNameTouched.value) draft.app = appNameFromRepo(repo)
    await loadBranches(repo)
    const known = repos.value.find(r => r.fullName.toLowerCase() === repo.toLowerCase())
    if (!draft.branch && draft.repo === repo) draft.branch = defaultBranch.value || known?.defaultBranch || ''
  }

  function setApp(value: string) {
    draft.app = value
    appNameTouched.value = true
  }

  // ── actions: advisory (debounced 500 ms, de-duplicated per (env,app,repo) 60 s) ──
  function queueAdvisory() {
    if (advisoryTimer) clearTimeout(advisoryTimer)
    advisoryTimer = setTimeout(() => {
      advisoryTimer = null
      void runAdvisory()
    }, ADVISORY_DEBOUNCE_MS)
  }

  async function runAdvisory(): Promise<void> {
    const repo = parseRepoInput(draft.repo)
    if (!repo || !draft.env || dnsLabelError('App', draft.app)) {
      advisory.value = null
      return
    }
    const { env, app } = draft
    const key = `${env}|${app}|${repo.toLowerCase()}`
    const hit = advisoryCache.get(key)
    if (hit && Date.now() - hit.at < ADVISORY_DEDUPE_MS) {
      advisory.value = hit.value
      applyEffectiveSettings()
      return
    }
    try {
      const res = await apiService.getShipAppState(env, app, repo)
      if (!res.success || !res.data) return
      advisoryCache.set(key, { at: Date.now(), value: res.data })
      if (`${draft.env}|${draft.app}|${draft.repo.toLowerCase()}` !== key) return // stale
      advisory.value = res.data
      applyEffectiveSettings()
    } catch {
      // Advisory only – the authoritative checks run at submit. Swallow (a repo-access error surfaces via branches).
      if (`${draft.env}|${draft.app}|${draft.repo.toLowerCase()}` === key) advisory.value = null
    }
  }

  /** Post-merge the merged config wins (AC-012-3): show the effective values read-only. */
  function applyEffectiveSettings() {
    const eff = advisory.value?.appState === 'merged' ? advisory.value.effectiveSettings : undefined
    if (eff) {
      draft.port = eff.port
      draft.healthPath = eff.healthPath
    }
  }

  watch([() => draft.repo, () => draft.app, () => draft.env], () => {
    advisory.value = null
    queueAdvisory()
  })

  // ── actions: submit ────────────────────────────────────────────────────
  async function submit(): Promise<ShipStartResponse | null> {
    if (!canSubmit.value) return null
    submitting.value = true
    startError.value = null
    fieldErrors.value = {}
    const repo = parseRepoInput(draft.repo) as string
    const payload = {
      repo, branch: draft.branch, app: draft.app, env: draft.env,
      ...(draft.namespace ? { namespace: draft.namespace } : {}),
      teamLabel: draft.teamLabel, bump: draft.bump,
      // Post-merge the server keeps the merged config; do not send settings it would ignore.
      ...(postMerge.value ? {} : { port: Number(draft.port), healthPath: draft.healthPath })
    }
    try {
      const res = await apiService.startShip(payload)
      if (!res.success || !res.data) throw new Error('empty')
      const started = res.data
      active.value = { correlationId: started.correlationId, start: started, status: null, loadError: null, unavailable: false, cancelling: false, actionError: null }
      recent.value = addRecent(userId(), {
        correlationId: started.correlationId, app: started.app, env: started.env, repo: started.repo,
        branch: started.branch, startedAt: started.startedAt
      })
      return started
    } catch (err) {
      const e = toShipApiError(err)
      startError.value = e
      if (e.code === 'VALIDATION_FAILED' && Array.isArray(e.details)) {
        const map: Record<string, string> = {}
        for (const d of e.details as Array<{ field?: unknown; message?: unknown }>) {
          if (typeof d?.field === 'string' && typeof d?.message === 'string') map[d.field] = d.message
        }
        fieldErrors.value = map
      } else if (e.code === 'APP_OWNED_BY_OTHER') {
        fieldErrors.value = { app: 'This app name is already used by a different source repository. Choose a different name.' }
      }
      return null
    } finally {
      submitting.value = false
    }
  }

  // ── actions: status (consumed through useShipPolling's callbacks) ──────
  async function fetchStatus(correlationId: string): Promise<ShipStatus> {
    const res = await apiService.getShipStatus(correlationId)
    if (!res.success || !res.data) throw new Error('empty status')
    return res.data
  }

  function applyStatus(status: ShipStatus): void {
    if (!active.value || active.value.correlationId !== status.correlationId) return
    active.value.status = status
    active.value.loadError = null
    active.value.unavailable = false
    storeTerminal(status)
  }

  /** Persist a terminal outcome with the recent entry (terminal entries are never re-fetched). */
  function storeTerminal(status: ShipStatus): void {
    if (!status.terminal || (status.state !== 'succeeded' && status.state !== 'failed' && status.state !== 'cancelled')) return
    recent.value = setRecentTerminal(userId(), status.correlationId, {
      state: status.state,
      ...(status.version ? { version: status.version } : {}),
      ...(status.pr?.url ? { prUrl: status.pr.url } : {})
    })
  }

  function applyStatusError(err: unknown): void {
    if (!active.value) return
    const e = toShipApiError(err)
    active.value.loadError = e
    if (e.status === 403 || e.status === 404) active.value.unavailable = true
  }

  const isFatalStatusError = (err: unknown): boolean => {
    const s = toShipApiError(err).status
    return s === 400 || s === 403 || s === 404
  }

  function openShip(correlationId: string): void {
    active.value = { correlationId, start: null, status: null, loadError: null, unavailable: false, cancelling: false, actionError: null }
  }

  async function cancel(): Promise<void> {
    if (!active.value) return
    active.value.actionError = null
    try {
      await apiService.cancelShip(active.value.correlationId)
      active.value.cancelling = true
    } catch (err) {
      active.value.actionError = toShipApiError(err)
    }
  }

  /** @returns the new attempt number to keep polling past (or null on failure). */
  async function retryConfigPr(): Promise<number | null> {
    if (!active.value) return null
    active.value.actionError = null
    try {
      const res = await apiService.retryShipConfigPr(active.value.correlationId)
      return res.data?.attempt ?? ((active.value.status?.attempt ?? 1) + 1)
    } catch (err) {
      active.value.actionError = toShipApiError(err)
      return null
    }
  }

  /** "Ship new version" / retry: back to the form, pre-filled from the ship's trusted inputs (AC-012-6). */
  async function prefillFromShip(status: ShipStatus): Promise<void> {
    const known = recent.value.find(r => r.correlationId === status.correlationId)
    const s = status.settings
    Object.assign(draft, DEFAULT_DRAFT, config.value ? {
      port: config.value.defaults.port, healthPath: config.value.defaults.healthPath,
      bump: config.value.defaults.bump, teamLabel: config.value.defaults.teamLabel
    } : {})
    draft.repo = status.repo
    draft.app = status.app
    draft.env = status.env
    draft.branch = s?.branch ?? active.value?.start?.branch ?? known?.branch ?? ''
    if (s) {
      draft.namespace = s.namespace === status.app ? '' : s.namespace
      draft.teamLabel = s.teamLabel
      draft.port = s.port
      draft.healthPath = s.healthPath
      draft.bump = s.bump
    }
    appNameTouched.value = true
    fieldErrors.value = {}
    startError.value = null
    advisory.value = null
    active.value = null
    await loadBranches(status.repo)
    if (!draft.branch) draft.branch = defaultBranch.value
  }

  // ── actions: recent ships ──────────────────────────────────────────────
  function loadRecent(): void {
    recent.value = readRecent(userId())
  }

  async function refreshOne(entry: RecentShipEntry): Promise<void> {
    recentStates.value = { ...recentStates.value, [entry.correlationId]: { state: 'loading' } }
    try {
      const status = await fetchStatus(entry.correlationId)
      recentStates.value = { ...recentStates.value, [entry.correlationId]: { state: 'ok', runState: status.state } }
      storeTerminal(status)
    } catch (err) {
      const s = toShipApiError(err).status
      recentStates.value = { ...recentStates.value, [entry.correlationId]: { state: s === 403 || s === 404 ? 'unavailable' : 'error' } }
    }
  }

  /** Only non-terminal entries are refreshed, at most 3 at a time (§3.10.4). */
  async function refreshRecent(): Promise<void> {
    const pending = recent.value.filter(e => !e.terminal)
    for (let i = 0; i < pending.length; i += RECENT_REFRESH_CONCURRENCY) {
      await Promise.all(pending.slice(i, i + RECENT_REFRESH_CONCURRENCY).map(refreshOne))
    }
  }

  const retryRecent = (correlationId: string) => {
    const entry = recent.value.find(e => e.correlationId === correlationId)
    return entry ? refreshOne(entry) : Promise.resolve()
  }

  function removeRecentEntry(correlationId: string): void {
    recent.value = removeRecent(userId(), correlationId)
  }

  function clearRecentList(): void {
    clearShipRecent(userId())
    recent.value = []
    recentStates.value = {}
  }

  /** Leave the active ship (it keeps running; it stays in Recent ships). */
  function closeActive(): void {
    active.value = null
  }

  /** Called when the page opens: nothing from a previous visit (or previous user) may leak into this one. */
  function reset(): void {
    if (advisoryTimer) clearTimeout(advisoryTimer)
    advisoryTimer = null
    Object.assign(draft, DEFAULT_DRAFT)
    appNameTouched.value = false
    fieldErrors.value = {}
    startError.value = null
    submitting.value = false
    advisory.value = null
    advisoryCache.clear()
    branchCache.clear()
    repos.value = []
    reposStatus.value = 'idle'
    reposError.value = null
    reposFetchedAt = 0
    branches.value = []
    branchesStatus.value = 'idle'
    branchesError.value = null
    defaultBranch.value = ''
    config.value = null
    configStatus.value = 'idle'
    configError.value = null
    active.value = null
    recent.value = []
    recentStates.value = {}
  }

  return {
    config, configStatus, configError, identityLinked,
    repos, reposStatus, reposError, reposTruncated, selectedRepo, selectedOrg,
    branches, branchesStatus, branchesError, defaultBranch,
    draft, appNameTouched, fieldErrors, validationErrors, allErrors, canSubmit, submitting, startError,
    advisory, postMerge, nameOwnedByOther,
    active, recent, recentStates,
    loadConfig, loadRepos, loadBranches, selectRepo, setApp, queueAdvisory, runAdvisory, submit,
    fetchStatus, applyStatus, applyStatusError, isFatalStatusError, openShip, cancel, retryConfigPr, prefillFromShip,
    loadRecent, refreshRecent, retryRecent, removeRecentEntry, clearRecentList, closeActive, reset
  }
})
