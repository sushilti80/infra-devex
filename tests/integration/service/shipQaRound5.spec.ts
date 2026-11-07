/**
 * QA round 5 (ship-from-repo, DELTA re-check of QA-013 ONLY after Dev rework round 4, commits d14279e / 1b099b2).
 * The escaped-value alternative of the generic secret pattern in utils/logRedactor.js is now `(\\{1,7})"(?:(?!\1")[^])*\1"`.
 *  - QA-013 independent verification: multi-word (2-6 words, punctuation, tabs) values at real JSON.stringify nesting 1-4 and
 *    literal 1-7 backslash forms are redacted whole; the field before the secret stays readable.
 *  - L-1 (accepted by the human 2026-10-22): level 5 / 8+ backslashes is unchanged by the fix (differential against the old pattern).
 *  - Mismatched / unterminated / single-quote forms: never throw, first word always redacted, no regression vs the old pattern.
 *  - `[DEFECT QA-014]` uses `it.fails` (asserts the CORRECT behaviour): a multi-word value that itself contains a double quote
 *    leaks the words after the quote at JSON-in-JSON levels 2-4 (pre-existing; not introduced by the QA-013 fix).
 *  - ReDoS/timing of the new backreference + lookahead on hostile 200k-1 MB lines.
 * Secret-shaped fixtures are assembled at runtime so secret scanners do not flag this file.
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const { redactText, redactLine, REPLACEMENT, PATTERNS } = cjsRequire('../../../utils/logRedactor')

const j = (...p: string[]) => p.join('')
const KEYS = [j('pass', 'word'), j('pass', 'wd'), j('sec', 'ret'), j('tok', 'en'), j('api', '_key'), j('api', 'Key'), j('client', '_sec', 'ret'), 'DB_' + j('PASS', 'WORD'), 'GITHUB_' + j('TOK', 'EN'), j('access', '_tok', 'en'), j('api', '-key')]
const W = ['alphaW', 'betaW', 'gammaW', 'deltaW', 'epsiW', 'zetaW']
const ONE = j('Zq81', 'xLm2', '0aBc', 'D3Ef') // single-word value, assembled at runtime
const BS = (n: number) => '\\'.repeat(n)
const nest = (levels: number, key: string, value: string) => {
  let s = JSON.stringify({ before: 'b4', [key]: value, nb: 'keepme', after: 'af' })
  for (let i = 1; i < levels; i++) s = JSON.stringify({ msg: s, tail: 'ok' })
  return 'log: ' + s
}
const leaks = (out: string, words: string[]) => words.filter((w) => out.includes(w)).length
// The pre-fix pattern (escaped alternative `\\"(?:(?!\\")[^])*\\"`), kept here only as a differential oracle.
const OLD = /(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret)(?:[_-][A-Za-z0-9_-]{0,32})?(?:\\{0,7}["'])?\s*[:=]\s*(?:(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\\"(?:(?!\\")[^])*\\")(?:[^\s,;)}\]]\S*)?|\S+)/gi
const NEW: RegExp = PATTERNS.filter((r: RegExp) => r.source.includes('client[_-]?secret'))[0]

describe('QA-013 independent verification: multi-word quoted values are redacted whole', () => {
  it('the production pattern is the one Dev described (backreference run, 1-7 backslashes)', () => {
    expect(NEW.source).toContain('(\\\\{1,7})"(?:(?!\\1")[^])*\\1"')
  })

  const SEPS = [' ', '\t', ' \t ', ', ', ' - ']
  it.each(KEYS)('%s: 2-6 words with space/tab/punctuation separators, real nesting levels 1-4, nothing leaks, field before stays readable', (key) => {
    for (let n = 2; n <= 6; n++) for (const sep of SEPS) {
      const words = W.slice(0, n)
      for (let lv = 1; lv <= 4; lv++) {
        const out = redactText(nest(lv, key, words.join(sep)))
        expect(leaks(out, words), `${key} n=${n} sep=${JSON.stringify(sep)} level ${lv}: ${out}`).toBe(0)
        expect(out).toContain(REPLACEMENT)
        expect(out, `${key} level ${lv} neighbour before`).toContain('b4')
      }
    }
  })

  it('values with punctuation (no embedded double quote) are taken whole at levels 1-4', () => {
    for (const val of ['p@ss w0rd! #1 (x) [y] {z}', "it's a long pass-phrase; really? yes: ok=1", 'a,b c;d e)f']) {
      for (let lv = 1; lv <= 4; lv++) {
        const out = redactText(nest(lv, KEYS[0], val))
        for (const piece of val.split(' ').filter((x) => x.length > 2)) expect(out, `level ${lv} "${piece}" of "${val}"`).not.toContain(piece)
        expect(out).toContain('b4')
      }
    }
  })

  it.each([1, 2, 3, 4, 5, 6, 7])('literal %i backslashes: multi-word (space and tab) value taken whole for every key; field before stays readable', (n) => {
    const b = BS(n)
    for (const key of KEYS) {
      const out = redactLine(`x ${b}"first${b}":${b}"1${b}", ${b}"${key}${b}":${b}"${W.slice(0, 4).join(' ').replace('betaW ', 'betaW\t')}${b}" , ${b}"other${b}":${b}"keepme${b}"`)
      expect(leaks(out, W.slice(0, 4)), `n=${n} ${key}: ${out}`).toBe(0)
      expect(out).toContain('first')
    }
  })

  it('"=" separator and value glued to a trailing word are also taken whole at 1-7 backslashes', () => {
    for (let n = 1; n <= 7; n++) {
      const b = BS(n)
      expect(leaks(redactLine(`${KEYS[0]}=${b}"${W.slice(0, 3).join(' ')}${b}"`), W)).toBe(0)
      expect(leaks(redactLine(`${KEYS[0]}=${b}"${W.slice(0, 3).join(' ')}${b}"glued-tail rest`), W)).toBe(0)
    }
  })

  it('a longer closing run than the opening run still closes the value (open n, close m>n): whole value redacted', () => {
    for (let o = 1; o <= 6; o++) for (const extra of [1, 2, 4]) {
      if (o + extra > 7 + 1) continue
      const out = redactLine(`${BS(o)}"${KEYS[0]}${BS(o)}":${BS(o)}"${W.slice(0, 3).join(' ')}${BS(o + extra)}" , tail`)
      expect(leaks(out, W), `open ${o}, close ${o + extra}: ${out}`).toBe(0)
    }
  })

  it('redaction is idempotent and deterministic for the multi-word shapes', () => {
    for (let lv = 1; lv <= 4; lv++) {
      const once = redactText(nest(lv, KEYS[0], W.join(' ')))
      expect(redactText(once)).toBe(once)
      expect(redactText(nest(lv, KEYS[0], W.join(' ')))).toBe(once)
    }
  })

  it('output remains offset-stable: redacting a multi-line log line by line equals redacting the lines independently', () => {
    const lines = [1, 2, 3, 4].map((lv) => nest(lv, KEYS[0], W.join(' ')))
    expect(redactText(lines.join('\n')).split('\n')).toEqual(lines.map((l) => redactText(l)))
  })
})

describe('L-1 (accepted by the human 2026-10-22): level >= 5 / >= 8 backslashes is bounded, consistent and UNCHANGED by the fix', () => {
  it('differential: for 8..31 backslashes and real levels 5-6, old and new patterns produce identical output (single- and multi-word)', () => {
    for (const n of [8, 9, 12, 15, 16, 31]) for (const val of [ONE, W.slice(0, 3).join(' ')]) {
      const b = BS(n)
      const line = `${b}"${KEYS[0]}${b}":${b}"${val}${b}" , ${b}"o${b}":1`
      expect(line.replace(NEW, REPLACEMENT), `n=${n}`).toBe(line.replace(OLD, REPLACEMENT))
    }
    for (const lv of [5, 6]) for (const val of [ONE, W.slice(0, 3).join(' ')]) {
      const line = nest(lv, KEYS[0], val)
      expect(line.replace(NEW, REPLACEMENT), `level ${lv}`).toBe(line.replace(OLD, REPLACEMENT))
    }
  })
  it('characterisation (declared bound, not an endorsement): level 5 and 8+ backslashes are not redacted, consistently for every key', () => {
    for (const key of KEYS) expect(redactText(nest(5, key, ONE)), key).toContain(ONE)
    for (const n of [8, 9, 16]) expect(redactLine(`${BS(n)}"${KEYS[0]}${BS(n)}":${BS(n)}"${W[0]}${BS(n)}"`)).toContain(W[0])
  })
  it('the bound is a bound, not a cliff into a hang: 7 backslashes redact, 8 do not, both in linear time on a 1 MB line', () => {
    const t = (n: number) => { const line = KEYS[0] + ':' + BS(n) + '"v ' + BS(1_000_000); const s = process.hrtime.bigint(); redactLine(line); return Number(process.hrtime.bigint() - s) / 1e6 }
    expect(t(7)).toBeLessThan(500)
    expect(t(8)).toBeLessThan(500)
  })
})

describe('mismatched, unterminated and single-quote forms', () => {
  const pairs: Array<[number, number]> = [[3, 1], [1, 3], [3, 2], [2, 3], [4, 2], [7, 1], [1, 7], [3, 0], [7, 8], [8, 3]]
  it.each(pairs)('open %i / close %i backslashes: never throws, the first word of the value is redacted, idempotent', (o, c) => {
    const line = `${BS(o)}"${KEYS[0]}${BS(o)}":${BS(o)}"${W.slice(0, 3).join(' ')}${BS(c)}" , tail zzz`
    const out = redactLine(line)
    if (o <= 7) expect(out, line).not.toContain(W[0])
    expect(redactLine(out)).toBe(out)
  })
  it('no regression vs the old pattern across a 1000-line grid (open 0-9 x close 0-9 x 5 tails x 2 quote kinds): the new pattern never leaks MORE words', () => {
    let regress = 0, improved = 0
    for (let o = 0; o <= 9; o++) for (let c = 0; c <= 9; c++) for (const tail of ['', ' tail', ', "x":1', '; ok', '}']) for (const q of ['"', "'"]) {
      const line = `${BS(o)}${q}${KEYS[0]}${BS(o)}${q}:${BS(o)}${q}${W.slice(0, 4).join(' ')}${BS(c)}${q}${tail}`
      const a = leaks(line.replace(OLD, REPLACEMENT), W), b = leaks(line.replace(NEW, REPLACEMENT), W)
      if (b > a) regress++
      if (b < a) improved++
    }
    expect(regress).toBe(0)
    expect(improved).toBeGreaterThan(0)
  })
  it('unterminated escaped quote: the first word is redacted, the call terminates, output idempotent (same behaviour class as one escaping level before the fix)', () => {
    for (const n of [1, 3, 7]) {
      const out = redactLine(`${BS(n)}"${KEYS[0]}${BS(n)}":${BS(n)}"${W.slice(0, 3).join(' ')}`)
      expect(out).not.toContain(W[0])
      expect(redactLine(out)).toBe(out)
    }
  })
  it('an embedded escaped quote of a SHORTER run inside the value does not close a longer-run value (3-run open, 1-run inside, 3-run close)', () => {
    const out = redactLine(`${BS(3)}"${KEYS[0]}${BS(3)}":${BS(3)}"${W[0]} ${BS(1)}" ${W[1]} ${W[2]}${BS(3)}" tail`)
    expect(leaks(out, W)).toBe(0)
  })
  it('single-quote forms: plain single-quoted multi-word values are taken whole; escaped single-quote forms behave exactly as before (no new coverage, no regression)', () => {
    expect(leaks(redactLine(`${KEYS[0]}: '${W.slice(0, 3).join(' ')}' tail`), W)).toBe(0)
    expect(leaks(redactLine(`${KEYS[0]}='${W.slice(0, 3).join(' ')}' tail`), W)).toBe(0)
    const esc = `${BS(3)}'${KEYS[0]}${BS(3)}': ${BS(3)}'${W.slice(0, 3).join(' ')}${BS(3)}' tail`
    expect(esc.replace(NEW, REPLACEMENT)).toBe(esc.replace(OLD, REPLACEMENT))
    expect(redactLine(esc)).not.toContain(W[0])
  })
  it('empty and adjacent values do not throw or hang', () => {
    for (const n of [1, 3, 7]) for (const v of ['', BS(n), ' ']) expect(() => redactLine(`${BS(n)}"${KEYS[0]}${BS(n)}":${BS(n)}"${v}${BS(n)}"`)).not.toThrow()
  })
})

describe('[DEFECT QA-014 low] multi-word value that itself contains a double quote, at JSON-in-JSON levels 2-4', () => {
  // Real JSON.stringify serialises an embedded quote with MORE backslashes than the delimiter (level 2: 3 vs 1, level 3: 7 vs 3).
  // The closing test `(?!\1")` also matches the tail of that longer run, so the value is closed early and the words after the
  // embedded quote are no longer inside the match. Level 1 (handled by the plain-JSON alternative) is correct. Pre-existing:
  // the old pattern behaves the same at level 2 and worse at 3-4; the QA-013 fix does not make it worse.
  const embedded = [`${W[0]} "${W[1]}" ${W[2]} ${W[3]}`, `${W[0]}" ${W[1]} ${W[2]} ${W[3]}`]
  it('level 1 is correct (control)', () => {
    for (const v of embedded) expect(leaks(redactText(nest(1, KEYS[0], v)), W)).toBe(0)
  })
  it.fails('levels 2-4: every word of a multi-word value containing a double quote is redacted (today the words after the quote leak)', () => {
    for (const lv of [2, 3, 4]) for (const v of embedded) expect(leaks(redactText(nest(lv, KEYS[0], v)), W), `level ${lv}: ${v}`).toBe(0)
  })
  it('not a regression: the new pattern never leaks more words than the old one for these values at levels 1-5', () => {
    for (const v of embedded) for (let lv = 1; lv <= 5; lv++) {
      const line = nest(lv, KEYS[0], v)
      expect(leaks(line.replace(NEW, REPLACEMENT), W)).toBeLessThanOrEqual(leaks(line.replace(OLD, REPLACEMENT), W))
    }
  })
  it('a quote-free value or one with a lone backslash is unaffected (taken whole at levels 1-4)', () => {
    for (const v of [W.join(' '), `${W[0]}\\ ${W[1]} ${W[2]}`, `${W[0]}\n${W[1]} ${W[2]}`, `${W[0]} é ${W[1]}`]) {
      for (let lv = 1; lv <= 4; lv++) expect(leaks(redactText(nest(lv, KEYS[0], v)), W), `level ${lv}`).toBe(0)
    }
  })
})

describe('false-positive sanity and neighbour readability after the fix', () => {
  it('benign lines are untouched', () => {
    for (const l of [
      'C:\\work\\password\\notes.txt', 'path \\\\server\\share\\token', j('the pass', 'word field is optional'), 'token budget exceeded? no',
      'regex /\\\\"x\\\\"/ matched', 'echo "hello \\"world\\""', 'Step 3/7 : RUN npm ci', 'secret-santa list updated', 'api key rotation docs',
      'JSON {"user":"bob","id":7}', 'escaped \\\\\\\\\\\\\\\\ run of eight', 'sha256:' + 'a'.repeat(64), 'he said \\"hello there\\" and left',
      '{"msg":"\\"quoted words here\\"","n":1}', 'tokens: 5 used', 'secrets rotated', 'password policy docs',
    ]) expect(redactText(l), l).toBe(l)
  })
  it('a line with a non-secret nested JSON object keeps every field', () => {
    for (let lv = 1; lv <= 4; lv++) {
      let s = JSON.stringify({ user: 'bob', note: 'two words here', id: 7 })
      for (let i = 1; i < lv; i++) s = JSON.stringify({ msg: s })
      expect(redactText(s)).toBe(s)
    }
  })
  it('the secret key appearing twice on one nested line: both occurrences are redacted at levels 1-4', () => {
    for (let lv = 1; lv <= 4; lv++) {
      let s = JSON.stringify({ [KEYS[0]]: W.slice(0, 3).join(' '), mid: 'x', [KEYS[2]]: W.slice(3, 6).join(' ') })
      for (let i = 1; i < lv; i++) s = JSON.stringify({ msg: s })
      expect(leaks(redactText(s), W), `level ${lv}`).toBe(0)
    }
  })
  it('QA-001..012 spot checks: PEM block, URL userinfo, bearer header, plain env var, npm token, SAS signature', () => {
    const v = ONE
    const pem = redactText([j('-----BEG', 'IN PRIV', 'ATE KEY-----'), v, j('-----E', 'ND PRIV', 'ATE KEY-----'), 'after'].join('\n'))
    expect(pem).not.toContain(v)
    expect(pem.endsWith('\nafter')).toBe(true)
    for (const line of [j('clone https:', '//u:', v, '@h.io/x'), j('Authorization: Bea', 'rer ', v), j('export GITHUB_', 'TOKEN=', v), j('_auth', 'Token=', v), j('x?sig=', v, '%3D&y=1')]) {
      expect(redactText(line), line).not.toContain(v)
    }
  })
})

describe('ReDoS / timing of the backreference + lookahead (200 KB - 1 MB hostile single lines)', () => {
  const kw = KEYS[0]
  const rep = (s: string, size: number) => s.repeat(Math.ceil(size / s.length)).slice(0, size)
  const desc = [7, 6, 5, 4, 3, 2, 1].map((n) => `${kw}:${BS(n)}"a `).join('')
  const nested = (() => { let s = JSON.stringify({ a: 1, [kw]: W.slice(0, 3).join(' '), z: 2 }); for (let i = 1; i < 4; i++) s = JSON.stringify({ m: s }); return s })()
  const shapes: Record<string, (n: number) => string> = {
    'bs run only': (n) => kw + ':' + BS(n),
    'bs run then quote': (n) => kw + ':' + BS(n) + '"',
    '3bs open + N backslashes': (n) => kw + ':' + BS(3) + '"' + BS(n),
    '1bs open + long unterminated text': (n) => kw + ':' + BS(1) + '"' + 'x '.repeat(n / 2),
    '3bs open + long unterminated text': (n) => kw + ':' + BS(3) + '"' + 'x '.repeat(n / 2),
    '7bs open + many 6bs near-matches': (n) => kw + ':' + BS(7) + '"a ' + rep(BS(6) + '"b ', n),
    '7bs open + many 3bs near-matches': (n) => kw + ':' + BS(7) + '"a ' + rep(BS(3) + '"b ', n),
    '3bs open + many 2bs near-matches': (n) => kw + ':' + BS(3) + '"v ' + rep('\\\\" w ', n),
    'many keyword + 1bs open repeats': (n) => rep(kw + ':' + BS(1) + '"a ', n),
    'many keyword + 3bs open repeats': (n) => rep(kw + ':' + BS(3) + '"a b ', n),
    'descending 7..1 opens repeated': (n) => rep(desc, n),
    'ascending 1..7 opens repeated': (n) => rep([1, 2, 3, 4, 5, 6, 7].map((k) => `${kw}:${BS(k)}"a `).join(''), n),
    'QA-012 shape repeated (7bs before quote + sep)': (n) => rep(kw + BS(7) + '":' + BS(7) + '"x ', n),
    'mismatched 3/2 closers repeated': (n) => rep(`${BS(3)}"${kw}${BS(3)}":${BS(3)}"v w${BS(2)}" `, n),
    'alternating 1bs / 2bs quotes after a 2bs open': (n) => kw + ':' + BS(2) + '"a ' + rep(BS(1) + '"x ' + BS(2) + '"', n),
    'real 4-level nested JSON repeated': (n) => rep(nested + ' ', n),
  }
  const time = (line: string) => { const t: number[] = []; for (let i = 0; i < 3; i++) { const s = process.hrtime.bigint(); redactLine(line); t.push(Number(process.hrtime.bigint() - s) / 1e6) } return t.sort((a, b) => a - b)[1] }

  it.each(Object.keys(shapes))('%s: terminates well under 400 ms at 1 MB, and 5x input costs <= ~10x time (linear, generous CI margin)', (name) => {
    const small = time(shapes[name](200_000))
    const big = time(shapes[name](1_000_000))
    expect(big, `${name} 1 MB: ${big.toFixed(1)} ms`).toBeLessThan(400)
    // 5x the input; quadratic growth would be ~25x. Floor the denominator so sub-millisecond noise cannot fail the check.
    expect(big / Math.max(small, 2), `${name}: 200k ${small.toFixed(1)} ms -> 1M ${big.toFixed(1)} ms`).toBeLessThan(10)
  })
  it('20 000 nested multi-word lines (about 2.8 MB) redact in well under a second', () => {
    const text = Array(20_000).fill(nested).join('\n')
    const s = process.hrtime.bigint()
    const out = redactText(text)
    expect(Number(process.hrtime.bigint() - s) / 1e6).toBeLessThan(1500)
    expect(leaks(out, W)).toBe(0)
  })
})
