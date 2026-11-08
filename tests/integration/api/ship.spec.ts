/**
 * BT-02 (POST envelope), BT-03 (flag gating at the API), BT-16 (logs endpoint), BT-17/18 (cancel / retry preconditions via
 * routes), BT-22 (legacy route B-5), plus 401s and read endpoints — spec §9.1. Routers are driven with `router.handle`
 * (no sockets); GitHub, the identity provider and the JWT validator are doubles.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'

process.env.GITHUB_APP_ID = ''
process.env.GITHUB_INSTALLATION_ID = ''
const cjsRequire = createRequire(import.meta.url)

const users: Record<string, any> = {
  sam: { id: '11111111-2222-3333-4444-555555555555', email: 'Sam@Example.com', roles: [], groups: [] },
  reader: { id: '99999999-2222-3333-4444-555555555555', email: 'reader@x.com', roles: [], groups: [] },
  admin: { id: 'aaaaaaaa-2222-3333-4444-555555555555', email: 'admin@x.com', roles: ['Platform.Admin'], groups: [] },
  stranger: { id: 'bbbbbbbb-2222-3333-4444-555555555555', email: 'nobody@x.com', roles: [], groups: [] },
  obrien: { id: 'cccccccc-2222-3333-4444-555555555555', email: "O'Brien@Example.com", roles: [], groups: [] },
}
const jwt = cjsRequire('../../../utils/jwtValidator')
jwt.validateToken = async (token: string) => { if (!users[token]) throw new Error('invalid'); return users[token] }
for (const m of ['../../../middleware/auth', '../../../routes/ship', '../../../routes/api']) delete cjsRequire.cache[cjsRequire.resolve(m)]

const config = cjsRequire('../../../config')
const githubService = cjsRequire('../../../services/githubService')
const aksService = cjsRequire('../../../services/aksService')
const infrastructureService = cjsRequire('../../../services/infrastructureService')
const identity = cjsRequire('../../../services/shipIdentityService')
const shipService = cjsRequire('../../../services/shipService')
const shipStatus = cjsRequire('../../../services/shipStatusService')
const { createTestProvider } = cjsRequire('../../helpers/shipIdentityTestDouble')
const fx = cjsRequire('../../helpers/shipFixtures')
const shipRouter = cjsRequire('../../../routes/ship')
const apiRouter = cjsRequire('../../../routes/api')

function caller(router: any) {
  return (method: string, url: string, { token = 'sam', body = {}, query = {} }: { token?: string | null; body?: any; query?: any } = {}) =>
    new Promise<any>((resolve) => {
      const req: any = { method, url, originalUrl: url, headers: token ? { authorization: `Bearer ${token}` } : {}, body, query, correlationId: 'req-1' }
      const res: any = {
        statusCode: 200, headers: {} as Record<string, string>,
        status(c: number) { this.statusCode = c; return this },
        set(k: string, v: string) { this.headers[k] = v; return this },
        setHeader(k: string, v: string) { this.headers[k] = v },
        json(b: any) { this.body = b; resolve(this); return this },
        send(b: any) { this.text = b; resolve(this); return this },
      }
      router.handle(req, res, () => resolve({ statusCode: 404, body: { unmatched: true } }))
    })
}
const ship = caller(shipRouter)
const api = caller(apiRouter)

const MIN = 60_000
const iso = (ms: number) => new Date(ms).toISOString()
let w: any
let dispatched: any[]
let t: number
let cid: string
let created: string

function wireHappyPath() {
  identity.registerProvider('test', createTestProvider({
    links: { [users.sam.id]: 'octocat', [users.reader.id]: 'reader-login', [users.admin.id]: 'admin-login' },
    repos: { octocat: [{ fullName: 'organization/my-svc', org: 'organization', name: 'my-svc', defaultBranch: 'main', private: true }] },
    permissions: { 'octocat:organization/my-svc': 'admin', 'reader-login:organization/my-svc': 'read', 'admin-login:organization/my-svc': 'write' },
  }))
  config.ship.identityProvider = 'test'
  githubService.codeAppGetRepo = async () => ({ defaultBranch: 'main', private: true, fork: false })
  githubService.codeAppBranchExists = async () => true
  githubService.triggerWorkflow = async (repo: string, wf: string, ref: string, inputs: any) => { dispatched.push({ repo, wf, ref, inputs }); return { success: true } }
  aksService.getAppState = async () => ({ appState: 'new' })
}

const goodBody = { repo: 'organization/my-svc', branch: 'main', app: 'my-app', env: 'devsand' }

beforeEach(() => {
  shipStatus._resetForTests(); shipService._resetForTests()
  w = fx.makeWorld(githubService)
  dispatched = []
  config.ship.allowedOrgs = ['organization']
  config.ship.supportedShipEnvironments = ['devsand']
  config.ship.workflowRef = 'ship/v1'
  config.ship.allowDefaultRef = false
  config.ship.annotationsVerified = true
  config.ship.queueSignalsVerified = false
  config.ship.platformRoles = ['Platform.Admin']
  config.ship.platformGroupIds = []
  config.ship.identityProvider = 'none'
  config.ship.previewHosts = {}
  t = Date.now() - 4 * 60 * MIN
  cid = fx.mintAt(t)
  created = iso(t + 5000)
  wireHappyPath()
  config.ship.identityProvider = 'none'
})
afterEach(() => { vi.restoreAllMocks() })

describe('authentication', () => {
  it.each([
    ['GET', '/config'], ['GET', '/repos'], ['GET', '/repos/organization/my-svc/branches'], ['GET', '/apps/devsand/my-app'],
    ['POST', '/'], ['GET', '/status/x'], ['GET', '/logs/x'], ['POST', '/x/cancel'], ['POST', '/x/retry-config-pr'],
  ])('%s %s without a token ⇒ 401 (existing middleware shape)', async (method, url) => {
    const res = await ship(method, url, { token: null })
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ success: false, error: 'Authentication required' })
  })
  it('an invalid token ⇒ 401', async () => {
    expect((await ship('GET', '/config', { token: 'nope' })).statusCode).toBe(401)
  })
})

describe('GET /config (#1)', () => {
  it('returns capabilities; identity unlinked with provider none', async () => {
    const res = await ship('GET', '/config')
    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toMatchObject({
      allowedOrgs: ['organization'], identity: { state: 'unlinked', reason: 'IDENTITY_MAPPING_NOT_CONFIGURED' }, previewConfiguredEnvs: [],
      defaults: { port: 8080, healthPath: '/healthz', bump: 'patch', teamLabel: 'software-engineering' },
      limits: { portMin: 1024, portMax: 65535, recentMax: 20, pollIntervalMs: 15000 },
    })
    expect(Array.isArray(res.body.data.supportedLanguages)).toBe(true)
  })
  it('linked identity and configured preview envs', async () => {
    config.ship.identityProvider = 'test'
    config.ship.previewHosts = { devsand: { suffix: 'apps.example.test', scheme: 'https' }, bad: { suffix: 'x y', scheme: 'https' } }
    const res = await ship('GET', '/config')
    expect(res.body.data.identity).toEqual({ state: 'linked' })
    expect(res.body.data.previewConfiguredEnvs).toEqual(['devsand'])
  })
})

describe('GET /repos and /branches (#2, #3) via routes', () => {
  it('provider none ⇒ empty list with identity unlinked', async () => {
    const res = await ship('GET', '/repos')
    expect(res.body.data).toMatchObject({ repos: [], identity: { state: 'unlinked' }, truncated: false })
  })
  it('linked ⇒ user∩App repos; invalid q ⇒ 400', async () => {
    config.ship.identityProvider = 'test'
    const ok = await ship('GET', '/repos', { query: { q: 'my' } })
    expect(ok.body.data.repos).toEqual([{ fullName: 'organization/my-svc', org: 'organization', name: 'my-svc', defaultBranch: 'main', private: true }])
    const bad = await ship('GET', '/repos', { query: { q: 'a b' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.body.error.code).toBe('VALIDATION_FAILED')
  })
  it('branches: org not allowlisted ⇒ 400; no identity ⇒ 403 REPO_NOT_ACCESSIBLE', async () => {
    expect((await ship('GET', '/repos/evil/x/branches')).statusCode).toBe(400)
    const res = await ship('GET', '/repos/organization/my-svc/branches')
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toMatchObject({ code: 'REPO_NOT_ACCESSIBLE', hint: 'IDENTITY_NOT_LINKED' })
  })
})

describe('BT-02 POST /api/ship', () => {
  beforeEach(() => { config.ship.identityProvider = 'test' })

  it('202 with the documented payload; the ship ID is a server-minted UUIDv7 used in the envelope', async () => {
    const res = await ship('POST', '/', { body: goodBody })
    expect(res.statusCode).toBe(202)
    const d = res.body.data
    expect(res.body.success).toBe(true)
    expect(res.body.correlationId).toBe(d.correlationId)
    expect(d.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(d).toMatchObject({ app: 'my-app', env: 'devsand', repo: 'organization/my-svc', branch: 'main', appState: 'new', settingsIgnored: [], rollout: 'preview_pr', effectiveSettings: { port: 8080, healthPath: '/healthz' } })
    expect(Date.parse(d.startedAt)).toBeGreaterThan(Date.now() - 5000)
    expect(dispatched).toHaveLength(1)
  })

  it('400 with field errors and NO dispatch (incl. reserved namespace)', async () => {
    const res = await ship('POST', '/', { body: { repo: 'x', branch: 'a..b', app: 'Bad_App', env: 'sand', namespace: 'kube-system', port: 80, healthPath: '/a b', bump: 'huge' } })
    expect(res.statusCode).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.map((e: any) => e.field)).toEqual(expect.arrayContaining(['repo', 'branch', 'app', 'env', 'namespace', 'port', 'healthPath', 'bump']))
    expect(dispatched).toHaveLength(0)
  })

  it('spoofed body fields are discarded and never forwarded; actor/oid/login are server-set', async () => {
    const res = await ship('POST', '/', { body: { ...goodBody, triggeredBy: 'evil@x', triggered_by: 'evil@x', triggered_by_oid: 'evil', correlationId: 'client-chosen', correlation_id: 'client-chosen', requesterLogin: 'someone-else', requester_github_login: 'someone-else', mode: 'config_only', retry_by: 'x', origin_run_id: '1', config_image_tag: '9.9.9' } })
    expect(res.statusCode).toBe(202)
    const { inputs } = dispatched[0]
    expect(inputs.triggered_by).toBe('sam@example.com')
    expect(inputs.triggered_by_oid).toBe(users.sam.id)
    expect(inputs.requester_github_login).toBe('octocat')
    expect(inputs.mode).toBe('full')
    expect(inputs.correlation_id).toBe(res.body.data.correlationId)
    expect(inputs.correlation_id).not.toBe('client-chosen')
    expect(inputs.retry_by).toBeUndefined()
    expect(inputs.origin_run_id).toBeUndefined()
    expect(inputs.config_image_tag).toBeUndefined()
  })

  it('403 REPO_NOT_ACCESSIBLE with hint IDENTITY_NOT_LINKED when the identity is unmapped; nothing dispatched; no GitHub call', async () => {
    const lookup = vi.fn(githubService.codeAppGetRepo)
    githubService.codeAppGetRepo = lookup
    const res = await ship('POST', '/', { body: goodBody, token: 'stranger' })
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toMatchObject({ code: 'REPO_NOT_ACCESSIBLE', hint: 'IDENTITY_NOT_LINKED' })
    expect(lookup).not.toHaveBeenCalled()
    expect(dispatched).toHaveLength(0)
  })

  it('provider `none` fails closed for everyone', async () => {
    config.ship.identityProvider = 'none'
    const res = await ship('POST', '/', { body: goodBody })
    expect(res.statusCode).toBe(403)
    expect(res.body.error.hint).toBe('IDENTITY_NOT_LINKED')
    expect(dispatched).toHaveLength(0)
  })

  it('403 REPO_NOT_ACCESSIBLE (generic, no hint) when the linked user lacks permission, repo missing, or it is a fork', async () => {
    identity.registerProvider('test', createTestProvider({ links: { [users.sam.id]: 'octocat' }, permissions: {} }))
    let res = await ship('POST', '/', { body: goodBody })
    expect(res.body.error).toMatchObject({ code: 'REPO_NOT_ACCESSIBLE' })
    expect(res.body.error.hint).toBeUndefined()
    wireHappyPath(); config.ship.identityProvider = 'test'
    githubService.codeAppGetRepo = async () => null
    res = await ship('POST', '/', { body: goodBody })
    expect(res.body.error.code).toBe('REPO_NOT_ACCESSIBLE')
    githubService.codeAppGetRepo = async () => ({ defaultBranch: 'main', private: false, fork: true })
    res = await ship('POST', '/', { body: goodBody })
    expect(res.body.error.code).toBe('REPO_NOT_ACCESSIBLE')
    expect(dispatched).toHaveLength(0)
  })

  it('the three not-accessible causes return identical bodies (no existence oracle, AC-001-4)', async () => {
    identity.registerProvider('test', createTestProvider({ links: { [users.sam.id]: 'octocat' }, permissions: {} }))
    const noPerm = (await ship('POST', '/', { body: goodBody })).body.error
    wireHappyPath(); config.ship.identityProvider = 'test'
    githubService.codeAppGetRepo = async () => null
    const missing = (await ship('POST', '/', { body: goodBody })).body.error
    expect(noPerm).toEqual(missing)
  })

  it('403 APP_OWNED_BY_OTHER for a bring-your-own-image app; no dispatch', async () => {
    aksService.getAppState = async () => ({ appState: 'merged', effectiveSettings: { port: 80, healthPath: '/h' }, imageName: 'exampleregistry.azurecr.io/platform/my-app' })
    const res = await ship('POST', '/', { body: goodBody })
    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('APP_OWNED_BY_OTHER')
    expect(dispatched).toHaveLength(0)
  })

  it('400 on a branch that does not exist', async () => {
    githubService.codeAppBranchExists = async () => false
    const res = await ship('POST', '/', { body: goodBody })
    expect(res.statusCode).toBe(400)
    expect(res.body.error.details).toEqual([{ field: 'branch', message: 'branch not found' }])
  })

  it('503 when the workflow ref is the default ref without the explicit waiver (DD-11); nothing dispatched', async () => {
    config.ship.workflowRef = config.aks.fluxBranch
    const res = await ship('POST', '/', { body: goodBody })
    expect(res.statusCode).toBe(503)
    expect(res.body.error.code).toBe('SHIP_UNAVAILABLE')
    expect(dispatched).toHaveLength(0)
    config.ship.allowDefaultRef = true
    expect((await ship('POST', '/', { body: goodBody })).statusCode).toBe(202)
  })

  it('500 UNKNOWN has a generic message and no stack on unexpected errors', async () => {
    githubService.triggerWorkflow = async () => { const e: any = new Error('boom with /secret/path'); e.status = 422; throw e }
    const res = await ship('POST', '/', { body: goodBody })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toEqual({ code: 'UNKNOWN', message: 'Unexpected error.' })
    expect(JSON.stringify(res.body)).not.toContain('secret')
  })

  it('GitHub rate limit on dispatch ⇒ 429 PLATFORM_RATE_LIMITED with Retry-After; outage ⇒ 503', async () => {
    githubService.triggerWorkflow = async () => { const e: any = new Error('rate limit'); e.status = 429; e.response = { headers: { 'retry-after': '42' } }; throw e }
    let res = await ship('POST', '/', { body: goodBody })
    expect(res.statusCode).toBe(429)
    expect(res.headers['Retry-After']).toBe('42')
    expect(res.body.error).toMatchObject({ code: 'PLATFORM_RATE_LIMITED', details: { limit: 'github' } })
    githubService.triggerWorkflow = async () => { const e: any = new Error('bad gateway'); e.status = 502; throw e }
    res = await ship('POST', '/', { body: { ...goodBody, app: 'other-app' } })
    expect(res.statusCode).toBe(503)
    expect(res.body.error.code).toBe('PLATFORM_RATE_LIMITED')
  })
})

describe('BT-03 flag gating at the API', () => {
  it('POST rejects an env without features.shipFromRepo (400 on env)', async () => {
    config.ship.identityProvider = 'test'
    config.ship.supportedShipEnvironments = []
    const res = await ship('POST', '/', { body: goodBody })
    expect(res.statusCode).toBe(400)
    expect(res.body.error.details.map((e: any) => e.field)).toContain('env')
    expect(dispatched).toHaveLength(0)
  })
  it('GET /api/environments serves the flag (false on devsand until Phase 4 gates pass)', async () => {
    const res = await api('GET', '/environments', { token: null })
    const devsand = res.body.data.environments.find((e: any) => e.id === 'devsand')
    expect(devsand.features.shipFromRepo).toBe(false)
    expect(res.body.data.environments.filter((e: any) => e.id !== 'devsand').every((e: any) => !('shipFromRepo' in (e.features || {})))).toBe(true)
    expect(typeof (await infrastructureService.getEnvironments()).environments).toBe('object')
  })
})

describe('GET /apps/:env/:app (#4)', () => {
  it('returns app state + ownership advisory for a user who can read the repo', async () => {
    config.ship.identityProvider = 'test'
    aksService.getAppState = async () => ({ appState: 'merged', effectiveSettings: { port: 9000, healthPath: '/ready' }, imageName: 'exampleregistry.azurecr.io/selfserve/my-app' })
    const res = await ship('GET', '/apps/devsand/my-app', { query: { repo: 'organization/my-svc' } })
    expect(res.statusCode).toBe(200)
    expect(res.body.data).toEqual({ appState: 'merged', ownership: 'unknown', ownershipSource: 'none', effectiveSettings: { port: 9000, healthPath: '/ready' } })
  })
  it('flags a bring-your-own-image app as unowned_existing; no owner repo is ever named without ACR', async () => {
    config.ship.identityProvider = 'test'
    aksService.getAppState = async () => ({ appState: 'merged', imageName: 'other.azurecr.io/x/my-app' })
    const res = await ship('GET', '/apps/devsand/my-app', { query: { repo: 'organization/my-svc' } })
    expect(res.body.data).toMatchObject({ ownership: 'unowned_existing', ownershipSource: 'github' })
    expect(res.body.data.owningRepo).toBeUndefined()
  })
  it('403 REPO_NOT_ACCESSIBLE for a user without access; 400 for a non-flagged env', async () => {
    config.ship.identityProvider = 'test'
    expect((await ship('GET', '/apps/devsand/my-app', { token: 'stranger', query: { repo: 'organization/my-svc' } })).statusCode).toBe(403)
    expect((await ship('GET', '/apps/sand/my-app', { query: { repo: 'organization/my-svc' } })).statusCode).toBe(400)
  })
})

describe('status / logs routes (#6, #7)', () => {
  const seed = (over: any = {}) => fx.buildRun(w, { cid, id: 1000, createdAt: created, ...over })

  it('400 for a non-UUIDv7 id; 404 for unknown / future; envelope carries the ship id', async () => {
    expect((await ship('GET', '/status/3f1d8b0e-6a3c-4b83-9d0a-0d5f8e2d9c11')).statusCode).toBe(400)
    const missing = await ship('GET', `/status/${fx.mintAt(Date.now() - 10 * MIN)}`)
    expect(missing.statusCode).toBe(404)
    expect(missing.body.error.code).toBe('NOT_FOUND')
    seed()
    const ok = await ship('GET', `/status/${cid}`)
    expect(ok.statusCode).toBe(200)
    expect(ok.body).toMatchObject({ success: true, correlationId: cid })
    expect(ok.body.data.correlationId).toBe(cid)
    expect(ok.body.data._meta).toBeUndefined()
  })
  it('403 FORBIDDEN for another user; `since` is ignored', async () => {
    seed()
    const res = await ship('GET', `/status/${cid}`, { token: 'stranger', query: { since: '2020-01-01' } })
    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect((await ship('GET', `/status/${cid}`, { query: { since: '2020-01-01' } })).statusCode).toBe(200)
  })
  it('429 on GitHub rate limit while reading', async () => {
    githubService.listWorkflowRunsInWindow = async () => { const e: any = new Error('API rate limit exceeded'); e.status = 403; e.response = { headers: { 'x-ratelimit-remaining': '0' } }; throw e }
    const res = await ship('GET', `/status/${cid}`)
    expect(res.statusCode).toBe(429)
    expect(res.body.error.code).toBe('PLATFORM_RATE_LIMITED')
    expect(res.headers['Retry-After']).toBeDefined()
  })

  describe('BT-16 logs', () => {
    const logText = (lines: Array<[string, string]>) => lines.map(([ts, msg]) => `${ts} ${msg}`).join('\n')
    beforeEach(() => {
      const r = seed()
      // publish job steps: Publish group 14:20–14:25, Config PR group 14:26–14:29
      r.jobs[3].steps = [
        { ...fx.step('Publish: guard'), started_at: '2026-10-22T14:20:00Z', completed_at: '2026-10-22T14:21:00Z' },
        { ...fx.step('Publish: verify image'), started_at: '2026-10-22T14:21:00Z', completed_at: '2026-10-22T14:22:00Z' },
        { ...fx.step('Publish: version'), started_at: '2026-10-22T14:22:00Z', completed_at: '2026-10-22T14:23:00Z' },
        { ...fx.step('Publish: push'), started_at: '2026-10-22T14:23:00Z', completed_at: '2026-10-22T14:25:00Z' },
        { ...fx.step('Emit: publish'), started_at: '2026-10-22T14:25:00Z', completed_at: '2026-10-22T14:25:30Z' },
        { ...fx.step('Config PR: decide'), started_at: '2026-10-22T14:26:00Z', completed_at: '2026-10-22T14:26:30Z' },
        { ...fx.step('Config PR: guard'), started_at: '2026-10-22T14:26:30Z', completed_at: '2026-10-22T14:27:00Z' },
        { ...fx.step('Config PR: dispatch'), started_at: '2026-10-22T14:27:00Z', completed_at: '2026-10-22T14:28:00Z' },
        { ...fx.step('Config PR: wait'), started_at: '2026-10-22T14:28:00Z', completed_at: '2026-10-22T14:29:00Z' },
        { ...fx.step('Emit: config'), started_at: '2026-10-22T14:29:00Z', completed_at: '2026-10-22T14:29:30Z' },
      ]
      const tokenLine = 'tok' + 'en: gh' + 'p_' + 'a1'.repeat(18)
      w.logs[r.jid(4)] = logText([
        ['2026-10-22T14:20:10Z', '##[group]Run publish guard'], ['2026-10-22T14:23:30Z', 'pushing image'],
        ['2026-10-22T14:24:00Z', `\u001b[31m${tokenLine}\u001b[0m`], ['2026-10-22T14:26:10Z', 'creating config PR'], ['2026-10-22T14:28:30Z', 'waiting for config run'],
      ])
      w.logs[r.jid(2)] = logText([['2026-10-22T14:06:00Z', 'build line']])
      w.jid = r.jid
    })

    it('maps stages to jobs/steps: publish minus Config PR; config_pr only Config PR', async () => {
      const pub = (await ship('GET', `/logs/${cid}`, { query: { stage: 'publish' } })).body.data
      expect(pub.text).toContain('pushing image')
      expect(pub.text).not.toContain('creating config PR')
      const cfg = (await ship('GET', `/logs/${cid}`, { query: { stage: 'config_pr' } })).body.data
      expect(cfg.text).toContain('creating config PR')
      expect(cfg.text).not.toContain('pushing image')
      const build = (await ship('GET', `/logs/${cid}`, { query: { stage: 'build' } })).body.data
      expect(build.text).toBe('2026-10-22T14:06:00Z build line')
    })
    it('redacts secrets and strips ANSI; no storage URLs / tokens in the response', async () => {
      const body = (await ship('GET', `/logs/${cid}`, { query: { stage: 'publish' } })).body
      expect(JSON.stringify(body)).not.toMatch(/gh[p]_|\u001b|blob\.core|Authorization/)
      expect(body.data.text).toContain('***REDACTED***')
    })
    it('incremental: offset continues where the previous chunk ended; complete when the job is done', async () => {
      const first = (await ship('GET', `/logs/${cid}`, { query: { stage: 'build' } })).body.data
      expect(first).toMatchObject({ available: true, complete: true, truncated: false, skippedBytes: 0 })
      const again = (await ship('GET', `/logs/${cid}`, { query: { stage: 'build', offset: String(first.offset) } })).body.data
      expect(again.text).toBe('')
      expect(again.offset).toBe(first.offset)
    })
    it('chunks of at most 256 KB; truncates to the 5 MB tail with skippedBytes', async () => {
      const line = '2026-10-22T14:06:00Z ' + 'x'.repeat(1000)
      w.logs[w.jid(2)] = Array.from({ length: 6000 }, () => line).join('\n')
      const res = (await ship('GET', `/logs/${cid}`, { query: { stage: 'build' } })).body.data
      expect(res.text.length).toBeLessThanOrEqual(256 * 1024)
      expect(res.truncated).toBe(true)
      expect(res.skippedBytes).toBeGreaterThan(0)
      expect(res.totalBytes).toBeLessThanOrEqual(5 * 1024 * 1024)
      expect(res.complete).toBe(false)
      const next = (await ship('GET', `/logs/${cid}`, { query: { stage: 'build', offset: String(res.offset) } })).body.data
      expect(next.offset).toBeGreaterThan(res.offset)
    })
    it('download=1 returns the redacted text as a text/plain attachment', async () => {
      const res = await ship('GET', `/logs/${cid}`, { query: { stage: 'build', download: '1' } })
      expect(res.headers['Content-Type']).toMatch(/^text\/plain/)
      expect(res.headers['Content-Disposition']).toMatch(/^attachment; filename="ship-/)
      expect(res.text).toBe('2026-10-22T14:06:00Z build line')
    })
    it('download=1 of a log larger than the 5 MB view cap returns the full text (view cache holds only the capped tail)', async () => {
      const line = '2026-10-22T14:06:00Z ' + 'x'.repeat(1000)
      w.logs[w.jid(2)] = Array.from({ length: 6000 }, () => line).join('\n')
      const view = (await ship('GET', `/logs/${cid}`, { query: { stage: 'build' } })).body.data
      expect(view.totalBytes).toBeLessThanOrEqual(5 * 1024 * 1024)
      const res = await ship('GET', `/logs/${cid}`, { query: { stage: 'build', download: '1' } })
      expect(res.text.length).toBeGreaterThan(5 * 1024 * 1024)
    })
    it('in-progress job with no log yet ⇒ available:false', async () => {
      w.logs = {}
      w.jobs[1000][1].status = 'in_progress'; w.jobs[1000][1].conclusion = null; w.runs[0].status = 'in_progress'; w.runs[0].conclusion = null
      shipStatus._resetForTests()
      const res = (await ship('GET', `/logs/${cid}`, { query: { stage: 'build' } })).body.data
      expect(res).toMatchObject({ available: false, text: '', complete: false })
    })
    it('validation: stage must be one of the five; offset a non-negative integer', async () => {
      expect((await ship('GET', `/logs/${cid}`, { query: { stage: 'config' } })).statusCode).toBe(400)
      expect((await ship('GET', `/logs/${cid}`, { query: { stage: 'build', offset: '-5' } })).statusCode).toBe(400)
    })
    it('authorization: other user 403; platform member allowed', async () => {
      expect((await ship('GET', `/logs/${cid}`, { token: 'stranger', query: { stage: 'build' } })).statusCode).toBe(403)
      expect((await ship('GET', `/logs/${cid}`, { token: 'admin', query: { stage: 'build' } })).statusCode).toBe(200)
    })
  })
})

describe('BT-17 cancel / BT-18 retry-config-pr', () => {
  const seed = (over: any = {}) => fx.buildRun(w, { cid, id: 1000, createdAt: created, ...over })
  const runningBuild = () => {
    const r = seed({ status: 'in_progress' })
    w.jobs[1000] = [fx.job(r.jid(1), 'prepare', {}), fx.job(r.jid(2), 'build', { status: 'in_progress', completed: undefined })]
    return r
  }

  it('starter can cancel while building ⇒ 200 {state:cancelling}; cancel flag recorded', async () => {
    runningBuild()
    const res = await ship('POST', `/${cid}/cancel`)
    expect(res.statusCode).toBe(200)
    expect(res.body.data).toEqual({ state: 'cancelling' })
    expect(w.cancelled).toEqual([1000])
  })
  it('platform member can cancel; repo reader and strangers get 403 and nothing is cancelled', async () => {
    runningBuild()
    config.ship.identityProvider = 'test'
    expect((await ship('POST', `/${cid}/cancel`, { token: 'reader' })).statusCode).toBe(403)
    expect((await ship('POST', `/${cid}/cancel`, { token: 'stranger' })).statusCode).toBe(403)
    expect(w.cancelled).toHaveLength(0)
    expect((await ship('POST', `/${cid}/cancel`, { token: 'admin' })).statusCode).toBe(200)
  })
  it('409 CANCEL_NOT_ALLOWED once publishing has started or the ship finished', async () => {
    const r = seed({ status: 'in_progress' })
    w.jobs[1000] = [fx.job(r.jid(1), 'prepare', {}), fx.job(r.jid(2), 'build', {}), fx.job(r.jid(3), 'scan', {}), fx.job(r.jid(4), 'publish', { status: 'in_progress', completed: undefined, steps: [fx.step('Publish: guard', null as any, 'in_progress', { started_at: '2026-10-22T14:20:00Z' })] })]
    let res = await ship('POST', `/${cid}/cancel`)
    expect(res.statusCode).toBe(409)
    expect(res.body.error.code).toBe('CANCEL_NOT_ALLOWED')
    expect(res.body.error.message).toMatch(/publishing has started/)
    shipStatus._resetForTests(); w = fx.makeWorld(githubService); seed()
    res = await ship('POST', `/${cid}/cancel`)
    expect(res.statusCode).toBe(409)
    expect(w.cancelled).toHaveLength(0)
  })
  it('cancel racing the publish start: GitHub 409 ⇒ CANCEL_NOT_ALLOWED', async () => {
    runningBuild()
    githubService.cancelWorkflowRun = async () => { const e: any = new Error('conflict'); e.status = 409; throw e }
    expect((await ship('POST', `/${cid}/cancel`)).body.error.code).toBe('CANCEL_NOT_ALLOWED')
  })
  it('cancel before the run is visible ⇒ 409 (try again), not a 403/404 oracle', async () => {
    cid = fx.mintAt(Date.now() - 30_000)
    expect((await ship('POST', `/${cid}/cancel`)).statusCode).toBe(409)
  })

  describe('retry-config-pr', () => {
    const failedConfig = () => { seed({ conclusion: 'failure', failAt: 'config' }) }
    beforeEach(() => { config.ship.identityProvider = 'test' })

    it('202 {correlationId, attempt}; dispatches a config_only run with the 17 inputs (origin_run_id, config_image_tag, retry_by)', async () => {
      failedConfig()
      const res = await ship('POST', `/${cid}/retry-config-pr`)
      expect(res.statusCode).toBe(202)
      expect(res.body.data).toEqual({ correlationId: cid, attempt: 2 })
      const { inputs, wf, ref } = dispatched[0]
      expect(wf).toBe('ship-from-repo.yaml')
      expect(ref).toBe('ship/v1')
      expect(Object.keys(inputs).sort()).toEqual(['app', 'branch', 'bump', 'config_image_tag', 'correlation_id', 'env', 'health_path', 'mode', 'namespace', 'origin_run_id', 'port', 'repo', 'requester_github_login', 'retry_by', 'team_label', 'triggered_by', 'triggered_by_oid'].sort())
      expect(inputs).toMatchObject({ correlation_id: cid, mode: 'config_only', config_image_tag: '1.2.3', origin_run_id: '1000', retry_by: 'sam@example.com', triggered_by_oid: users.sam.id, repo: fx.REPO, port: '8080', requester_github_login: 'octocat' })
    })
    it('409 RETRY_NOT_APPLICABLE: image not published, failure not CONFIG_PR_FAILED, run still active, window elapsed', async () => {
      seed({ conclusion: 'failure', failAt: 'scan' })
      expect((await ship('POST', `/${cid}/retry-config-pr`)).body.error.code).toBe('RETRY_NOT_APPLICABLE')
      shipStatus._resetForTests(); w = fx.makeWorld(githubService)
      seed({ conclusion: 'failure', failAt: 'publish' })
      expect((await ship('POST', `/${cid}/retry-config-pr`)).statusCode).toBe(409)
      shipStatus._resetForTests(); w = fx.makeWorld(githubService)
      seed()
      expect((await ship('POST', `/${cid}/retry-config-pr`)).statusCode).toBe(409) // succeeded: nothing to retry
      shipStatus._resetForTests(); w = fx.makeWorld(githubService)
      failedConfig()
      config.ship.retryWindowHours = 1
      expect((await ship('POST', `/${cid}/retry-config-pr`)).body.error.message).toMatch(/window/)
      config.ship.retryWindowHours = 24
      expect(dispatched).toHaveLength(0)
    })
    it('409 while a newer run of the ship is still active', async () => {
      failedConfig()
      w.originRunId = 1000
      const r2 = fx.buildRun(w, { cid, id: 2000, createdAt: iso(t + 3_600_000), mode: 'config_only', status: 'in_progress' })
      w.jobs[2000] = [fx.job(r2.jid(1), 'prepare', { status: 'in_progress', completed: undefined })]
      const res = await ship('POST', `/${cid}/retry-config-pr`)
      expect(res.statusCode).toBe(409)
      expect(dispatched).toHaveLength(0)
    })
    it('concurrent / repeated retry requests dispatch once (retry lock)', async () => {
      failedConfig()
      const results = await Promise.all([ship('POST', `/${cid}/retry-config-pr`), ship('POST', `/${cid}/retry-config-pr`)])
      expect(results.map((r: any) => r.statusCode).sort()).toEqual([202, 409])
      expect(dispatched).toHaveLength(1)
      expect((await ship('POST', `/${cid}/retry-config-pr`)).statusCode).toBe(409)
      expect(dispatched).toHaveLength(1)
    })
    it('starter or platform only: repo reader 403, stranger 403', async () => {
      failedConfig()
      expect((await ship('POST', `/${cid}/retry-config-pr`, { token: 'reader' })).statusCode).toBe(403)
      expect((await ship('POST', `/${cid}/retry-config-pr`, { token: 'stranger' })).statusCode).toBe(403)
      expect(dispatched).toHaveLength(0)
      const admin = await ship('POST', `/${cid}/retry-config-pr`, { token: 'admin' })
      expect(admin.statusCode).toBe(202)
      expect(dispatched[0].inputs.retry_by).toBe('admin@x.com')
      expect(dispatched[0].inputs.triggered_by_oid).toBe(users.sam.id) // the ship's starter oid is preserved
    })
  })
})

describe('BT-22 legacy route GET /api/aks-status-by-correlation/:id (B-5)', () => {
  const url = '/aks-status-by-correlation/legacy-cid-1'
  const run = (displayTitle: string | undefined, jobId: number | null = 5) => ({ status: 'success', githubStatus: 'completed', conclusion: 'success', url: 'https://github.com/x/y/actions/runs/1', prUrl: null, message: 'Workflow success', createdAt: 'a', updatedAt: 'b', displayTitle, jobId })
  let logLine: string | null
  beforeEach(() => {
    logLine = null
    aksService.getTriggeredByFromJobLog = async () => logLine
  })
  const stub = (r: any) => { aksService.getDeploymentStatusByCorrelationId = async () => r }

  it('401 without a token', async () => {
    stub(run('Deploy a-b [CID:x] by=sam@example.com'))
    const res = await api('GET', url, { token: null })
    expect(res.statusCode).toBe(401)
  })
  it('owner matches by `by=`; response shape {success,status} unchanged and internal fields stripped', async () => {
    stub(run('Deploy a-b [CID:x] by=Sam@Example.com'))
    const res = await api('GET', url)
    expect(res.statusCode).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['status', 'success'])
    expect(res.body.status).toMatchObject({ status: 'success', url: 'https://github.com/x/y/actions/runs/1' })
    expect(res.body.status.displayTitle).toBeUndefined()
    expect(res.body.status.jobId).toBeUndefined()
  })
  it('mixed-case and apostrophe e-mails match their own `by=` (normalised both sides)', async () => {
    stub(run("Deploy a-b [CID:x] by=O'Brien@Example.com"))
    expect((await api('GET', url, { token: 'obrien' })).statusCode).toBe(200)
    stub(run('Deploy a-b [CID:x] by=O_Brien@example.com'))
    expect((await api('GET', url, { token: 'obrien' })).statusCode).toBe(200)
  })
  it('non-owner ⇒ 403 {success:false,error,message}', async () => {
    stub(run('Deploy a-b [CID:x] by=sam@example.com'))
    const res = await api('GET', url, { token: 'stranger' })
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ success: false, error: 'Forbidden' })
    expect(typeof res.body.message).toBe('string')
  })
  it('platform member always allowed', async () => {
    stub(run('Deploy a-b [CID:x] by=sam@example.com'))
    expect((await api('GET', url, { token: 'admin' })).statusCode).toBe(200)
  })
  it('run without `by=` (pre-change) is resolved via the Triggered by: log-line fallback', async () => {
    stub(run('Deploy a-b [CID:x]'))
    logLine = 'sam@example.com'
    expect((await api('GET', url)).statusCode).toBe(200)
    expect((await api('GET', url, { token: 'stranger' })).statusCode).toBe(403)
  })
  it('no `by=` and no readable log ⇒ platform members only (fail closed)', async () => {
    stub(run('Deploy a-b [CID:x]'))
    logLine = null
    expect((await api('GET', url)).statusCode).toBe(403)
    expect((await api('GET', url, { token: 'admin' })).statusCode).toBe(200)
  })
  it.each(['system', 'unknown', 'SYSTEM'])('triggered_by %s ⇒ platform only', async (by) => {
    stub(run(`Deploy a-b [CID:x] by=${by}`))
    expect((await api('GET', url)).statusCode).toBe(403)
    expect((await api('GET', url, { token: 'admin' })).statusCode).toBe(200)
  })
  it('BYO-image and agent-deploy runs after the additive run-name (by= present) follow the same owner rule', async () => {
    stub(run('Deploy my-agent-sand [CID:x] by=sam@example.com'))
    expect((await api('GET', url)).statusCode).toBe(200)
    expect((await api('GET', url, { token: 'stranger' })).statusCode).toBe(403)
  })
  it('a ship run name is parsed with the strict ship regex (the by= value, not the rest of the title)', async () => {
    const title = fx.runName({ cid: fx.mintAt(Date.now() - MIN), by: 'sam@example.com' })
    stub(run(title))
    expect((await api('GET', url)).statusCode).toBe(200)
    expect((await api('GET', url, { token: 'stranger' })).statusCode).toBe(403)
  })
  it('unknown ID returns the legacy not_found body to any authenticated user', async () => {
    stub({ status: 'not_found', message: 'Workflow run not found. Please check DevOps for PR approval.' })
    const res = await api('GET', url, { token: 'stranger' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true, status: { status: 'not_found', message: 'Workflow run not found. Please check DevOps for PR approval.' } })
  })
  it('a search error with no matched run keeps the legacy body (nothing to protect)', async () => {
    stub({ status: 'error', message: 'x' })
    expect((await api('GET', url, { token: 'stranger' })).statusCode).toBe(200)
  })
})
