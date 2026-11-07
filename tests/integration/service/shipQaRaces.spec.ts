/**
 * QA (ship-from-repo, independent): start caps, 10 s dedupe, failure release and the unknown-ID miss cap under
 * concurrency (spec DD-14, BT-24, BT-09, §9.5). `[DEFECT QA-…]` tests use `it.fails` (assert the correct behaviour; expected
 * to fail today; they flip to “unexpectedly passed” once the Developer fixes the defect).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'

process.env.GITHUB_APP_ID = ''
process.env.GITHUB_INSTALLATION_ID = ''
const cjsRequire = createRequire(import.meta.url)
const { createHarness, ID } = cjsRequire('../../helpers/shipQaHarness')
const h = createHarness()
const { config, githubService, ship, fx } = h

const MIN = 60_000
const good = { repo: 'AyaHealthcare/my-svc', branch: 'main', app: 'my-app', env: 'devsand' }
const tick = () => new Promise((r) => setTimeout(r, 5))
let env: ReturnType<typeof h.wire>
let w: any

beforeEach(() => {
  w = fx.makeWorld(githubService)
  env = h.wire(w)
  config.ship.identityProvider = 'test'
  Object.assign(config.ship, { maxStartsPerHour: 12, maxActiveGlobal: 10, maxActivePerUser: 3, maxStartsPerUserPerHour: 6, rateLimitGuardRemaining: 1000 })
  githubService.getRateLimitSnapshot = () => null
  // asynchronous dispatch so concurrent POSTs genuinely interleave
  githubService.triggerWorkflow = async (repo: string, wf: string, ref: string, inputs: any) => { await tick(); env.dispatched.push({ repo, wf, ref, inputs }); return { success: true } }
})

const post = (body: any, token = 'sam') => ship('POST', '/', { token, body })

describe('concurrent starts cannot overshoot the caps (reservation is synchronous)', () => {
  it('10 simultaneous POSTs for different apps by one user ⇒ exactly 3 dispatched, 7 × 429 user_active with Retry-After', async () => {
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => post({ ...good, app: `app-${i}` })))
    expect(res.filter((r: any) => r.statusCode === 202)).toHaveLength(3)
    const refused = res.filter((r: any) => r.statusCode === 429)
    expect(refused).toHaveLength(7)
    for (const r of refused) {
      expect(r.body.error).toMatchObject({ code: 'PLATFORM_RATE_LIMITED', details: { limit: 'user_active' } })
      expect(Number(r.headers['Retry-After'])).toBeGreaterThan(0)
    }
    expect(env.dispatched).toHaveLength(3)
    expect(new Set(env.dispatched.map((d: any) => d.inputs.correlation_id)).size).toBe(3)
  })
  it('per-user hourly cap holds under concurrency (6/h), global active cap holds across users (10)', async () => {
    Object.assign(config.ship, { maxActivePerUser: 99, maxStartsPerUserPerHour: 2 })
    const res = await Promise.all(Array.from({ length: 5 }, (_, i) => post({ ...good, app: `h-${i}` })))
    expect(res.filter((r: any) => r.statusCode === 202)).toHaveLength(2)
    expect(res.filter((r: any) => r.statusCode === 429).every((r: any) => r.body.error.details.limit === 'user_hourly')).toBe(true)
    h.shipService._resetForTests(); h.shipStatus._resetForTests(); env.dispatched.length = 0
    Object.assign(config.ship, { maxActivePerUser: 99, maxStartsPerUserPerHour: 99, maxActiveGlobal: 2 })
    const users = ['sam', 'admin', 'bob', 'reader']
    const res2 = await Promise.all(users.map((u, i) => post({ ...good, app: `g-${i}` }, u)))
    expect(res2.filter((r: any) => r.statusCode === 202)).toHaveLength(2)
    expect(res2.filter((r: any) => r.statusCode === 429).every((r: any) => ['global_active', 'user_active'].includes(r.body.error.details.limit))).toBe(true)
    expect(res2.filter((r: any) => r.statusCode === 429)[0].body.error.details.limit).toBe('global_active')
  })
  it('global hourly cap (12/h by default) holds', async () => {
    Object.assign(config.ship, { maxActivePerUser: 99, maxActiveGlobal: 99, maxStartsPerUserPerHour: 99, maxStartsPerHour: 3 })
    const res = await Promise.all(Array.from({ length: 6 }, (_, i) => post({ ...good, app: `gh-${i}` })))
    expect(res.filter((r: any) => r.statusCode === 202)).toHaveLength(3)
    expect(res.find((r: any) => r.statusCode === 429).body.error.details.limit).toBe('global_hourly')
  })
  it('a start that fails (GitHub 500 on dispatch / 403 identity) releases its reservation: 5 failures do not burn a 3-active cap', async () => {
    githubService.triggerWorkflow = async () => { await tick(); const e: any = new Error('upstream'); e.status = 502; throw e }
    for (let i = 0; i < 5; i++) expect((await post({ ...good, app: `f-${i}` })).statusCode).toBe(503)
    githubService.triggerWorkflow = async (repo: string, wf: string, ref: string, inputs: any) => { env.dispatched.push({ repo, wf, ref, inputs }); return {} }
    const res = await Promise.all(['a', 'b', 'c'].map((n) => post({ ...good, app: `ok-${n}` })))
    expect(res.map((r: any) => r.statusCode)).toEqual([202, 202, 202])
  })
})

describe('10 s dedupe', () => {
  it('5 concurrent identical POSTs (double-click storm) ⇒ ONE dispatch, five 202s sharing one ship id', async () => {
    const res = await Promise.all(Array.from({ length: 5 }, () => post(good)))
    expect(res.map((r: any) => r.statusCode)).toEqual([202, 202, 202, 202, 202])
    expect(new Set(res.map((r: any) => r.body.data.correlationId)).size).toBe(1)
    expect(env.dispatched).toHaveLength(1)
  })
  it('a failed first POST does not poison the key: the immediate retry dispatches', async () => {
    let first = true
    githubService.triggerWorkflow = async (repo: string, wf: string, ref: string, inputs: any) => {
      await tick()
      if (first) { first = false; const e: any = new Error('x'); e.status = 502; throw e }
      env.dispatched.push({ repo, wf, ref, inputs }); return {}
    }
    expect((await post(good)).statusCode).toBe(503)
    expect((await post(good)).statusCode).toBe(202)
    expect(env.dispatched).toHaveLength(1)
  })
  it('different users, repos, branches or apps are never deduped against each other', async () => {
    const res = await Promise.all([post(good), post(good, 'admin'), post({ ...good, branch: 'dev' }), post({ ...good, app: 'other' })])
    expect(res.map((r: any) => r.statusCode)).toEqual([202, 202, 202, 202])
    expect(env.dispatched).toHaveLength(4)
  })
  it('[DEFECT QA-005 medium] the dedupe key omits env (and port/namespace/healthPath/bump/teamLabel): a second, DIFFERENT POST within 10 s is silently answered with the first ship (no dispatch to the second env)', async () => {
    config.ship.supportedShipEnvironments = ['devsand', 'devprod']
    const a = await post({ ...good, env: 'devsand' })
    const b = await post({ ...good, env: 'devprod' })
    expect(a.statusCode).toBe(202)
    expect(b.statusCode).toBe(202)
    expect(env.dispatched.map((d: any) => d.inputs.env)).toEqual(['devsand', 'devprod'])
    expect(b.body.data.env).toBe('devprod')
  })
})

describe('unknown-ID lookups: negative cache and per-user miss cap (DD-14, BT-09)', () => {
  const unknownId = (ageMin = 10) => fx.mintAt(Date.now() - ageMin * MIN - Math.floor(Math.random() * 1000))
  it('the same unknown ID is negative-cached (one upstream search for repeated polls)', async () => {
    const id = unknownId()
    for (let i = 0; i < 5; i++) expect((await ship('GET', `/status/${id}`)).statusCode).toBe(404)
    expect(w.calls.list).toBe(1)
  })
  it('the 31st distinct unknown ID within a minute ⇒ 429 PLATFORM_RATE_LIMITED details.limit=user_misses + Retry-After; other users are unaffected', async () => {
    const codes: number[] = []
    for (let i = 0; i < 32; i++) codes.push((await ship('GET', `/status/${unknownId()}`)).statusCode)
    expect(codes.slice(0, 30).every((c) => c === 404)).toBe(true)
    expect(codes.slice(30)).toEqual([429, 429])
    const blocked = await ship('GET', `/status/${unknownId()}`)
    expect(blocked.body.error.details.limit).toBe('user_misses')
    expect(Number(blocked.headers['Retry-After'])).toBeGreaterThan(0)
    expect((await ship('GET', `/status/${unknownId()}`, { token: 'admin' })).statusCode).toBe(404)
  })
  it('[DEFECT QA-006 medium] the miss cap is bypassed by IDs minted “now” (3-minute queued-placeholder window): every fresh ID costs one GitHub search, is answered 200 “queued”, and is never counted as a miss', async () => {
    const results: number[] = []
    for (let i = 0; i < 100; i++) results.push((await ship('GET', `/status/${fx.mintAt(Date.now() - 1000 - i)}`, { token: 'stranger' })).statusCode)
    // correct behaviour: unauthenticated-to-the-ship probing is rate limited like any other miss
    expect(results).toContain(429)
    expect(w.calls.list).toBeLessThanOrEqual(35)
  })
})

void ID
