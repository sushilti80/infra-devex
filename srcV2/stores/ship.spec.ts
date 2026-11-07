/**
 * Ship store: FT-04 (picker data), FT-12 (recent ships), FT-13 (Ship new version prefill),
 * FT-16 (advisory debounce + de-dup), fail-closed error mapping.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

const api = vi.hoisted(() => ({
  getShipConfig: vi.fn(), listShipRepos: vi.fn(), listShipBranches: vi.fn(), getShipAppState: vi.fn(),
  startShip: vi.fn(), getShipStatus: vi.fn(), getShipLogs: vi.fn(), cancelShip: vi.fn(), retryShipConfigPr: vi.fn()
}))
vi.mock('@v2/services/api', () => ({ apiService: api, default: api }))
vi.mock('@v2/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 'oid-1', email: 'a@x.io', name: 'A', tenantId: 't' } }) }))

import { useShipStore } from './ship'
import { useEnvironmentsStore } from './environments'
import { readRecent, addRecent } from '@v2/utils/shipRecentStorage'
import type { ShipConfig, ShipStatus } from '@v2/types/ship.types'

const id = (n: number) => `0190${String(n).padStart(4, '0')}-0000-7000-8000-${String(n).padStart(12, '0')}`
const CONFIG: ShipConfig = {
  allowedOrgs: ['Aya-DevOpsTeam'], supportedLanguages: ['Node.js', 'Python'],
  identity: { state: 'linked' }, previewConfiguredEnvs: [],
  defaults: { port: 8080, healthPath: '/healthz', bump: 'patch', teamLabel: 'software-engineering' },
  limits: { portMin: 1024, portMax: 65535, recentMax: 20, pollIntervalMs: 15000 }
}
const ok = <T,>(data: T) => ({ success: true, data })
const httpError = (status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  ({ response: { status, headers, data: { success: false, error: { code, message: code, ...extra } } } })
const status = (over: Partial<ShipStatus> = {}): ShipStatus => ({
  correlationId: id(1), app: 'my-app', env: 'devsand', repo: 'Aya-DevOpsTeam/my-app', startedAt: '2026-01-01T00:00:00Z',
  state: 'running', terminal: false, attempt: 1, queuedBehind: false, runResolved: true, stages: [], preview: { state: 'pending' }, ...over
})

function setup() {
  const envs = useEnvironmentsStore()
  envs.environments = [{ id: 'devsand', displayName: 'Dev', subscriptionId: 's', enabled: true, features: { customInfra: true, templates: true, aks: true, shipFromRepo: true } }]
  return useShipStore()
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  Object.values(api).forEach(f => f.mockReset())
  api.getShipConfig.mockResolvedValue(ok(CONFIG))
  api.listShipRepos.mockResolvedValue(ok({ repos: [{ fullName: 'Aya-DevOpsTeam/my-app', org: 'Aya-DevOpsTeam', name: 'my-app', defaultBranch: 'trunk', private: true }], identity: { state: 'linked' }, truncated: false }))
  api.listShipBranches.mockResolvedValue(ok({ branches: [{ name: 'trunk', isDefault: true }, { name: 'dev', isDefault: false }], defaultBranch: 'trunk' }))
  api.getShipAppState.mockResolvedValue(ok({ appState: 'new', ownership: 'unclaimed', ownershipSource: 'github' }))
})

describe('ship store — config, repos, branches (FT-04)', () => {
  it('loads config, applies defaults and preselects the only ship environment', async () => {
    const s = setup()
    await s.loadConfig()
    expect(s.configStatus).toBe('ready')
    expect(s.draft.env).toBe('devsand')
    expect(s.draft.port).toBe(8080)
    expect(s.draft.healthPath).toBe('/healthz')
    expect(s.identityLinked).toBe(true)
  })

  it('config failure => configStatus error (S0e), not a crash', async () => {
    api.getShipConfig.mockRejectedValue(httpError(500, 'UNKNOWN'))
    const s = setup()
    await s.loadConfig()
    expect(s.configStatus).toBe('error')
    expect(s.configError?.status).toBe(500)
  })

  it('selecting a repo defaults branch to the default branch and prefills the app name', async () => {
    const s = setup()
    await s.loadConfig(); await s.loadRepos()
    await s.selectRepo('Aya-DevOpsTeam/my-app')
    expect(s.draft.branch).toBe('trunk')
    expect(s.draft.app).toBe('my-app')
    expect(api.listShipBranches).toHaveBeenCalledWith('Aya-DevOpsTeam', 'my-app')
  })

  it('does not overwrite an app name the user already edited', async () => {
    const s = setup()
    await s.loadConfig()
    s.setApp('custom')
    await s.selectRepo('Aya-DevOpsTeam/my-app')
    expect(s.draft.app).toBe('custom')
  })

  it('a pasted GitHub URL is normalised to org/name', async () => {
    const s = setup()
    await s.loadConfig()
    await s.selectRepo('https://github.com/Aya-DevOpsTeam/my-app.git')
    expect(s.draft.repo).toBe('Aya-DevOpsTeam/my-app')
  })

  it('a typed branch is kept as typed (not forced back to the default)', async () => {
    const s = setup()
    await s.loadConfig()
    await s.selectRepo('Aya-DevOpsTeam/my-app')
    s.draft.branch = 'feature/typed-not-in-first-page'
    expect(s.draft.branch).toBe('feature/typed-not-in-first-page')
    expect(s.validationErrors.branch).toBeUndefined()
  })

  it('403 REPO_NOT_ACCESSIBLE on branches => generic error state with no branches', async () => {
    api.listShipBranches.mockRejectedValue(httpError(403, 'REPO_NOT_ACCESSIBLE', {}, {}))
    const s = setup()
    await s.loadConfig()
    await s.selectRepo('Aya-DevOpsTeam/secret')
    expect(s.branchesStatus).toBe('error')
    expect(s.branchesError?.code).toBe('REPO_NOT_ACCESSIBLE')
    expect(s.branches).toEqual([])
  })

  it('caches branches per repo for 5 minutes', async () => {
    const s = setup()
    await s.loadConfig()
    s.draft.repo = 'Aya-DevOpsTeam/my-app'
    await s.loadBranches('Aya-DevOpsTeam/my-app')
    await s.loadBranches('Aya-DevOpsTeam/my-app')
    expect(api.listShipBranches).toHaveBeenCalledTimes(1)
  })

  it('caches the repo list for 5 minutes but force reloads', async () => {
    const s = setup()
    await s.loadRepos(); await s.loadRepos()
    expect(api.listShipRepos).toHaveBeenCalledTimes(1)
    await s.loadRepos('', true)
    expect(api.listShipRepos).toHaveBeenCalledTimes(2)
  })

  it('repo list error / empty are exposed as states', async () => {
    api.listShipRepos.mockRejectedValueOnce(httpError(503, 'PLATFORM_RATE_LIMITED'))
    const s = setup()
    await s.loadRepos()
    expect(s.reposStatus).toBe('error')
    api.listShipRepos.mockResolvedValueOnce(ok({ repos: [], identity: { state: 'linked' }, truncated: false }))
    await s.loadRepos('', true)
    expect(s.reposStatus).toBe('ready')
    expect(s.repos).toEqual([])
  })

  it('unlinked identity returned by the repo list flips identityLinked (fail-closed)', async () => {
    const s = setup()
    await s.loadConfig()
    api.listShipRepos.mockResolvedValueOnce(ok({ repos: [], identity: { state: 'unlinked', reason: 'IDENTITY_MAPPING_NOT_CONFIGURED' }, truncated: false }))
    await s.loadRepos('', true)
    expect(s.identityLinked).toBe(false)
  })
})

describe('ship store — submit (S4) and errors', () => {
  async function ready() {
    const s = setup()
    await s.loadConfig(); await s.loadRepos()
    await s.selectRepo('Aya-DevOpsTeam/my-app')
    return s
  }
  const started = { correlationId: id(7), app: 'my-app', env: 'devsand', repo: 'Aya-DevOpsTeam/my-app', branch: 'trunk', startedAt: new Date().toISOString(), appState: 'new', effectiveSettings: { port: 8080, healthPath: '/healthz' }, settingsIgnored: [], rollout: 'preview_pr' }

  it('sends only the whitelisted request fields and records the ship on 202', async () => {
    api.startShip.mockResolvedValue(ok(started))
    const s = await ready()
    const res = await s.submit()
    expect(res?.correlationId).toBe(id(7))
    expect(api.startShip).toHaveBeenCalledWith({
      repo: 'Aya-DevOpsTeam/my-app', branch: 'trunk', app: 'my-app', env: 'devsand',
      teamLabel: 'software-engineering', bump: 'patch', port: 8080, healthPath: '/healthz'
    })
    expect(s.active?.correlationId).toBe(id(7))
    expect(readRecent('oid-1')[0]).toMatchObject({ correlationId: id(7), app: 'my-app', env: 'devsand', repo: 'Aya-DevOpsTeam/my-app', branch: 'trunk' })
  })

  it('does not submit when the form is invalid (no network call)', async () => {
    const s = await ready()
    s.setApp('Bad_Name')
    expect(s.canSubmit).toBe(false)
    expect(await s.submit()).toBeNull()
    expect(api.startShip).not.toHaveBeenCalled()
  })

  it('is blocked when the app-state advisory says the name is owned by another repo (AC-002-7)', async () => {
    api.getShipAppState.mockResolvedValue(ok({ appState: 'new', ownership: 'other_repo', owningRepo: 'org/other', ownershipSource: 'github' }))
    const s = await ready()
    await s.runAdvisory()
    expect(s.canSubmit).toBe(false)
    expect(s.validationErrors.app).toMatch(/org\/other/)
  })

  it('post-merge advisory fixes port/health to the effective values and omits them from the request', async () => {
    api.getShipAppState.mockResolvedValue(ok({ appState: 'merged', ownership: 'same_repo', ownershipSource: 'github', effectiveSettings: { port: 9000, healthPath: '/health' } }))
    api.startShip.mockResolvedValue(ok(started))
    const s = await ready()
    await s.runAdvisory()
    expect(s.postMerge).toBe(true)
    expect(s.draft.port).toBe(9000)
    expect(s.draft.healthPath).toBe('/health')
    await s.submit()
    const sent = api.startShip.mock.calls[0][0]
    expect(sent).not.toHaveProperty('port')
    expect(sent).not.toHaveProperty('healthPath')
  })

  it.each([
    [403, 'REPO_NOT_ACCESSIBLE', { hint: 'IDENTITY_NOT_LINKED' }],
    [403, 'REPO_NOT_ACCESSIBLE', {}],
    [503, 'SHIP_UNAVAILABLE', {}],
    [429, 'PLATFORM_RATE_LIMITED', { details: { limit: 'user_active' } }]
  ])('keeps a structured error for %s %s (fail-closed states are not generic)', async (statusCode, code, extra) => {
    api.startShip.mockRejectedValue(httpError(statusCode, code, extra as Record<string, unknown>, { 'retry-after': '90' }))
    const s = await ready()
    expect(await s.submit()).toBeNull()
    expect(s.startError).toMatchObject({ status: statusCode, code })
    expect(s.submitting).toBe(false)
    expect(s.active).toBeNull()
    expect(readRecent('oid-1')).toEqual([])
  })

  it('maps 400 VALIDATION_FAILED field errors and APP_OWNED_BY_OTHER onto fields', async () => {
    api.startShip.mockRejectedValueOnce(httpError(400, 'VALIDATION_FAILED', { details: [{ field: 'namespace', message: 'reserved' }] }))
    const s = await ready()
    await s.submit()
    expect(s.allErrors.namespace).toBe('reserved')
    api.startShip.mockRejectedValueOnce(httpError(403, 'APP_OWNED_BY_OTHER'))
    await s.submit()
    expect(s.allErrors.app).toMatch(/different source repository/)
  })
})

describe('ship store — advisory debounce and de-dup (FT-16)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  async function configured() {
    const s = setup()
    await s.loadConfig()
    s.draft.repo = 'Aya-DevOpsTeam/my-app'
    s.draft.app = 'my-app'
    await nextTick()
    api.getShipAppState.mockClear()
    return s
  }

  it('fires once, 500 ms after the last edit', async () => {
    const s = await configured()
    s.draft.app = 'a'; await nextTick()
    await vi.advanceTimersByTimeAsync(400)
    s.draft.app = 'ap'; await nextTick()
    await vi.advanceTimersByTimeAsync(400)
    s.draft.app = 'app'; await nextTick()
    await vi.advanceTimersByTimeAsync(499)
    expect(api.getShipAppState).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(api.getShipAppState).toHaveBeenCalledTimes(1)
    expect(api.getShipAppState).toHaveBeenCalledWith('devsand', 'app', 'Aya-DevOpsTeam/my-app')
  })

  it('de-duplicates the same (env, app, repo) for 60 s, then calls again', async () => {
    const s = await configured()
    s.queueAdvisory(); await vi.advanceTimersByTimeAsync(500)
    expect(api.getShipAppState).toHaveBeenCalledTimes(1)
    s.queueAdvisory(); await vi.advanceTimersByTimeAsync(500)
    expect(api.getShipAppState).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    s.queueAdvisory(); await vi.advanceTimersByTimeAsync(500)
    expect(api.getShipAppState).toHaveBeenCalledTimes(2)
  })

  it('a different app name is a different key (calls again within 60 s)', async () => {
    const s = await configured()
    s.queueAdvisory(); await vi.advanceTimersByTimeAsync(500)
    s.draft.app = 'other'; await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    expect(api.getShipAppState).toHaveBeenCalledTimes(2)
  })

  it('does not call with an invalid app name or missing repo', async () => {
    const s = await configured()
    s.draft.app = 'Bad Name'; await nextTick()
    await vi.advanceTimersByTimeAsync(600)
    expect(api.getShipAppState).not.toHaveBeenCalled()
  })

  it('an advisory error is swallowed (advisory only)', async () => {
    api.getShipAppState.mockRejectedValue(httpError(403, 'REPO_NOT_ACCESSIBLE'))
    const s = await configured()
    s.queueAdvisory()
    await vi.advanceTimersByTimeAsync(500)
    expect(s.advisory).toBeNull()
  })
})

describe('ship store — recent ships (FT-12)', () => {
  const entry = (n: number, extra = {}) => ({ correlationId: id(n), app: `a${n}`, env: 'devsand', repo: 'o/r', branch: 'main', startedAt: new Date(1_700_000_000_000 + n).toISOString(), ...extra })

  it('refreshes ONLY non-terminal entries (terminal state is stored, not re-fetched)', async () => {
    addRecent('oid-1', entry(1, { terminal: { state: 'succeeded', version: '1.0.0' } }))
    addRecent('oid-1', entry(2))
    api.getShipStatus.mockResolvedValue(ok(status({ correlationId: id(2), state: 'running' })))
    const s = setup()
    s.loadRecent()
    await s.refreshRecent()
    expect(api.getShipStatus).toHaveBeenCalledTimes(1)
    expect(api.getShipStatus).toHaveBeenCalledWith(id(2))
    expect(s.recentStates[id(2)]).toEqual({ state: 'ok', runState: 'running' })
  })

  it('stores the terminal result when a refreshed entry has finished', async () => {
    addRecent('oid-1', entry(2))
    api.getShipStatus.mockResolvedValue(ok(status({ correlationId: id(2), state: 'succeeded', terminal: true, version: '0.1.3', pr: { number: 4, url: 'https://github.com/o/r/pull/4', state: 'open' } })))
    const s = setup()
    s.loadRecent()
    await s.refreshRecent()
    expect(readRecent('oid-1')[0].terminal).toEqual({ state: 'succeeded', version: '0.1.3', prUrl: 'https://github.com/o/r/pull/4' })
    api.getShipStatus.mockClear()
    s.loadRecent()
    await s.refreshRecent()
    expect(api.getShipStatus).not.toHaveBeenCalled()
  })

  it('refreshes at most 3 entries concurrently', async () => {
    for (let i = 1; i <= 7; i++) addRecent('oid-1', entry(i))
    let inFlight = 0, peak = 0
    api.getShipStatus.mockImplementation(async (cid: string) => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return ok(status({ correlationId: cid }))
    })
    const s = setup()
    s.loadRecent()
    await s.refreshRecent()
    expect(api.getShipStatus).toHaveBeenCalledTimes(7)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('403/404 => unavailable (entry kept for Remove); other errors => error with retry', async () => {
    addRecent('oid-1', entry(1)); addRecent('oid-1', entry(2)); addRecent('oid-1', entry(3))
    api.getShipStatus.mockImplementation(async (cid: string) => {
      if (cid === id(1)) throw httpError(404, 'NOT_FOUND')
      if (cid === id(2)) throw httpError(403, 'FORBIDDEN')
      throw httpError(503, 'PLATFORM_RATE_LIMITED')
    })
    const s = setup()
    s.loadRecent()
    await s.refreshRecent()
    expect(s.recentStates[id(1)].state).toBe('unavailable')
    expect(s.recentStates[id(2)].state).toBe('unavailable')
    expect(s.recentStates[id(3)].state).toBe('error')
    expect(s.recent).toHaveLength(3)

    api.getShipStatus.mockResolvedValue(ok(status({ correlationId: id(3) })))
    await s.retryRecent(id(3))
    expect(s.recentStates[id(3)].state).toBe('ok')
  })

  it('Remove drops one entry; Clear list drops all for this user only', () => {
    addRecent('oid-1', entry(1)); addRecent('oid-1', entry(2)); addRecent('oid-2', entry(3))
    const s = setup()
    s.loadRecent()
    s.removeRecentEntry(id(1))
    expect(s.recent.map(e => e.correlationId)).toEqual([id(2)])
    s.clearRecentList()
    expect(s.recent).toEqual([])
    expect(readRecent('oid-1')).toEqual([])
    expect(readRecent('oid-2')).toHaveLength(1)
  })

  it('applyStatus on a terminal status persists the outcome for the active ship', async () => {
    addRecent('oid-1', entry(1))
    const s = setup()
    s.loadRecent()
    s.openShip(id(1))
    s.applyStatus(status({ correlationId: id(1), state: 'failed', terminal: true }))
    expect(readRecent('oid-1')[0].terminal).toEqual({ state: 'failed' })
  })

  it('ignores a status for a ship that is no longer active', () => {
    const s = setup()
    s.openShip(id(1))
    s.applyStatus(status({ correlationId: id(9), state: 'succeeded', terminal: true }))
    expect(s.active?.status).toBeNull()
  })

  it('status errors: 404/403 mark the ship unavailable; others stay soft', () => {
    const s = setup()
    s.openShip(id(1))
    s.applyStatusError(httpError(503, 'PLATFORM_RATE_LIMITED'))
    expect(s.active?.unavailable).toBe(false)
    s.applyStatusError(httpError(404, 'NOT_FOUND'))
    expect(s.active?.unavailable).toBe(true)
    expect(s.isFatalStatusError(httpError(404, 'NOT_FOUND'))).toBe(true)
    expect(s.isFatalStatusError(httpError(503, 'X'))).toBe(false)
  })
})

describe('ship store — Ship new version prefill (FT-13)', () => {
  it('prefills repo, app, env and all settings from the ship\'s trusted inputs', async () => {
    const s = setup()
    await s.loadConfig()
    await s.prefillFromShip(status({ settings: { branch: 'release', namespace: 'ns1', teamLabel: 'team-x', port: 3000, healthPath: '/health', bump: 'minor' } }))
    expect(s.draft).toMatchObject({ repo: 'Aya-DevOpsTeam/my-app', app: 'my-app', env: 'devsand', branch: 'release', namespace: 'ns1', teamLabel: 'team-x', port: 3000, healthPath: '/health', bump: 'minor' })
    expect(s.active).toBeNull()
  })

  it('falls back to repo/branch/app + defaults when settings are unreadable', async () => {
    const s = setup()
    await s.loadConfig()
    s.openShip(id(1))
    await s.prefillFromShip(status({ settings: undefined }))
    expect(s.draft).toMatchObject({ repo: 'Aya-DevOpsTeam/my-app', app: 'my-app', port: 8080, healthPath: '/healthz', bump: 'patch', teamLabel: 'software-engineering' })
    expect(s.draft.branch).toBe('trunk') // default branch fallback
  })

  it('uses the recent entry\'s branch when settings are missing', async () => {
    addRecent('oid-1', { correlationId: id(1), app: 'my-app', env: 'devsand', repo: 'Aya-DevOpsTeam/my-app', branch: 'feature/x', startedAt: new Date().toISOString() })
    const s = setup()
    await s.loadConfig()
    s.loadRecent()
    await s.prefillFromShip(status({ settings: undefined }))
    expect(s.draft.branch).toBe('feature/x')
  })
})

describe('ship store — cancel / retry-config-pr and reset', () => {
  it('cancel sets cancelling; a 409 is exposed as an action error', async () => {
    const s = setup()
    s.openShip(id(1))
    api.cancelShip.mockResolvedValueOnce(ok({ state: 'cancelling' }))
    await s.cancel()
    expect(s.active?.cancelling).toBe(true)
    api.cancelShip.mockRejectedValueOnce(httpError(409, 'CANCEL_NOT_ALLOWED'))
    await s.cancel()
    expect(s.active?.actionError?.code).toBe('CANCEL_NOT_ALLOWED')
  })

  it('retryConfigPr returns the new attempt, or null with the error on 409', async () => {
    const s = setup()
    s.openShip(id(1))
    api.retryShipConfigPr.mockResolvedValueOnce(ok({ correlationId: id(1), attempt: 3 }))
    expect(await s.retryConfigPr()).toBe(3)
    api.retryShipConfigPr.mockRejectedValueOnce(httpError(409, 'RETRY_NOT_APPLICABLE'))
    expect(await s.retryConfigPr()).toBeNull()
    expect(s.active?.actionError?.code).toBe('RETRY_NOT_APPLICABLE')
  })

  it('reset() clears draft, caches and the active ship (nothing leaks across visits/users)', async () => {
    const s = setup()
    await s.loadConfig(); await s.selectRepo('Aya-DevOpsTeam/my-app')
    s.openShip(id(1))
    s.reset()
    expect(s.draft.repo).toBe('')
    expect(s.active).toBeNull()
    expect(s.config).toBeNull()
    expect(s.branches).toEqual([])
  })
})
