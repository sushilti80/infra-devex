/**
 * QA round 4 (ship-from-repo, FINAL delta re-check of QA-012 and O-7 after Dev rework round 3, commits 0268ff6 / ea91c45).
 *  - QA-012: real JSON.stringify nesting 1..4 (inside the declared 0-7 backslash bound), literal 0..7 backslash forms, the
 *    documented limit (8+ backslashes = 5+ real nesting levels), neighbour readability, false-positive sanity, linear time on
 *    hostile shapes with long backslash runs (the new `\\{0,7}` quantifier next to the other quantifiers).
 *  - `[DEFECT QA-013]` (fixed in rework round 4; was `it.fails`): a multi-word quoted value inside 3-4 levels of
 *    JSON-in-JSON-string is redacted whole, not only up to its first space.
 *  - O-7: githubService.findPullRequestForBranch emits `github_api_call` through _infraCall (success and failure paths,
 *    correlation id, request arguments, result mapping, unchanged 3-argument callers).
 * Secret-shaped fixtures are assembled at runtime so secret scanners do not flag this file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'

process.env.GITHUB_APP_ID = ''
process.env.GITHUB_INSTALLATION_ID = ''
const cjsRequire = createRequire(import.meta.url)
const { redactText, redactLine, REPLACEMENT } = cjsRequire('../../../utils/logRedactor')
const githubService = cjsRequire('../../../services/githubService')
const logger = cjsRequire('../../../utils/logger')

const j = (...p: string[]) => p.join('')
const VALUE = j('Zq81', 'xLm2', '0aBc', 'D3Ef')
const KEYS = [j('pass', 'word'), j('pass', 'wd'), j('sec', 'ret'), j('tok', 'en'), j('api', '_key'), j('api', 'Key'), j('client', '_sec', 'ret'), 'DB_' + j('PASS', 'WORD'), 'GITHUB_' + j('TOK', 'EN'), j('access', '_tok', 'en'), j('api', '-key')]
const BS = (n: number) => '\\'.repeat(n)
const nest = (levels: number, key: string, value = VALUE) => {
  let s = JSON.stringify({ before: 'b4', [key]: value, nb: 'keepme', after: 'af' })
  for (let i = 1; i < levels; i++) s = JSON.stringify({ msg: s, tail: 'ok' })
  return 'log: ' + s
}
const ms = (fn: () => void) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6 }

describe('QA-012 re-verification: real JSON.stringify nesting', () => {
  it.each(KEYS)('%s: value redacted and the field BEFORE it stays readable at nesting levels 1-4', (key) => {
    for (const levels of [1, 2, 3, 4]) {
      const out = redactText(nest(levels, key))
      expect(out, `${key} level ${levels}`).not.toContain(VALUE)
      expect(out, `${key} level ${levels}`).toContain(REPLACEMENT)
      expect(out, `${key} level ${levels} neighbour before`).toContain('b4')
    }
  })

  it('neighbour fields AFTER the secret stay readable at levels 1-2 (levels 3-4 over-redact the rest of the line: safe-side, not a leak)', () => {
    for (const levels of [1, 2]) expect(redactText(nest(levels, KEYS[0]))).toContain('keepme')
    for (const levels of [3, 4]) expect(redactText(nest(levels, KEYS[0]))).not.toContain(VALUE)
  })

  it('a secret as the LAST key (nothing after it) is redacted at levels 1-4 and everything before it survives', () => {
    for (let levels = 1; levels <= 4; levels++) {
      let s = JSON.stringify({ user: 'bob', [KEYS[0]]: VALUE })
      for (let i = 1; i < levels; i++) s = JSON.stringify({ msg: s })
      const out = redactText(s)
      expect(out).not.toContain(VALUE)
      expect(out).toContain('bob')
    }
  })

  it('several secrets in one nested line (level 3): the first is redacted and no later secret key is exposed with its value', () => {
    let s = JSON.stringify({ [KEYS[0]]: VALUE, [KEYS[3]]: VALUE + '2' })
    for (let i = 1; i < 3; i++) s = JSON.stringify({ msg: s })
    const out = redactText(s)
    expect(out).not.toContain(VALUE)
  })

  it('[documented limit] 5 real nesting levels (15 backslashes before the quote) is outside the declared 0-7 bound and is NOT redacted', () => {
    // Characterisation test of the declared bound, not an endorsement: if the bound is ever widened this assertion must flip.
    expect(redactText(nest(5, KEYS[0]))).toContain(VALUE)
  })
})

describe('QA-012 re-verification: literal backslash counts before the quote', () => {
  const forms = (n: number, key: string) => {
    const b = BS(n)
    return [
      `x ${b}"${key}${b}":${b}"${VALUE}${b}" , ${b}"other${b}":${b}"keepme${b}"`,
      `${b}'${key}${b}': ${b}'${VALUE}${b}'`,
      `${b}"${key}${b}"=${VALUE}`,
      `{${b}"${key}${b}": "${VALUE}"}`,
    ]
  }
  it.each([0, 1, 2, 3, 4, 5, 6, 7])('%i backslashes: every form redacts the value of every key', (n) => {
    for (const key of KEYS) for (const line of forms(n, key)) expect(redactLine(line), `${n} bs, ${key}: ${line}`).not.toContain(VALUE)
  })
  it.each([1, 2, 3, 4, 7])('%i backslashes: the field before the key stays readable', (n) => {
    const b = BS(n)
    const out = redactLine(`${b}"first${b}":${b}"1${b}", ${b}"${KEYS[0]}${b}":${b}"${VALUE}${b}"`)
    expect(out).toContain('first')
    expect(out).not.toContain(VALUE)
  })
  it.each([8, 9, 12, 16])('%i backslashes (outside the declared 0-7 bound): behaviour is "not redacted" (documented limit, judged acceptable)', (n) => {
    for (const line of forms(n, KEYS[0])) expect(redactLine(line)).toContain(VALUE)
  })
})

describe('[DEFECT QA-013 low] multi-word quoted value inside 3-4 levels of JSON-in-JSON-string', () => {
  const W = [j('alpha', 'Word'), j('beta', 'Word'), j('gamma', 'Word')]
  const MULTI = W.join(' ')
  it('levels 1-2: every word of a multi-word value is redacted (taken whole)', () => {
    for (const levels of [1, 2]) {
      const out = redactText(nest(levels, KEYS[0], MULTI))
      for (const w of W) expect(out, `level ${levels} ${w}`).not.toContain(w)
    }
  })
  it('levels 3-4: every word of a multi-word value is redacted (QA-013 fixed: escaped-value alternative takes 1-7 backslashes)', () => {
    for (const levels of [3, 4]) {
      const out = redactText(nest(levels, KEYS[0], MULTI))
      for (const w of W) expect(out, `level ${levels} ${w}`).not.toContain(w)
    }
  })
})

describe('no regression and false-positive sanity around the widened quote group', () => {
  it('benign lines that mention keywords and backslashes are unchanged', () => {
    for (const l of [
      'C:\\work\\password\\notes.txt', 'path \\\\server\\share\\token', j('the pass', 'word field is optional'), 'token budget exceeded? no',
      'regex /\\\\"x\\\\"/ matched', 'echo "hello \\"world\\""', 'Step 3/7 : RUN npm ci', 'secret-santa list updated', 'api key rotation docs',
      `JSON {"user":"bob","id":7}`, 'escaped \\\\\\\\\\\\\\\\ run of eight', 'sha256:' + 'a'.repeat(64),
    ]) expect(redactText(l), l).toBe(l)
  })
  it('round 1-3 forms still redact: plain, prefixed env var, JSON, escaped JSON, quoted-with-spaces, glued tail, header, userinfo, PEM', () => {
    const cases: Array<[string, string]> = [
      [j('pass', 'word=', VALUE), VALUE],
      [j('export GITHUB_', 'TOKEN=', VALUE), VALUE],
      [j('{"pass', 'word":"', VALUE, '"}'), VALUE],
      [j('\\"pass', 'word\\":\\"', VALUE, '\\"'), VALUE],
      [j('pass', 'word: "my ', VALUE, ' phrase"'), VALUE],
      [j('pass', 'word="', VALUE, '"$(echo x)'), VALUE],
      [j('Authorization: Bea', 'rer ', VALUE), VALUE],
      [j('clone https:', '//u:', VALUE, '@h.io/x'), VALUE],
    ]
    for (const [line, secret] of cases) expect(redactText(line), line).not.toContain(secret)
    const pem = redactText([j('-----BEG', 'IN PRIV', 'ATE KEY-----'), VALUE, j('-----E', 'ND PRIV', 'ATE KEY-----'), 'after'].join('\n'))
    expect(pem).not.toContain(VALUE)
    expect(pem.endsWith('\nafter')).toBe(true)
  })
  it('redaction is idempotent and deterministic on nested lines', () => {
    for (let levels = 1; levels <= 4; levels++) {
      const once = redactText(nest(levels, KEYS[0]))
      expect(redactText(nest(levels, KEYS[0]))).toBe(once)
      expect(redactText(once)).toBe(once)
    }
  })
})

describe('ReDoS: the 0-7 backslash quantifier next to the other quantifiers stays linear', () => {
  const kw = j('pass', 'word')
  const shapes: Record<string, string> = {
    'backslash run': BS(1000),
    'keyword + backslash run': kw + BS(1000),
    'keyword + 7 bs + quote': kw + BS(7) + '"',
    'keyword + 8 bs + quote': kw + BS(8) + '"',
    'keyword + 7 bs + quote + space (no separator)': kw + BS(7) + '" ',
    'keyword + 7 bs + quote + colon + 7 bs + quote': kw + BS(7) + '":' + BS(7) + '"',
    'keyword_ + 32 chars + 7 bs + quote': kw + '_' + 'a'.repeat(32) + BS(7) + '"',
    'keyword- + 33 chars + 7 bs + quote + colon': 'token-' + 'a'.repeat(33) + BS(7) + '":',
    'keyword: + 9 bs (no quote)': kw + ':' + BS(9),
    'keyword= + escaped quote, unterminated': kw + '=' + BS(1) + '"abc',
    'secret= + 3 bs + quote': 'secret=' + BS(3) + '"xxxxx',
    'keyword + 7 bs + quote + 50 spaces + colon': kw + BS(7) + '"' + ' '.repeat(50) + ':',
    'tokentoken': 'token',
    'secret-': 'secret-',
    'eyJ-': 'eyJ-',
    mixed: kw + BS(7) + '"' + BS(3) + '"token_' + BS(7) + "'api-key" + BS(2),
  }
  it.each(Object.entries(shapes))('%s: 200 KB and 1 MB lines are redacted in well under a second', (_n, unit) => {
    for (const size of [200_000, 1_000_000]) {
      const line = unit.repeat(Math.ceil(size / unit.length)).slice(0, size)
      expect(ms(() => redactLine(line)), `${_n} @${size}`).toBeLessThan(500)
    }
  })
  it('scaling guard: 4x the input costs well under 16x the time on the nested-escape shape', () => {
    const unit = kw + BS(7) + '":' + BS(7) + '"v' + BS(7) + '" '
    const make = (n: number) => unit.repeat(Math.ceil(n / unit.length))
    redactLine(make(50_000)) // warm up
    const small = Math.max(ms(() => redactLine(make(250_000))), 1)
    const big = ms(() => redactLine(make(1_000_000)))
    expect(big).toBeLessThan(small * 16)
    expect(big).toBeLessThan(1500)
  })
  it('a 1 MB backslash run followed by a real secret is still redacted quickly', () => {
    const line = BS(1_000_000) + j('"pass', 'word":"', VALUE, '"')
    let out = ''
    expect(ms(() => { out = redactLine(line) })).toBeLessThan(500)
    expect(out).not.toContain(VALUE)
  })
  it('20 000 lines of escaped-JSON secrets redact in well under a second', () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => kw + BS(7) + '":' + BS(7) + '"v' + i + BS(7) + '" tail')
    expect(ms(() => redactText(lines.join('\n')))).toBeLessThan(1500)
  })
})

describe('O-7: githubService.findPullRequestForBranch emits github_api_call', () => {
  const REPO = 'Aya-DevOpsTeam/aya-flux'
  const CID = '0194a000-0000-7000-8000-0000000000a7'
  let impl: ((a: any) => any) | undefined
  let listArgs: any[]
  let spy: any
  const apiCalls = () => spy.mock.calls.filter((c: any[]) => c[1] === 'github_api_call').map((c: any[]) => ({ level: c[0], ...c[2] }))
  const pr = (over: any = {}) => ({ number: 7, html_url: 'https://example.test/pr/7', state: 'open', merged_at: null, ...over })
  const err = (status?: number, message = 'boom') => { const e: any = new Error(message); if (status !== undefined) e.status = status; return e }

  beforeEach(() => {
    impl = undefined
    listArgs = []
    githubService.octokit = { rest: { pulls: { list: async (a: any) => { listArgs.push(a); if (impl) return impl(a); return { data: [pr()] } } } } }
    spy = vi.spyOn(logger, 'log')
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('success: one info metric with operation, repo, duration, success and the supplied correlation id; mapping unchanged', async () => {
    expect(await githubService.findPullRequestForBranch(REPO, 'auto/gen-dev-app', 'all', CID)).toEqual({ number: 7, url: 'https://example.test/pr/7', state: 'open' })
    const calls = apiCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ level: 'info', operation: 'findPullRequestForBranch', repo: REPO, success: true, correlation_id: CID })
    expect(typeof calls[0].duration_ms).toBe('number')
    expect(calls[0].duration_ms).toBeGreaterThanOrEqual(0)
    expect(calls[0].status_code).toBeUndefined()
  })

  it('request arguments are unchanged: owner/repo split, head=<owner>:<branch>, requested state, per_page 1', async () => {
    await githubService.findPullRequestForBranch(REPO, 'auto/gen-dev-app', 'open', CID)
    expect(listArgs).toEqual([{ owner: 'Aya-DevOpsTeam', repo: 'aya-flux', head: 'Aya-DevOpsTeam:auto/gen-dev-app', state: 'open', per_page: 1 }])
  })

  it('the default state is still "all" when only 3 arguments are passed (existing callers: aksService, shipStatusService)', async () => {
    expect(await githubService.findPullRequestForBranch(REPO, 'auto/gen-dev-app')).toMatchObject({ number: 7 })
    await githubService.findPullRequestForBranch(REPO, 'auto/gen-dev-app', 'all')
    expect(listArgs.map((a) => a.state)).toEqual(['all', 'all'])
  })

  it('without a correlation id the metric falls back to "unknown" (existing pattern), for 2- and 3-argument callers', async () => {
    await githubService.findPullRequestForBranch(REPO, 'b')
    await githubService.findPullRequestForBranch(REPO, 'b', 'all')
    expect(apiCalls().map((c: any) => c.correlation_id)).toEqual(['unknown', 'unknown'])
  })

  it('maps merged / closed / open / none exactly as before (and still emits a success metric for each)', async () => {
    const cases: Array<[any[], any]> = [
      [[pr({ state: 'closed', merged_at: '2026-01-01T00:00:00Z' })], { number: 7, url: 'https://example.test/pr/7', state: 'merged' }],
      [[pr({ state: 'closed' })], { number: 7, url: 'https://example.test/pr/7', state: 'closed' }],
      [[pr()], { number: 7, url: 'https://example.test/pr/7', state: 'open' }],
      [[], null],
    ]
    for (const [data, expected] of cases) {
      impl = () => ({ data })
      expect(await githubService.findPullRequestForBranch(REPO, 'b', 'all', CID)).toEqual(expected)
    }
    expect(apiCalls().filter((c: any) => c.success === true)).toHaveLength(4)
  })

  it.each([[404, 'warn'], [422, 'warn'], [403, 'warn'], [500, 'error'], [502, 'error']])('failure with status %i: metric level %s, status_code kept, the SAME error is rethrown', async (status, level) => {
    const e = err(status as number, 'upstream said no')
    impl = () => { throw e }
    await expect(githubService.findPullRequestForBranch(REPO, 'b', 'all', CID)).rejects.toBe(e)
    const calls = apiCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ level, operation: 'findPullRequestForBranch', repo: REPO, success: false, status_code: status, correlation_id: CID, error: 'upstream said no' })
  })

  it('a network error without a numeric status is an error-level metric with no status_code, and is rethrown', async () => {
    const e = err(undefined, 'socket hang up')
    impl = () => { throw e }
    await expect(githubService.findPullRequestForBranch(REPO, 'b', 'all', CID)).rejects.toBe(e)
    expect(apiCalls()[0]).toMatchObject({ level: 'error', success: false, error: 'socket hang up', correlation_id: CID })
    expect(apiCalls()[0].status_code).toBeUndefined()
  })

  it('an uninitialised Infrastructure App client still rejects with the same message and now also emits a failure metric', async () => {
    githubService.octokit = null
    await expect(githubService.findPullRequestForBranch(REPO, 'b', 'all', CID)).rejects.toThrow('GitHub client not initialized')
    expect(apiCalls()).toEqual([expect.objectContaining({ operation: 'findPullRequestForBranch', success: false, level: 'error', correlation_id: CID })])
  })

  it('one lookup emits exactly one metric (no double counting) and concurrent lookups keep their own correlation ids', async () => {
    await Promise.all(['c1', 'c2', 'c3'].map((cid) => githubService.findPullRequestForBranch(REPO, 'b', 'all', cid)))
    expect(apiCalls().map((c: any) => c.correlation_id).sort()).toEqual(['c1', 'c2', 'c3'])
  })

  it('the metric never carries the branch name or PR url (no unexpected data in the log line)', async () => {
    await githubService.findPullRequestForBranch(REPO, 'auto/gen-dev-secret-branch', 'all', CID)
    expect(JSON.stringify(apiCalls())).not.toContain('secret-branch')
    expect(JSON.stringify(apiCalls())).not.toContain('example.test')
  })
})
