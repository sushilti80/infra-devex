/** FT-10 failure panels for every code, retry matrix, copy details, Retry PR creation; FT-06 default view. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ShipFailurePanel from './ShipFailurePanel.vue'
import { useNavigationStore } from '@v2/stores/navigation'
import { CID, failed, status, ALL_FAILURE_CODES, FORBIDDEN_DEFAULT_TERMS } from './ship.fixtures'

const mountPanel = (s = failed('BUILD_FAILED'), props: Record<string, unknown> = {}) =>
  mount(ShipFailurePanel, { props: { status: s, ...props }, global: { plugins: [createPinia()] } })
const btn = (w: ReturnType<typeof mountPanel>, label: string) => w.findAll('button').find(b => b.text() === label)

beforeEach(() => setActivePinia(createPinia()))

describe('ShipFailurePanel (FT-10)', () => {
  it.each(ALL_FAILURE_CODES)('%s renders a panel with plain-language copy, no technical terms (FT-06) and the code in data-code', (code) => {
    const w = mountPanel(failed(code, 'reship', {}, code === 'CANCELLED' ? { state: 'cancelled' } : {}))
    expect(w.get('section').attributes('data-code')).toBe(code)
    const text = w.text()
    for (const re of FORBIDDEN_DEFAULT_TERMS) expect(text, `${code}: ${re}`).not.toMatch(re)
    expect(text).not.toContain(CID)
    expect(text).not.toContain(`server message for ${code}`) // API wording only inside Details
    expect(text.length).toBeGreaterThan(40)
  })

  it('an unknown code falls back to the UNKNOWN copy (never blank, never raw server text)', () => {
    const w = mountPanel(failed('SOMETHING_NEW'))
    expect(w.get('section').attributes('data-code')).toBe('UNKNOWN')
    expect(w.text()).toContain('unrecognised reason')
  })

  it('retry matrix: reship => "Try again"', async () => {
    const w = mountPanel(failed('PUBLISH_FAILED', 'reship'))
    expect(btn(w, 'Try again')).toBeTruthy()
    expect(btn(w, 'Retry PR creation')).toBeUndefined()
    await btn(w, 'Try again')!.trigger('click')
    expect(w.emitted('ship-again')).toHaveLength(1)
  })

  it('retry matrix: fix_then_ship => "Ship again", no retry-config', () => {
    const w = mountPanel(failed('BUILD_FAILED', 'fix_then_ship'))
    expect(btn(w, 'Ship again')).toBeTruthy()
    expect(btn(w, 'Try again')).toBeUndefined()
    expect(btn(w, 'Retry PR creation')).toBeUndefined()
  })

  it('retry matrix: retry_config => "Retry PR creation" emits retry-config; ship again stays available', async () => {
    const w = mountPanel(failed('CONFIG_PR_FAILED', 'retry_config'))
    await btn(w, 'Retry PR creation')!.trigger('click')
    expect(w.emitted('retry-config')).toHaveLength(1)
    expect(btn(w, 'Ship again')).toBeTruthy()
  })

  it('VERSION_COLLISION offers no automatic retry action (platform integrity error)', () => {
    const w = mountPanel(failed('VERSION_COLLISION'))
    expect(btn(w, 'Ship again')).toBeUndefined()
    expect(btn(w, 'Try again')).toBeUndefined()
    expect(btn(w, 'Copy details')).toBeTruthy()
  })

  it('BUILD_FAILED shows the extracted error line at the top and the unsupported-feeds hint; text only (no HTML)', () => {
    const w = mountPanel(failed('BUILD_FAILED', 'fix_then_ship', { errorLine: '<img src=x onerror=alert(1)> npm ERR!' }))
    expect(w.get('[data-testid="ship-error-line"]').text()).toBe('<img src=x onerror=alert(1)> npm ERR!')
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toMatch(/Private package feeds, build-time secrets, submodules and Git LFS aren't supported/)
  })

  it('REPO_NOT_ACCESSIBLE names the org and never claims whether the repo exists', () => {
    const w = mountPanel(failed('REPO_NOT_ACCESSIBLE'))
    expect(w.text()).toContain('organization')
    expect(w.text()).not.toMatch(/does not exist|doesn't exist|not found/i)
  })

  it('UNSUPPORTED_LANGUAGE lists the supported languages and links to the docs page', async () => {
    const pinia = createPinia()
    const nav = useNavigationStore(pinia)
    nav.navigateToPage('ship')
    const w = mount(ShipFailurePanel, { props: { status: failed('UNSUPPORTED_LANGUAGE'), supportedLanguages: ['Node.js', 'Go'] }, global: { plugins: [pinia] } })
    expect(w.get('[data-testid="ship-languages"]').text()).toContain('Node.js, Go')
    await w.get('[data-testid="ship-languages"] button').trigger('click')
    expect(nav.currentPage).toBe('docs')
  })

  it('SECURITY_GATE_FAILED says nothing was published; findings and counts live only in Details', async () => {
    const w = mountPanel(failed('SECURITY_GATE_FAILED', 'fix_then_ship', {
      severityCounts: { critical: 1, high: 2 }, findings: [{ package: 'lodash', version: '4.0.0', fixedIn: '4.17.21', severity: 'critical' }]
    }))
    expect(w.text()).toContain('Nothing was published')
    expect(w.text()).not.toContain('lodash')
    await btn(w, 'Details')!.trigger('click')
    const d = w.get('[data-testid="ship-failure-details"]').text()
    expect(d).toContain('lodash')
    expect(d).toContain('4.17.21')
    expect(d).toContain('critical: 1')
  })

  it('Details toggle reveals the correlation ID, code, buildpack id, last 50 lines (collapsed by default)', async () => {
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`)
    const w = mountPanel(failed('BUILD_FAILED', 'fix_then_ship', { buildpackId: 'paketo-buildpacks/npm-install', lastLines: lines, runUrl: 'https://github.com/o/r/actions/runs/1' }))
    expect(w.find('[data-testid="ship-failure-details"]').exists()).toBe(false)
    const toggle = btn(w, 'Details')!
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    const d = w.get('[data-testid="ship-failure-details"]').text()
    expect(d).toContain(CID)
    expect(d).toContain('paketo-buildpacks/npm-install')
    expect(d).toContain('line 80')
    expect(d).not.toContain('line 30\n')
    expect(d).toContain('Last 50 lines')
    expect(d).toContain('server message for BUILD_FAILED')
    expect(w.get('[data-testid="ship-failure-details"] a').attributes('href')).toBe('https://github.com/o/r/actions/runs/1')
  })

  it('drops a non-https run URL', async () => {
    const w = mountPanel(failed('UNKNOWN', 'fix_then_ship', { runUrl: 'javascript:alert(1)' }))
    await btn(w, 'Details')!.trigger('click')
    expect(w.find('[data-testid="ship-failure-details"] a').exists()).toBe(false)
  })

  it('Copy details writes a payload that includes the correlation ID, code and tail lines', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = mountPanel(failed('BUILD_FAILED', 'fix_then_ship', { buildpackId: 'bp/x', lastLines: ['a', 'b'] }))
    await btn(w, 'Copy details')!.trigger('click')
    const payload = writeText.mock.calls[0][0] as string
    expect(payload).toContain(`Correlation ID: ${CID}`)
    expect(payload).toContain('BUILD_FAILED')
    expect(payload).toContain('Buildpack: bp/x')
    expect(payload).toContain('a\nb')
    expect(w.text()).toContain('Copied')
  })

  it('cancelled state uses the cancelled title', () => {
    const w = mountPanel(failed('CANCELLED', 'reship', {}, { state: 'cancelled' }))
    expect(w.get('h2').text()).toBe('Ship cancelled')
  })

  it('report-only RUNNER_UNAVAILABLE (failed, not terminal) offers Cancel and no retry buttons yet', async () => {
    const s = status({ state: 'failed', terminal: false, failure: { code: 'RUNNER_UNAVAILABLE', message: 'm', nextStep: 'n', retry: 'reship', details: { runStillQueued: true, hint: 'runner_busy' } } })
    const w = mountPanel(s)
    expect(btn(w, 'Cancel')).toBeTruthy()
    await btn(w, 'Cancel')!.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
  })
})
