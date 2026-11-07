/**
 * QA (ship-from-repo, independent): FAIL-CLOSED behaviour at the HTTP layer — provider `none` (H-2), flag false, default
 * workflow ref (H-5/DD-11), empty org allowlist (H-7), empty platform roles (H-4). Also loads the REAL config defaults
 * with every SHIP_* variable removed. Complements (does not copy) tests/integration/api/ship.spec.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRequire } from 'node:module'

process.env.GITHUB_APP_ID = ''
process.env.GITHUB_INSTALLATION_ID = ''
const cjsRequire = createRequire(import.meta.url)
const { createHarness, ID } = cjsRequire('../../helpers/shipQaHarness')
const h = createHarness()
const { config, githubService, aksService, ship, api, fx } = h
const { isPlatformMember } = cjsRequire('../../../utils/platformTeam')

const MIN = 60_000
const goodBody = { repo: 'AyaHealthcare/my-svc', branch: 'main', app: 'my-app', env: 'devsand' }
let env: ReturnType<typeof h.wire>
let w: any
let counts: Record<string, number>

beforeEach(() => {
  w = fx.makeWorld(githubService)
  env = h.wire(w)
  counts = { repo: 0, branch: 0, appState: 0 }
  const repo = githubService.codeAppGetRepo
  const branch = githubService.codeAppBranchExists
  githubService.codeAppGetRepo = async (...a: any[]) => { counts.repo++; return repo(...a) }
  githubService.codeAppBranchExists = async (...a: any[]) => { counts.branch++; return branch(...a) }
  aksService.getAppState = async () => { counts.appState++; return { appState: 'new' } }
})

describe('real defaults are fail-closed (config.js loaded fresh with all SHIP_* env removed)', () => {
  function freshConfig() {
    const saved: Record<string, string | undefined> = {}
    for (const k of Object.keys(process.env).filter((x) => x.startsWith('SHIP_'))) { saved[k] = process.env[k]; delete process.env[k] }
    const path = cjsRequire.resolve('../../../config')
    const prior = cjsRequire.cache[path]
    delete cjsRequire.cache[path]
    try { return cjsRequire('../../../config') } finally {
      cjsRequire.cache[path] = prior
      for (const [k, v] of Object.entries(saved)) process.env[k] = v
    }
  }
  it('identity none, no orgs, no platform members, no preview host, gates and watchdog off, flag off for every env', () => {
    const s = freshConfig().ship
    expect(s.identityProvider).toBe('none')
    expect(s.allowedOrgs).toEqual([])
    expect(s.platformRoles).toEqual([])
    expect(s.platformGroupIds).toEqual([])
    expect(s.previewHosts).toEqual({})
    expect(s.annotationsVerified).toBe(false)
    expect(s.queueSignalsVerified).toBe(false)
    expect(s.watchdogCancelEnabled).toBe(false)
    expect(s.acrReadEnabled).toBe(false)
    expect(s.allowDefaultRef).toBe(false)
    expect(s.supportedShipEnvironments).toEqual([])
  })
  it('SHIP_WORKFLOW_REF unset ⇒ the workflow ref IS the default flux ref (so DD-11 refuses to dispatch)', () => {
    const c = freshConfig()
    expect(c.ship.workflowRef).toBe(c.aks.fluxBranch)
  })
  it('data/environments.json: no environment has features.shipFromRepo === true; devsand is explicitly false', () => {
    const file = cjsRequire('../../../data/environments.json')
    expect(file.environments.filter((e: any) => e.features?.shipFromRepo === true)).toEqual([])
    expect(file.environments.find((e: any) => e.id === 'devsand').features.shipFromRepo).toBe(false)
  })
})

describe('provider none (H-2) fails closed on every identity-dependent endpoint, before any GitHub call', () => {
  beforeEach(() => { config.ship.identityProvider = 'none' })
  it('POST ⇒ 403 REPO_NOT_ACCESSIBLE hint IDENTITY_NOT_LINKED for an admin, a repo owner and a platform member alike', async () => {
    for (const token of ['sam', 'admin', 'reader', 'stranger']) {
      const res = await ship('POST', '/', { token, body: goodBody })
      expect(res.statusCode, token).toBe(403)
      expect(res.body.error).toMatchObject({ code: 'REPO_NOT_ACCESSIBLE', hint: 'IDENTITY_NOT_LINKED' })
    }
    expect(env.dispatched).toHaveLength(0)
    expect(counts).toEqual({ repo: 0, branch: 0, appState: 0 })
  })
  it('an unrecognised provider name also resolves to none', async () => {
    config.ship.identityProvider = 'entra-magic'
    const res = await ship('POST', '/', { body: goodBody })
    expect(res.statusCode).toBe(403)
    expect(res.body.error.hint).toBe('IDENTITY_NOT_LINKED')
    expect(env.dispatched).toHaveLength(0)
  })
  it('config says unlinked; repos is empty; branches and app advisory are 403 with zero GitHub calls', async () => {
    expect((await ship('GET', '/config')).body.data.identity).toMatchObject({ state: 'unlinked' })
    expect((await ship('GET', '/repos')).body.data).toMatchObject({ repos: [], identity: { state: 'unlinked' } })
    expect((await ship('GET', '/repos/AyaHealthcare/my-svc/branches')).statusCode).toBe(403)
    expect((await ship('GET', '/apps/devsand/my-app', { query: { repo: 'AyaHealthcare/my-svc' } })).statusCode).toBe(403)
    expect(counts).toEqual({ repo: 0, branch: 0, appState: 0 })
  })
  it('a failed start leaves no reserved cap slot behind (10 refused POSTs, then a linked user still starts)', async () => {
    for (let i = 0; i < 10; i++) await ship('POST', '/', { body: { ...goodBody, app: `app-${i}` } })
    config.ship.identityProvider = 'test'
    expect((await ship('POST', '/', { body: goodBody })).statusCode).toBe(202)
  })
})

describe('flag false (no env has features.shipFromRepo)', () => {
  beforeEach(() => { config.ship.identityProvider = 'test'; config.ship.supportedShipEnvironments = [] })
  it('POST ⇒ 400 VALIDATION_FAILED on `env`, no dispatch, no GitHub call', async () => {
    const res = await ship('POST', '/', { body: goodBody })
    expect(res.statusCode).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.map((d: any) => d.field)).toContain('env')
    expect(env.dispatched).toHaveLength(0)
    expect(counts).toEqual({ repo: 0, branch: 0, appState: 0 })
  })
  it('app advisory ⇒ 400 for the same env; an env outside the supported list is never accepted even when the flag env is on', async () => {
    expect((await ship('GET', '/apps/devsand/my-app', { query: { repo: goodBody.repo } })).statusCode).toBe(400)
    config.ship.supportedShipEnvironments = ['devsand']
    expect((await ship('POST', '/', { body: { ...goodBody, env: 'prod' } })).statusCode).toBe(400)
    expect((await ship('POST', '/', { body: { ...goodBody, env: ['devsand'] } })).statusCode).toBe(400)
  })
})

describe('SHIP_WORKFLOW_REF unset ⇒ the default ref (DD-11, H-5)', () => {
  beforeEach(() => { config.ship.identityProvider = 'test'; config.ship.workflowRef = config.aks.fluxBranch })
  it('POST ⇒ 503 SHIP_UNAVAILABLE and nothing is dispatched (even for a fully linked, authorised user)', async () => {
    const res = await ship('POST', '/', { body: goodBody })
    expect(res.statusCode).toBe(503)
    expect(res.body.error.code).toBe('SHIP_UNAVAILABLE')
    expect(env.dispatched).toHaveLength(0)
    expect(counts).toEqual({ repo: 0, branch: 0, appState: 0 })
  })
  it('only the explicit waiver (SHIP_ALLOW_DEFAULT_REF) lifts it; the dispatch then uses the configured ref', async () => {
    config.ship.allowDefaultRef = true
    const res = await ship('POST', '/', { body: goodBody })
    expect(res.statusCode).toBe(202)
    expect(env.dispatched[0].ref).toBe(config.aks.fluxBranch)
  })
})

describe('empty org allowlist (H-7)', () => {
  beforeEach(() => { config.ship.identityProvider = 'test'; config.ship.allowedOrgs = [] })
  it('POST ⇒ 400 on repo; branches ⇒ 400; the repo list is empty even if the identity provider returns repos', async () => {
    const post = await ship('POST', '/', { body: goodBody })
    expect(post.statusCode).toBe(400)
    expect(post.body.error.details.map((d: any) => d.field)).toContain('repo')
    expect((await ship('GET', '/repos/AyaHealthcare/my-svc/branches')).statusCode).toBe(400)
    expect((await ship('GET', '/repos')).body.data.repos).toEqual([])
    expect(env.dispatched).toHaveLength(0)
  })
})

describe('empty platform roles (H-4): nobody is a platform member', () => {
  const seed = () => fx.buildRun(w, { cid, id: 1000, createdAt: new Date(t + 5000).toISOString() })
  let t: number
  let cid: string
  beforeEach(() => {
    t = Date.now() - 4 * 60 * MIN
    cid = fx.mintAt(t)
    config.ship.platformRoles = []
    config.ship.platformGroupIds = []
  })
  it('isPlatformMember is false for every shape of user (roles/groups as strings, empty strings, undefined, null)', () => {
    const odd = [null, undefined, {}, { roles: 'Platform.Admin' }, { roles: ['Platform.Admin'] }, { groups: [''] }, { roles: [''], groups: [''] }, { groups: 'x' }]
    for (const u of odd) expect(isPlatformMember(u as any)).toBe(false)
  })
  it('a user holding the (now unconfigured) admin role gets 403 on someone else’s status/logs/cancel/retry', async () => {
    seed()
    expect((await ship('GET', `/status/${cid}`, { token: 'admin' })).statusCode).toBe(403)
    expect((await ship('GET', `/logs/${cid}`, { token: 'admin', query: { stage: 'prepare' } })).statusCode).toBe(403)
    expect((await ship('POST', `/${cid}/cancel`, { token: 'admin' })).statusCode).toBe(403)
    expect((await ship('POST', `/${cid}/retry-config-pr`, { token: 'admin' })).statusCode).toBe(403)
    expect(w.cancelled).toHaveLength(0)
    expect(env.dispatched).toHaveLength(0)
  })
  it('legacy status route: platform bypass is also off (admin ≠ owner ⇒ 403); the owner still passes', async () => {
    aksService.getDeploymentStatusByCorrelationId = async () => ({ status: 'success', displayTitle: 'Deploy a-b [CID:x] by=sam@example.com', jobId: 7 })
    expect((await api('GET', '/aks-status-by-correlation/x', { token: 'admin' })).statusCode).toBe(403)
    expect((await api('GET', '/aks-status-by-correlation/x', { token: 'sam' })).statusCode).toBe(200)
  })
  it('with the user id missing the “starter” comparison never matches (no undefined === undefined)', async () => {
    seed()
    h.hook.override = async () => ({ email: 'x@x.com', roles: [], groups: [] })
    try {
      const res = await ship('GET', `/status/${cid}`, { token: 'anything' })
      expect([403, 404]).toContain(res.statusCode)
      expect((await ship('POST', '/', { token: 'anything', body: goodBody })).statusCode).toBe(403)
    } finally { h.hook.override = null }
  })
})

describe('V-3 gate (SHIP_GATE_V3_PASSED=false by default): no trusted annotation payload is exposed and retry is never applicable', () => {
  let t: number
  let cid: string
  beforeEach(() => {
    t = Date.now() - 4 * 60 * MIN
    cid = fx.mintAt(t)
    fx.buildRun(w, { cid, id: 1000, createdAt: new Date(t + 5000).toISOString() })
    config.ship.platformRoles = ['Platform.Admin']
  })
  it('gate OFF: a fully successful run exposes no version / sha / digest / image reference', async () => {
    config.ship.annotationsVerified = false
    const res = await ship('GET', `/status/${cid}`)
    expect(res.statusCode).toBe(200)
    const text = JSON.stringify(res.body)
    expect(text).not.toMatch(/1\.2\.3|sha256:|selfserve\/my-app|aaaaaaaa/)
    expect(res.body.data.version).toBeUndefined()
    expect(res.body.data.digest).toBeUndefined()
    expect(res.body.data.imageRef).toBeUndefined()
  })
  it('gate OFF: retry-config-pr is 409 RETRY_NOT_APPLICABLE even for a platform member on a CONFIG_PR_FAILED run', async () => {
    w.runs.length = 0; for (const k of Object.keys(w.jobs)) delete w.jobs[k]
    fx.buildRun(w, { cid, id: 1000, createdAt: new Date(t + 5000).toISOString(), failAt: 'config' })
    config.ship.annotationsVerified = false
    const res = await ship('POST', `/${cid}/retry-config-pr`, { token: 'admin' })
    expect(res.statusCode).toBe(409)
    expect(res.body.error.code).toBe('RETRY_NOT_APPLICABLE')
    expect(env.dispatched).toHaveLength(0)
  })
  it('control: gate ON exposes the trusted version on the very same fixture (the test above is not vacuous)', async () => {
    config.ship.annotationsVerified = true
    const res = await ship('GET', `/status/${cid}`)
    expect(res.body.data.version).toBe('1.2.3')
  })
})

void ID
void vi
