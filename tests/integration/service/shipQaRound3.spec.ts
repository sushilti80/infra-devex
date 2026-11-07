/**
 * QA round 3 (ship-from-repo, final delta re-check of QA-008..QA-011 after Dev rework round 2). Adversarial variants on top of the
 * round-2 specs: JSON-in-JSON built with a real JSON.stringify chain, glued tails, oversized lines that carry a secret (replaced
 * whole), false-positive sanity, and de-dup flags under a two-user 2 100-lookup flood (ship_succeeded / ship_stage_completed / ship_failed
 * emitted once). `QA-012` (3+ nesting levels) was an `it.fails` repro, now a plain `it`.
 * Secret-shaped fixtures are assembled at runtime so secret scanners do not flag this file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'

process.env.GITHUB_APP_ID = ''
process.env.GITHUB_INSTALLATION_ID = ''
const cjsRequire = createRequire(import.meta.url)
const { redactText, redactLine, REPLACEMENT } = cjsRequire('../../../utils/logRedactor')
const { createHarness } = cjsRequire('../../helpers/shipQaHarness')
const h = createHarness()
const { config, githubService, ship, fx, shipStatus } = h

const j = (...p: string[]) => p.join('')
const VALUE = j('Zq81', 'xLm2', '0aBc', 'D3Ef')
const KEYS = [j('pass', 'word'), j('sec', 'ret'), j('tok', 'en'), j('api', '_key'), j('client', '_sec', 'ret'), 'DB_' + j('PASS', 'WORD'), 'GITHUB_' + j('TOK', 'EN'), j('access', 'Token')]
const MB = 1024 * 1024
const MIN = 60_000
const nest = (levels: number, key: string) => {
  let s = JSON.stringify({ [key]: VALUE, user: 'bob' })
  for (let i = 1; i < levels; i++) s = JSON.stringify({ msg: s, id: i })
  return s
}

describe('QA-010 re-verification: JSON embedded in JSON strings (real JSON.stringify chains)', () => {
  it.each(KEYS)('1 and 2 levels of embedding redact the value of %s and keep the neighbour', (key) => {
    for (const levels of [1, 2]) {
      const out = redactText(nest(levels, key))
      expect(out, `${key} level ${levels}`).not.toContain(VALUE)
      expect(out).toContain('bob')
    }
  })

  it('single-escaped quote forms: eq/colon separators, single quotes, spaced value, escaped quote inside the value', () => {
    const e = '\\"'
    for (const l of [`${e}${KEYS[0]}${e}=${e}${VALUE}${e}`, `\\'${KEYS[0]}\\': \\'${VALUE}\\'`, `${e}${KEYS[0]}${e}: ${e}two ${VALUE} words${e} rest`, `${e}${KEYS[0]}${e}:${e}a\\\\${e}${VALUE}${e}`]) {
      const out = redactText(l)
      expect(out, l).not.toContain(VALUE)
      expect(out, l).not.toContain('words')
    }
  })

  // Three or more levels of JSON-in-JSON-string leave key AND value in clear: the key is followed by two+ backslashes before
  // the quote, but the generic pattern allows exactly one (`\\?["']`). Not covered by QA-010's fix (one level).
  it('[QA-012 fixed] a secret inside 3+ levels of JSON-in-JSON-string (\\\\\\"password\\\\\\":\\\\\\"v\\\\\\") is redacted', () => {
    for (const levels of [3, 4]) expect(redactText(nest(levels, KEYS[0])), `level ${levels}`).not.toContain(VALUE)
  })
})

describe('QA-011 re-verification: glued tails', () => {
  const k = KEYS[0]
  it.each([
    [`${k}="${VALUE}"tailX9`, ['tailX9']],
    [`${k}='${VALUE}'tailX9`, ['tailX9']],
    [`${k}="${VALUE}""moreX9"`, ['moreX9']],
    [`${k}="${VALUE}"$(whoami)`, ['whoami']],
    [`${k}="${VALUE}"'moreX9'`, ['moreX9']],
    [`\\"${k}\\":\\"${VALUE}\\"tailX9`, ['tailX9']],
    [`export ${KEYS[2].toUpperCase()}="${VALUE}"tailX9`, ['tailX9']],
  ])('%s', (line, gone) => {
    const out = redactText(line as string)
    for (const g of [VALUE, ...(gone as string[])]) expect(out).not.toContain(g)
  })

  it('JSON/list delimiters still end the redaction, so structural neighbours survive', () => {
    expect(redactText(`{"${k}":"${VALUE}","user":"bob","n":1}`)).toContain('"user":"bob","n":1}')
    expect(redactText(`{"${k}":"${VALUE}"}`)).toMatch(/\}$/)
    expect(redactText(`(${k}="${VALUE}")`)).toMatch(/\)$/)
    expect(redactText(`\\"${k}\\":\\"${VALUE}\\",\\"keep\\":1`)).toContain('keep')
    expect(redactText(`${k}="${VALUE}"\tother`)).toContain('other')
  })
})

describe('QA-009 re-verification: oversized lines fail closed per line', () => {
  const ghp = j('gh', 'p_')
  const shapes: Array<[string, (n: number) => string]> = [
    ['github-token run', (n) => ghp + 'a'.repeat(n)],
    ['quoted value', (n) => `${KEYS[0]}="` + 'a'.repeat(n)],
    ['jwt-ish run', (n) => 'eyJ-'.repeat(n / 4)],
  ]
  it.each([6, 20])('%i MB line that also holds a secret: never throws, secret never survives, neighbours stay readable and redacted', (mb) => {
    for (const [name, make] of shapes) {
      const big = `${KEYS[1]}=${VALUE} ` + make(mb * MB) + ` ${KEYS[1]}=${VALUE}`
      const text = [`before ${KEYS[0]}=${VALUE}`, big, 'plain after', `${KEYS[2]}: ${VALUE}`].join('\n')
      let out = ''
      expect(() => { out = redactText(text) }, name).not.toThrow()
      const lines = out.split('\n')
      expect(out, name).not.toContain(VALUE)
      expect(lines).toHaveLength(4)
      expect(lines[1], name).toContain(REPLACEMENT) // either redacted in place or replaced whole (RangeError path); never in clear
      expect(lines[2]).toBe('plain after')
      expect(lines[0]).toBe(`before ${REPLACEMENT}`)
    }
  }, 60_000)

  it('is deterministic and idempotent, and a line below the failure size keeps its structure', () => {
    const text = ['a', ghp + 'a'.repeat(7 * MB), 'b'].join('\n')
    expect(redactText(text)).toBe(redactText(text))
    expect(redactText(redactText(text))).toBe(redactText(text))
    expect(redactLine('x'.repeat(MB))).toBe('x'.repeat(MB))
    expect(redactText(`${KEYS[1]}=${VALUE} ` + ghp + 'a'.repeat(8 * MB))).toBe(REPLACEMENT) // RangeError path: the whole line, secret included, is replaced
  }, 30_000)
})

describe('false-positive sanity after the QA-009/010/011 pattern changes', () => {
  it.each([
    'npm WARN deprecated token-bucket@1.0.0', 'Run actions/checkout@v4', 'secretariat meeting notes', 'tokenizer: loaded 1000 tokens', 'passwordless login enabled',
    'Using cache key: v1-deps-abc', '{"user":"bob","path":"/tmp/x"}', 'error: "unexpected token" at line 3', '2026-10-22T14:06:00Z ##[group]Run docker build', 'Step 4/10 : RUN npm ci',
  ])('unchanged: %s', (line) => { expect(redactText(line)).toBe(line) })
})

describe('QA-008 re-verification: de-dup flags survive a two-user 2 100-lookup fresh-ID flood', () => {
  const MS = (n: number) => n * MIN
  let w: any
  beforeEach(() => {
    w = fx.makeWorld(githubService)
    h.wire(w)
    config.ship.identityProvider = 'test'
    Object.assign(config.ship, { maxStartsPerHour: 99, maxActiveGlobal: 99, maxActivePerUser: 99, maxStartsPerUserPerHour: 99, rateLimitGuardRemaining: 1000 })
    githubService.getRateLimitSnapshot = () => null
  })
  afterEach(() => { vi.restoreAllMocks() })
  const fresh = (i: number) => fx.mintAt(Date.now() - 1000 - i * 3)

  it('ship_succeeded and ship_stage_completed are emitted once each, however many fresh lookups follow', async () => {
    const t = Date.now() - MS(240)
    const cid = fx.mintAt(t)
    fx.buildRun(w, { cid, id: 1000, createdAt: new Date(t + 5000).toISOString() })
    const logs = h.captureLogs()
    try {
      expect((await ship('GET', `/status/${cid}`, { token: 'sam' })).statusCode).toBe(200)
      const count = (ev: string) => logs.lines.filter((l: string) => l.includes(ev) && l.includes(cid)).length
      const before = { ok: count('ship_succeeded'), stage: count('ship_stage_completed') }
      expect(before.ok).toBe(1)
      for (let i = 0; i < 2100; i++) await ship('GET', `/status/${fresh(i)}`, { token: i % 2 ? 'stranger' : 'admin' })
      shipStatus.invalidate(cid)
      expect((await ship('GET', `/status/${cid}`, { token: 'sam' })).statusCode).toBe(200)
      expect(count('ship_succeeded')).toBe(1)
      expect(count('ship_stage_completed')).toBe(before.stage)
    } finally { logs.stop() }
  }, 60_000)
})
