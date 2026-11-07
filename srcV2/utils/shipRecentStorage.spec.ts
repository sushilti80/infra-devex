/** FT-12 (storage part) + deep-link/validation helpers. localStorage is untrusted. */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readRecent, writeRecent, addRecent, removeRecent, setRecentTerminal, clearShipRecent, validateEntry, RECENT_MAX
} from './shipRecentStorage'
import type { RecentShipEntry } from '@v2/types/ship.types'

const uuid7 = (n: number) => `0190${String(n).padStart(4, '0')}-0000-7000-8000-${String(n).padStart(12, '0')}`
const entry = (n: number, over: Partial<RecentShipEntry> = {}): RecentShipEntry => ({
  correlationId: uuid7(n), app: `app${n}`, env: 'devsand', repo: 'org/repo', branch: 'main',
  startedAt: new Date(1_700_000_000_000 + n * 1000).toISOString(), ...over
})

describe('shipRecentStorage', () => {
  beforeEach(() => localStorage.clear())

  it('keys by user id: ship.recent.v1.<id>', () => {
    addRecent('u1', entry(1))
    expect(localStorage.getItem('ship.recent.v1.u1')).toContain(uuid7(1))
    expect(readRecent('u2')).toEqual([])
  })

  it('keeps the 20 newest, newest first', () => {
    for (let i = 1; i <= RECENT_MAX + 5; i++) addRecent('u1', entry(i))
    const list = readRecent('u1')
    expect(list).toHaveLength(20)
    expect(list[0].correlationId).toBe(uuid7(25))
    expect(list[19].correlationId).toBe(uuid7(6))
  })

  it('replaces an entry with the same correlationId instead of duplicating', () => {
    addRecent('u1', entry(1))
    addRecent('u1', entry(1, { branch: 'dev' }))
    expect(readRecent('u1')).toHaveLength(1)
    expect(readRecent('u1')[0].branch).toBe('dev')
  })

  it('stores terminal state and never any token-like field', () => {
    addRecent('u1', entry(1))
    setRecentTerminal('u1', uuid7(1), { state: 'succeeded', version: '1.2.3', prUrl: 'https://github.com/o/r/pull/4' })
    const raw = localStorage.getItem('ship.recent.v1.u1')!
    expect(JSON.parse(raw)[0].terminal).toEqual({ state: 'succeeded', version: '1.2.3', prUrl: 'https://github.com/o/r/pull/4' })
    expect(raw).not.toMatch(/token|secret|authorization/i)
  })

  it('drops corrupt / tampered entries and keeps valid ones', () => {
    const good = entry(1)
    localStorage.setItem('ship.recent.v1.u1', JSON.stringify([
      good,
      null, 'x', 42, [],
      { ...entry(2), correlationId: 'not-a-uuid' },
      { ...entry(3), correlationId: '01900003-0000-4000-8000-000000000003' }, // v4, not v7
      { ...entry(4), app: 'a'.repeat(64) },
      { ...entry(5), startedAt: 'not a date' },
      { ...entry(6), terminal: { state: 'exploded' } },
      { ...entry(7), repo: 123 },
      good // duplicate
    ]))
    const list = readRecent('u1')
    expect(list.map(e => e.correlationId)).toEqual([good.correlationId])
  })

  it('returns [] for invalid JSON or a non-array payload', () => {
    localStorage.setItem('ship.recent.v1.u1', '{not json')
    expect(readRecent('u1')).toEqual([])
    localStorage.setItem('ship.recent.v1.u1', JSON.stringify({ a: 1 }))
    expect(readRecent('u1')).toEqual([])
  })

  it('strips a non-https prUrl (javascript:) from a tampered terminal block, keeps the entry', () => {
    const e = validateEntry({ ...entry(1), terminal: { state: 'succeeded', version: '1.0.0', prUrl: 'javascript:alert(1)' } })
    expect(e?.terminal).toEqual({ state: 'succeeded', version: '1.0.0' })
  })

  it('length-caps strings (oversize version dropped, oversize branch rejects the entry)', () => {
    expect(validateEntry({ ...entry(1), branch: 'b'.repeat(201) })).toBeNull()
    expect(validateEntry({ ...entry(1), terminal: { state: 'failed', version: 'v'.repeat(33) } })?.terminal).toEqual({ state: 'failed' })
  })

  it('removeRecent removes one; clearShipRecent removes the user key only', () => {
    addRecent('u1', entry(1)); addRecent('u1', entry(2)); addRecent('u2', entry(3))
    expect(removeRecent('u1', uuid7(1)).map(e => e.correlationId)).toEqual([uuid7(2)])
    clearShipRecent('u1')
    expect(localStorage.getItem('ship.recent.v1.u1')).toBeNull()
    expect(readRecent('u2')).toHaveLength(1)
  })

  it('is a no-op without a user id', () => {
    writeRecent('', [entry(1)])
    clearShipRecent(undefined)
    expect(localStorage.length).toBe(0)
    expect(readRecent('')).toEqual([])
  })
})
