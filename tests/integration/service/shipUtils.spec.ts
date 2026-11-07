/**
 * BT-26 (shipId), BT-14 (single-flight cache), BT-15 (redaction) — ship-from-repo spec §9.1.
 */
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { v4 as uuidv4 } from 'uuid'

const cjsRequire = createRequire(import.meta.url)
const shipId = cjsRequire('../../../utils/shipId')
const TtlSingleFlightCache = cjsRequire('../../../utils/ttlSingleFlightCache')
const { redactText, redactLine, stripAnsi, REPLACEMENT, PATTERNS } = cjsRequire('../../../utils/logRedactor')

const { v7 } = cjsRequire('uuid')
const idAt = (ms: number) => v7({ msecs: ms })

describe('BT-26 shipId', () => {
  it('mints RFC 9562 UUIDv7 (version 7, variant 8-b)', () => {
    const id = shipId.mintShipId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(shipId.isShipId(id)).toBe(true)
  })

  it('embedded timestamp follows the wall clock, even after the clock was moved forward and back (stateless mint)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 3_600_000)
    shipId.mintShipId()
    vi.useRealTimers()
    expect(Math.abs(shipId.shipIdTimestamp(shipId.mintShipId()) - Date.now())).toBeLessThan(1000)
  })

  it('two IDs minted in the same millisecond differ (random tail)', () => {
    const a = idAt(1_700_000_000_000)
    const b = idAt(1_700_000_000_000)
    expect(a).not.toBe(b)
    expect(shipId.shipIdTimestamp(a)).toBe(shipId.shipIdTimestamp(b))
  })

  it('extracts the embedded timestamp', () => {
    expect(shipId.shipIdTimestamp(idAt(1_700_000_123_456))).toBe(1_700_000_123_456)
  })

  it('rejects v4 and other versions / junk', () => {
    expect(shipId.isShipId(uuidv4())).toBe(false)
    expect(shipId.isShipId('not-a-uuid')).toBe(false)
    expect(shipId.isShipId(undefined)).toBe(false)
    expect(shipId.isShipId(idAt(1).toUpperCase())).toBe(false)
    expect(() => shipId.shipIdTimestamp(uuidv4())).toThrow()
    expect(shipId.classifyShipId(uuidv4())).toBe('invalid')
  })

  it('classifies future / expired / ok with ASM-13 skew boundaries (now + 119 s ok, + 121 s future)', () => {
    const now = 1_800_000_000_000
    expect(shipId.classifyShipId(idAt(now + 119_000), { now })).toBe('ok')
    expect(shipId.classifyShipId(idAt(now + 121_000), { now })).toBe('future')
    expect(shipId.classifyShipId(idAt(now - 89 * 86_400_000), { now, retentionDays: 90 })).toBe('ok')
    expect(shipId.classifyShipId(idAt(now - 91 * 86_400_000), { now, retentionDays: 90 })).toBe('expired')
  })

  it('derives the run window from the ID: lower bound t − 180 s, upper min(now, t + retry + 1 h)', () => {
    const t = 1_800_000_000_000 // whole second
    const id = idAt(t)
    const w = shipId.runSearchWindow(id, { now: t + 30 * 86_400_000, retryWindowHours: 24 })
    expect(Date.parse(w.from)).toBe(t - 180_000)
    expect(Date.parse(w.to)).toBe(t + 25 * 3_600_000)
    expect(w.created).toBe(`${w.from}..${w.to}`)
    // young ship: upper bound is now
    const young = shipId.runSearchWindow(id, { now: t + 60_000, retryWindowHours: 24 })
    expect(Date.parse(young.to)).toBe(t + 60_000)
  })

  it('a run created at t − 179 s is inside the window, t − 181 s is outside (fast replica skew)', () => {
    const t = 1_800_000_000_000
    const w = shipId.runSearchWindow(idAt(t), { now: t + 60_000 })
    const from = Date.parse(w.from)
    expect(t - 179_000).toBeGreaterThanOrEqual(from)
    expect(t - 181_000).toBeLessThan(from)
    // replica 119 s fast: run created_at = t − 119 s + 20 s is found
    expect(t - 119_000 + 20_000).toBeGreaterThanOrEqual(from)
  })

  it('floors the lower bound to whole seconds (window only ever widens)', () => {
    const t = 1_800_000_000_500
    const w = shipId.runSearchWindow(idAt(t), { now: t + 1000 })
    expect(Date.parse(w.from)).toBeLessThanOrEqual(t - 180_000)
    expect(t - 180_000 - Date.parse(w.from)).toBeLessThan(1000)
  })
})

describe('BT-14 TtlSingleFlightCache', () => {
  it('N concurrent callers share one upstream call', async () => {
    const cache = new TtlSingleFlightCache()
    let calls = 0
    const loader = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return 'v' }
    const results = await Promise.all(Array.from({ length: 10 }, () => cache.get('k', loader, 1000)))
    expect(results).toEqual(Array(10).fill('v'))
    expect(calls).toBe(1)
  })

  it('serves from cache until the TTL expires, then reloads', async () => {
    let t = 0
    const cache = new TtlSingleFlightCache({ now: () => t })
    let calls = 0
    const loader = async () => ++calls
    expect(await cache.get('k', loader, 10_000)).toBe(1)
    t = 9_999
    expect(await cache.get('k', loader, 10_000)).toBe(1)
    t = 10_001
    expect(await cache.get('k', loader, 10_000)).toBe(2)
  })

  it('TTL can depend on the value (10 s running / 60 s terminal) and 0 disables caching', async () => {
    let t = 0
    const cache = new TtlSingleFlightCache({ now: () => t })
    let n = 0
    const ttl = (v: { terminal: boolean }) => (v.terminal ? 60_000 : 10_000)
    await cache.get('run', async () => ({ terminal: false, n: ++n }), ttl)
    t = 11_000
    expect((await cache.get('run', async () => ({ terminal: true, n: ++n }), ttl)).n).toBe(2)
    t = 50_000
    expect((await cache.get('run', async () => ({ terminal: true, n: ++n }), ttl)).n).toBe(2)
    await cache.get('nocache', async () => ++n, 0)
    expect(await cache.get('nocache', async () => ++n, 0)).toBe(4)
  })

  it('does not cache failures; next caller retries', async () => {
    const cache = new TtlSingleFlightCache()
    let calls = 0
    await expect(cache.get('k', async () => { calls++; throw new Error('boom') }, 1000)).rejects.toThrow('boom')
    expect(await cache.get('k', async () => { calls++; return 'ok' }, 1000)).toBe('ok')
    expect(calls).toBe(2)
  })

  it('evicts least-recently-used beyond max', async () => {
    const cache = new TtlSingleFlightCache({ max: 2 })
    cache.set('a', 1, 1000); cache.set('b', 2, 1000)
    cache.peek('a') // a is now most recent
    cache.set('c', 3, 1000)
    expect(cache.peek('b')).toBeUndefined()
    expect(cache.peek('a')).toBe(1)
    expect(cache.peek('c')).toBe(3)
  })
})

describe('BT-15 logRedactor', () => {
  // Fake secrets are assembled at runtime so no secret-shaped literal lives in the repo (gitleaks).
  const rep = (c: string, n: number) => c.repeat(n)
  const GH = 'gh' + 'p_' + rep('a1', 18)
  const AWS = 'AK' + 'IA' + rep('Q7', 8)
  const JWT = ['ey' + 'JhbGciOiJIUzI1NiJ9', 'ey' + 'JzdWIiOiIxMjM0In0', rep('s', 20)].join('.')
  const NPM = '_auth' + 'Token=' + rep('n9', 8)
  const secrets: Array<[string, string]> = [
    ['github token', `token ${GH}`],
    ['github pat', 'x github' + '_pat_' + rep('Ab1', 14)],
    ['bearer header', ['Authorization:', 'Bear' + 'er', 'abc.def-ghi'].join(' ')],
    ['basic header', ['authorization:', 'Ba' + 'sic', 'dXNlcjpwYXNz'].join(' ')],
    ['url userinfo', ['cloning https:', '', ['us' + 'er', 'hunt' + 'er2'].join(':') + '@github.com/o/r.git'].join('/')],
    ['aws key', `key ${AWS} end`],
    ['azure account key', 'DefaultEndpointsProtocol=https;Account' + 'Key=abc123+/==;EndpointSuffix=core'],
    ['sas sig', 'https://x.blob.core.windows.net/c?sv=1&s' + 'ig=AbCdEf12%2Bxyz%3D'],
    ['jwt', `tok ${JWT}`],
    ['slack', 'xo' + 'xb-1234567890-abcdefghij'],
    ['npm', `//registry.npmjs.org/:${NPM}`],
    ['generic password', 'pass' + 'word: s3cr3t!'],
    ['generic api key', 'api' + '_key=XYZ123'],
    ['client secret', 'client' + '-secret = abcd'],
    ['wiz secret env', 'WIZ_CLIENT' + '_SECRET=abcdef'],
  ]

  it('has at least 10 patterns', () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(10)
  })

  it.each(secrets)('redacts %s', (_name, line) => {
    const out = redactLine(line)
    expect(out).toContain(REPLACEMENT)
    expect(out).not.toMatch(/hunter2|s3cr3t|abc123\+|XYZ123/)
    expect(out).not.toContain(GH)
    expect(out).not.toContain(AWS)
    expect(out).not.toContain(rep('n9', 8))
  })

  it('redacts PEM private key blocks across lines', () => {
    const dash = '-----'
    const text = ['before', `${dash}BEGIN RSA PRIVATE ` + `KEY${dash}`, 'MIIEowIBAAKCAQEA', `${dash}END RSA PRIVATE ` + `KEY${dash}`, 'after'].join('\n')
    const out = redactText(text)
    expect(out).not.toContain('MIIEowIBAAKCAQEA')
    expect(out.split('\n')[0]).toBe('before')
    expect(out.split('\n')[4]).toBe('after')
  })

  it('strips ANSI escapes first', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m \u001b[1;32mok\u001b[0m')).toBe('red ok')
  })

  it('leaves ordinary text untouched', () => {
    expect(redactText('Step 3/7 : RUN npm ci\nadded 120 packages')).toBe('Step 3/7 : RUN npm ci\nadded 120 packages')
  })

  it('is offset-stable for append-only logs (redacted prefix is a prefix of the redacted whole)', () => {
    const dash = '-----'
    const log = ['line one', 'tok' + 'en=abc123', `${dash}BEGIN PRIVATE ` + `KEY${dash}`, 'KEYDATA', `${dash}END PRIVATE ` + `KEY${dash}`, 'tail ' + 'gh' + 'p_' + 'a1'.repeat(18)].join('\n')
    const whole = redactText(log)
    for (const cut of [2, 3, 4, 5]) {
      const prefix = log.split('\n').slice(0, cut).join('\n')
      expect(whole.startsWith(redactText(prefix))).toBe(true)
    }
  })
})
