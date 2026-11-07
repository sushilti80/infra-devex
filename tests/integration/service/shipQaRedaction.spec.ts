/**
 * QA (ship-from-repo, independent): log redaction (spec §7.3, BT-15) — ≥10 patterns, ANSI strip, offset stability,
 * no over-redaction — plus adversarial probes. Tests named `[DEFECT QA-…]` use `it.fails`: they assert the CORRECT
 * behaviour and are expected to fail today; they will flip to “unexpectedly passed” (failing the suite) when the
 * Developer fixes the defect, which is the signal to turn them into ordinary `it`. See tests/results/ship-from-repo-results.json.
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const { redactText, stripAnsi, PATTERNS, REPLACEMENT } = cjsRequire('../../../utils/logRedactor')

const R = '***REDACTED***'
// secret-shaped fixtures are assembled at runtime so secret scanners do not flag this test file
const c = (...parts: string[]) => parts.join('')
const pemBegin = (kind: string) => c('-----BEG', 'IN ', kind, '-----')
const pemEnd = (kind: string) => c('-----E', 'ND ', kind, '-----')
const PK = c('PRIV', 'ATE KEY')
const samples: Array<[string, string, string]> = [
  ['GitHub token', c('cloning with gh', 'p_abcdefghijklmnopqrstuvwxyz0123456789 now'), c('gh', 'p_abcdefghijklmnopqrstuvwxyz0123456789')],
  ['GitHub server token (ghs_)', c('x gh', 's_abcdefghijklmnopqrstuvwxyz0123456789 y'), c('gh', 's_abcdefghijklmnopqrstuvwxyz0123456789')],
  ['GitHub fine-grained PAT', c('pat github', '_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz_0123456789 end'), c('github', '_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz_0123456789')],
  ['Authorization Bearer', c('Authorization: Bea', 'rer abc123.def456.ghi789'), 'abc123.def456.ghi789'],
  ['Authorization Basic', c('authorization: ba', 'sic dXNlcjpwYXNzd29yZA=='), 'dXNlcjpwYXNzd29yZA=='],
  ['Authorization token', c('Authorization: to', 'ken s3cr3tvalue'), 's3cr3tvalue'],
  ['URL userinfo', c('git clone https://deploy:', 'hunter2pass@github.com/o/r.git'), 'hunter2pass'],
  ['AWS access key id', c('key AKI', 'AIOSFODNN7EXAMPLE used'), c('AKI', 'AIOSFODNN7EXAMPLE')],
  ['AWS temp key id', c('key ASI', 'AIOSFODNN7EXAMPLE used'), c('ASI', 'AIOSFODNN7EXAMPLE')],
  ['Azure storage AccountKey', c('DefaultEndpointsProtocol=https;AccountName=a;Account', 'Key', '=', 'abcDEF123+/xyz==', ';EndpointSuffix=core'), 'abcDEF123+/xyz=='],
  ['Azure SAS sig', c('https://a.blob.core.windows.net/c/b?sv=2022&s', 'ig=abcdEFGH%2Bxyz12345%3D&se=2030'), 'abcdEFGH%2Bxyz12345%3D'],
  ['JWT', c('id ey', 'JhbGciOiJIUzI1NiJ9.ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c end'), c('ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0')],
  ['Slack token', c('hook xo', 'xb-123456789012-abcdefghijkl here'), c('xo', 'xb-123456789012-abcdefghijkl')],
  ['npm _authToken', c('//registry.npmjs.org/:_auth', 'Token=npm_abcdefghijklmnop'), 'npm_abcdefghijklmnop'],
  ['generic password', c('pass', 'word: hunter2hunter2'), 'hunter2hunter2'],
  ['generic client_secret', c('client_', 'secret=Zm9vYmFyYmF6'), 'Zm9vYmFyYmF6'],
  ['generic api-key', c('api-', 'key = value_0123456789'), 'value_0123456789'],
  ['*_SECRET= env echo', c('WIZ_CLIENT_', 'SECRET=topsecretvalue1'), 'topsecretvalue1'],
]

describe('BT-15 redaction patterns', () => {
  it('has at least 10 distinct patterns and a stable replacement token', () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(10)
    expect(REPLACEMENT).toBe(R)
  })
  it.each(samples)('%s is redacted', (_n, line, secret) => {
    const out = redactText(line)
    expect(out).not.toContain(secret)
    expect(out).toContain(R)
  })
  it('PEM private-key blocks are redacted whole (BEGIN..END, any key type), text after the block is kept', () => {
    for (const kind of [`RSA ${PK}`, PK, `EC ${PK}`, `OPENSSH ${PK}`]) {
      const out = redactText(`before\n${pemBegin(kind)}\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nabcdef==\n${pemEnd(kind)}\nafter`)
      expect(out).not.toMatch(/MIIEvQ|abcdef==|BEGIN|END/)
      expect(out.startsWith('before\n')).toBe(true)
      expect(out.endsWith('\nafter')).toBe(true)
    }
  })
  it('an unterminated PEM block (log still streaming) redacts to the end — never leaks the partial key', () => {
    const out = redactText(pemBegin(PK) + '\nMIIEvQIBADANBgkqhkiG9w0BAQEF')
    expect(out).not.toContain('MIIEvQ')
  })
  it('ANSI colour, cursor and OSC sequences are stripped first (also when they split a secret); no ESC byte survives', () => {
    const out = redactText('\u001b[31mred\u001b[0m \u001b]0;title\u0007ok gh\u001b[1mp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(out).not.toMatch(/\u001b/)
    expect(out).toContain('red ok')
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789')
    expect(stripAnsi('\u001b[2K\u001b[1A\u001b[38;5;196mx\u001b[0m')).toBe('x')
  })
  it('is deterministic and offset-stable: redacting any line-aligned prefix equals the prefix of the redacted whole (append-only logs)', () => {
    const lines = [
      'start', c('Authorization: Bea', 'rer abc.def.ghi'), pemBegin(PK), 'MIIEvQIBADANBg', pemEnd(PK),
      c('url https:', '//u:p4', 'ss@h.io/x'), 'plain line', c('pass', 'word=zzz999'), '\u001b[32mgreen\u001b[0m', 'end',
    ]
    const whole = redactText(lines.join('\n'))
    expect(redactText(lines.join('\n'))).toBe(whole)
    for (let k = 1; k <= lines.length; k++) {
      const prefix = redactText(lines.slice(0, k).join('\n'))
      expect(whole.startsWith(prefix), `prefix of ${k} lines`).toBe(true)
    }
    expect(redactText(whole)).toBe(whole) // idempotent
  })
  it('does not over-redact ordinary build output', () => {
    const benign = ['Step 3/5 : RUN npm ci', 'added 214 packages in 9s', 'token budget exceeded? no', 'the password field is optional', 'Successfully built a1b2c3d4e5f6', 'sha256:' + 'a'.repeat(64)]
    for (const l of benign) expect(redactText(l)).toBe(l)
  })
})

describe('redaction gaps found by QA', () => {
  it('[DEFECT QA-001 high] env-var echoes with a prefix leak: GITHUB_TOKEN=, DB_PASSWORD=, NPM_TOKEN=, AWS_SECRET_ACCESS_KEY= (spec §7.3 generic pattern has no word boundaries; the implementation added \\b…\\b)', () => {
    for (const [line, secret] of [
      [c('export GITHUB_', 'TOKEN', '=', 'abc123def456'), 'abc123def456'],
      [c('DB_PASS', 'WORD=hunter2'), 'hunter2'],
      [c('NPM_TO', 'KEN=npm_zzz999'), 'npm_zzz999'],
      [c('AWS_SEC', 'RET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'), 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    ]) expect(redactText(line), line).not.toContain(secret)
  })
  it('[DEFECT QA-003 medium/advisory-spec-gap] JSON-quoted secrets leak: {"password":"…"}, {"token": "…"}, {"api_key":"…"}', () => {
    for (const [line, secret] of [[c('{"pass', 'word":"hunter2hunter2"}'), 'hunter2hunter2'], [c('{"to', 'ken": "abcdef123456"}'), 'abcdef123456'], [c('{"api', '_key":"value-123456789"}'), 'value-123456789']]) {
      expect(redactText(line), line).not.toContain(secret)
    }
  })
  it('[DEFECT QA-004 low] a quoted secret containing spaces is only redacted up to the first space (password: "my secret value")', () => {
    const out = redactText(c('pass', 'word: "my secret value"'))
    expect(out).not.toContain('secret value')
  })
})

describe('redaction is linear-time on attacker-controlled build output (the log is redacted synchronously on the event loop)', () => {
  const t0 = () => process.hrtime.bigint()
  const ms = (s: bigint) => Number((process.hrtime.bigint() - s) / 1_000_000n)
  it('linear patterns stay fast on 1 MB pathological inputs (url userinfo, password, sig, Authorization, AccountKey, ghp_)', () => {
    for (const unit of ['://a:b', 'password ', 'token: ', 'sig=aaaaaaaa', 'Authorization: Bearer ', 'AccountKey=;', 'ghp_']) {
      const s = unit.repeat(Math.ceil(1_000_000 / unit.length))
      const start = t0()
      redactText(s)
      expect(ms(start), unit).toBeLessThan(1500)
    }
  })
  it('[DEFECT QA-002 high] JWT pattern is quadratic: 60 KB of "eyJ-" repeated takes ~1 s (160 KB ≈ 7 s, 1 MB ≈ minutes) — a hostile repo’s build output can stall the Node event loop', () => {
    const s = 'eyJ-'.repeat(15_000)
    const start = t0()
    redactText(s)
    expect(ms(start)).toBeLessThan(250)
  }, 30_000)
  it('[DEFECT QA-002 high] ANSI OSC pattern is quadratic: 100 KB of ESC "]" ≈ 1 s (200 KB ≈ 3.7 s)', () => {
    const s = '\u001b]0;t'.repeat(16_000)
    const start = t0()
    stripAnsi(s)
    expect(ms(start)).toBeLessThan(250)
  }, 30_000)
})
