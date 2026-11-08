/**
 * QA (ship-from-repo, independent): hostile-input, authentication and authorization matrices driven through the REAL
 * routers (express-validator included). Spec §4.4 (validation rules), §3.6.3 (starter oid / reader / platform; read vs
 * mutate), §9.4/§9.5 edge cases, NFR-004. Complements tests/integration/api/ship.spec.ts with different payloads.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'

process.env.GITHUB_APP_ID = ''
process.env.GITHUB_INSTALLATION_ID = ''
const cjsRequire = createRequire(import.meta.url)
const { createHarness, ID, SENTINEL_TOKEN } = cjsRequire('../../helpers/shipQaHarness')
const h = createHarness()
const { config, githubService, aksService, ship, api, fx, shipRouter, apiRouter, captureLogs } = h

const MIN = 60_000
const DAY = 24 * 60 * MIN
const good = { repo: 'organization/my-svc', branch: 'main', app: 'my-app', env: 'devsand' }
let env: ReturnType<typeof h.wire>
let w: any

beforeEach(() => {
  w = fx.makeWorld(githubService)
  env = h.wire(w)
  config.ship.identityProvider = 'test'
})

const post = (body: any, token = 'sam') => ship('POST', '/', { token, body })
const fields = (res: any) => (res.body?.error?.details || []).map((d: any) => d.field)

describe('requireAuth on EVERY ship route (introspected, so a newly added route cannot slip through) and the legacy route', () => {
  const routes: Array<{ method: string; path: string }> = shipRouter.stack
    .filter((l: any) => l.route)
    .flatMap((l: any) => Object.keys(l.route.methods).map((m) => ({ method: m.toUpperCase(), path: l.route.path.replace(/:\w+/g, 'x') })))
  it('the first layer of the router is the requireAuth middleware', () => {
    expect(shipRouter.stack[0].name).toBe('requireAuth')
    expect(shipRouter.stack[0].route).toBeUndefined()
  })
  it('discovers all nine documented endpoints', () => {
    expect(routes.length).toBe(9)
  })
  it.each(routes)('$method $path: no token ⇒ 401, bad token ⇒ 401, nothing dispatched or fetched', async ({ method, path }) => {
    for (const token of [null, 'not-a-user', '']) {
      const res = await ship(method, path, { token, body: good })
      expect(res.statusCode).toBe(401)
    }
    expect(env.dispatched).toHaveLength(0)
    expect(w.calls.list + w.calls.jobs + w.calls.logs + w.calls.cancel).toBe(0)
  })
  it('an unknown path under /api/ship is also behind auth (401, not a 404 oracle)', async () => {
    expect((await ship('GET', '/does-not-exist', { token: null })).statusCode).toBe(401)
    expect((await ship('GET', '/does-not-exist')).statusCode).toBe(404)
  })
  it('mounted through the real /api router: /ship/* and the legacy /aks-status-by-correlation/:id both demand a token', async () => {
    expect(apiRouter).toBeTruthy()
    for (const [m, u] of [['GET', '/ship/config'], ['POST', '/ship'], ['GET', '/ship/status/x'], ['GET', '/aks-status-by-correlation/anything']]) {
      const res = await api(m, u, { token: null })
      expect(res.statusCode, `${m} ${u}`).toBe(401)
    }
  })
})

describe('POST /api/ship hostile inputs (NFR-004) — every one ⇒ 400 on the named field, never a dispatch', () => {
  const NL = '\n'
  const table: Array<[string, any, string]> = [
    // repo
    ['repo missing', { ...good, repo: undefined }, 'repo'],
    ['repo org only', { ...good, repo: 'organization' }, 'repo'],
    ['repo empty name', { ...good, repo: 'organization/' }, 'repo'],
    ['repo pasted URL', { ...good, repo: 'https://github.com/organization/my-svc' }, 'repo'],
    ['repo .git suffix', { ...good, repo: 'organization/my-svc.git' }, 'repo'],
    ['repo dot-dot', { ...good, repo: 'organization/..' }, 'repo'],
    ['repo shell metachar', { ...good, repo: 'organization/my-svc;id' }, 'repo'],
    ['repo trailing newline', { ...good, repo: `organization/my-svc${NL}` }, 'repo'],
    ['repo extra segment', { ...good, repo: 'organization/a/b' }, 'repo'],
    ['repo org not allowlisted', { ...good, repo: 'Evil/my-svc' }, 'repo'],
    ['repo as array', { ...good, repo: ['organization/my-svc'] }, 'repo'],
    ['repo as object', { ...good, repo: { toString: 'x' } }, 'repo'],
    ['repo null', { ...good, repo: null }, 'repo'],
    ['repo number', { ...good, repo: 123 }, 'repo'],
    // branch
    ...[
      '', '..', 'a..b', '-rf', '--upload-pack=evil', '/main', 'main/', 'main.', 'main.lock', 'a@{1}', 'a b', `a${NL}b`, 'a;b', 'a$(id)', 'a`id`', "a'b", 'a"b', 'a//b', 'x'.repeat(201), 'a\u0000b', 'ma\u202Ein', 'ré',
    ].map((b): [string, any, string] => [`branch ${JSON.stringify(b).slice(0, 30)}`, { ...good, branch: b }, 'branch']),
    ['branch array', { ...good, branch: ['main'] }, 'branch'],
    ['branch object', { ...good, branch: { a: 1 } }, 'branch'],
    ['branch null', { ...good, branch: null }, 'branch'],
    ['branch number', { ...good, branch: 5 }, 'branch'],
    // app
    ...['', 'My-App', '-app', 'app-', 'a_b', 'a.b', 'x'.repeat(64), 'a b', '$(id)', `a${NL}`].map((a): [string, any, string] => [`app ${JSON.stringify(a).slice(0, 20)}`, { ...good, app: a }, 'app']),
    ['app array', { ...good, app: ['a'] }, 'app'],
    ['app defaults to a reserved namespace: kube-system', { ...good, app: 'kube-system' }, 'app'],
    ['app defaults to a reserved namespace: flux-system', { ...good, app: 'flux-system' }, 'app'],
    ['app defaults to a reserved namespace: default', { ...good, app: 'default' }, 'app'],
    // namespace (reserved list is a hard control, A-8)
    ...['kube-system', 'kube-public', 'kube-', 'flux-system', 'flux-anything', 'default', 'cert-manager', 'ingress-nginx'].map((n): [string, any, string] => [`reserved namespace ${n}`, { ...good, namespace: n }, 'namespace']),
    ...['Kube-System', 'x'.repeat(64), '', 'a_b', '-x', 'x-'].map((n): [string, any, string] => [`namespace ${JSON.stringify(n).slice(0, 20)}`, { ...good, namespace: n }, 'namespace']),
    ['namespace null', { ...good, namespace: null }, 'namespace'],
    // teamLabel
    ...['UPPER', '', 'a b', 'x'.repeat(64)].map((t): [string, any, string] => [`teamLabel ${JSON.stringify(t).slice(0, 20)}`, { ...good, teamLabel: t }, 'teamLabel']),
    // port
    ...[0, 80, 1023, 65536, 70000, -1, 1.5, '8080abc', '0x1F90', '1e4', ' 8080', '8080 ', '８０８０', [], {}, true, null].map((p): [string, any, string] => [`port ${JSON.stringify(p)}`, { ...good, port: p }, 'port']),
    // healthPath
    ...['', 'healthz', '/a b', '/a"b', "/a'b", '/a$b', '/a`b`', '/a{b}', '/a;b', `/a${NL}b`, `/${'a'.repeat(255)}`, '/a?x=1', '/a#b', '/a%20b', '/a\\b', '/a|b', '/a&b', '/a>b'].map((p): [string, any, string] => [`healthPath ${JSON.stringify(p).slice(0, 20)}`, { ...good, healthPath: p }, 'healthPath']),
    // bump
    ...['PATCH', 'prerelease', '', 'patch;id'].map((b): [string, any, string] => [`bump ${JSON.stringify(b)}`, { ...good, bump: b }, 'bump']),
    ['bump array', { ...good, bump: ['patch'] }, 'bump'],
    // env
    ['env missing', { ...good, env: undefined }, 'env'],
    ['env not flagged', { ...good, env: 'prod' }, 'env'],
    ['env path traversal', { ...good, env: '../prod' }, 'env'],
  ]
  it.each(table)('%s', async (_name, body, field) => {
    const res = await post(body)
    expect(res.statusCode, JSON.stringify(res.body)).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(fields(res)).toContain(field)
    expect(env.dispatched).toHaveLength(0)
  })

  it('configured extra reserved namespaces (SHIP_RESERVED_NAMESPACES, exact and wildcard) are refused too', async () => {
    config.ship.reservedNamespaces = ['monitoring', 'sys-*']
    for (const n of ['monitoring', 'sys-a', 'sys-']) expect(fields(await post({ ...good, namespace: n })), n).toContain('namespace')
    expect((await post({ ...good, namespace: 'monitoring2' })).statusCode).toBe(202)
  })

  it('valid boundaries are accepted and normalised: canonical org case, port 1024/65535 (also as string), healthPath "/" and 255 chars', async () => {
    const r1 = await post({ ...good, repo: 'organization/my-svc', port: 1024, healthPath: '/', app: 'a1' })
    expect(r1.statusCode, JSON.stringify(r1.body)).toBe(202)
    expect(env.dispatched[0].inputs.repo).toBe('organization/my-svc')
    const r2 = await post({ ...good, port: '65535', healthPath: `/${'a'.repeat(254)}`, app: 'a2', branch: 'release/1.2.3_rc-1' })
    expect(r2.statusCode, JSON.stringify(r2.body)).toBe(202)
    expect(env.dispatched[1].inputs.port).toBe('65535')
  })

  it('spoofed / unknown body fields are discarded: the dispatch carries exactly the 14 server-built inputs', async () => {
    const spoof = {
      ...good, triggeredBy: 'admin@x.com', triggered_by: 'admin@x.com', triggered_by_oid: ID.admin, correlationId: 'evil-id', correlation_id: 'evil-id',
      requesterLogin: 'admin-login', requester_github_login: 'admin-login', mode: 'config_only', retry_by: 'admin', origin_run_id: '1', config_image_tag: '9.9.9',
      workflowRef: 'main', ref: 'main', inputs: { env: 'prod' }, huge: 'z'.repeat(1_000_000), __proto__: { polluted: true }, constructor: { prototype: { polluted: true } },
    }
    const res = await post(spoof)
    expect(res.statusCode, JSON.stringify(res.body)).toBe(202)
    const { inputs } = env.dispatched[0]
    expect(Object.keys(inputs).sort()).toEqual(['app', 'branch', 'bump', 'correlation_id', 'env', 'health_path', 'mode', 'namespace', 'port', 'repo', 'requester_github_login', 'team_label', 'triggered_by', 'triggered_by_oid'])
    expect(inputs).toMatchObject({ triggered_by_oid: ID.sam, requester_github_login: 'octocat', mode: 'full', triggered_by: 'sam@example.com', env: 'devsand' })
    expect(inputs.correlation_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(inputs.correlation_id).toBe(res.body.data.correlationId)
    expect(JSON.stringify(env.dispatched)).not.toMatch(/evil-id|admin-login|zzzz|polluted/)
    expect(({} as any).polluted).toBeUndefined()
  })

  it('a hostile e-mail claim never reaches the workflow unsanitised (triggered_by is [a-z0-9._%+@-] only)', async () => {
    h.users.sam.email = 'Evil";$(id)`\n::set-output name=x::y@x.com'
    try {
      expect((await post(good)).statusCode).toBe(202)
      expect(env.dispatched[0].inputs.triggered_by).toMatch(/^[a-z0-9._%+@-]+$/)
    } finally { h.users.sam.email = 'Sam@Example.com' }
  })
})

describe('ship id (UUIDv7 rule) on every per-ship route — rejected before any GitHub call', () => {
  const targets = (id: string): Array<[string, string, any]> => [
    ['GET', `/status/${id}`, {}], ['GET', `/logs/${id}`, { query: { stage: 'prepare' } }], ['POST', `/${id}/cancel`, {}], ['POST', `/${id}/retry-config-pr`, {}],
  ]
  const base = fx.mintAt(Date.now() - 4 * MIN)
  const bad: Array<[string, string]> = [
    ['v4', '3f1d8b0e-6a3c-4b83-9d0a-0d5f8e2d9c11'],
    ['v1', '3f1d8b0e-6a3c-1b83-9d0a-0d5f8e2d9c11'],
    ['nil', '00000000-0000-0000-0000-000000000000'],
    ['uppercase v7', base.toUpperCase()],
    ['trailing newline (as sent on the wire: %0A)', `${base}%0A`],
    ['braced', `{${base}}`],
    ['bad variant', base.split('-').map((p, i) => (i === 3 ? `c${p.slice(1)}` : p)).join('-')],
    ['too short', base.slice(0, 35)],
    ['sql-ish', "x' OR '1'='1"],
    ['encoded traversal', '..%2f..%2fadmin'],
  ]
  for (const [name, id] of bad) {
    it(`${name} ⇒ 400 on status/logs/cancel/retry with zero upstream calls, no cancel, no dispatch`, async () => {
      for (const [m, u, opts] of targets(id)) {
        const res = await ship(m, u, opts)
        expect(res.statusCode, `${m} ${u}`).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_FAILED')
      }
      expect(w.calls.list + w.calls.jobs + w.calls.logs + w.calls.cancel + w.calls.ann).toBe(0)
      expect(env.dispatched).toHaveLength(0)
    })
  }
  it('future (now+121 s) and beyond-retention IDs ⇒ 404 NOT_FOUND with ZERO GitHub calls; for status, logs, cancel and retry', async () => {
    for (const id of [fx.mintAt(Date.now() + 121_000), fx.mintAt(Date.now() + 10 * DAY), fx.mintAt(Date.now() - 91 * DAY), fx.mintAt(Date.now() - 400 * DAY)]) {
      for (const [m, u, opts] of targets(id)) {
        const res = await ship(m, u, opts)
        expect(res.statusCode, `${m} ${u}`).toBe(404)
        expect(res.body.error.code).toBe('NOT_FOUND')
      }
    }
    expect(w.calls.list + w.calls.jobs + w.calls.logs + w.calls.cancel).toBe(0)
  })
})

describe('authorization is oid-based; read ≠ mutate; tampered run sets are 404 (§3.6.3, BT-13)', () => {
  let t: number
  let cid: string
  const seedRunning = (over: any = {}) => {
    const r = fx.buildRun(w, { cid, id: 1000, createdAt: new Date(t + 5000).toISOString(), status: 'in_progress', ...over })
    w.jobs[1000] = [fx.job(r.jid(1), 'prepare', {}), fx.job(r.jid(2), 'build', { status: 'in_progress', completed: undefined })]
    return r
  }
  beforeEach(() => { t = Date.now() - 4 * MIN * 60; cid = fx.mintAt(t) })

  it('two people whose e-mails sanitise identically (o\'brien@x / o_brien@x) do not authorise each other: only the real oid reads or mutates', async () => {
    seedRunning({ oid: ID.obrien })
    w.runs[0].display_title = w.runs[0].display_title.replace('by=sam@x.com', 'by=o_brien@x.com')
    expect((await ship('GET', `/status/${cid}`, { token: 'underscore' })).statusCode).toBe(403)
    expect((await ship('POST', `/${cid}/cancel`, { token: 'underscore' })).statusCode).toBe(403)
    expect((await ship('GET', `/status/${cid}`, { token: 'obrien' })).statusCode).toBe(200)
    expect(w.cancelled).toHaveLength(0)
    expect((await ship('POST', `/${cid}/cancel`, { token: 'obrien' })).statusCode).toBe(200)
  })
  it('a repo reader / writer may READ status and logs but never mutate; a platform member may do both', async () => {
    seedRunning()
    for (const token of ['reader', 'bob']) {
      expect((await ship('GET', `/status/${cid}`, { token })).statusCode, token).toBe(200)
      expect((await ship('GET', `/logs/${cid}`, { token, query: { stage: 'prepare' } })).statusCode, token).toBe(200)
      expect((await ship('POST', `/${cid}/cancel`, { token })).statusCode, token).toBe(403)
      expect((await ship('POST', `/${cid}/retry-config-pr`, { token })).statusCode, token).toBe(403)
    }
    expect(w.cancelled).toHaveLength(0)
    expect((await ship('GET', `/status/${cid}`, { token: 'stranger' })).statusCode).toBe(403)
    expect((await ship('POST', `/${cid}/cancel`, { token: 'admin' })).statusCode).toBe(200)
  })
  it('403 and 404 bodies are identical in shape for any stranger and never name the app, repo, owner or run', async () => {
    seedRunning()
    const forbidden = await ship('GET', `/status/${cid}`, { token: 'stranger' })
    const missing = await ship('GET', `/status/${fx.mintAt(Date.now() - 10 * MIN)}`, { token: 'stranger' })
    for (const res of [forbidden, missing]) {
      expect(Object.keys(res.body.error).sort()).toEqual(['code', 'message'])
      expect(JSON.stringify(res.body)).not.toMatch(/my-app|my-svc|organization|sam@|11111111|octocat|actions\/runs/)
    }
  })
  it('runs sharing a ship id but with a different oid/app/repo are treated as tampering: 404 for everyone, starter included', async () => {
    seedRunning()
    fx.buildRun(w, { cid, id: 2000, createdAt: new Date(t + 9000).toISOString(), oid: ID.stranger })
    for (const token of ['sam', 'admin', 'stranger']) expect((await ship('GET', `/status/${cid}`, { token })).statusCode, token).toBe(404)
  })
  it('the response never exposes the starter oid, login, workflow ref/repo or the raw run URLs of the status', async () => {
    seedRunning()
    const res = await ship('GET', `/status/${cid}`, { token: 'reader' })
    const text = JSON.stringify(res.body)
    expect(text).not.toMatch(new RegExp(`${ID.sam}|octocat|ship/v1|ship-from-repo\\.yaml|_meta|\\boid\\b`))
  })
})

describe('no secret / bearer-token leakage in any response or log line', () => {
  const SENTINEL = SENTINEL_TOKEN
  it('start, status, logs, cancel, validation errors and a forced 500 never echo the bearer token; the 500 is generic with no stack/upstream text', async () => {
    const cap = captureLogs()
    const t = Date.now() - 4 * MIN * 60
    const cid = fx.mintAt(t)
    const r = fx.buildRun(w, { cid, id: 1000, createdAt: new Date(t + 5000).toISOString(), status: 'in_progress' })
    w.jobs[1000] = [fx.job(r.jid(1), 'prepare', {}), fx.job(r.jid(2), 'build', { status: 'in_progress', completed: undefined })]
    w.logs[r.jid(1)] = `2026-10-22T14:00:01Z ${'to' + 'ken'}=${'gh' + 'p_'}abcdefghijklmnopqrstuvwxyz0123456789\n2026-10-22T14:00:02Z ok`
    const responses: any[] = []
    responses.push(await ship('POST', '/', { token: SENTINEL, body: good }))
    responses.push(await ship('POST', '/', { token: SENTINEL, body: { ...good, branch: '..' } }))
    responses.push(await ship('GET', `/status/${cid}`, { token: SENTINEL }))
    responses.push(await ship('GET', `/logs/${cid}`, { token: SENTINEL, query: { stage: 'prepare' } }))
    responses.push(await ship('POST', `/${cid}/cancel`, { token: SENTINEL }))
    githubService.triggerWorkflow = async () => { const e: any = new Error(`boom ${'gh' + 'p_'}abcdefghijklmnopqrstuvwxyz0123456789 at /Users/x/stack.js:1`); e.status = 400; e.stack = 'STACKTRACE'; throw e }
    h.shipService._resetForTests()
    const boom = await ship('POST', '/', { token: SENTINEL, body: { ...good, app: 'boom-app' } })
    responses.push(boom)
    cap.stop()
    expect(boom.statusCode).toBe(500)
    expect(boom.body.error).toEqual({ code: 'UNKNOWN', message: 'Unexpected error.' })
    for (const res of responses) {
      const text = JSON.stringify(res.body ?? res.text)
      expect(text).not.toContain(SENTINEL)
      expect(text).not.toMatch(/ghp_|STACKTRACE|\/Users\/x/)
    }
    const logText = cap.lines.join('')
    expect(logText.length).toBeGreaterThan(0)
    expect(logText).not.toContain(SENTINEL)
    expect(logText).not.toMatch(/Bearer /i)
    // the token planted in the BUILD log is redacted in the response
    expect(JSON.stringify(responses[3].body)).toContain('***REDACTED***')
  })
})

describe('legacy GET /api/aks-status-by-correlation/:id (B-5) — ownership edge cases', () => {
  const url = '/aks-status-by-correlation/legacy-1'
  const stub = (displayTitle: string, jobId: number | null = 9) => { aksService.getDeploymentStatusByCorrelationId = async () => ({ status: 'success', githubStatus: 'completed', url: 'https://x', displayTitle, jobId }) }
  const as = (email: string) => { h.hook.override = async () => ({ id: ID.stranger, email, roles: [], groups: [] }) }
  beforeEach(() => { aksService.getTriggeredByFromJobLog = async () => null })
  afterEach(() => { h.hook.override = null })

  it('`system` / `unknown` / empty owners never match a user — even a user whose e-mail sanitises to the same word', async () => {
    for (const by of ['system', 'unknown', 'SYSTEM']) {
      stub(`Deploy a-b [CID:x] by=${by}`)
      for (const email of ['system', 'System', 'unknown', '']) {
        as(email)
        expect((await api('GET', url, { token: 'anyone' })).statusCode, `by=${by} user=${email}`).toBe(403)
      }
    }
  })
  it('owner match is exact after normalisation: a longer / prefixed / suffixed e-mail does not match', async () => {
    stub('Deploy a-b [CID:x] by=sam@example.com')
    for (const email of ['xsam@example.com', 'sam@example.com.evil.io', 'sam@example.co', 'sam@example.com ']) {
      as(email)
      expect((await api('GET', url, { token: 'anyone' })).statusCode, email).toBe(403)
    }
    as('SAM@Example.COM')
    expect((await api('GET', url, { token: 'anyone' })).statusCode).toBe(200)
  })
  it('a title with a second `by=` cannot be used to impersonate: the first by= wins and the combined value matches nobody', async () => {
    stub('Deploy a-b [CID:x] by=victim@x.com by=sam@example.com')
    as('sam@example.com')
    expect((await api('GET', url, { token: 'anyone' })).statusCode).toBe(403)
  })
  it('without a by= the Triggered-by log line decides; unreadable log ⇒ 403 for non-platform users; the matched-run body hides displayTitle/jobId', async () => {
    stub('Deploy a-b [CID:x]')
    as('sam@example.com')
    expect((await api('GET', url, { token: 'anyone' })).statusCode).toBe(403)
    aksService.getTriggeredByFromJobLog = async () => 'Sam@Example.com'
    const ok = await api('GET', url, { token: 'anyone' })
    expect(ok.statusCode).toBe(200)
    expect(Object.keys(ok.body).sort()).toEqual(['status', 'success'])
    expect(JSON.stringify(ok.body)).not.toMatch(/displayTitle|jobId/)
  })
})
