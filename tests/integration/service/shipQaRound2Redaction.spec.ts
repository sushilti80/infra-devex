/**
 * QA round 2 (ship-from-repo, independent re-verification of QA-001..QA-004 after Dev rework round 1): the log redactor
 * (utils/logRedactor.js, spec §7.3, BT-15, NFR-005/NFR-012). Adversarial variants: other prefixed env-var names, JSON /
 * quoted / escaped forms, hostile 1 MB lines for every pattern (linear time), parity with the spec-literal generic
 * pattern, and false-positive sanity. `[DEFECT QA-nnn]` tests use `it.fails` (assert the CORRECT behaviour; expected to
 * fail today; they flip to “unexpectedly passed” once the Developer fixes the defect). All secret-shaped fixtures are
 * assembled at runtime so secret scanners do not flag this file.
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const { redactText, redactLine, stripAnsi, REPLACEMENT } = cjsRequire('../../../utils/logRedactor')

const j = (...p: string[]) => p.join('')
const PASSWORD = j('pass', 'word')
const TOKEN = j('tok', 'en')
const SECRET = j('sec', 'ret')
const APIKEY = j('api', '_key')
const Q = '"'
const BS = '\\'
const ms = (fn: () => void): number => { const s = process.hrtime.bigint(); fn(); return Number((process.hrtime.bigint() - s) / 1_000_000n) }

describe('QA-001 re-verification: prefixed / suffixed / header-style secret names are redacted', () => {
  const names = [
    'GITHUB_' + TOKEN.toUpperCase(), 'GH_' + TOKEN.toUpperCase(), 'NPM_' + TOKEN.toUpperCase(), 'SLACK_BOT_' + TOKEN.toUpperCase(), 'SONAR_' + TOKEN.toUpperCase(),
    'ACCESS_' + TOKEN.toUpperCase(), 'ID_' + TOKEN.toUpperCase(), 'DB_' + PASSWORD.toUpperCase(), 'MYSQL_ROOT_' + PASSWORD.toUpperCase(), 'PG' + PASSWORD.toUpperCase(),
    'DOCKER_' + PASSWORD.toUpperCase(), 'REGISTRY_PASSWD', 'AWS_' + SECRET.toUpperCase() + '_ACCESS_KEY', 'ARM_CLIENT_' + SECRET.toUpperCase(), 'AZURE_CLIENT_' + SECRET.toUpperCase(),
    'JWT_' + SECRET.toUpperCase(), 'SESSION_' + SECRET.toUpperCase(), SECRET.toUpperCase() + '_KEY_BASE', 'MY_SVC_' + APIKEY.toUpperCase(), 'X-Api-Key', 'x-api-key', 'APIKEY',
    'api-key', 'TF_VAR_db_' + PASSWORD, 'client_' + SECRET, 'clientSecret', 'accessToken', 'apiKey', 'Password', PASSWORD.toUpperCase(),
  ]
  const values = ['Zq81xLm20aBcD3EfGh4', 'a/b+c=d==', 'v;with:colons-and_underscores.9', 'P@ss!w0rd#1']
  const forms: Array<[string, (n: string, v: string) => string]> = [
    ['export', (n, v) => `export ${n}=${v}`], ['colon', (n, v) => `${n}: ${v}`], ['spaced eq', (n, v) => `${n} = ${v}`],
    ['dq', (n, v) => `${n}="${v}"`], ['sq', (n, v) => `${n}='${v}'`], ['env cmd', (n, v) => `env ${n}=${v} ./run.sh --flag`], ['timestamped', (n, v) => `2026-10-22T14:06:00.1234567Z ##[debug]${n}:${v}`],
  ]
  for (const n of names) {
    it(`${n}: value never survives (${forms.length} forms × ${values.length} values)`, () => {
      for (const [, f] of forms) for (const v of values) {
        const out = redactText(f(n, v))
        expect(out, f(n, v)).toContain(REPLACEMENT)
        expect(out, f(n, v)).not.toContain(v.length > 6 ? v.slice(2, 12) : v)
      }
    })
  }
})

describe('QA-003/004 re-verification: JSON, quoted and spaced values', () => {
  const secretWords = ['alpha beta gamma', 'a1b2c3d4e5f6']
  it('JSON object forms (compact, spaced, uppercase key, single-quoted dict, multiple keys per line): values gone, structure around them kept', () => {
    const k = (n: string) => `${Q}${n}${Q}`
    const lines = [
      `{${k(PASSWORD)}:${k(secretWords[1])}}`, `{ ${k(PASSWORD)} : ${k(secretWords[1])} , ${k('user')}: ${k('bob')} }`, `{${k(PASSWORD.toUpperCase())}:${k(secretWords[0])},${k('x')}:1}`,
      `{'${APIKEY}': '${secretWords[0]}', 'user': 'bob'}`, `{${k(TOKEN)}:${k(secretWords[1])},${k(SECRET)}:${k(secretWords[0])}}`,
      `{${k('auth')}:{${k(TOKEN)}:${k(secretWords[1])}}}`, `${PASSWORD}: ${Q}${secretWords[0]}${Q} # yaml`, `export ${TOKEN.toUpperCase()}='${secretWords[0]}' && echo done`,
    ]
    for (const l of lines) {
      const out = redactText(l)
      for (const s of secretWords) expect(out, l).not.toContain(s)
      expect(out, l).toContain(REPLACEMENT)
    }
    expect(redactText(`{${k(PASSWORD)}:${k('a b c')},${k('user')}:${k('bob')}}`)).toContain(`${k('user')}:${k('bob')}`)
    expect(redactText(`${PASSWORD}: ${Q}${secretWords[0]}${Q} # yaml`)).toContain('# yaml')
  })
  it('escaped quote INSIDE a quoted value (a\\"b) is consumed as part of the value', () => {
    const out = redactText(`{${Q}${TOKEN}${Q}:${Q}aaa${BS}${Q}bbb${Q},${Q}x${Q}:1}`)
    expect(out).not.toMatch(/aaa|bbb/)
    expect(out).toContain(`${Q}x${Q}:1`)
  })
  it('non-string JSON values (null / number / true / empty string) do not crash and keep the rest of the line sane', () => {
    for (const v of ['null', '123456', 'true', `${Q}${Q}`]) expect(() => redactText(`{${Q}${PASSWORD}${Q}:${v},${Q}x${Q}:1}`)).not.toThrow()
    expect(redactText(`{${Q}${PASSWORD}${Q}:123456}`)).not.toContain('123456')
  })
  it('URL query strings: token=… and api_key=… values are redacted', () => {
    const out = redactText(`GET /x?${APIKEY}=abc123def456&${TOKEN}=zzz999yyy888&ok=1`)
    expect(out).not.toMatch(/abc123def456|zzz999yyy888/)
  })

  // QA-003 fix is incomplete: JSON that is itself embedded in a JSON string (every inner quote escaped as \") — the form
  // docker/kubectl/Actions print when a structured log line is itself serialised — leaves BOTH key and value in clear.
  it('[DEFECT QA-010 medium] escaped-quote JSON (\\"password\\":\\"v\\") — a JSON log line embedded in a JSON string — is redacted', () => {
    const v = 'Zq81xLm20aBcD3EfGh4'
    const esc = `${BS}${Q}`
    const embedded = `{${Q}msg${Q}:${Q}{${esc}${PASSWORD}${esc}:${esc}${v}${esc}}${Q}}`
    for (const l of [embedded, `${PASSWORD}${esc}:${esc}${v}${esc}`, `${TOKEN}${esc}=${esc}${v}${esc}`]) {
      expect(redactText(l), l).not.toContain(v)
    }
  })

  // The quoted alternative stops at the closing quote; anything glued to it is a continuation of the same shell word /
  // SQL-style escaped value and is left in clear (spec §7.3 `\S+` would have taken it).
  it('[DEFECT QA-011 low] a quoted value with characters glued after the closing quote (shell concatenation / SQL-style doubled quote) is redacted entirely', () => {
    const tail = 'TAILSECRET99'
    for (const l of [`${PASSWORD}="abc"${tail}`, `${PASSWORD}='abc'${BS}''${tail}'`, `${PASSWORD}: 'it''${tail}'`, `export ${TOKEN.toUpperCase()}="abc"${tail}`]) {
      expect(redactText(l), l).not.toContain(tail)
    }
  })
})

describe('QA-002 re-verification: every pattern is linear on hostile 1 MB lines (the log is redacted synchronously on the event loop)', () => {
  const N = 1_000_000
  const rep = (s: string, n = N) => s.repeat(Math.ceil(n / s.length)).slice(0, n)
  const ESC = '\u001b'
  const hostile: Record<string, string> = {
    'gh token run + word char': j('gh', 'p_') + 'a'.repeat(N) + '_',
    'gh token repeated': rep(j('gh', 'p_') + 'a'.repeat(20) + '_'),
    'github_pat run': j('github_', 'pat_') + 'a'.repeat(N) + '_',
    'Authorization + spaces': 'Authorization:' + ' '.repeat(N),
    'Authorization Bearer + spaces': 'Authorization: Bearer' + ' '.repeat(N),
    'Authorization repeated': rep('Authorization: Bearer '),
    'userinfo ://a: run': '://' + rep('a:'),
    'userinfo repeated': rep('://a:b'),
    'AKIA repeated': rep('AKIA'),
    'AccountKey repeated': rep('AccountKey='),
    'sig run': 'sig=' + 'a'.repeat(N) + '.',
    'JWT dash-run': rep('eyJ-'),
    'JWT dot-run': rep(j('ey', 'Jaaaaa.')),
    'JWT two-segment run': rep(j('ey', 'Jaaaaa.ey', 'Jaaaaa-')),
    'JWT long segment': j('ey', 'Jaaaaaa.ey', 'J') + 'a'.repeat(N),
    'xox run': rep('xoxb-'),
    '_authToken repeated': rep('_authToken'),
    '_authToken + spaces': '_authToken=' + ' '.repeat(N),
    '_SECRET repeated': rep('_SECRET'),
    'A_SECRET + spaces': 'A_SECRET' + ' '.repeat(N),
    'word run (generic NAME_SECRET)': 'a'.repeat(N),
    'keyword repeated': rep(PASSWORD),
    'keyword + spaces': PASSWORD + ' '.repeat(N),
    'keyword- repeated': rep(TOKEN + '-'),
    'keyword_a- repeated': rep(TOKEN + '_a-'),
    'keyword=" repeated (unterminated quotes)': rep(PASSWORD + '="'),
    'keyword=\\" repeated': rep(PASSWORD + '=' + BS + '"'),
    'keyword=" + escaped-quote run': PASSWORD + '="' + rep(BS + '"'),
    'keyword=" + words (never closed)': PASSWORD + '="' + rep('a '),
    'mixed quote kinds': rep(PASSWORD + '="a ' + PASSWORD + "='a "),
    'PEM BEGIN repeated': rep('-----BEGIN '),
    'PEM BEGIN + letters': '-----BEGIN ' + rep('A '),
    'CSI no final byte': ESC + '[' + '0'.repeat(N),
    'CSI repeated': rep(ESC + '[0'),
    'bare ESC run': ESC.repeat(N),
    'OSC repeated': rep(ESC + ']'),
    'OSC ESC-terminated repeated': rep(ESC + ']a' + ESC),
  }
  for (const [name, input] of Object.entries(hostile)) {
    it(`${name} (${input.length} chars) < 500 ms`, () => { expect(ms(() => redactText(input))).toBeLessThan(500) }, 15_000)
  }
  it('every hostile shape concatenated into one 1 MB+ line', () => {
    const all = Object.values(hostile).map((s) => s.slice(0, 40_000)).join(' ')
    expect(ms(() => redactText(all))).toBeLessThan(500)
  })
  it('20 MB of ordinary multi-line build output redacts in well under 2 s (event-loop cost bound)', () => {
    const line = '2026-10-22T14:06:00Z npm info using npm@10 downloading tokenizer-1.2.3 password policy ok step 3/10'
    const text = Array.from({ length: 200_000 }, () => line).join('\n')
    expect(ms(() => redactText(text))).toBeLessThan(2000)
  }, 20_000)
  it('hostile line scales linearly: 4 MB takes < 8× the 0.5 MB time (+ 100 ms slack)', () => {
    const a = ms(() => redactText(rep('eyJ-', 500_000)))
    const b = ms(() => redactText(rep('eyJ-', 4_000_000)))
    expect(b).toBeLessThan(a * 8 + 100)
  })

  // A single line of ~6 MB+ (e.g. one huge un-newlined blob) overflows V8's regexp backtrack stack: String.replace throws
  // RangeError, redactText propagates it, and GET /api/ship/logs answers 5xx for everyone (fail-closed, but the log is
  // unreadable). Pre-existing for the GitHub-token pattern at the reviewed baseline; widened to the quoted pattern.
  it('[DEFECT QA-009 low] a single 8 MB line never makes redactText throw (RangeError: Maximum call stack size exceeded)', () => {
    for (const body of [j('gh', 'p_') + 'a'.repeat(8 * 1024 * 1024), PASSWORD + '="' + 'a'.repeat(8 * 1024 * 1024), 'eyJ-'.repeat(2 * 1024 * 1024)]) {
      expect(() => redactText(body)).not.toThrow()
    }
  }, 30_000)
})

describe('no loss of redaction vs the spec-literal §7.3 generic pattern (seeded differential fuzz)', () => {
  // spec §7.3: (password|passwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*\S+
  const spec = /(password|passwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*\S+/gi
  let seed = 20261022
  const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n }
  const pick = <T,>(a: T[]): T => a[rnd(a.length)]
  const kws = [PASSWORD, 'passwd', SECRET, TOKEN, APIKEY, 'api-key', 'apikey', 'client_' + SECRET, 'client-' + SECRET, 'clientsecret']
  const cases = (s: string) => (rnd(2) ? s.toUpperCase() : s)
  const pre = ['', 'export ', 'DB_', 'MY-', '  ', '[', '"', "'", 'x.', '--', 'a1', '2026-10-22T14:06:00Z ']
  const seps = [':', '=', ' : ', ' = ', ':  ', '=\t']
  const alnum = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const val = () => { let s = ''; const n = 8 + rnd(20); for (let i = 0; i < n; i++) s += alnum[rnd(alnum.length)]; return s + pick(['', '/', '+', '=', '==', ';', ',', '.x']) }
  it('3 000 generated lines: wherever the spec-literal pattern redacts an unquoted value, so does the implementation', () => {
    for (let i = 0; i < 3000; i++) {
      const v = val()
      const line = `${pick(pre)}${cases(pick(kws))}${pick(seps)}${v} tail${i}`
      const specMatches = line.match(spec)
      if (!specMatches) continue
      const out = redactText(line)
      expect(out, line).not.toContain(v)
      expect(out, line).toContain(REPLACEMENT)
    }
  })
  it('3 000 generated QUOTED lines (value fully inside one pair of quotes): value never survives; text after the closing quote + space is kept', () => {
    for (let i = 0; i < 3000; i++) {
      const v = val() + ' ' + val()
      const quote = pick([Q, "'"])
      const line = `${pick(pre)}${cases(pick(kws))}${pick([':', '='])}${quote}${v}${quote} after${i}`
      const out = redactText(line)
      expect(out, line).not.toContain(v.split(' ')[0])
      expect(out, line).not.toContain(v.split(' ')[1])
      expect(out, line).toContain(`after${i}`)
    }
  })
  it('idempotent and append-stable on the generated corpus (offset stability, BT-15)', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `${cases(pick(kws))}${pick(seps)}${val()} n${i}`)
    const a = redactText(lines.join('\n'))
    expect(redactText(a)).toBe(a)
    for (const cut of [10, 100, 399]) expect(redactText(lines.slice(0, cut).join('\n')) + '\n').toBe(a.split('\n').slice(0, cut).join('\n') + '\n')
  })
})

describe('false-positive sanity: ordinary build output is untouched', () => {
  const benign = [
    'Downloading tokenizer-1.2.3.tgz', 'tokenizer: fast', 'the password field is optional', 'password policy: strict', 'Passwords must be at least 8 characters',
    'secrets-manager enabled', 'secretive behaviour', 'tokens issued per minute = see dashboard', 'no_token_here', 'sig=short', 'success rate: 100%',
    'GET /api/tokens 200 12ms', 'step 3/10 : RUN npm ci --omit=dev', 'npm WARN deprecated left-pad@1.3.0: use String.prototype.padStart()',
    'Authorization header present', 'Bearer', 'curl -u user:pw123@host', 'cache key: build-linux-x64-abc', 'eyJ not a token', 'ghp_short', 'AKIAshort', 'xox-',
    '2026-10-22T14:06:00.1234567Z ##[group]Run actions/checkout@v4', 'https://github.com/organization/my-svc/actions/runs/123', 'docker.io/library/node:20-alpine@sha256:' + 'a'.repeat(64),
    '[2/4] Linking dependencies...', 'Compiled successfully in 12.3s', '  at Object.<anonymous> (/workspace/src/index.js:10:5)',
  ]
  for (const l of benign) it(JSON.stringify(l.length > 60 ? l.slice(0, 57) + '…' : l), () => { expect(redactText(l)).toBe(l) })
  it('known, accepted over-redaction (documented, harmless): hyphenated keyword forms such as `token-based: yes`', () => {
    expect(redactText('token-based: yes')).toContain(REPLACEMENT)
  })
})

describe('JWT lookbehind (QA-002 fix) still redacts every realistic placement', () => {
  const jwt = j('ey', 'JhbGciOiJIUzI1NiJ9') + '.' + j('ey', 'JzdWIiOiIxMjM0NTYifQ') + '.' + 'SflKxwRJSMeKKF2QT4fwpM'
  for (const [name, wrap] of Object.entries({
    'start of line': (t: string) => t, 'after space': (t: string) => `token ${t}`, 'after =': (t: string) => `x=${t}`, 'after :': (t: string) => `id_token:${t}`,
    'after (': (t: string) => `(${t})`, 'after quote': (t: string) => `"${t}"`, 'after dot': (t: string) => `a.${t}`, 'after comma': (t: string) => `a,${t}`, 'after slash': (t: string) => `/cb/${t}`,
    'after Bearer': (t: string) => `Bearer ${t}`, 'after ANSI colour': (t: string) => `\u001b[31m${t}\u001b[0m`,
  } as Record<string, (t: string) => string>)) {
    it(name, () => { expect(redactText(wrap(jwt))).not.toContain(jwt.split('.')[1]) })
  }
})

describe('ANSI stripping and redaction interplay', () => {
  it('a secret split by an ANSI escape is stripped first and then redacted', () => {
    const out = redactText(`${TOKEN}=abc\u001b[0m123SECRETVALUE`)
    expect(out).not.toMatch(/abc|SECRETVALUE/)
  })
  it('stripAnsi + redactLine on a 1 MB OSC-heavy hostile line is linear', () => {
    expect(ms(() => redactLine(stripAnsi('\u001b]0;t\u0007'.repeat(120_000))))).toBeLessThan(500)
  })
})
