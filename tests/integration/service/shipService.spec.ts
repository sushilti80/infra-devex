/**
 * shipService: BT-04/06/07/08/21/24/25 — listing, ownership & app state, post-merge enforcement, start guards,
 * dispatch payload contract. GitHub and identity are doubles; the router is not involved (see tests/integration/api/ship.spec.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'

process.env.GITHUB_APP_ID = ''
process.env.GITHUB_INSTALLATION_ID = ''
const cjsRequire = createRequire(import.meta.url)
for (const m of ['githubService', 'aksService', 'shipStatusService', 'shipService', 'shipIdentityService']) delete cjsRequire.cache[cjsRequire.resolve(`../../../services/${m}`)]
const config = cjsRequire('../../../config')
const logger = cjsRequire('../../../utils/logger')
const githubService = cjsRequire('../../../services/githubService')
const aksService = cjsRequire('../../../services/aksService')
const identity = cjsRequire('../../../services/shipIdentityService')
const shipService = cjsRequire('../../../services/shipService')
const shipStatus = cjsRequire('../../../services/shipStatusService')
const { createTestProvider } = cjsRequire('../../helpers/shipIdentityTestDouble')
const fx = cjsRequire('../../helpers/shipFixtures')
const { isShipId, shipIdTimestamp } = cjsRequire('../../../utils/shipId')

const sam = { id: fx.OID, email: 'Sam@Example.com' }
const other = { id: fx.OTHER_OID, email: 'other@x.com' }
const input = { repo: 'AyaHealthcare/my-svc', branch: 'main', app: 'my-app', env: 'devsand', namespace: 'my-app', teamLabel: 'software-engineering', port: 8080, healthPath: '/healthz', bump: 'patch' }
let dispatched: any[]
let provider: any
let appState: any

beforeEach(() => {
  shipService._resetForTests(); shipStatus._resetForTests()
  dispatched = []
  appState = { appState: 'new' }
  Object.assign(config.ship, {
    allowedOrgs: ['AyaHealthcare'], supportedShipEnvironments: ['devsand'], workflowRef: 'ship/v1', allowDefaultRef: false, identityProvider: 'test',
    maxStartsPerHour: 12, maxActiveGlobal: 10, maxActivePerUser: 3, maxStartsPerUserPerHour: 6, rateLimitGuardRemaining: 1000, retryWindowHours: 24,
    previewHosts: {}, annotationsVerified: true, queueSignalsVerified: false,
  })
  provider = createTestProvider({
    links: { [fx.OID]: 'octocat', [fx.OTHER_OID]: 'other-login' },
    repos: {
      octocat: [
        { fullName: 'AyaHealthcare/zeta', org: 'AyaHealthcare', name: 'zeta', defaultBranch: 'main', private: true },
        { fullName: 'AyaHealthcare/alpha', org: 'AyaHealthcare', name: 'alpha', defaultBranch: 'develop', private: false },
        { fullName: 'AyaHealthcare/forked', org: 'AyaHealthcare', name: 'forked', defaultBranch: 'main', private: false, fork: true },
        { fullName: 'EvilOrg/steal', org: 'EvilOrg', name: 'steal', defaultBranch: 'main', private: false },
      ],
    },
    permissions: { 'octocat:AyaHealthcare/my-svc': 'admin', 'octocat:AyaHealthcare/zeta': 'read', 'other-login:AyaHealthcare/my-svc': 'read' },
  })
  identity.registerProvider('test', provider)
  githubService.codeAppGetRepo = async () => ({ defaultBranch: 'main', private: true, fork: false })
  githubService.codeAppBranchExists = async () => true
  githubService.codeAppListBranches = async () => ({ branches: [{ name: 'feature/x' }, { name: 'main' }, { name: 'dev' }], hasNext: false })
  githubService.triggerWorkflow = async (repo: string, wf: string, ref: string, inputs: any) => { dispatched.push({ repo, wf, ref, inputs }); return { success: true } }
  githubService.getRateLimitSnapshot = () => ({ remaining: 4000, limit: 5000, reset: Math.floor(Date.now() / 1000) + 600 })
  aksService.getAppState = async () => appState
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('BT-04 identity contract through the service', () => {
  it('provider none: config says unlinked; list is empty; start/branches/app advisory fail closed with IDENTITY_NOT_LINKED', async () => {
    config.ship.identityProvider = 'none'
    expect((await shipService.getConfig(sam)).identity).toEqual({ state: 'unlinked', reason: 'IDENTITY_MAPPING_NOT_CONFIGURED' })
    expect((await shipService.listRepos(sam)).repos).toEqual([])
    for (const call of [() => shipService.start(sam, input), () => shipService.listBranches(sam, 'AyaHealthcare', 'my-svc'), () => shipService.getAppAdvisory(sam, 'devsand', 'my-app', 'AyaHealthcare/my-svc')]) {
      await expect(call()).rejects.toMatchObject({ status: 403, code: 'REPO_NOT_ACCESSIBLE', hint: 'IDENTITY_NOT_LINKED' })
    }
    expect(dispatched).toHaveLength(0)
  })
  it('test double: linked ⇒ ship starts; unlinked ⇒ refused', async () => {
    await expect(shipService.start(sam, input)).resolves.toMatchObject({ app: 'my-app' })
    await expect(shipService.start({ id: 'dddddddd-2222-3333-4444-555555555555', email: 'x@x' }, { ...input, app: 'a2' })).rejects.toMatchObject({ code: 'REPO_NOT_ACCESSIBLE', hint: 'IDENTITY_NOT_LINKED' })
  })
  it('a non-GUID identity id (no Entra oid) cannot start a ship (run-name needs a parseable oid)', async () => {
    await expect(shipService.start({ id: 'not-a-guid', email: 'x@x' }, input)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })
})

describe('BT-06 repo / branch listing', () => {
  it('user ∩ App repos in allowed orgs only, forks excluded, sorted by fullName, projection only', async () => {
    const res = await shipService.listRepos(sam)
    expect(res.identity).toEqual({ state: 'linked' })
    expect(res.repos.map((r: any) => r.fullName)).toEqual(['AyaHealthcare/alpha', 'AyaHealthcare/zeta'])
    expect(res.repos[0]).toEqual({ fullName: 'AyaHealthcare/alpha', org: 'AyaHealthcare', name: 'alpha', defaultBranch: 'develop', private: false })
    expect(res.truncated).toBe(false)
  })
  it('q filter and limit with truncated flag', async () => {
    expect((await shipService.listRepos(sam, { q: 'ZET' })).repos.map((r: any) => r.name)).toEqual(['zeta'])
    const res = await shipService.listRepos(sam, { limit: 1 })
    expect(res.repos).toHaveLength(1)
    expect(res.truncated).toBe(true)
  })
  it('empty org allowlist ⇒ nothing is listed (fail closed)', async () => {
    config.ship.allowedOrgs = []
    expect((await shipService.listRepos(sam)).repos).toEqual([])
  })
  it('cached 5 min per user (one provider call), refetched afterwards', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await shipService.listRepos(sam); await shipService.listRepos(sam, { q: 'a' })
    expect(provider.calls.listAccessibleRepos).toBe(1)
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1000)
    await shipService.listRepos(sam)
    expect(provider.calls.listAccessibleRepos).toBe(2)
    await shipService.listRepos(other)
    expect(provider.calls.listAccessibleRepos).toBe(3) // per-user cache key
  })
  it('branches: default first; typed branch verified when not on the page; cached 5 min; ≤3 pages', async () => {
    githubService.codeAppGetRepo = async () => ({ defaultBranch: 'main', private: true, fork: false })
    const res = await shipService.listBranches(sam, 'AyaHealthcare', 'my-svc')
    expect(res.defaultBranch).toBe('main')
    expect(res.branches.map((b: any) => b.name)).toEqual(['main', 'dev', 'feature/x'])
    expect(res.branches[0].isDefault).toBe(true)
    expect(res.nextPage).toBeUndefined()
    const typed = vi.fn(async (_o: string, _r: string, b: string) => b === 'hotfix/1')
    githubService.codeAppBranchExists = typed
    expect((await shipService.listBranches(sam, 'AyaHealthcare', 'my-svc', { q: 'hotfix/1' })).branches.map((b: any) => b.name)).toEqual(['hotfix/1'])
    expect((await shipService.listBranches(sam, 'AyaHealthcare', 'my-svc', { q: 'nope' })).branches).toEqual([])
    expect(typed).toHaveBeenCalledTimes(2)
    expect((await shipService.listBranches(sam, 'AyaHealthcare', 'my-svc', { q: 'bad..ref' })).branches).toEqual([])
    expect(typed).toHaveBeenCalledTimes(2) // invalid refs are never sent to GitHub
  })
  it('branch paging: nextPage while hasNext and page < 3', async () => {
    githubService.codeAppListBranches = async () => ({ branches: [{ name: 'main' }], hasNext: true })
    expect((await shipService.listBranches(sam, 'AyaHealthcare', 'my-svc', { page: 1 })).nextPage).toBe(2)
    expect((await shipService.listBranches(sam, 'AyaHealthcare', 'my-svc', { page: 3 })).nextPage).toBeUndefined()
  })
  it('a repo the user cannot read, an uninstalled App, and a missing repo all answer identically (generic)', async () => {
    const answers: any[] = []
    await shipService.listBranches(sam, 'AyaHealthcare', 'not-permitted').catch((e: any) => answers.push([e.status, e.code, e.message, e.hint]))
    githubService.codeAppListBranches = async () => null
    shipService._resetForTests()
    await shipService.listBranches(sam, 'AyaHealthcare', 'my-svc').catch((e: any) => answers.push([e.status, e.code, e.message, e.hint]))
    expect(answers).toHaveLength(2)
    expect(answers[0]).toEqual(answers[1])
  })
})

describe('BT-07 ownership and app state matrix', () => {
  it('checkOwnership: GitHub-only signals (ACR step H-3 not implemented, SHIP_ACR_READ_ENABLED has no effect)', () => {
    for (const acr of [false, true]) {
      config.ship.acrReadEnabled = acr
      expect(shipService.checkOwnership('my-app', { appState: 'new' })).toEqual({ ownership: 'unknown', ownershipSource: 'none' })
      expect(shipService.checkOwnership('my-app', { appState: 'merged', imageName: 'sharedwus3acr2.azurecr.io/selfserve/my-app' })).toEqual({ ownership: 'unknown', ownershipSource: 'none' })
      expect(shipService.checkOwnership('my-app', { appState: 'merged', imageName: 'sharedwus3acr2.azurecr.io/platform/my-app' })).toEqual({ ownership: 'unowned_existing', ownershipSource: 'github' })
      expect(shipService.checkOwnership('my-app', { appState: 'merged' })).toEqual({ ownership: 'unknown', ownershipSource: 'none' })
      expect(shipService.checkOwnership('my-app', { appState: 'preview_open', prNumber: 3 })).toEqual({ ownership: 'unknown', ownershipSource: 'none' })
    }
    config.ship.acrReadEnabled = false
  })
  it('a name that exists on aya-flux as a non-ship app ⇒ start refused with APP_OWNED_BY_OTHER and no dispatch', async () => {
    appState = { appState: 'merged', effectiveSettings: { port: 80, healthPath: '/' }, imageName: 'docker.io/library/nginx' }
    await expect(shipService.start(sam, input)).rejects.toMatchObject({ status: 403, code: 'APP_OWNED_BY_OTHER' })
    expect(dispatched).toHaveLength(0)
  })
  it('the same source repo may own several apps (AC-016-4): two apps from one repo both ship', async () => {
    await expect(shipService.start(sam, input)).resolves.toBeDefined()
    await expect(shipService.start(sam, { ...input, app: 'second-app', namespace: 'second-app' })).resolves.toBeDefined()
    expect(dispatched.map((d) => d.inputs.app)).toEqual(['my-app', 'second-app'])
  })
  it('advisory endpoint is cached 60 s per (env, app, repo)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const spy = vi.fn(async () => ({ appState: 'new' }))
    aksService.getAppState = spy
    await shipService.getAppAdvisory(sam, 'devsand', 'my-app', 'AyaHealthcare/my-svc')
    await shipService.getAppAdvisory(sam, 'devsand', 'my-app', 'AyaHealthcare/my-svc')
    expect(spy).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 61_000)
    await shipService.getAppAdvisory(sam, 'devsand', 'my-app', 'AyaHealthcare/my-svc')
    expect(spy).toHaveBeenCalledTimes(2)
  })
  it('advisory refuses a user without read access to the repo', async () => {
    await expect(shipService.getAppAdvisory(sam, 'devsand', 'my-app', 'AyaHealthcare/unreadable')).rejects.toMatchObject({ code: 'REPO_NOT_ACCESSIBLE' })
  })
})

describe('BT-08 post-merge effective settings', () => {
  const merged = { appState: 'merged', effectiveSettings: { port: 9000, healthPath: '/ready' }, imageName: 'sharedwus3acr2.azurecr.io/selfserve/my-app' }
  it('changed port/healthPath are ignored, reported in settingsIgnored, and the effective values are dispatched', async () => {
    appState = merged
    const res = await shipService.start(sam, { ...input, port: 3000, healthPath: '/other' }, { provided: { port: true, healthPath: true } })
    expect(res.settingsIgnored).toEqual(['port', 'healthPath'])
    expect(res.effectiveSettings).toEqual({ port: 9000, healthPath: '/ready' })
    expect(res.appState).toBe('merged')
    expect(res.rollout).toBe('flux_auto_roll')
    expect(dispatched[0].inputs).toMatchObject({ port: '9000', health_path: '/ready' })
  })
  it('unchanged or not-provided values are not reported as ignored', async () => {
    appState = merged
    expect((await shipService.start(sam, { ...input, port: 9000, healthPath: '/ready' }, { provided: { port: true, healthPath: true } })).settingsIgnored).toEqual([])
    shipService._resetForTests()
    expect((await shipService.start(sam, input, { provided: {} })).settingsIgnored).toEqual([])
    expect(dispatched[1].inputs).toMatchObject({ port: '9000', health_path: '/ready' })
  })
  it('new / preview_open apps use the submitted values and rollout preview_pr', async () => {
    const res = await shipService.start(sam, { ...input, port: 3000 }, { provided: { port: true } })
    expect(res).toMatchObject({ appState: 'new', rollout: 'preview_pr', effectiveSettings: { port: 3000, healthPath: '/healthz' }, settingsIgnored: [] })
    appState = { appState: 'preview_open', prNumber: 4 }
    shipService._resetForTests()
    expect((await shipService.start(sam, input)).rollout).toBe('preview_pr')
  })
})

describe('BT-24 start guards (DD-14, DD-11)', () => {
  const expectLimit = async (p: Promise<any>, limit: string) => {
    const err: any = await p.then(() => null, (e: any) => e)
    expect(err).toMatchObject({ status: 429, code: 'PLATFORM_RATE_LIMITED', details: { limit } })
    expect(err.retryAfterSec).toBeGreaterThanOrEqual(1)
  }
  const n = (i: number) => ({ ...input, app: `app-${i}`, namespace: `app-${i}` })

  it('per user: > 3 active ⇒ user_active', async () => {
    for (let i = 0; i < 3; i++) await shipService.start(sam, n(i))
    await expectLimit(shipService.start(sam, n(3)), 'user_active')
    expect(dispatched).toHaveLength(3)
  })
  it('per user: > 6 starts an hour ⇒ user_hourly (active cap relaxed)', async () => {
    config.ship.maxActivePerUser = 100; config.ship.maxActiveGlobal = 100
    for (let i = 0; i < 6; i++) await shipService.start(sam, n(i))
    await expectLimit(shipService.start(sam, n(6)), 'user_hourly')
  })
  it('global: > 10 active ⇒ global_active (another user is blocked by someone else’s ships)', async () => {
    config.ship.maxActiveGlobal = 2; config.ship.maxActivePerUser = 100
    await shipService.start(sam, n(0)); await shipService.start(sam, n(1))
    await expectLimit(shipService.start(other, n(2)), 'global_active')
  })
  it('global: > 12 starts an hour ⇒ global_hourly', async () => {
    config.ship.maxStartsPerHour = 2; config.ship.maxActivePerUser = 100; config.ship.maxActiveGlobal = 100; config.ship.maxStartsPerUserPerHour = 100
    await shipService.start(sam, n(0)); await shipService.start(other, n(1))
    await expectLimit(shipService.start(sam, n(2)), 'global_hourly')
  })
  it('hourly windows roll: a start older than an hour no longer counts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    config.ship.maxStartsPerUserPerHour = 1; config.ship.maxActivePerUser = 100; config.ship.maxActiveGlobal = 100
    await shipService.start(sam, n(0))
    await expectLimit(shipService.start(sam, n(1)), 'user_hourly')
    vi.setSystemTime(Date.now() + 61 * 60_000)
    await expect(shipService.start(sam, n(1))).resolves.toBeDefined()
  })
  it('GitHub rate limit remaining < 1 000 ⇒ github', async () => {
    githubService.getRateLimitSnapshot = () => ({ remaining: 999, limit: 5000, reset: Math.floor(Date.now() / 1000) + 120 })
    const err: any = await shipService.start(sam, input).then(() => null, (e: any) => e)
    expect(err).toMatchObject({ status: 429, details: { limit: 'github' } })
    expect(err.retryAfterSec).toBeGreaterThan(60)
    expect(dispatched).toHaveLength(0)
  })
  it('an active ship stops counting once observed terminal', async () => {
    config.ship.maxActivePerUser = 1
    const first = await shipService.start(sam, input)
    await expectLimit(shipService.start(sam, n(1)), 'user_active')
    const t = shipIdTimestamp(first.correlationId)
    const w = fx.makeWorld(githubService)
    fx.buildRun(w, { cid: first.correlationId, id: 1000, createdAt: new Date(t).toISOString() })
    await shipStatus.getStatus(first.correlationId, sam) // terminal observed
    await expect(shipService.start(sam, n(1))).resolves.toBeDefined()
  })
  it('10 s dedupe: an identical POST returns the same ship without a second dispatch; a different branch/app starts a new one; expires after 10 s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const a = await shipService.start(sam, input)
    const b = await shipService.start(sam, input)
    expect(b.correlationId).toBe(a.correlationId)
    expect(dispatched).toHaveLength(1)
    await shipService.start(sam, { ...input, branch: 'dev' })
    expect(dispatched).toHaveLength(2)
    vi.setSystemTime(Date.now() + 11_000)
    const c = await shipService.start(sam, input)
    expect(c.correlationId).not.toBe(a.correlationId)
    expect(dispatched).toHaveLength(3)
  })
  it('dedupe is per user', async () => {
    const a = await shipService.start(sam, input)
    const b = await shipService.start(other, input)
    expect(b.correlationId).not.toBe(a.correlationId)
  })
  it('concurrent identical POSTs (double-click) share one start and one dispatch', async () => {
    const [a, b, c] = await Promise.all([shipService.start(sam, input), shipService.start(sam, input), shipService.start(sam, input)])
    expect(b.correlationId).toBe(a.correlationId)
    expect(c.correlationId).toBe(a.correlationId)
    expect(dispatched).toHaveLength(1)
  })
  it('concurrent POSTs for different apps cannot all slip past the per-user active cap', async () => {
    config.ship.maxActivePerUser = 3
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => shipService.start(sam, n(i))))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
    expect(results.filter((r) => r.status === 'rejected').every((r: any) => r.reason.details.limit === 'user_active')).toBe(true)
    expect(dispatched).toHaveLength(3)
  })
  it('a failed start releases its reservation (caps and dedupe) so a retry is not penalised', async () => {
    config.ship.maxActivePerUser = 1
    githubService.codeAppBranchExists = async () => false
    for (let i = 0; i < 3; i++) await expect(shipService.start(sam, input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    githubService.codeAppBranchExists = async () => true
    await expect(shipService.start(sam, input)).resolves.toBeDefined()
    expect(dispatched).toHaveLength(1)
  })
  it('a failed dispatch is rolled back too', async () => {
    config.ship.maxActivePerUser = 1
    githubService.triggerWorkflow = async () => { const e: any = new Error('x'); e.status = 502; throw e }
    await expect(shipService.start(sam, input)).rejects.toMatchObject({ status: 503 })
    githubService.triggerWorkflow = async (r: string, wf: string, ref: string, inputs: any) => { dispatched.push({ inputs }); return {} }
    await expect(shipService.start(sam, input)).resolves.toBeDefined()
  })
  it('workflow ref equal to the default ref is refused without SHIP_ALLOW_DEFAULT_REF, allowed with it', async () => {
    config.ship.workflowRef = config.aks.fluxBranch
    await expect(shipService.start(sam, input)).rejects.toMatchObject({ status: 503, code: 'SHIP_UNAVAILABLE' })
    expect(dispatched).toHaveLength(0)
    config.ship.allowDefaultRef = true
    await expect(shipService.start(sam, input)).resolves.toBeDefined()
    expect(dispatched[0].ref).toBe(config.aks.fluxBranch)
  })
  it('breaches log ship_rate_limited', async () => {
    config.ship.maxActivePerUser = 0
    const spy = vi.spyOn(logger, 'log')
    await shipService.start(sam, input).catch(() => undefined)
    expect(spy.mock.calls.some((c: any[]) => c[1] === 'ship_rate_limited' && c[2].limit === 'user_active')).toBe(true)
  })
})

describe('BT-25 dispatch payload contract / BT-21 start metrics', () => {
  const template = (i: any) => `ship cid=${i.correlation_id} app=${i.app} env=${i.env} repo=${i.repo} by=${i.triggered_by} oid=${i.triggered_by_oid} mode=${i.mode} retry_by=${i.retry_by || '-'}`

  it('full mode: exactly the inputs the workflow expects, server-set actor/oid/login, UUIDv7 correlation_id, string values', async () => {
    const res = await shipService.start(sam, { ...input, port: 3000, healthPath: '/up', bump: 'minor', namespace: 'team-ns', teamLabel: 'platform' }, { provided: { port: true } })
    const { repo, wf, ref, inputs } = dispatched[0]
    expect([repo, wf, ref]).toEqual(['Aya-DevOpsTeam/aya-flux', 'ship-from-repo.yaml', 'ship/v1'])
    expect(Object.keys(inputs).sort()).toEqual(['app', 'branch', 'bump', 'correlation_id', 'env', 'health_path', 'mode', 'namespace', 'port', 'repo', 'requester_github_login', 'team_label', 'triggered_by', 'triggered_by_oid', 'repo'].filter((k, i, a) => a.indexOf(k) === i).sort())
    expect(inputs).toMatchObject({ repo: 'AyaHealthcare/my-svc', branch: 'main', app: 'my-app', namespace: 'team-ns', team_label: 'platform', env: 'devsand', port: '3000', health_path: '/up', bump: 'minor', triggered_by: 'sam@example.com', triggered_by_oid: fx.OID, requester_github_login: 'octocat', mode: 'full' })
    expect(Object.values(inputs).every((v) => typeof v === 'string')).toBe(true)
    expect(isShipId(inputs.correlation_id)).toBe(true)
    expect(inputs.correlation_id).toBe(res.correlationId)
    expect(Date.parse(res.startedAt)).toBe(shipIdTimestamp(inputs.correlation_id))
  })
  it('run-name template round-trips through the strict regex for full and config_only (e-mail with apostrophe is sanitised)', async () => {
    await shipService.start({ id: fx.OID, email: "O'Brien+tag@Example.com" }, input)
    const full = dispatched[0].inputs
    expect(full.triggered_by).toBe("o_brien+tag@example.com")
    expect(shipStatus.parseRunName(template(full))).toEqual({ cid: full.correlation_id, app: 'my-app', env: 'devsand', repo: 'AyaHealthcare/my-svc', by: 'o_brien+tag@example.com', oid: fx.OID, mode: 'full', retryBy: '-' })
    const cfgOnly = { ...full, mode: 'config_only', retry_by: 'platform@x.com' }
    expect(shipStatus.parseRunName(template(cfgOnly))).toMatchObject({ mode: 'config_only', retryBy: 'platform@x.com' })
    expect(shipStatus.parseRunName(template(cfgOnly).replace('mode=config_only', 'mode=other'))).toBeNull()
  })
  it('a user without an e-mail claim is dispatched as `unknown`, still parseable', async () => {
    await shipService.start({ id: fx.OID }, input)
    expect(dispatched[0].inputs.triggered_by).toBe('unknown')
    expect(shipStatus.parseRunName(template(dispatched[0].inputs))).not.toBeNull()
  })
  it('emits ship_started (carrying the ship id and request id) and an info line prefixed [shipId]', async () => {
    const spy = vi.spyOn(logger, 'log')
    const res = await shipService.start(sam, input, { requestId: 'req-42' })
    const started = spy.mock.calls.find((c: any[]) => c[1] === 'ship_started') as any[]
    expect(started[2]).toMatchObject({ correlation_id: res.correlationId, requestId: 'req-42', app: 'my-app' })
    expect(spy.mock.calls.some((c: any[]) => typeof c[1] === 'string' && c[1].startsWith(`[${res.correlationId}]`))).toBe(true)
  })
})
