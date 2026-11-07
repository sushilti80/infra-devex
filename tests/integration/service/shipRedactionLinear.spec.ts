/**
 * ship-from-repo rework round 1 (QA-001..004): redaction must be linear-time on attacker-controlled build output
 * (the log is redacted synchronously on the event loop) while still covering prefixed/JSON/quoted secret echoes.
 * Secret-shaped fixtures are assembled at runtime so secret scanners do not flag this file.
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const { redactText, stripAnsi } = cjsRequire('../../../utils/logRedactor')

const ms = (fn: () => void): number => { const s = process.hrtime.bigint(); fn(); return Number((process.hrtime.bigint() - s) / 1_000_000n) }

describe('redaction is linear-time on 1 MB hostile lines', () => {
  const hostile: Array<[string, string]> = [
    ['JWT prefix run', 'eyJ-'.repeat(250_000)],
    ['JWT run + dot', 'eyJ-'.repeat(250_000) + '.eyJ'],
    ['unterminated OSC', '\u001b]0;t'.repeat(200_000)],
    ['keyword run', 'token'.repeat(200_000)],
    ['keyword + suffix run', 'token_'.repeat(200_000)],
    ['unterminated quoted value', 'pass' + 'word:"'.repeat(150_000)],
    ['keyword + spaces', 'pass' + 'word' + ' '.repeat(1_000_000)],
  ]
  for (const [name, input] of hostile) {
    it(name, () => { expect(ms(() => redactText(input))).toBeLessThan(1000) }, 15_000)
  }
  it('stripAnsi on unterminated OSC', () => { expect(ms(() => stripAnsi('\u001b]0;t'.repeat(200_000)))).toBeLessThan(1000) })
})

describe('widened generic pattern', () => {
  it('keeps ordinary prose intact', () => {
    for (const l of ['tokenizer: fast', 'token budget exceeded? no', 'the password field is optional']) expect(redactText(l)).toBe(l)
  })
  it('redacts a JSON value with escaped quotes and spaces as one token', () => {
    const out = redactText('{"pass' + 'word":"a b\\"c d","x":1}')
    expect(out).not.toMatch(/a b|c d/)
    expect(out).toContain('"x":1')
  })
})
