/**
 * Observability rework (SRE O-2 / O-3 / O-5, spec §3.9): `ship_rate_limited` for the unknown-ID miss cap, `requestId` on the
 * status / cancel / retry / denial logs and metrics, and a real per-stage `duration_ms`. Drives the real routers through the
 * QA harness and reads back what winston emitted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'

process.env.GITHUB_APP_ID = ''
process.env.GITHUB_INSTALLATION_ID = ''
const cjsRequire = createRequire(import.meta.url)
const { createHarness } = cjsRequire('../../helpers/shipQaHarness')
const h = createHarness()
const { config, githubService, ship, fx } = h

const MIN = 60_000
const iso = (ms: number) => new Date(ms).toISOString()
let w: any

beforeEach(() => {
  w = fx.makeWorld(githubService)
  h.wire(w)
  config.ship.identityProvider = 'test'
  Object.assign(config.ship, { maxStartsPerHour: 99, maxActiveGlobal: 99, maxActivePerUser: 99, maxStartsPerUserPerHour: 99, rateLimitGuardRemaining: 1000, annotationsVerified: true, queueSignalsVerified: false })
  githubService.getRateLimitSnapshot = () => null
})
afterEach(() => { vi.restoreAllMocks() })

const parsed = (lines: string[]) => lines.map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) as any[]
const fresh = (i: number) => fx.mintAt(Date.now() - 1000 - i * 7)

describe('O-2 ship_rate_limited for the unknown-ID miss cap', () => {
  it('the refused lookup emits ship_rate_limited{limit:user_misses} with the ship id, actor and request id', async () => {
    const logs = h.captureLogs()
    let last: any
    try {
      for (let i = 0; i < 31; i++) last = await ship('GET', `/status/${fresh(i)}`, { token: 'stranger' })
    } finally { logs.stop() }
    expect(last.statusCode).toBe(429)
    const ev = parsed(logs.lines).filter((e) => e.event === 'ship_rate_limited')
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ limit: 'user_misses', actor_oid: h.ID.stranger, requestId: 'req-1', level: 'warn' })
    expect(ev[0].correlation_id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('O-3 requestId on status / cancel / retry logs and status-path metrics', () => {
  const t = () => Date.now() - 30 * MIN
  let cid: string

  it('ship_authz_denied (status) carries the request id', async () => {
    cid = fx.mintAt(t())
    fx.buildRun(w, { cid, id: 1000, createdAt: iso(t() + 5000) })
    const logs = h.captureLogs()
    try { expect((await ship('GET', `/status/${cid}`, { token: 'stranger' })).statusCode).toBe(403) } finally { logs.stop() }
    const ev = parsed(logs.lines).find((e) => e.event === 'ship_authz_denied')
    expect(ev).toMatchObject({ action: 'status', requestId: 'req-1', correlation_id: cid })
  })

  it('ship_authz_denied (cancel / retry) carries the request id', async () => {
    cid = fx.mintAt(t())
    fx.buildRun(w, { cid, id: 1000, createdAt: iso(t() + 5000) })
    const logs = h.captureLogs()
    try {
      expect((await ship('POST', `/${cid}/cancel`, { token: 'reader' })).statusCode).toBe(403)
      expect((await ship('POST', `/${cid}/retry-config-pr`, { token: 'reader' })).statusCode).toBe(403)
    } finally { logs.stop() }
    const ev = parsed(logs.lines).filter((e) => e.event === 'ship_authz_denied')
    expect(ev.map((e) => e.action).sort()).toEqual(['cancel', 'retry'])
    expect(ev.every((e) => e.requestId === 'req-1')).toBe(true)
  })

  it('a successful cancel logs the request id', async () => {
    cid = fx.mintAt(t())
    const r = fx.buildRun(w, { cid, id: 1000, createdAt: iso(t() + 5000), status: 'in_progress', publishSteps: [], configSteps: [] })
    w.runs[0].status = 'in_progress'; w.runs[0].conclusion = null
    w.jobs[1000][1].status = 'in_progress'; w.jobs[1000][1].conclusion = null
    w.jobs[1000][2].status = 'queued'; w.jobs[1000][2].conclusion = null
    w.jobs[1000][3].status = 'queued'; w.jobs[1000][3].conclusion = null
    expect(r.jid(1)).toBe(10001)
    const logs = h.captureLogs()
    try {
      const res = await ship('POST', `/${cid}/cancel`, { token: 'sam' })
      expect(res.statusCode).toBe(200)
    } finally { logs.stop() }
    const line = parsed(logs.lines).find((e) => typeof e.message === 'string' && e.message.includes('ship cancel requested'))
    expect(line).toMatchObject({ requestId: 'req-1' })
  })

  it('the request id is passed to the services from every per-ship route (status, logs)', async () => {
    cid = fx.mintAt(t())
    fx.buildRun(w, { cid, id: 1000, createdAt: iso(t() + 5000) })
    const shipStatus = h.shipStatus
    const spy = vi.spyOn(shipStatus, 'getStatus')
    const logsSpy = vi.spyOn(shipStatus, 'getLogs')
    await ship('GET', `/status/${cid}`)
    await ship('GET', `/logs/${cid}`, { query: { stage: 'build' } })
    expect(spy.mock.calls[0][2]).toEqual({ requestId: 'req-1' })
    expect(logsSpy.mock.calls[0][2]).toMatchObject({ requestId: 'req-1' })
  })
})

describe('O-5 ship_stage_completed.duration_ms is the stage’s own duration', () => {
  it('uses the job/step timestamps (prepare 5 min, build 15 min), not the time since the ship started; omitted when GitHub reports none', async () => {
    const t = Date.now() - 3 * 60 * MIN // ship is three hours old: a "since start" value would be ≥ 3 h for every stage
    const cid = fx.mintAt(t)
    fx.buildRun(w, { cid, id: 1000, createdAt: iso(t + 5000) })
    const logs = h.captureLogs()
    try { expect((await ship('GET', `/status/${cid}`)).statusCode).toBe(200) } finally { logs.stop() }
    const ev = parsed(logs.lines).filter((e) => e.event === 'ship_stage_completed')
    const by = (s: string) => ev.find((e) => e.stage === s)
    expect(by('prepare').duration_ms).toBe(5 * MIN)
    expect(by('build').duration_ms).toBe(15 * MIN)
    expect(by('scan').duration_ms).toBe(5 * MIN)
    expect(ev.every((e) => e.duration_ms === undefined || e.duration_ms < 60 * MIN)).toBe(true)
    expect(by('queued').duration_ms).toBeUndefined()
    expect(by('preview').duration_ms).toBeUndefined()
  })
})
