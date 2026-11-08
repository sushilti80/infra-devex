/**
 * QA round 2 (ship-from-repo, independent re-verification of QA-005/006/007 after Dev rework round 1): dedupe keyed on every
 * input field, the per-user miss cap for IDs inside the 3-minute queued-placeholder window, and the logs cache bound.
 * `[DEFECT QA-nnn]` tests use `it.fails` (assert the CORRECT behaviour; expected to fail today; they flip to “unexpectedly
 * passed” once the Developer fixes the defect, which is the cue to convert them to plain `it`). Secret-shaped fixtures are
 * assembled at runtime so secret scanners do not flag this file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'

process.env.GITHUB_APP_ID = ''
process.env.GITHUB_INSTALLATION_ID = ''
const cjsRequire = createRequire(import.meta.url)
const { createHarness } = cjsRequire('../../helpers/shipQaHarness')
const h = createHarness()
const { config, githubService, ship, fx, shipStatus } = h

const MIN = 60_000
const MB = 1024 * 1024
const good = { repo: 'organization/my-svc', branch: 'main', app: 'my-app', env: 'devsand' }
const iso = (ms: number) => new Date(ms).toISOString()
let env: ReturnType<typeof h.wire>
let w: any

beforeEach(() => {
  w = fx.makeWorld(githubService)
  env = h.wire(w)
  config.ship.identityProvider = 'test'
  Object.assign(config.ship, { maxStartsPerHour: 99, maxActiveGlobal: 99, maxActivePerUser: 99, maxStartsPerUserPerHour: 99, rateLimitGuardRemaining: 1000 })
  githubService.getRateLimitSnapshot = () => null
})
afterEach(() => { vi.restoreAllMocks() })

const post = (body: any, token = 'sam') => ship('POST', '/', { token, body })

describe('QA-005 re-verification: dedupe key = user + all nine validated fields', () => {
  beforeEach(() => {
    config.ship.supportedShipEnvironments = ['devsand', 'devprod']
    h.identity.registerProvider('test', h.createTestProvider({
      links: { [h.ID.sam]: 'octocat', [h.ID.admin]: 'admin-login' },
      repos: { octocat: [{ fullName: 'organization/my-svc', org: 'organization', name: 'my-svc', defaultBranch: 'main', private: true }, { fullName: 'organization/other-svc', org: 'organization', name: 'other-svc', defaultBranch: 'main', private: true }] },
      permissions: { 'octocat:organization/my-svc': 'admin', 'octocat:organization/other-svc': 'admin', 'admin-login:organization/my-svc': 'write' },
    }))
  })

  it('genuinely identical POSTs (sequential, key order shuffled, defaults explicit vs omitted) share ONE dispatch and one ship id', async () => {
    const a = await post(good)
    const b = await post({ env: 'devsand', app: 'my-app', branch: 'main', repo: 'organization/my-svc' })
    const c = await post({ ...good, namespace: 'my-app', port: 8080, bump: 'patch' }) // explicit defaults == omitted defaults (pickStartBody)
    const d = await post({ ...good, repo: 'organization/my-svc' }) // canonical org case
    expect([a, b, c, d].map((r: any) => r.statusCode)).toEqual([202, 202, 202, 202])
    expect(new Set([a, b, c, d].map((r: any) => r.body.data.correlationId)).size).toBe(1)
    expect(env.dispatched).toHaveLength(1)
  })

  const variants: Array<[string, any]> = [
    ['env', { env: 'devprod' }],
    ['namespace', { namespace: 'other-ns' }],
    ['teamLabel', { teamLabel: 'other-team' }],
    ['port', { port: 9090 }],
    ['healthPath', { healthPath: '/ready' }],
    ['bump', { bump: 'minor' }],
    ['branch', { branch: 'release' }],
    ['app', { app: 'other-app' }],
    ['repo', { repo: 'organization/other-svc' }],
  ]
  for (const [field, patch] of variants) {
    it(`a second POST differing only in ${field} within 10 s is a NEW dispatch carrying the new value`, async () => {
      const first = await post(good)
      const second = await post({ ...good, ...patch })
      expect([first.statusCode, second.statusCode]).toEqual([202, 202])
      expect(second.body.data.correlationId).not.toBe(first.body.data.correlationId)
      expect(env.dispatched).toHaveLength(2)
    })
  }

  it('the dispatch for the changed POST really carries the changed inputs (not the first POST’s)', async () => {
    await post(good)
    await post({ ...good, env: 'devprod', port: 9090, healthPath: '/ready', bump: 'minor', teamLabel: 'other-team', namespace: 'other-ns' })
    expect(env.dispatched[1].inputs).toMatchObject({ env: 'devprod', port: '9090', health_path: '/ready', bump: 'minor', team_label: 'other-team' })
  })

  it('different users with an identical body never share a start (key includes the Entra oid)', async () => {
    const [a, b] = await Promise.all([post(good), post(good, 'admin')])
    expect(a.body.data.correlationId).not.toBe(b.body.data.correlationId)
    expect(env.dispatched).toHaveLength(2)
  })

  it('the 10 s window expires: an identical POST after 10 s dispatches again', async () => {
    const t0 = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(t0)
    await post(good)
    spy.mockReturnValue(t0 + 9_000)
    await post(good)
    expect(env.dispatched).toHaveLength(1)
    spy.mockReturnValue(t0 + 11_000)
    await post(good)
    expect(env.dispatched).toHaveLength(2)
  })

  it('concurrent identical POSTs share the start even while a DIFFERENT concurrent POST dispatches separately', async () => {
    githubService.triggerWorkflow = async (repo: string, wf: string, ref: string, inputs: any) => { await new Promise((r) => setTimeout(r, 5)); env.dispatched.push({ repo, wf, ref, inputs }); return {} }
    const res = await Promise.all([post(good), post(good), post({ ...good, env: 'devprod' }), post(good), post({ ...good, env: 'devprod' })])
    expect(res.every((r: any) => r.statusCode === 202)).toBe(true)
    expect(env.dispatched).toHaveLength(2)
    expect(new Set(res.map((r: any) => r.body.data.correlationId)).size).toBe(2)
  })
})

describe('QA-006 re-verification: fresh (<3 min) ship IDs count against the per-user miss cap', () => {
  const fresh = (i = 0) => fx.mintAt(Date.now() - 1000 - i * 7 - Math.floor(Math.random() * 5))
  const old = () => fx.mintAt(Date.now() - 10 * MIN - Math.floor(Math.random() * 100_000))
  const statusOf = (id: string, token = 'stranger') => ship('GET', `/status/${id}`, { token })

  it('100 distinct fresh IDs by one user ⇒ 429 user_misses from the 31st; ≤ 31 GitHub searches; Retry-After set', async () => {
    const codes: number[] = []
    let last: any
    for (let i = 0; i < 100; i++) { last = await statusOf(fresh(i)); codes.push(last.statusCode) }
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true)
    expect(codes.slice(30).every((c) => c === 429)).toBe(true)
    expect(last.body.error).toMatchObject({ code: 'PLATFORM_RATE_LIMITED', details: { limit: 'user_misses' } })
    expect(Number(last.headers['Retry-After'])).toBeGreaterThan(0)
    expect(w.calls.list).toBeLessThanOrEqual(31)
  })

  it('the cap is per user: one user exhausting it does not block another user’s fresh lookups', async () => {
    for (let i = 0; i < 40; i++) await statusOf(fresh(i))
    expect((await statusOf(fresh(500))).statusCode).toBe(429)
    expect((await statusOf(fresh(501), 'admin')).statusCode).toBe(200)
    expect((await statusOf(fresh(502), 'reader')).statusCode).toBe(200)
  })

  it('old unknown IDs and fresh IDs share ONE counter: 15 old + 16 fresh ⇒ the 31st lookup is refused', async () => {
    const codes: number[] = []
    for (let i = 0; i < 15; i++) codes.push((await statusOf(old())).statusCode)
    for (let i = 0; i < 16; i++) codes.push((await statusOf(fresh(i))).statusCode)
    expect(codes.slice(0, 15).every((c) => c === 404)).toBe(true)
    expect(codes.slice(15, 30).every((c) => c === 200)).toBe(true)
    expect(codes[30]).toBe(429)
  })

  it('the starter polling their OWN fresh ship (50 polls) is never refused and costs ≤ 1 search (counted once per ID)', async () => {
    const id = fresh()
    for (let i = 0; i < 50; i++) expect((await statusOf(id, 'sam')).statusCode).toBe(200)
    expect(w.calls.list).toBe(1)
    // …and the single counted lookup leaves 29 more of headroom for other ships
    for (let i = 0; i < 29; i++) expect((await statusOf(fresh(i + 1), 'sam')).statusCode).toBe(200)
    expect((await statusOf(fresh(900), 'sam')).statusCode).toBe(429)
  })

  it('the starter running 3 concurrent ships and polling each repeatedly is nowhere near the cap', async () => {
    const ids = [fresh(1), fresh(2), fresh(3)]
    for (let round = 0; round < 20; round++) for (const id of ids) expect((await statusOf(id, 'sam')).statusCode).toBe(200)
    expect(w.calls.list).toBeLessThanOrEqual(3)
  })

  it('every per-ship route counts fresh IDs (logs, cancel, retry-config-pr), not just status', async () => {
    for (const [method, path] of [['GET', (id: string) => `/logs/${id}?stage=build`], ['POST', (id: string) => `/${id}/cancel`], ['POST', (id: string) => `/${id}/retry-config-pr`]] as const) {
      shipStatus._resetForTests()
      w.calls.list = 0
      const codes: number[] = []
      for (let i = 0; i < 45; i++) {
        const id = fresh(i)
        const p = path(id)
        const res = await ship(method, p.split('?')[0], { token: 'stranger', query: p.includes('?') ? { stage: 'build' } : {} })
        codes.push(res.statusCode)
      }
      expect(codes, `${method} ${path('<id>')}`).toContain(429)
      expect(w.calls.list, `${method} ${path('<id>')}`).toBeLessThanOrEqual(31)
    }
  })

  it('the counter window slides: 61 s later the user may look up again', async () => {
    const t0 = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(t0)
    for (let i = 0; i < 31; i++) await statusOf(fx.mintAt(t0 - 1000 - i * 3))
    expect((await statusOf(fx.mintAt(t0 - 5000))).statusCode).toBe(429)
    spy.mockReturnValue(t0 + 61_000)
    expect((await statusOf(fx.mintAt(t0 + 61_000 - 1000))).statusCode).toBe(200)
  })

  it('IDs minted in the future or older than retention never reach GitHub and never create a fresh-ID record', async () => {
    const before = w.calls.list
    expect((await statusOf(fx.mintAt(Date.now() + 10 * MIN))).statusCode).toBe(404)
    expect((await statusOf(fx.mintAt(Date.now() - 400 * 24 * 60 * MIN))).statusCode).toBe(404)
    expect(w.calls.list).toBe(before)
  })

  // The `fresh:` markers live in the SAME bounded LRU (`flags`, max 2000) as the cancel-requested / watchdog / metric
  // de-dup flags, and are written BEFORE the cap check, so even refused (429) requests insert one. A user can therefore
  // flush other ships' flags by flooding distinct fresh IDs.
  it('[DEFECT QA-008 low] a flood of distinct fresh IDs (refused with 429) evicts other ships’ de-dup flags: a terminal ship’s metrics are emitted twice', async () => {
    const t = Date.now() - 4 * 60 * MIN
    const cid = fx.mintAt(t)
    fx.buildRun(w, { cid, id: 1000, createdAt: iso(t + 5000) })
    const logs = h.captureLogs()
    try {
      expect((await ship('GET', `/status/${cid}`)).statusCode).toBe(200)
      const count = () => logs.lines.filter((l: string) => l.includes('ship_succeeded') && l.includes(cid)).length
      expect(count()).toBe(1)
      for (let i = 0; i < 2100; i++) await statusOf(fresh(i), 'stranger') // ≈ 30 × 200 then 429s
      shipStatus.invalidate(cid)
      expect((await ship('GET', `/status/${cid}`)).statusCode).toBe(200)
      expect(count()).toBe(1) // correct: the de-dup flag survives anyone else's lookups
    } finally { logs.stop() }
  }, 30_000)
})

describe('QA-007 re-verification: the logs cache holds only the ≤5 MB view tail', () => {
  const line = (n: number) => `2026-10-22T14:06:00Z line-${n} ` + 'x'.repeat(980)
  const bigLog = (lines: number, extra?: (i: number) => string | null) => Array.from({ length: lines }, (_, i) => extra?.(i) ?? line(i)).join('\n')
  let cid: string

  beforeEach(() => {
    const t = Date.now() - 4 * 60 * MIN
    cid = fx.mintAt(t)
    const r = fx.buildRun(w, { cid, id: 1000, createdAt: iso(t + 5000) })
    w.jid = r.jid
  })
  const view = async (offset = 0, stage = 'build') => (await ship('GET', `/logs/${cid}`, { query: { stage, offset: String(offset) } })).body.data
  const download = async (stage = 'build') => ship('GET', `/logs/${cid}`, { query: { stage, download: '1' } })

  it('a 6.5 MB log: the view is the last 5 MB, skippedBytes+totalBytes add up, chunk offsets are contiguous and a repeat view is served from cache', async () => {
    w.logs[w.jid(2)] = bigLog(6500)
    const full = w.logs[w.jid(2)] as string
    const first = await view()
    expect(first.truncated).toBe(true)
    expect(first.totalBytes).toBe(5 * MB)
    expect(first.skippedBytes + first.totalBytes).toBe(full.length)
    let text = first.text
    let offset = first.offset
    for (let guard = 0; guard < 40 && text.length < first.totalBytes; guard++) { const next = await view(offset); text += next.text; offset = next.offset }
    expect(text).toBe(full.slice(full.length - 5 * MB))
    expect(w.calls.logs).toBe(1)
  }, 30_000)

  it('a view of an already-cached big log never refetches; a download of it refetches uncached and returns the WHOLE log', async () => {
    w.logs[w.jid(2)] = bigLog(6500)
    await view(); await view(1000); await view(2000)
    expect(w.calls.logs).toBe(1)
    const dl = await download()
    expect(dl.statusCode).toBe(200)
    expect(dl.text.length).toBe((w.logs[w.jid(2)] as string).length)
    expect(w.calls.logs).toBe(2)
    await download()
    expect(w.calls.logs).toBe(3) // by design: the >5 MB download is not cached
    await view()
    expect(w.calls.logs).toBe(3) // the view cache is untouched by the download
  }, 60_000)

  it('a log ≤ 5 MB is cached whole: view + download + view = ONE fetch', async () => {
    w.logs[w.jid(2)] = bigLog(1000)
    await view(); await download(); await view(500)
    expect(w.calls.logs).toBe(1)
  })

  it('redaction happens BEFORE slicing: secrets in the dropped head and in the kept tail never appear; PEM block spanning the cut stays redacted', async () => {
    const tok = (n: string) => ['gh', 'p_', n.repeat(40)].join('')
    const begin = '-----BEGIN ' + 'RSA PRIV' + 'ATE KEY-----'
    const end = '-----END ' + 'RSA PRIV' + 'ATE KEY-----'
    w.logs[w.jid(2)] = bigLog(6500, (i) => (i === 10 ? tok('a') : i === 6400 ? tok('b') : i === 1000 ? begin : i === 5800 ? end : i > 1000 && i < 5800 ? 'MIIEvQIBADANBgkq' + 'Z'.repeat(60) : null))
    const first = await view()
    let text = first.text
    let offset = first.offset
    for (let g = 0; g < 40 && text.length < first.totalBytes; g++) { const n = await view(offset); text += n.text; offset = n.offset }
    expect(text).not.toContain(tok('a'))
    expect(text).not.toContain(tok('b'))
    expect(text).not.toContain('MIIEvQIBADANBgkq')
    expect(text).toContain('***REDACTED***')
    const dl = (await download()).text as string
    for (const s of [tok('a'), tok('b'), 'MIIEvQIBADANBgkq', begin]) expect(dl).not.toContain(s)
  }, 60_000)

  it('LRU bound: 11 distinct >5 MB logs ⇒ the oldest entry is evicted (refetched) while the newest is still cached', async () => {
    const t = Date.now() - 4 * 60 * MIN
    const cids: string[] = []
    for (let i = 0; i < 11; i++) {
      const c = fx.mintAt(t + i)
      const r = fx.buildRun(w, { cid: c, id: 2000 + i * 10, createdAt: iso(t + 5000 + i) })
      w.logs[r.jid(2)] = bigLog(5300)
      cids.push(c)
    }
    const get = (c: string) => ship('GET', `/logs/${c}`, { query: { stage: 'build' } })
    for (const c of cids) expect((await get(c)).statusCode).toBe(200)
    expect(w.calls.logs).toBe(11)
    await get(cids[10]); expect(w.calls.logs).toBe(11) // newest: cached
    await get(cids[0]); expect(w.calls.logs).toBe(12) // oldest: evicted (max 10)
  }, 120_000)

  it('a log above the 100 MB download cap: download is truncated to the last 100 MB with skippedBytes reported (view stays ≤ 5 MB)', async () => {
    const chunk = 'y'.repeat(1023) + '\n'
    const total = 101 * MB
    w.logs[w.jid(2)] = chunk.repeat(Math.ceil(total / chunk.length))
    const v = await view()
    expect(v.totalBytes).toBe(5 * MB)
    const dl = await download()
    expect(dl.statusCode).toBe(200)
    expect(dl.text.length).toBe(100 * MB)
  }, 120_000)

  it('a single 8 MB un-newlined line is never echoed unredacted: the logs route either redacts it or fails closed (no secret, no stack in the body)', async () => {
    const secret = ['gh', 'p_', 'a'.repeat(8 * MB)].join('')
    w.logs[w.jid(2)] = `${line(1)}\n${secret}\n${line(2)}`
    const res = await ship('GET', `/logs/${cid}`, { query: { stage: 'build' } })
    const body = JSON.stringify(res.body)
    expect(body).not.toContain('a'.repeat(100))
    expect(body).not.toMatch(/RangeError|call stack|at .*\.js:\d+/)
  }, 30_000)

  it('[DEFECT QA-009 low] a single 8 MB un-newlined line must not make the log unreadable: logs route answers 200 (redacted) instead of 5xx', async () => {
    const secret = ['gh', 'p_', 'a'.repeat(8 * MB)].join('')
    w.logs[w.jid(2)] = `${line(1)}\n${secret}\n${line(2)}`
    const res = await ship('GET', `/logs/${cid}`, { query: { stage: 'build' } })
    expect(res.statusCode).toBe(200)
    expect(res.body.data.text).toContain('line-2')
  }, 30_000)

  it('in-progress job: the 10 s TTL entry is replaced after expiry and grows (append-only), and the offset stays stable', async () => {
    const t0 = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(t0)
    w.jobs[1000][1].status = 'in_progress'; w.jobs[1000][1].conclusion = null; w.runs[0].status = 'in_progress'; w.runs[0].conclusion = null
    shipStatus._resetForTests()
    w.logs[w.jid(2)] = bigLog(10)
    const a = await view()
    w.logs[w.jid(2)] = bigLog(20)
    spy.mockReturnValue(t0 + 11_000)
    const b = await view(a.offset)
    expect(b.text.length).toBeGreaterThan(0)
    expect(a.text + b.text).toBe(bigLog(20))
    spy.mockRestore()
  })
})
