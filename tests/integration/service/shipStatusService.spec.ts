/**
 * BT-09 (run lookup), BT-10 (stage derivation + attempt fold), BT-11 (annotation forgery matrix),
 * BT-13 (authorization), BT-14 (single-flight/TTL), BT-19 (watchdog), BT-20 (SUPERSEDED), BT-21 (metrics),
 * BT-23 (preview URL) — spec §9.1. Recorded-style fixtures; no network (githubService is stubbed, and
 * GitHub credentials are blanked before any module loads).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'

process.env.GITHUB_APP_ID = ''
process.env.GITHUB_INSTALLATION_ID = ''
const cjsRequire = createRequire(import.meta.url)
const config = cjsRequire('../../../config')
const logger = cjsRequire('../../../utils/logger')
const githubService = cjsRequire('../../../services/githubService')
const svc = cjsRequire('../../../services/shipStatusService')
const identity = cjsRequire('../../../services/shipIdentityService')
const { createTestProvider } = cjsRequire('../../helpers/shipIdentityTestDouble')
const fx = cjsRequire('../../helpers/shipFixtures')

const MIN = 60_000
const AGE = 4 * 60 * MIN // default ship age, so a config_only retry 1–3 h after the start lies in the past
const iso = (ms: number) => new Date(ms).toISOString()
let w: any
let t: number
let cid: string
let created: string
const sam = { id: fx.OID, email: 'sam@x.com', roles: [], groups: [] }

function full(over: any = {}, id = 1000) {
  return fx.buildRun(w, { cid, id, createdAt: created, ...over })
}
const status = (user: any = sam) => svc.getStatus(cid, user)
const stage = (s: any, id: string) => s.stages.find((x: any) => x.id === id)
const states = (s: any) => s.stages.map((x: any) => `${x.id}:${x.state}`).join(' ')

beforeEach(() => {
  svc._resetForTests()
  w = fx.makeWorld(githubService)
  config.ship.annotationsVerified = true
  config.ship.queueSignalsVerified = false
  config.ship.watchdogCancelEnabled = false
  config.ship.previewHosts = {}
  config.ship.retryWindowHours = 24
  config.ship.identityProvider = 'none'
  config.ship.platformRoles = []
  config.ship.platformGroupIds = []
  t = Date.now() - AGE
  cid = fx.mintAt(t)
  created = iso(t + 5000)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('BT-09 run lookup from the UUIDv7 window', () => {
  it('finds the run in one call with window lower bound t − 180 s', async () => {
    full()
    const s = await status()
    expect(s.runResolved).toBe(true)
    expect(w.calls.list).toBe(1)
    const [from] = w.windows[0].created.split('..')
    expect(Date.parse(from)).toBe(Math.floor((t - 180_000) / 1000) * 1000)
    expect(w.windows[0].wf).toBe('ship-from-repo.yaml')
  })

  it('ship 30 days old with 2 000 newer runs ⇒ ≤ 3 calls (window-bounded, not recency-bounded)', async () => {
    const old = Date.now() - 30 * 86_400_000
    cid = fx.mintAt(old); created = iso(old + 5000)
    full()
    // 250 other ships inside the 25 h window (≈ the DD-14 start cap) → 3 pages; 2 000 newer runs outside it
    for (let i = 0; i < 250; i++) w.runs.push({ id: 50_000 + i, display_title: fx.runName({ cid: fx.mintAt(old + 60_000 + i), app: 'other' }), created_at: iso(old + 60_000 + i * 1000), status: 'completed', conclusion: 'success' })
    for (let i = 0; i < 2000; i++) w.runs.push({ id: 90_000 + i, display_title: 'whatever', created_at: iso(Date.now() - i * 1000), status: 'completed', conclusion: 'success' })
    const s = await status()
    expect(s.runResolved).toBe(true)
    expect(w.calls.list).toBeLessThanOrEqual(3)
    expect(w.calls.list).toBe(3)
  })

  it('future (> now+121 s) and expired IDs ⇒ 404 with zero GitHub calls', async () => {
    for (const id of [fx.mintAt(Date.now() + 121_000), fx.mintAt(Date.now() - 91 * 86_400_000)]) {
      await expect(svc.getStatus(id, sam)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
    }
    expect(w.calls.list).toBe(0)
  })

  it('no run yet and age < 3 min ⇒ queued (dispatch→run visibility lag); older ⇒ 404', async () => {
    cid = fx.mintAt(Date.now() - 60_000)
    const s = await status()
    expect(s).toMatchObject({ state: 'queued', runResolved: false, terminal: false, attempt: 0 })
    expect(s.stages).toHaveLength(7)
    svc._resetForTests()
    cid = fx.mintAt(Date.now() - 4 * MIN)
    await expect(status()).rejects.toMatchObject({ status: 404 })
  })

  it('negative cache: an unknown ID is looked up once per 60 s', async () => {
    cid = fx.mintAt(Date.now() - 10 * MIN)
    await expect(status()).rejects.toMatchObject({ status: 404 })
    await expect(status()).rejects.toMatchObject({ status: 404 })
    expect(w.calls.list).toBe(1)
  })

  it('per-user miss cap: more than 30 unknown lookups a minute ⇒ 429 PLATFORM_RATE_LIMITED', async () => {
    let last: any
    for (let i = 0; i < 31; i++) last = await svc.getStatus(fx.mintAt(Date.now() - 10 * MIN + i), sam).catch((e: any) => e)
    expect(last).toMatchObject({ status: 429, code: 'PLATFORM_RATE_LIMITED', details: { limit: 'user_misses' } })
  })

  it('a config_only retry run created later inside the retry window is part of the same ship', async () => {
    const r1 = full({ failAt: 'config' }, 1000)
    w.originRunId = 1000
    fx.buildRun(w, { cid, id: 2000, createdAt: iso(t + 2 * 3_600_000), mode: 'config_only' })
    const s = await status()
    expect(s.attempt).toBe(2)
    expect(w.calls.list).toBe(1)
    expect(r1.run.id).toBe(1000)
  })

  it('an extra `since` hint does not exist in the service contract (run located from the ID alone)', async () => {
    full()
    expect((await svc.getStatus(cid, sam)).correlationId).toBe(cid)
  })
})

describe('BT-10 stage derivation and attempt fold', () => {
  it('all green: succeeded, trusted fields from annotations, PR known, preview not configured (H-1)', async () => {
    full()
    w.pr = { number: 7, url: 'https://github.com/Aya-DevOpsTeam/aya-flux/pull/7', state: 'open' }
    const s = await status()
    expect(s).toMatchObject({ state: 'succeeded', terminal: true, attempt: 1, queuedBehind: false, version: '1.2.3', sha: fx.SHA, shortSha: fx.SHA.slice(0, 7), digest: fx.DIGEST, app: 'my-app', env: 'devsand', repo: fx.REPO, rollout: 'preview_pr' })
    expect(s.imageRef).toBe(`${fx.REGISTRY}/selfserve/my-app:1.2.3`)
    expect(s.settings).toEqual({ branch: 'main', namespace: 'my-app', teamLabel: 'software-engineering', port: 8080, healthPath: '/healthz', bump: 'patch' })
    expect(s.pr).toEqual({ number: 7, url: 'https://github.com/Aya-DevOpsTeam/aya-flux/pull/7', state: 'open' })
    expect(s.preview).toEqual({ state: 'not_configured' })
    expect(states(s)).toBe('queued:succeeded prepare:succeeded build:succeeded scan:succeeded publish:succeeded config_pr:succeeded preview:succeeded')
    expect(s.failure).toBeUndefined()
    expect(s.stages).toHaveLength(7)
  })

  it.each(['open', 'merged', 'closed'])('PR state %s from the aya-flux PR lookup is surfaced', async (state) => {
    full()
    w.pr = { number: 7, url: 'https://github.com/Aya-DevOpsTeam/aya-flux/pull/7', state }
    expect((await status()).pr).toMatchObject({ number: 7, state })
  })

  it('PR lookup failure degrades gracefully: no pr object, number still known from the trusted config annotation', async () => {
    full()
    githubService.findPullRequestForBranch = async () => { throw new Error('boom') }
    const s = await status()
    expect(s.state).toBe('succeeded')
    expect(s.pr).toBeUndefined()
    expect(stage(s, 'preview').state).toBe('succeeded')
  })

  it('running mid-build: earlier stages succeeded, later pending', async () => {
    const r = full({ status: 'in_progress' })
    w.jobs[1000] = [
      fx.job(r.jid(1), 'prepare', {}),
      fx.job(r.jid(2), 'build', { status: 'in_progress', completed: undefined }),
    ]
    const s = await status()
    expect(s).toMatchObject({ state: 'running', terminal: false })
    expect(states(s)).toBe('queued:succeeded prepare:succeeded build:running scan:pending publish:pending config_pr:pending preview:pending')
  })

  it('queued: no job has started yet', async () => {
    const r = full({ status: 'queued' })
    w.jobs[1000] = [fx.job(r.jid(1), 'prepare', { status: 'queued' })]
    const s = await status()
    expect(s.state).toBe('queued')
    expect(stage(s, 'queued').state).toBe('running')
  })

  it.each([
    ['prepare', 'REPO_NOT_ACCESSIBLE', 'fix_then_ship'],
    ['build', 'BUILD_FAILED', 'fix_then_ship'],
    ['scan', 'SECURITY_GATE_FAILED', 'fix_then_ship'],
    ['publish', 'PUBLISH_FAILED', 'reship'],
    ['config', 'CONFIG_PR_FAILED', 'retry_config'],
  ])('failure at %s ⇒ %s (%s)', async (failAt, code, retry) => {
    full({ conclusion: 'failure', failAt })
    const s = await status()
    expect(s.state).toBe('failed')
    expect(s.terminal).toBe(true)
    expect(s.failure).toMatchObject({ code, retry })
    expect(s.failure.details.runUrl).toMatch(/^https:\/\/github\.com\//)
  })

  it('scan failure surfaces findings in details only; build failure carries the untrusted hint in details', async () => {
    full({ conclusion: 'failure', failAt: 'scan' })
    expect((await status()).failure.details.findings[0]).toMatchObject({ package: 'lodash', severity: 'CRITICAL' })
    svc._resetForTests(); w = fx.makeWorld(githubService)
    full({ conclusion: 'failure', failAt: 'build' })
    const s = await status()
    expect(s.failure.details).toMatchObject({ buildpackId: 'paketo-buildpacks/npm-install', errorLine: 'npm ERR! boom' })
    expect(s.failure.message).not.toContain('npm ERR')
  })

  it('untrusted build hint is sanitised everywhere it surfaces (top-level buildHint and failure.details): redacted, control-stripped, ≤300 chars', async () => {
    const r = full({ conclusion: 'failure', failAt: 'build' })
    const secret = 'gh' + 'p_' + 'a1'.repeat(18)
    w.anns[r.jid(2)] = [fx.annotation('build', { code: 'BUILD_FAILED', buildpackId: 'bp\u0007', errorLine: `\u001b[31mfail ${secret} ` + 'x'.repeat(600), arch: 'amd64' })]
    const s = await status()
    for (const hint of [s.buildHint, s.failure.details]) {
      expect(hint.errorLine.length).toBeLessThanOrEqual(300)
      expect(hint.errorLine).not.toContain(secret)
      expect(hint.errorLine).toContain('***REDACTED***')
      expect(hint.errorLine).not.toMatch(/[\u0000-\u001f]/)
    }
  })

  it('BUILD_TIMEOUT from job duration ≥ 29.5 min', async () => {
    const r = full({ conclusion: 'failure', failAt: 'build' })
    r.jobs[1].started_at = '2026-10-22T14:00:00Z'; r.jobs[1].completed_at = '2026-10-22T14:30:00Z'
    expect((await status()).failure.code).toBe('BUILD_TIMEOUT')
  })

  describe('B-6 attempt fold', () => {
    it('run 1 full + CONFIG_PR_FAILED → run 2 config_only success: carried from I, attempt 2, build/scan not skipped', async () => {
      full({ conclusion: 'failure', failAt: 'config' }, 1000)
      w.originRunId = 1000
      fx.buildRun(w, { cid, id: 2000, createdAt: iso(t + 3_600_000), mode: 'config_only' })
      const s = await status()
      expect(s).toMatchObject({ state: 'succeeded', terminal: true, attempt: 2, version: '1.2.3', sha: fx.SHA, digest: fx.DIGEST })
      expect(s.failure).toBeUndefined()
      expect(states(s)).toBe('queued:succeeded prepare:succeeded build:succeeded scan:succeeded publish:succeeded config_pr:succeeded preview:succeeded')
      expect(s.startedAt).toBe(created)
      expect(s.durationSec).toBe(1200)
    })

    it('run 2 also fails in step 9 ⇒ CONFIG_PR_FAILED again, retry_config within the window', async () => {
      full({ conclusion: 'failure', failAt: 'config' }, 1000)
      w.originRunId = 1000
      fx.buildRun(w, { cid, id: 2000, createdAt: iso(t + 3_600_000), mode: 'config_only', conclusion: 'failure', failAt: 'config' })
      const s = await status()
      expect(s).toMatchObject({ state: 'failed', attempt: 2, version: '1.2.3' })
      expect(s.failure).toMatchObject({ code: 'CONFIG_PR_FAILED', retry: 'retry_config' })
      expect(stage(s, 'publish').state).toBe('succeeded')
    })

    it('run 2 fails in prepare ⇒ REPO_NOT_ACCESSIBLE with carried stages unchanged', async () => {
      full({ conclusion: 'failure', failAt: 'config' }, 1000)
      w.originRunId = 1000
      fx.buildRun(w, { cid, id: 2000, createdAt: iso(t + 3_600_000), mode: 'config_only', conclusion: 'failure', failAt: 'prepare' })
      const s = await status()
      expect(s.failure.code).toBe('REPO_NOT_ACCESSIBLE')
      expect(states(s)).toContain('build:succeeded scan:succeeded publish:succeeded')
    })

    it('mismatched originRunId / imageTag ⇒ retry result ignored, UNKNOWN (never success)', async () => {
      full({ conclusion: 'failure', failAt: 'config' }, 1000)
      w.originRunId = 999 // wrong
      fx.buildRun(w, { cid, id: 2000, createdAt: iso(t + 3_600_000), mode: 'config_only' })
      let s = await status()
      expect(s.state).toBe('failed')
      expect(s.failure.code).toBe('UNKNOWN')
      svc._resetForTests(); w = fx.makeWorld(githubService)
      full({ conclusion: 'failure', failAt: 'config' }, 1000)
      w.originRunId = 1000
      fx.buildRun(w, { cid, id: 2000, createdAt: iso(t + 3_600_000), mode: 'config_only', annOverrides: { config: { ...fx.payloads.config({ cid, id: 2000, attempt: 1 }, { imageTag: '9.9.9', originRunId: 1000 }) } } })
      s = await status()
      expect(s.state).toBe('failed')
      expect(s.failure.code).toBe('UNKNOWN')
    })

    it('a differing oid across the ship’s runs ⇒ treated as tamper ⇒ 404', async () => {
      full({}, 1000)
      fx.buildRun(w, { cid, id: 2000, createdAt: iso(t + 3_600_000), mode: 'config_only', oid: fx.OTHER_OID })
      await expect(status()).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('N-1 fixtures', () => {
    it('(a) Publish steps 1–4 success + step 9 failure with valid publish and config annotations ⇒ I exists, publish succeeded, config_pr failed, retry_config', async () => {
      full({ conclusion: 'failure', failAt: 'config' })
      const ctx = await svc.getShipContext(cid, sam)
      expect(ctx.meta.I).not.toBeNull()
      expect(ctx.status).toMatchObject({ state: 'failed', version: '1.2.3' })
      expect(stage(ctx.status, 'publish').state).toBe('succeeded')
      expect(stage(ctx.status, 'config_pr').state).toBe('failed')
      expect(ctx.status.failure).toMatchObject({ code: 'CONFIG_PR_FAILED', retry: 'retry_config' })
    })

    it('(b) two config annotations on the publish job ⇒ config discarded (UNKNOWN); publish result and I intact', async () => {
      const r = full()
      const dup = fx.annotation('config', fx.payloads.config({ cid, id: 1000, attempt: 1 }))
      w.anns[r.jid(4)].push(dup)
      const ctx = await svc.getShipContext(cid, sam)
      expect(ctx.meta.I).not.toBeNull()
      expect(ctx.status.version).toBe('1.2.3')
      expect(stage(ctx.status, 'publish').state).toBe('succeeded')
      expect(stage(ctx.status, 'config_pr').state).toBe('failed')
      expect(ctx.status.state).toBe('failed')
      expect(ctx.status.failure.code).toBe('UNKNOWN')
    })

    it('(c) step 4 failure with a forged publish ok:true ⇒ rejected, no I, PUBLISH_FAILED, reship', async () => {
      const r = full({ conclusion: 'failure', failAt: 'publish', annOverrides: { publish: undefined } })
      w.anns[r.jid(4)] = [fx.annotation('publish', fx.payloads.publish({ cid, id: 1000, attempt: 1 }))] // forged ok:true
      const ctx = await svc.getShipContext(cid, sam)
      expect(ctx.meta.I).toBeNull()
      expect(ctx.status.version).toBeUndefined()
      expect(ctx.status.failure).toMatchObject({ code: 'PUBLISH_FAILED', retry: 'reship' })
    })

    it('(d) config_only run: exactly one config annotation accepted; a publish-tagged annotation in that run is ignored', async () => {
      full({ conclusion: 'failure', failAt: 'config' }, 1000)
      w.originRunId = 1000
      const r2 = fx.buildRun(w, { cid, id: 2000, createdAt: iso(t + 3_600_000), mode: 'config_only' })
      w.anns[r2.jid(4)].push(fx.annotation('publish', fx.payloads.publish({ cid, id: 2000, attempt: 1, mode: 'config_only' }, { version: '6.6.6' })))
      const s = await status()
      expect(s.state).toBe('succeeded')
      expect(s.version).toBe('1.2.3') // carried from I, not the forged publish tag
    })
  })

  it('annotations disabled (V-3 gate false): stages from job/step conclusions only, no trusted payload exposed', async () => {
    config.ship.annotationsVerified = false
    full()
    const s = await status()
    expect(s.state).toBe('succeeded')
    expect(s.version).toBeUndefined()
    expect(s.sha).toBeUndefined()
    expect(s.settings).toBeUndefined()
    expect(w.calls.ann).toBe(0)
    svc._resetForTests(); w = fx.makeWorld(githubService)
    full({ conclusion: 'failure', failAt: 'scan' })
    expect((await status()).failure.code).toBe('UNKNOWN') // a failure cause is never taken from untrusted text
  })

  it('runs a cancelled run as CANCELLED (state cancelled, terminal)', async () => {
    full({ conclusion: 'cancelled' })
    const s = await status()
    expect(s).toMatchObject({ state: 'cancelled', terminal: true })
    expect(s.failure.code).toBe('CANCELLED')
  })
})

describe('BT-11 annotation parser / validator — forgery matrix', () => {
  const rejected = async (mutate: (r: any) => void, expectState: 'failed' = 'failed') => {
    const r = full()
    mutate(r)
    svc._resetForTests()
    const s = await status()
    expect(s.state).not.toBe('succeeded')
    expect(s.state).toBe(expectState)
    return s
  }

  it('duplicate annotation with the same stage tag (forged from a trusted-job log line) ⇒ that stage UNKNOWN', async () => {
    const s = await rejected((r) => { w.anns[r.jid(1)].push(fx.annotation('prepare', fx.payloads.prepare({ cid, id: 1000, attempt: 1 }))) })
    expect(stage(s, 'prepare').state).toBe('failed')
    expect(s.failure.code).toBe('UNKNOWN')
  })

  it.each([
    ['wrong cid', (p: any) => ({ ...p, cid: fx.mintAt(t + 1) })],
    ['wrong runId', (p: any) => ({ ...p, runId: 4242 })],
    ['wrong runAttempt', (p: any) => ({ ...p, runAttempt: 2 })],
    ['wrong stage in payload', (p: any) => ({ ...p, stage: 'scan' })],
    ['wrong version', (p: any) => ({ ...p, v: 2 })],
    ['bad sha format', (p: any) => ({ ...p, sha: 'XYZ' })],
    ['disallowed code', (p: any) => ({ ...p, ok: false, code: 'SECURITY_GATE_FAILED' })],
    ['ok true with a code', (p: any) => ({ ...p, code: 'CLONE_FAILED' })],
    ['invalid inputs (injection)', (p: any) => ({ ...p, inputs: { ...p.inputs, branch: 'a;b' } })],
    ['mode mismatch', (p: any) => ({ ...p, mode: 'config_only' })],
  ])('prepare payload %s ⇒ rejected, never success', async (_n, f) => {
    const s = await rejected((r) => { w.anns[r.jid(1)] = [fx.annotation('prepare', f(fx.payloads.prepare({ cid, id: 1000, attempt: 1 })))] })
    expect(s.failure.code).toBe('UNKNOWN')
  })

  it.each([
    ['padded base64', () => ({ title: 'ship.result', message: 'ship.result.v1:prepare:eyJ2IjoxfQ==' })],
    ['non-canonical base64url', () => ({ title: 'ship.result', message: 'ship.result.v1:prepare:eyJ2IjoxfR' })],
    ['invalid JSON', () => ({ title: 'ship.result', message: `ship.result.v1:prepare:${Buffer.from('not json').toString('base64url')}` })],
    ['JSON array', () => ({ title: 'ship.result', message: `ship.result.v1:prepare:${Buffer.from('[1]').toString('base64url')}` })],
    ['oversize payload (> 4 KB)', () => ({ title: 'ship.result', message: `ship.result.v1:prepare:${Buffer.from(JSON.stringify({ pad: 'x'.repeat(5000) })).toString('base64url')}` })],
    ['wrong title', () => fx.annotation('prepare', fx.payloads.prepare({ cid, id: 1000, attempt: 1 }), { title: 'other' })],
    ['whitespace in message', () => ({ title: 'ship.result', message: `ship.result.v1:prepare:${fx.enc({ v: 1 })} ` })],
  ])('%s ⇒ the stage result is not trusted', async (_n, make) => {
    await rejected((r) => { w.anns[r.jid(1)] = [make()] })
  })

  it('ok:true on a failed job is rejected (annotations can downgrade, never upgrade)', async () => {
    const s = await rejected((r) => {
      r.jobs[0].conclusion = 'failure'
      w.runs[0].conclusion = 'failure'
    })
    expect(s.failure.code).toBe('UNKNOWN')
  })

  it('ok:true publish while a Publish: work step failed is rejected; failure is PUBLISH_FAILED reship (no I)', async () => {
    const s = await rejected((r) => {
      r.jobs[3].steps.find((x: any) => x.name === 'Publish: push').conclusion = 'failure'
      w.runs[0].conclusion = 'failure'
    })
    expect(s.failure).toMatchObject({ code: 'PUBLISH_FAILED', retry: 'reship' })
    expect((await svc.getShipContext(cid, sam)).meta.I).toBeNull()
  })

  it('ok:true config while a Config PR: work step failed is rejected, yet a valid publish survives (I intact)', async () => {
    const r = full()
    r.jobs[3].steps.find((x: any) => x.name === 'Config PR: wait').conclusion = 'failure'
    w.runs[0].conclusion = 'failure'
    const ctx = await svc.getShipContext(cid, sam)
    expect(ctx.meta.I).not.toBeNull()
    expect(stage(ctx.status, 'publish').state).toBe('succeeded')
    expect(stage(ctx.status, 'config_pr').state).toBe('failed')
    expect(ctx.status.failure.code).toBe('CONFIG_PR_FAILED')
  })

  it('step-group membership is by EXACT name: lookalike steps neither join nor break a group (N3-A4)', async () => {
    const r = full()
    r.jobs[3].steps.push(fx.step('Post Publish: push', 'failure'), fx.step('Publish: extra', 'failure'), fx.step('Config PR: extra', 'failure'))
    const s = await status()
    expect(s.state).toBe('succeeded')
    expect(stage(s, 'publish').state).toBe('succeeded')
    expect(stage(s, 'config_pr').state).toBe('succeeded')
  })

  it('ok:true with the stage Emit: step not success is rejected (N3-A4)', async () => {
    const s = await rejected((r) => { r.jobs[3].steps.find((x: any) => x.name === 'Emit: publish').conclusion = 'failure' })
    expect(s.state).toBe('failed')
  })

  it('a skipped step never counts as success: forced-skipped Config PR step with skipped:true annotation is not honoured', async () => {
    const r = full({ annOverrides: { config: fx.payloads.config({ cid, id: 1000, attempt: 1 }, { skipped: true }) } })
    r.jobs[3].steps.find((x: any) => x.name === 'Config PR: dispatch').conclusion = 'skipped'
    const s = await status()
    expect(stage(s, 'config_pr').state).not.toBe('skipped')
    expect(s.state).not.toBe('succeeded')
  })

  it('a skip_config run with steps 7–9 success and a valid skipped:true annotation ⇒ config_pr skipped', async () => {
    full({ annOverrides: { config: fx.payloads.config({ cid, id: 1000, attempt: 1 }, { skipped: true, rollout: 'flux_auto_roll', prNumber: undefined, prUrl: undefined }) } })
    const s = await status()
    expect(stage(s, 'config_pr').state).toBe('skipped')
    expect(stage(s, 'preview').state).toBe('skipped')
    expect(s.state).toBe('succeeded')
    expect(s.rollout).toBe('flux_auto_roll')
    expect(w.calls.pr).toBe(0)
  })

  it('a stage tag not expected for the job is ignored (scan tag inside the publish job); the job still validates', async () => {
    const r = full()
    w.anns[r.jid(4)].push(fx.annotation('scan', fx.payloads.scan({ cid, id: 1000, attempt: 1 })))
    expect((await status()).state).toBe('succeeded')
  })

  it('mismatched tarSha256 / scanId between scan and publish ⇒ publish result discarded', async () => {
    const r = full({ annOverrides: { publish: fx.payloads.publish({ cid, id: 1000, attempt: 1 }, { tarSha256: 'e'.repeat(64) }) } })
    const ctx = await svc.getShipContext(cid, sam)
    expect(r.run.id).toBe(1000)
    expect(ctx.meta.I).toBeNull()
    expect(ctx.status.state).toBe('failed')
  })

  it('build-job annotations never decide anything: a forged prepare/publish-tagged annotation on the build job is inert', async () => {
    const r = full({ conclusion: 'failure', failAt: 'build' })
    w.anns[r.jid(2)].push(fx.annotation('publish', fx.payloads.publish({ cid, id: 1000, attempt: 1 })))
    const ctx = await svc.getShipContext(cid, sam)
    expect(ctx.meta.I).toBeNull()
    expect(ctx.status.failure.code).toBe('BUILD_FAILED')
  })

  it('unknown fields are dropped; unrecognised payload fields never reach the status', () => {
    const run = { id: 1000, runAttempt: 1, parsed: { app: 'my-app' } }
    const p = svc.parsePayload('scan', { ...fx.payloads.scan({ cid, id: 1000, attempt: 1 }), evil: '<script>', url: 'http://x' }, { run, cid })
    expect(p.evil).toBeUndefined()
    expect(p.url).toBeUndefined()
    expect(() => svc.parsePayload('publish', { ...fx.payloads.publish({ cid, id: 1000, attempt: 1 }), imageRef: 'evil.io/selfserve/my-app:1.0.0' }, { run, cid })).toThrow()
  })
})

describe('BT-13 authorization matrix', () => {
  const ownerCtx = async () => { full(); return svc.getShipContext(cid, sam) }

  it('read: starter by immutable oid ⇒ allowed', async () => {
    const ctx = await ownerCtx()
    expect(await svc.authorize(sam, ctx.meta)).toBe('starter')
  })
  it('read: unrelated user ⇒ 403 FORBIDDEN', async () => {
    full()
    await expect(svc.getStatus(cid, { id: fx.OTHER_OID, email: 'x@x.com' })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })
  it('e-mail collision does not authorize: a different oid with the same sanitised e-mail is denied', async () => {
    full({ app: 'my-app' })
    const brien = { id: fx.OTHER_OID, email: "o'brien@x" }
    const brien2 = { id: fx.OID, email: 'o_brien@x' }
    await expect(svc.getStatus(cid, brien)).rejects.toMatchObject({ status: 403 })
    expect((await svc.getStatus(cid, brien2)).correlationId).toBe(cid) // oid is the key
  })
  it('read: repo reader (identity linked + permission ≥ read) allowed; mutate refused', async () => {
    const ctx = await ownerCtx()
    identity.registerProvider('test', createTestProvider({ links: { [fx.OTHER_OID]: 'octocat' }, permissions: { 'octocat:AyaHealthcare/my-svc': 'read' } }))
    config.ship.identityProvider = 'test'
    const reader = { id: fx.OTHER_OID, email: 'r@x.com' }
    expect(await svc.authorize(reader, ctx.meta)).toBe('repo_reader')
    expect(await svc.authorize(reader, ctx.meta, { mutate: true })).toBeNull()
    expect((await svc.getStatus(cid, reader)).correlationId).toBe(cid)
  })
  it('repo reader without permission / unlinked / provider none ⇒ denied', async () => {
    const ctx = await ownerCtx()
    identity.registerProvider('test', createTestProvider({ links: { [fx.OTHER_OID]: 'octocat' }, permissions: { 'octocat:AyaHealthcare/my-svc': 'none' } }))
    config.ship.identityProvider = 'test'
    expect(await svc.authorize({ id: fx.OTHER_OID }, ctx.meta)).toBeNull()
    expect(await svc.authorize({ id: 'someone-else' }, ctx.meta)).toBeNull()
    config.ship.identityProvider = 'none'
    expect(await svc.authorize({ id: fx.OTHER_OID }, ctx.meta)).toBeNull()
  })
  it('platform member may read and mutate; empty platform config qualifies nobody', async () => {
    const ctx = await ownerCtx()
    const admin = { id: fx.OTHER_OID, roles: ['Platform.Admin'], groups: [] }
    expect(await svc.authorize(admin, ctx.meta)).toBeNull()
    config.ship.platformRoles = ['Platform.Admin']
    expect(await svc.authorize(admin, ctx.meta)).toBe('platform')
    expect(await svc.authorize(admin, ctx.meta, { mutate: true })).toBe('platform')
    config.ship.platformRoles = []
    config.ship.platformGroupIds = ['grp-1']
    expect(await svc.authorize({ id: 'z', groups: ['grp-1'] }, ctx.meta, { mutate: true })).toBe('platform')
  })
  it('mutate: starter allowed', async () => {
    const ctx = await ownerCtx()
    expect(await svc.authorize(sam, ctx.meta, { mutate: true })).toBe('starter')
  })
  it('denials are logged as ship_authz_denied', async () => {
    full()
    const spy = vi.spyOn(logger, 'log')
    await svc.getStatus(cid, { id: fx.OTHER_OID }).catch(() => undefined)
    expect(spy.mock.calls.some((c: any[]) => c[1] === 'ship_authz_denied')).toBe(true)
  })
})

describe('BT-14 single-flight and TTLs', () => {
  it('N concurrent viewers cause one upstream refresh', async () => {
    full()
    await Promise.all(Array.from({ length: 10 }, () => status()))
    expect(w.calls.list).toBe(1)
    expect(w.calls.jobs).toBe(1)
  })
  it('running status is cached 10 s, terminal 60 s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(t + AGE)
    const r = full({ status: 'in_progress' })
    w.jobs[1000] = [fx.job(r.jid(1), 'prepare', { status: 'in_progress', completed: undefined })]
    await status()
    await status()
    expect(w.calls.jobs).toBe(1)
    vi.setSystemTime(t + AGE + 11_000)
    await status()
    expect(w.calls.jobs).toBe(2) // jobs for an active run re-read after 10 s
  })
  it('terminal ship: status cached for 60 s, completed-run jobs immutable', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(t + AGE)
    full()
    await status()
    vi.setSystemTime(t + AGE + 30_000)
    await status()
    expect(w.calls.list).toBe(1)
    vi.setSystemTime(t + AGE + 61_000)
    await status()
    expect(w.calls.list).toBe(2)
    expect(w.calls.jobs).toBe(1) // immutable once completed
    expect(w.calls.ann).toBe(3) // prepare, scan, publish jobs read once
  })
  it('rate-limit guard: remaining < 1 000 stretches every TTL to 60 s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(t + AGE)
    githubService.getRateLimitSnapshot = () => ({ remaining: 500, limit: 5000, reset: 0 })
    const r = full({ status: 'in_progress' })
    w.jobs[1000] = [fx.job(r.jid(1), 'prepare', { status: 'in_progress', completed: undefined })]
    await status()
    vi.setSystemTime(t + AGE + 30_000)
    await status()
    expect(w.calls.list).toBe(1)
  })
})

describe('BT-19 queue watchdog (V-4 gated, report-only)', () => {
  const queuedPrepare = (minutesAgo: number) => {
    const r = full({ status: 'queued' })
    w.jobs[1000] = [fx.job(r.jid(1), 'prepare', { status: 'queued', steps: [], started: iso(Date.now() - minutesAgo * MIN), completed: undefined, created: iso(Date.now() - minutesAgo * MIN) })]
    return r
  }
  beforeEach(() => { config.ship.queueSignalsVerified = true })

  it('reports RUNNER_UNAVAILABLE (state failed, terminal false, runStillQueued) after 10 min queued', async () => {
    queuedPrepare(11)
    const s = await status()
    expect(s).toMatchObject({ state: 'failed', terminal: false })
    expect(s.failure).toMatchObject({ code: 'RUNNER_UNAVAILABLE', retry: 'reship' })
    expect(s.failure.details.runStillQueued).toBe(true)
  })
  it('not reported before 10 min', async () => {
    queuedPrepare(5)
    const s = await status()
    expect(s.state).toBe('queued')
    expect(s.failure).toBeUndefined()
  })
  it('cancel side effect is OFF by default (no cancel call)', async () => {
    queuedPrepare(11)
    await status()
    expect(w.calls.cancel).toBe(0)
  })
  it('publish queued behind another ship of the same app ⇒ queuedBehind, no runner alarm', async () => {
    const r = full({ status: 'in_progress' })
    w.jobs[1000] = [fx.job(r.jid(1), 'prepare', {}), fx.job(r.jid(2), 'build', {}), fx.job(r.jid(3), 'scan', {}), fx.job(r.jid(4), 'publish', { status: 'queued', steps: [], created: iso(Date.now() - 20 * MIN), started: iso(Date.now() - 20 * MIN), completed: undefined })]
    w.runs.push({ id: 7, display_title: fx.runName({ cid: fx.mintAt(t - 60_000), app: 'my-app' }), created_at: iso(t), status: 'in_progress', conclusion: null })
    const s = await status()
    expect(s.queuedBehind).toBe(true)
    expect(s.failure).toBeUndefined()
  })
  it('a queued publish is never auto-cancelled, even with cancel enabled', async () => {
    config.ship.watchdogCancelEnabled = true
    const r = full({ status: 'in_progress' })
    w.jobs[1000] = [fx.job(r.jid(1), 'prepare', {}), fx.job(r.jid(2), 'build', {}), fx.job(r.jid(3), 'scan', {}), fx.job(r.jid(4), 'publish', { status: 'queued', steps: [], created: iso(Date.now() - 20 * MIN), started: iso(Date.now() - 20 * MIN), completed: undefined })]
    const s = await status()
    expect(s.failure.code).toBe('RUNNER_UNAVAILABLE')
    expect(w.calls.cancel).toBe(0)
  })
  it('cancel enabled: only a never-started prepare, only for starter/platform, once per run', async () => {
    config.ship.watchdogCancelEnabled = true
    queuedPrepare(11)
    // repo reader (not starter/platform) ⇒ no cancel
    identity.registerProvider('test', createTestProvider({ links: { [fx.OTHER_OID]: 'octocat' }, permissions: { 'octocat:AyaHealthcare/my-svc': 'read' } }))
    config.ship.identityProvider = 'test'
    await svc.getStatus(cid, { id: fx.OTHER_OID })
    expect(w.calls.cancel).toBe(0)
    await status()
    await status()
    expect(w.calls.cancel).toBe(1)
    expect(w.cancelled).toEqual([1000])
  })
  it('V-4 gate false: nothing is derived (no watchdog report, no queuedBehind)', async () => {
    config.ship.queueSignalsVerified = false
    queuedPrepare(30)
    const s = await status()
    expect(s.state).toBe('queued')
    expect(s.failure).toBeUndefined()
  })
  it('logs ship_watchdog_cancel when the cancel executes', async () => {
    config.ship.watchdogCancelEnabled = true
    queuedPrepare(11)
    const spy = vi.spyOn(logger, 'log')
    await status()
    expect(spy.mock.calls.some((c: any[]) => c[1] === 'ship_watchdog_cancel')).toBe(true)
  })
})

describe('BT-20 SUPERSEDED vs CANCELLED', () => {
  const cancelledNeverPublished = () => {
    const r = full({ conclusion: 'cancelled' })
    r.jobs[3].conclusion = 'cancelled'; r.jobs[3].steps = []; r.jobs[3].started_at = null
    return r
  }
  it('V-4 passed: publish cancelled without ever starting and no cancel recorded ⇒ SUPERSEDED (reship)', async () => {
    config.ship.queueSignalsVerified = true
    cancelledNeverPublished()
    const s = await status()
    expect(s.state).toBe('cancelled')
    expect(s.failure).toMatchObject({ code: 'SUPERSEDED', retry: 'reship' })
  })
  it('a cancel recorded through our endpoint ⇒ CANCELLED', async () => {
    config.ship.queueSignalsVerified = true
    cancelledNeverPublished()
    svc.flagCancelRequested(cid)
    expect((await status()).failure.code).toBe('CANCELLED')
  })
  it('multi-replica: the cancel flag is per process, so either classification is allowed and both are reship', async () => {
    config.ship.queueSignalsVerified = true
    cancelledNeverPublished()
    const f = (await status()).failure
    expect(['CANCELLED', 'SUPERSEDED']).toContain(f.code)
    expect(f.retry).toBe('reship')
  })
  it('V-4 gate false: always CANCELLED', async () => {
    cancelledNeverPublished()
    expect((await status()).failure.code).toBe('CANCELLED')
  })
})

describe('BT-21 metrics', () => {
  it('emits ship_stage_completed/ship_succeeded once per process (de-dup), carrying the ship id', async () => {
    full()
    const spy = vi.spyOn(logger, 'log')
    await status()
    svc.invalidate(cid)
    await status()
    const events = spy.mock.calls.map((c: any[]) => c[1])
    expect(events.filter((e: string) => e === 'ship_succeeded')).toHaveLength(1)
    expect(events.filter((e: string) => e === 'ship_stage_completed').length).toBe(7)
    const ev = spy.mock.calls.find((c: any[]) => c[1] === 'ship_succeeded') as any[]
    expect(ev[2].correlation_id).toBe(cid)
  })
  it('emits ship_failed{code} and ship_annotation_rejected{reason}', async () => {
    const r = full({ conclusion: 'failure', failAt: 'scan' })
    w.anns[r.jid(3)].push(fx.annotation('scan', fx.payloads.scan({ cid, id: 1000, attempt: 1 })))
    const spy = vi.spyOn(logger, 'log')
    await status()
    const calls = spy.mock.calls as any[]
    expect(calls.some((c) => c[1] === 'ship_failed' && c[2].code === 'UNKNOWN')).toBe(true)
    expect(calls.some((c) => c[1] === 'ship_annotation_rejected' && c[2].reason === 'duplicate')).toBe(true)
  })
})

describe('BT-23 buildPreviewUrl', () => {
  beforeEach(() => { config.ship.previewHosts = {} })
  it('pending without a PR number', () => { expect(svc.buildPreviewUrl('devsand', undefined, 'a')).toEqual({ state: 'pending' }) })
  it('not_configured when the env has no host (H-1 open) — never a default domain', () => {
    expect(svc.buildPreviewUrl('devsand', 7, 'a')).toEqual({ state: 'not_configured' })
  })
  it('available from config only', () => {
    config.ship.previewHosts = { devsand: { suffix: 'apps.example.test', scheme: 'https' } }
    expect(svc.buildPreviewUrl('devsand', 7, 'my-app')).toEqual({ state: 'available', url: 'https://pr-7-my-app.apps.example.test' })
    expect(svc.buildPreviewUrl('sand', 7, 'my-app')).toEqual({ state: 'not_configured' })
  })
  it('rejects a malformed suffix / scheme (defensive)', () => {
    config.ship.previewHosts = { devsand: { suffix: 'x y;z', scheme: 'https' } }
    expect(svc.buildPreviewUrl('devsand', 7, 'a').state).toBe('not_configured')
    config.ship.previewHosts = { devsand: { suffix: 'a.b', scheme: 'ftp' } }
    expect(svc.buildPreviewUrl('devsand', 7, 'a').state).toBe('not_configured')
  })
  it('unavailable_chart when the chart is not preview-capable', () => {
    expect(svc.buildPreviewUrl('devsand', 7, 'a', { previewCapable: false })).toEqual({ state: 'unavailable_chart' })
  })
  it('flows through the status when configured', async () => {
    config.ship.previewHosts = { devsand: { suffix: 'apps.example.test', scheme: 'http' } }
    full()
    w.pr = { number: 7, url: 'https://github.com/x/y/pull/7', state: 'open' }
    expect((await status()).preview).toEqual({ state: 'available', url: 'http://pr-7-my-app.apps.example.test' })
  })
})
