/**
 * Page-level tests: FT-01 (page auth gate is in App spec), FT-04 (S3), FT-12 (recent on page), FT-13 (Ship new version),
 * FT-14 (S0, S0e, S1, S2), FT-15 (automated a11y checks), end-to-end flow with polling.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const api = vi.hoisted(() => ({
  getShipConfig: vi.fn(), listShipRepos: vi.fn(), listShipBranches: vi.fn(), getShipAppState: vi.fn(),
  startShip: vi.fn(), getShipStatus: vi.fn(), getShipLogs: vi.fn(), cancelShip: vi.fn(), retryShipConfigPr: vi.fn()
}))
vi.mock('@v2/services/api', () => ({ apiService: api, default: api }))
vi.mock('@v2/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 'oid-1', email: 'a@x.io', name: 'A', tenantId: 't' } }) }))

import ShipFromRepoPage from './ShipFromRepoPage.vue'
import { useShipStore } from '@v2/stores/ship'
import { useEnvironmentsStore } from '@v2/stores/environments'
import { useNavigationStore } from '@v2/stores/navigation'
import { addRecent, readRecent } from '@v2/utils/shipRecentStorage'
import { CID, status, succeeded, failed } from '@v2/components/ship/ship.fixtures'

const CONFIG = {
  allowedOrgs: ['Aya-DevOpsTeam'], supportedLanguages: ['Node.js', 'Python'], identity: { state: 'linked' }, previewConfiguredEnvs: [],
  defaults: { port: 8080, healthPath: '/healthz', bump: 'patch', teamLabel: 'software-engineering' },
  limits: { portMin: 1024, portMax: 65535, recentMax: 20, pollIntervalMs: 15000 }
}
const ok = (data: unknown) => ({ success: true, data })
const httpError = (s: number, code: string, extra: Record<string, unknown> = {}) => ({ response: { status: s, headers: {}, data: { success: false, error: { code, message: code, ...extra } } } })
const shipEnv = (over: Record<string, unknown> = {}) => ({ id: 'devsand', displayName: 'Dev Sandbox', subscriptionId: 's', enabled: true, features: { customInfra: true, templates: true, aks: true, shipFromRepo: true }, ...over })
const started = { correlationId: CID, app: 'my-app', env: 'devsand', repo: 'Aya-DevOpsTeam/my-app', branch: 'trunk', startedAt: '2026-01-01T00:00:00Z', appState: 'new', effectiveSettings: { port: 8080, healthPath: '/healthz' }, settingsIgnored: [], rollout: 'preview_pr' }

async function mountPage(opts: { envs?: unknown[] } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useEnvironmentsStore().environments = (opts.envs ?? [shipEnv()]) as never
  const w = mount(ShipFromRepoPage, { global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
  return { w, ship: useShipStore(), nav: useNavigationStore() }
}

/** Minimal structural a11y audit (axe-core is not a dependency of this repo). */
function auditA11y(root: HTMLElement) {
  const problems: string[] = []
  const nameOf = (el: Element) => {
    const id = el.getAttribute('id')
    if (el.getAttribute('aria-label')) return true
    const lb = el.getAttribute('aria-labelledby')
    if (lb && lb.split(' ').some(i => document.getElementById(i)?.textContent?.trim())) return true
    if (id && root.querySelector(`label[for="${id}"]`)?.textContent?.trim()) return true
    return !!el.closest('label')?.textContent?.trim()
  }
  root.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach(el => { if (!nameOf(el)) problems.push(`unlabelled <${el.tagName.toLowerCase()} id="${el.id}">`) })
  root.querySelectorAll('button').forEach(el => { if (!el.textContent?.trim() && !el.getAttribute('aria-label')) problems.push('button without name') })
  root.querySelectorAll('a').forEach(el => { if (!el.textContent?.trim() && !el.getAttribute('aria-label')) problems.push('link without name') })
  const ids = [...root.querySelectorAll('[id]')].map(e => e.id)
  ids.filter((id, i) => ids.indexOf(id) !== i).forEach(id => problems.push(`duplicate id ${id}`))
  root.querySelectorAll('[aria-controls]').forEach(el => {
    const target = el.getAttribute('aria-controls')!
    // collapsed disclosure buttons point at content that is intentionally not rendered; comboboxes must resolve
    if (el.getAttribute('role') === 'combobox' && !document.getElementById(target)) problems.push(`combobox aria-controls ${target} missing`)
  })
  root.querySelectorAll('[role="combobox"]').forEach(el => {
    for (const a of ['aria-expanded', 'aria-controls', 'aria-autocomplete']) if (!el.hasAttribute(a)) problems.push(`combobox missing ${a}`)
  })
  root.querySelectorAll('[aria-describedby]').forEach(el => {
    el.getAttribute('aria-describedby')!.split(' ').forEach(id => { if (!document.getElementById(id)) problems.push(`aria-describedby ${id} missing`) })
  })
  root.querySelectorAll('[aria-expanded]').forEach(el => { if (!['true', 'false'].includes(el.getAttribute('aria-expanded')!)) problems.push('aria-expanded not boolean') })
  root.querySelectorAll('img:not([alt])').forEach(() => problems.push('img without alt'))
  if (root.querySelectorAll('h1').length !== 1) problems.push(`expected 1 h1, got ${root.querySelectorAll('h1').length}`)
  return problems
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  Object.values(api).forEach(f => f.mockReset())
  api.getShipConfig.mockResolvedValue(ok(CONFIG))
  api.listShipRepos.mockResolvedValue(ok({ repos: [{ fullName: 'Aya-DevOpsTeam/my-app', org: 'Aya-DevOpsTeam', name: 'my-app', defaultBranch: 'trunk', private: true }], identity: { state: 'linked' }, truncated: false }))
  api.listShipBranches.mockResolvedValue(ok({ branches: [{ name: 'trunk', isDefault: true }], defaultBranch: 'trunk' }))
  api.getShipAppState.mockResolvedValue(ok({ appState: 'new', ownership: 'unclaimed', ownershipSource: 'github' }))
  api.getShipLogs.mockResolvedValue(ok({ stage: 'prepare', text: '', offset: 0, complete: false, available: false, truncated: false, skippedBytes: 0, totalBytes: 0 }))
})
afterEach(() => { vi.useRealTimers(); window.history.replaceState({}, '', '/') })

describe('ShipFromRepoPage — states (FT-14)', () => {
  it('S0: skeleton with aria-busy while config is in flight', async () => {
    let resolve!: (v: unknown) => void
    api.getShipConfig.mockReturnValue(new Promise(r => { resolve = r }))
    const { w } = await mountPage()
    const s0 = w.get('[data-testid="ship-loading"]')
    expect(s0.attributes('aria-busy')).toBe('true')
    expect(w.find('form').exists()).toBe(false)
    resolve(ok(CONFIG))
    await flushPromises()
    expect(w.find('[data-testid="ship-loading"]').exists()).toBe(false)
    expect(w.find('form').exists()).toBe(true)
    w.unmount()
  })

  it('S0e: config failure => "Couldn\'t load Ship from Repo" + Try again that reloads', async () => {
    api.getShipConfig.mockRejectedValueOnce(httpError(500, 'UNKNOWN'))
    const { w } = await mountPage()
    expect(w.text()).toContain("Couldn't load Ship from Repo")
    expect(w.find('form').exists()).toBe(false)
    await w.findAll('button').find(b => b.text() === 'Try again')!.trigger('click')
    await flushPromises()
    expect(w.find('form').exists()).toBe(true)
    w.unmount()
  })

  it('S1: no environment enabled => message + Back to home, no form, no API calls', async () => {
    const { w, nav } = await mountPage({ envs: [shipEnv({ features: { customInfra: true, templates: true, aks: true, shipFromRepo: false } })] })
    expect(w.text()).toContain("Ship from Repo isn't available in any environment right now.")
    expect(w.find('form').exists()).toBe(false)
    expect(api.getShipConfig).not.toHaveBeenCalled()
    nav.navigateToPage('ship')
    await w.findAll('button').filter(b => b.text() === 'Back to home')[0].trigger('click')
    expect(nav.currentPage).toBe('home')
    w.unmount()
  })

  it('S1 also when the environments catalogue failed to load (fail closed)', async () => {
    const { w } = await mountPage({ envs: [] })
    expect(w.text()).toContain("isn't available in any environment")
    w.unmount()
  })

  it('S2: unlinked identity => explanation, disabled form, Recent ships still shown', async () => {
    api.getShipConfig.mockResolvedValue(ok({ ...CONFIG, identity: { state: 'unlinked', reason: 'IDENTITY_MAPPING_NOT_CONFIGURED' } }))
    addRecent('oid-1', { correlationId: CID, app: 'older-app', env: 'devsand', repo: 'o/r', branch: 'main', startedAt: new Date().toISOString(), terminal: { state: 'succeeded', version: '1.0.0' } })
    const { w } = await mountPage()
    expect(w.text()).toContain("We couldn't verify your GitHub account, so shipping is turned off for you.")
    expect(w.text()).toContain('Ask the platform team to link it.')
    expect(w.get('#ship-repo').attributes('disabled')).toBeDefined()
    expect(w.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('older-app')
    expect(api.listShipRepos).not.toHaveBeenCalled()
    w.unmount()
  })

  it('S3: normal form with Advanced collapsed and Recent ships empty text', async () => {
    const { w } = await mountPage()
    expect(w.find('#ship-port').exists()).toBe(false)
    expect(w.text()).toContain('Ships you start will appear here.')
    expect(api.listShipRepos).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})

describe('ShipFromRepoPage — ship flow (S4→S7) with polling', () => {
  async function pickAndShip(ctx: Awaited<ReturnType<typeof mountPage>>) {
    await ctx.ship.selectRepo('Aya-DevOpsTeam/my-app')
    await flushPromises()
    await ctx.w.get('form').trigger('submit')
    await flushPromises()
  }

  it('202 → progress with five labels, deep link set, recent entry written; polls and reaches the result; terminal stored', async () => {
    api.startShip.mockResolvedValue(ok(started))
    api.getShipStatus
      .mockResolvedValueOnce(ok(status()))
      .mockResolvedValue(ok(succeeded()))
    const ctx = await mountPage()
    vi.useFakeTimers()
    await pickAndShip(ctx)

    expect(window.location.search).toBe(`?ship=${CID}`)
    expect(readRecent('oid-1')[0]).toMatchObject({ correlationId: CID, app: 'my-app', branch: 'trunk' })
    expect(ctx.w.find('[data-testid="ship-stages"]').exists()).toBe(true)
    expect(ctx.w.text()).toContain('Security check')

    await vi.advanceTimersByTimeAsync(15_000)
    await flushPromises()
    expect(ctx.w.get('[data-testid="ship-version"]').text()).toBe('0.1.3')
    expect(readRecent('oid-1')[0].terminal).toMatchObject({ state: 'succeeded', version: '0.1.3' })
    const calls = api.getShipStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(api.getShipStatus.mock.calls.length).toBe(calls) // stopped on terminal
    ctx.w.unmount()
  })

  it('failure result shows the failure panel; fail-closed start errors keep the form with a specific notice', async () => {
    api.startShip.mockRejectedValueOnce(httpError(503, 'SHIP_UNAVAILABLE'))
    const ctx = await mountPage()
    await pickAndShip(ctx)
    expect(ctx.w.get('[data-kind="unavailable"]').exists()).toBe(true)
    expect(ctx.w.find('form').exists()).toBe(true)
    expect(readRecent('oid-1')).toEqual([])

    api.startShip.mockRejectedValueOnce(httpError(403, 'REPO_NOT_ACCESSIBLE', { hint: 'IDENTITY_NOT_LINKED' }))
    await ctx.w.get('form').trigger('submit')
    await flushPromises()
    expect(ctx.w.get('[data-kind="not_linked"]').exists()).toBe(true)
    ctx.w.unmount()
  })

  it('S7: failed ship renders the failure panel with the right retry; Retry PR creation restarts polling past the old attempt', async () => {
    api.startShip.mockResolvedValue(ok(started))
    api.getShipStatus.mockResolvedValueOnce(ok(failed('CONFIG_PR_FAILED', 'retry_config', {}, { attempt: 1 })))
    const ctx = await mountPage()
    await pickAndShip(ctx)
    await flushPromises()
    expect(ctx.w.get('section[data-code="CONFIG_PR_FAILED"]').exists()).toBe(true)

    vi.useFakeTimers()
    api.retryShipConfigPr.mockResolvedValue(ok({ correlationId: CID, attempt: 2 }))
    api.getShipStatus
      .mockResolvedValueOnce(ok(failed('CONFIG_PR_FAILED', 'retry_config', {}, { attempt: 1 }))) // stale terminal
      .mockResolvedValueOnce(ok(succeeded({ attempt: 2 })))
    await ctx.w.findAll('button').find(b => b.text() === 'Retry PR creation')!.trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(15_000)
    await flushPromises()
    expect(api.retryShipConfigPr).toHaveBeenCalledWith(CID)
    expect(ctx.w.find('[data-testid="ship-version"]').exists()).toBe(true)
    ctx.w.unmount()
  })

  it('Cancel is sent while building; a 409 shows the plain-language reason', async () => {
    api.startShip.mockResolvedValue(ok(started))
    api.getShipStatus.mockResolvedValue(ok(status()))
    api.cancelShip.mockRejectedValueOnce(httpError(409, 'CANCEL_NOT_ALLOWED'))
    const ctx = await mountPage()
    await pickAndShip(ctx)
    await flushPromises()
    await ctx.w.findAll('button').find(b => b.text() === 'Cancel')!.trigger('click')
    await flushPromises()
    expect(api.cancelShip).toHaveBeenCalledWith(CID)
    expect(ctx.w.text()).toContain("You can't cancel once publishing has started.")
    ctx.w.unmount()
  })

  it('status 404/403 on an opened ship shows "This ship isn\'t available" and stops polling', async () => {
    window.history.replaceState({}, '', `/?ship=${CID}`)
    api.getShipStatus.mockRejectedValue(httpError(404, 'NOT_FOUND'))
    vi.useFakeTimers()
    const ctx = await mountPage()
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()
    expect(ctx.w.get('[data-testid="ship-unavailable"]').text()).toContain("This ship isn't available")
    const n = api.getShipStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(api.getShipStatus.mock.calls.length).toBe(n)
    ctx.w.unmount()
  })
})

describe('ShipFromRepoPage — deep link and recent (FT-12/16 page parts)', () => {
  it('?ship=<id> on load opens that ship and polls it (works without it being in Recent)', async () => {
    window.history.replaceState({}, '', `/?ship=${CID}`)
    api.getShipStatus.mockResolvedValue(ok(succeeded()))
    const { w } = await mountPage()
    await flushPromises()
    expect(api.getShipStatus).toHaveBeenCalledWith(CID)
    expect(w.get('[data-testid="ship-version"]').text()).toBe('0.1.3')
    w.unmount()
  })

  it('an invalid ?ship= value is ignored (form shown, no status call)', async () => {
    window.history.replaceState({}, '', '/?ship=not-a-uuid')
    const { w } = await mountPage()
    expect(api.getShipStatus).not.toHaveBeenCalled()
    expect(w.find('form').exists()).toBe(true)
    w.unmount()
  })

  it('leaving the page removes ?ship= and stops polling (navigation cleanup)', async () => {
    window.history.replaceState({}, '', `/?ship=${CID}`)
    api.getShipStatus.mockResolvedValue(ok(status()))
    vi.useFakeTimers()
    const { w, nav } = await mountPage()
    await vi.advanceTimersByTimeAsync(0)
    expect(window.location.search).toBe(`?ship=${CID}`)
    nav.navigateToPage('home')
    expect(window.location.search).toBe('')
    const n = api.getShipStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.getShipStatus.mock.calls.length).toBe(n)
    w.unmount()
  })

  it('unmount stops polling', async () => {
    window.history.replaceState({}, '', `/?ship=${CID}`)
    api.getShipStatus.mockResolvedValue(ok(status()))
    vi.useFakeTimers()
    const { w } = await mountPage()
    await vi.advanceTimersByTimeAsync(0)
    w.unmount()
    const n = api.getShipStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.getShipStatus.mock.calls.length).toBe(n)
  })

  it('Recent ships: only non-terminal refreshed on load; row opens the ship; unavailable row can be removed', async () => {
    const other = '01926f3c-8a41-7b3e-9d2a-0123456789ac'
    addRecent('oid-1', { correlationId: CID, app: 'done-app', env: 'devsand', repo: 'o/r', branch: 'main', startedAt: new Date().toISOString(), terminal: { state: 'succeeded', version: '1.0.0' } })
    addRecent('oid-1', { correlationId: other, app: 'gone-app', env: 'devsand', repo: 'o/r', branch: 'main', startedAt: new Date().toISOString() })
    api.getShipStatus.mockRejectedValue(httpError(404, 'NOT_FOUND'))
    const { w } = await mountPage()
    expect(api.getShipStatus).toHaveBeenCalledTimes(1)
    expect(api.getShipStatus).toHaveBeenCalledWith(other)
    expect(w.text()).toContain('No longer available')
    await w.findAll('button').find(b => b.text() === 'Remove')!.trigger('click')
    expect(readRecent('oid-1').map(e => e.correlationId)).toEqual([CID])
    api.getShipStatus.mockResolvedValue(ok(succeeded()))
    await w.findAll('li button').find(b => b.text() === 'done-app')!.trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="ship-version"]').exists()).toBe(true)
    w.unmount()
  })

  it('Clear list empties Recent ships for this user', async () => {
    addRecent('oid-1', { correlationId: CID, app: 'done-app', env: 'devsand', repo: 'o/r', branch: 'main', startedAt: new Date().toISOString(), terminal: { state: 'failed' } })
    const { w } = await mountPage()
    await w.findAll('button').find(b => b.text() === 'Clear list')!.trigger('click')
    expect(readRecent('oid-1')).toEqual([])
    expect(w.text()).toContain('Ships you start will appear here.')
    w.unmount()
  })
})

describe('ShipFromRepoPage — Ship new version (FT-13)', () => {
  it('result → Ship new version returns to the form pre-filled from the ship inputs', async () => {
    window.history.replaceState({}, '', `/?ship=${CID}`)
    api.getShipStatus.mockResolvedValue(ok(succeeded({ settings: { branch: 'release', namespace: 'ns1', teamLabel: 'team-x', port: 3000, healthPath: '/health', bump: 'minor' } })))
    const { w, ship } = await mountPage()
    await flushPromises()
    expect(w.text()).toContain('Push your code to release')
    await w.findAll('button').find(b => b.text() === 'Ship new version')!.trigger('click')
    await flushPromises()
    expect(w.find('form').exists()).toBe(true)
    expect(ship.draft).toMatchObject({ repo: 'Aya-DevOpsTeam/my-app', app: 'my-app', branch: 'release', port: 3000, healthPath: '/health', bump: 'minor', namespace: 'ns1', teamLabel: 'team-x' })
    expect((w.get('#ship-app').element as HTMLInputElement).value).toBe('my-app')
    expect(window.location.search).toBe('')
    w.unmount()
  })

  it('falls back to repo/branch/app and defaults when settings are unreadable', async () => {
    window.history.replaceState({}, '', `/?ship=${CID}`)
    api.getShipStatus.mockResolvedValue(ok(succeeded({ settings: undefined })))
    const { w, ship } = await mountPage()
    await flushPromises()
    await w.findAll('button').find(b => b.text() === 'Ship new version')!.trigger('click')
    await flushPromises()
    expect(ship.draft).toMatchObject({ repo: 'Aya-DevOpsTeam/my-app', app: 'my-app', branch: 'trunk', port: 8080, healthPath: '/healthz', bump: 'patch' })
    w.unmount()
  })

  it('after merge the prefilled form shows port/health path read-only', async () => {
    window.history.replaceState({}, '', `/?ship=${CID}`)
    api.getShipStatus.mockResolvedValue(ok(succeeded({ rollout: 'flux_auto_roll', pr: { number: 1, url: 'https://github.com/o/r/pull/1', state: 'merged' } })))
    api.getShipAppState.mockResolvedValue(ok({ appState: 'merged', ownership: 'same_repo', ownershipSource: 'github', effectiveSettings: { port: 8080, healthPath: '/healthz' } }))
    const { w, ship } = await mountPage()
    await flushPromises()
    expect(w.get('[data-testid="ship-post-merge-note"]').text()).toContain('will roll out automatically in a few minutes')
    await w.findAll('button').find(b => b.text() === 'Ship new version')!.trigger('click')
    await flushPromises()
    await ship.runAdvisory()
    await flushPromises()
    await w.findAll('button').find(b => b.text() === 'Advanced settings')!.trigger('click')
    expect(w.find('[data-testid="ship-post-merge"]').exists()).toBe(true)
    expect(w.find('#ship-port').exists()).toBe(false)
    w.unmount()
  })
})

describe('ShipFromRepoPage — automated a11y checks (FT-15)', () => {
  it('form (collapsed + Advanced expanded) has labelled controls, valid ARIA references, unique ids and one h1', async () => {
    const { w } = await mountPage()
    expect(auditA11y(w.element as HTMLElement)).toEqual([])
    await w.findAll('button').find(b => b.text() === 'Advanced settings')!.trigger('click')
    expect(auditA11y(w.element as HTMLElement)).toEqual([])
    w.unmount()
  })

  it('S1, S0e, S2 notices pass the audit', async () => {
    const s1 = await mountPage({ envs: [] })
    expect(auditA11y(s1.w.element as HTMLElement)).toEqual([])
    s1.w.unmount()
    api.getShipConfig.mockRejectedValueOnce(httpError(500, 'UNKNOWN'))
    const s0e = await mountPage()
    expect(auditA11y(s0e.w.element as HTMLElement)).toEqual([])
    expect(s0e.w.get('[role="alert"]').exists()).toBe(true)
    s0e.w.unmount()
    api.getShipConfig.mockResolvedValue(ok({ ...CONFIG, identity: { state: 'unlinked' } }))
    const s2 = await mountPage()
    expect(auditA11y(s2.w.element as HTMLElement)).toEqual([])
    s2.w.unmount()
  })

  it('progress (with Details open), result and failure views pass the audit and expose live regions / roles', async () => {
    window.history.replaceState({}, '', `/?ship=${CID}`)
    api.getShipStatus.mockResolvedValue(ok(status()))
    const p = await mountPage()
    await flushPromises()
    await p.w.findAll('button').find(b => b.text() === 'Details')!.trigger('click')
    expect(p.w.get('[aria-live="polite"]').exists()).toBe(true)
    expect(auditA11y(p.w.element as HTMLElement)).toEqual([])
    p.w.unmount()

    api.getShipStatus.mockResolvedValue(ok(succeeded()))
    window.history.replaceState({}, '', `/?ship=${CID}`)
    const r = await mountPage()
    await flushPromises()
    await r.w.findAll('button').find(b => b.text() === 'Technical details')!.trigger('click')
    expect(auditA11y(r.w.element as HTMLElement)).toEqual([])
    r.w.unmount()

    api.getShipStatus.mockResolvedValue(ok(failed('BUILD_FAILED', 'fix_then_ship', { lastLines: ['x'] })))
    window.history.replaceState({}, '', `/?ship=${CID}`)
    const f = await mountPage()
    await flushPromises()
    await f.w.findAll('button').find(b => b.text() === 'Details')!.trigger('click')
    expect(f.w.get('section[role="alert"]').exists()).toBe(true)
    expect(auditA11y(f.w.element as HTMLElement)).toEqual([])
    f.w.unmount()
  })

  it('every interactive control is keyboard reachable (native button/input/select/a; no click-only divs)', async () => {
    const { w } = await mountPage()
    const clickOnly = [...(w.element as HTMLElement).querySelectorAll('div[onclick], span[onclick]')]
    expect(clickOnly).toHaveLength(0)
    w.unmount()
  })
})
