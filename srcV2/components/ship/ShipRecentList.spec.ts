/** FT-12 recent-ships rendering (escaping, states) and FT-14 notices. */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ShipRecentList from './ShipRecentList.vue'
import ShipStateNotice from './ShipStateNotice.vue'
import { noticeKindForError } from '@v2/utils/shipHelpers'

const id = (n: number) => `0190${String(n).padStart(4, '0')}-0000-7000-8000-${String(n).padStart(12, '0')}`
const entry = (n: number, extra = {}) => ({ correlationId: id(n), app: `app${n}`, env: 'devsand', repo: 'o/r', branch: 'main', startedAt: '2026-01-01T10:00:00Z', ...extra })

describe('ShipRecentList (FT-12)', () => {
  it('empty list text', () => {
    const w = mount(ShipRecentList, { props: { entries: [], states: {} } })
    expect(w.text()).toContain('Ships you start will appear here.')
    expect(w.text()).not.toContain('Clear list')
  })

  it('rows show app, branch, start time and status (terminal stored vs refreshed vs unknown)', () => {
    const w = mount(ShipRecentList, {
      props: {
        entries: [entry(1, { terminal: { state: 'succeeded', version: '1.2.3', prUrl: 'https://github.com/o/r/pull/9' } }), entry(2), entry(3), entry(4)],
        states: { [id(3)]: { state: 'ok', runState: 'running' }, [id(4)]: { state: 'loading' } }
      }
    })
    const rows = w.findAll('li')
    expect(rows[0].text()).toContain('app1')
    expect(rows[0].text()).toContain('main')
    expect(rows[0].text()).toContain('Succeeded · 1.2.3')
    expect(rows[0].get('a').attributes('href')).toBe('https://github.com/o/r/pull/9')
    expect(rows[1].text()).toContain('In progress')
    expect(rows[2].text()).toContain('In progress')
    expect(rows[3].text()).toContain('Checking…')
  })

  it('403/404 => "No longer available" + Remove (row stays); error => "Couldn\'t load status — try again" + retry', async () => {
    const w = mount(ShipRecentList, { props: { entries: [entry(1), entry(2)], states: { [id(1)]: { state: 'unavailable' }, [id(2)]: { state: 'error' } } } })
    const [r1, r2] = w.findAll('li')
    expect(r1.text()).toContain('No longer available')
    await r1.findAll('button').find(b => b.text() === 'Remove')!.trigger('click')
    expect(w.emitted('remove')?.[0]).toEqual([id(1)])
    expect(r2.text()).toContain("Couldn't load status — try again")
    await r2.findAll('button').find(b => b.text() === 'Try again')!.trigger('click')
    expect(w.emitted('retry')?.[0]).toEqual([id(2)])
    expect(w.findAll('li')).toHaveLength(2)
  })

  it('opens a ship from its row and clears the list', async () => {
    const w = mount(ShipRecentList, { props: { entries: [entry(1)], states: {} } })
    await w.get('li button').trigger('click')
    expect(w.emitted('open')?.[0]).toEqual([id(1)])
    await w.findAll('button').find(b => b.text() === 'Clear list')!.trigger('click')
    expect(w.emitted('clear')).toHaveLength(1)
  })

  it('renders hostile entry strings as text (no HTML) and drops non-https PR links', () => {
    const w = mount(ShipRecentList, {
      props: {
        entries: [entry(1, { app: '<img src=x onerror=alert(1)>', branch: '<script>alert(1)</script>', terminal: { state: 'succeeded', prUrl: 'javascript:alert(1)' } })],
        states: {}
      }
    })
    expect(w.find('img').exists()).toBe(false)
    expect(w.find('script').exists()).toBe(false)
    expect(w.find('a').exists()).toBe(false)
    expect(w.text()).toContain('<img src=x onerror=alert(1)>')
  })
})

describe('ShipStateNotice and error classification (FT-14)', () => {
  it('no_environment: S1 copy + Back to home, no form', async () => {
    const w = mount(ShipStateNotice, { props: { kind: 'no_environment' } })
    expect(w.text()).toContain("Ship from Repo isn't available in any environment right now.")
    await w.get('button').trigger('click')
    expect(w.emitted('home')).toHaveLength(1)
  })

  it('load_error: S0e copy + Try again', async () => {
    const w = mount(ShipStateNotice, { props: { kind: 'load_error' } })
    expect(w.text()).toContain("Couldn't load Ship from Repo")
    expect(w.attributes('role')).toBe('alert')
    await w.findAll('button').find(b => b.text() === 'Try again')!.trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
  })

  it('not_linked: S2 copy asks the platform team (no Connect GitHub action until H-2 selects it)', () => {
    const w = mount(ShipStateNotice, { props: { kind: 'not_linked' } })
    expect(w.text()).toContain("We couldn't verify your GitHub account, so shipping is turned off for you.")
    expect(w.text()).toContain('Ask the platform team to link it.')
    expect(w.text()).not.toMatch(/Connect GitHub/i)
    expect(w.findAll('button')).toHaveLength(0)
  })

  it('not_accessible: generic message naming the org (never reveals existence)', () => {
    const w = mount(ShipStateNotice, { props: { kind: 'not_accessible', org: 'Aya-DevOpsTeam' } })
    expect(w.text()).toContain("We couldn't access that repository with your GitHub permissions.")
    expect(w.text()).toContain('Aya-DevOpsTeam')
    expect(w.text()).not.toMatch(/exist/i)
  })

  it('unavailable (503 SHIP_UNAVAILABLE) and rate_limited (with/without Retry-After) are specific', () => {
    expect(mount(ShipStateNotice, { props: { kind: 'unavailable' } }).text()).toContain('temporarily unavailable')
    expect(mount(ShipStateNotice, { props: { kind: 'rate_limited', retryAfterSec: 90 } }).text()).toContain('about 90 seconds')
    expect(mount(ShipStateNotice, { props: { kind: 'rate_limited' } }).text()).toContain('wait a few minutes')
  })

  it('noticeKindForError maps the fail-closed API responses', () => {
    const e = (status: number, code: string, hint?: string) => ({ status, code, message: code, hint })
    expect(noticeKindForError(e(403, 'REPO_NOT_ACCESSIBLE', 'IDENTITY_NOT_LINKED'))).toBe('not_linked')
    expect(noticeKindForError(e(403, 'REPO_NOT_ACCESSIBLE'))).toBe('not_accessible')
    expect(noticeKindForError(e(503, 'SHIP_UNAVAILABLE'))).toBe('unavailable')
    expect(noticeKindForError(e(429, 'PLATFORM_RATE_LIMITED'))).toBe('rate_limited')
    expect(noticeKindForError(e(503, 'PLATFORM_RATE_LIMITED'))).toBe('rate_limited')
    expect(noticeKindForError(e(400, 'VALIDATION_FAILED'))).toBe('validation')
    expect(noticeKindForError(e(403, 'APP_OWNED_BY_OTHER'))).toBeNull()
    expect(noticeKindForError(e(500, 'UNKNOWN'))).toBe('generic')
    expect(noticeKindForError(e(0, 'NETWORK'))).toBe('generic')
    expect(noticeKindForError(null)).toBeNull()
  })
})
