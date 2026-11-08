/** FT-04 pickers, FT-05 form, FT-06 form default text, FT-13 post-merge read-only. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const api = vi.hoisted(() => ({
  getShipConfig: vi.fn(), listShipRepos: vi.fn(), listShipBranches: vi.fn(), getShipAppState: vi.fn(),
  startShip: vi.fn(), getShipStatus: vi.fn(), getShipLogs: vi.fn(), cancelShip: vi.fn(), retryShipConfigPr: vi.fn()
}))
vi.mock('@v2/services/api', () => ({ apiService: api, default: api }))
vi.mock('@v2/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 'oid-1', email: 'a@x.io', name: 'A', tenantId: 't' } }) }))

import ShipConfigForm from './ShipConfigForm.vue'
import { useShipStore } from '@v2/stores/ship'
import { useEnvironmentsStore } from '@v2/stores/environments'
import { FORBIDDEN_DEFAULT_TERMS } from './ship.fixtures'

const CONFIG = {
  allowedOrgs: ['organization'], supportedLanguages: ['Node.js'], identity: { state: 'linked' }, previewConfiguredEnvs: [],
  defaults: { port: 8080, healthPath: '/healthz', bump: 'patch', teamLabel: 'software-engineering' },
  limits: { portMin: 1024, portMax: 65535, recentMax: 20, pollIntervalMs: 15000 }
}
const ok = (data: unknown) => ({ success: true, data })
const httpError = (status: number, code: string, extra: Record<string, unknown> = {}) => ({ response: { status, headers: {}, data: { success: false, error: { code, message: code, ...extra } } } })
const env = (id: string, name: string) => ({ id, displayName: name, subscriptionId: 's', enabled: true, features: { customInfra: true, templates: true, aks: true, shipFromRepo: true } })

async function mountForm(opts: { envs?: ReturnType<typeof env>[]; disabled?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useEnvironmentsStore().environments = opts.envs ?? [env('devsand', 'Dev Sandbox')]
  const ship = useShipStore()
  await ship.loadConfig()
  await ship.loadRepos()
  const w = mount(ShipConfigForm, { props: { disabled: opts.disabled }, global: { plugins: [pinia] }, attachTo: document.body })
  return { w, ship }
}

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset())
  api.getShipConfig.mockResolvedValue(ok(CONFIG))
  api.listShipRepos.mockResolvedValue(ok({
    repos: [
      { fullName: 'organization/my-app', org: 'organization', name: 'my-app', defaultBranch: 'trunk', private: true },
      { fullName: 'organization/other', org: 'organization', name: 'other', defaultBranch: 'main', private: false }
    ], identity: { state: 'linked' }, truncated: false
  }))
  api.listShipBranches.mockResolvedValue(ok({ branches: [{ name: 'trunk', isDefault: true }, { name: 'dev', isDefault: false }], defaultBranch: 'trunk' }))
  api.getShipAppState.mockResolvedValue(ok({ appState: 'new', ownership: 'unclaimed', ownershipSource: 'github' }))
})

describe('ShipConfigForm — pickers (FT-04)', () => {
  it('picking a repo defaults the branch to the default branch and prefills the app name', async () => {
    const { w } = await mountForm()
    await w.get('#ship-repo').trigger('focus')
    await w.findAll('[role="option"]').find(o => o.text().startsWith('organization/my-app'))!.trigger('mousedown')
    await flushPromises()
    expect((w.get('#ship-branch').element as HTMLInputElement).value).toBe('trunk')
    expect((w.get('#ship-app').element as HTMLInputElement).value).toBe('my-app')
    w.unmount()
  })

  it('branch can be typed when it is not in the list', async () => {
    const { w, ship } = await mountForm()
    await ship.selectRepo('organization/my-app')
    await flushPromises()
    await w.get('#ship-branch').setValue('feature/not-listed')
    expect(ship.draft.branch).toBe('feature/not-listed')
    w.unmount()
  })

  it('branch is disabled until a repository is chosen', async () => {
    const { w } = await mountForm()
    expect(w.get('#ship-branch').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('a pasted GitHub URL is committed on Enter and loads branches', async () => {
    const { w, ship } = await mountForm()
    await w.get('#ship-repo').setValue('https://github.com/organization/other')
    await w.get('#ship-repo').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(ship.draft.repo).toBe('organization/other')
    expect(api.listShipBranches).toHaveBeenCalledWith('organization', 'other')
    w.unmount()
  })

  it('not-accessible repo: generic message naming the org, no existence hint, no branches', async () => {
    api.listShipBranches.mockRejectedValue(httpError(403, 'REPO_NOT_ACCESSIBLE'))
    const { w, ship } = await mountForm()
    await ship.selectRepo('organization/private-thing')
    await flushPromises()
    const alert = w.get('[data-kind="not_accessible"]')
    expect(alert.text()).toContain("We couldn't access that repository with your GitHub permissions.")
    expect(alert.text()).toContain('organization')
    expect(alert.text()).not.toMatch(/exist|not found/i)
    w.unmount()
  })

  it('a truncated repo list tells the user they can type or paste org/name', async () => {
    api.listShipRepos.mockResolvedValue(ok({ repos: [{ fullName: 'organization/a', org: 'organization', name: 'a', defaultBranch: 'main', private: false }], identity: { state: 'linked' }, truncated: true }))
    const { w } = await mountForm()
    expect(w.get('[data-testid="ship-repos-truncated"]').text()).toContain('Type or paste org/name')
    w.unmount()
  })

  it('empty repo list shows how to request App access, naming the org', async () => {
    api.listShipRepos.mockResolvedValue(ok({ repos: [], identity: { state: 'linked' }, truncated: false }))
    const { w } = await mountForm()
    expect(w.text()).toContain('No repositories found')
    expect(w.text()).toContain('organization')
    expect(w.text()).toMatch(/install the Ship GitHub App/)
    w.unmount()
  })

  it('repo list error uses the specific notice (503 SHIP_UNAVAILABLE), not a generic error', async () => {
    api.listShipRepos.mockRejectedValue(httpError(503, 'SHIP_UNAVAILABLE'))
    const { w } = await mountForm()
    expect(w.get('[data-kind="unavailable"]').text()).toContain('temporarily unavailable')
    w.unmount()
  })

  it('identity-not-linked repo error shows the S2 wording', async () => {
    api.listShipRepos.mockRejectedValue(httpError(403, 'REPO_NOT_ACCESSIBLE', { hint: 'IDENTITY_NOT_LINKED' }))
    const { w } = await mountForm()
    expect(w.get('[data-kind="not_linked"]').text()).toContain("We couldn't verify your GitHub account")
    w.unmount()
  })
})

describe('ShipConfigForm — fields, validation, defaults (FT-05)', () => {
  it('environment is read-only text when exactly one is enabled, a select otherwise (no hardcoded ids)', async () => {
    const one = await mountForm()
    expect(one.w.get('[data-testid="ship-env-text"]').text()).toBe('Dev Sandbox')
    expect(one.w.find('#ship-env').exists()).toBe(false)
    one.w.unmount()

    const two = await mountForm({ envs: [env('alpha', 'Alpha'), env('beta', 'Beta')] })
    const options = two.w.findAll('#ship-env option').map(o => o.text())
    expect(options).toEqual(['Choose an environment', 'Alpha', 'Beta'])
    expect(two.ship.draft.env).toBe('')
    await two.w.get('#ship-env').setValue('beta')
    expect(two.ship.draft.env).toBe('beta')
    two.w.unmount()
  })

  it('Advanced is collapsed by default and holds port, health path, bump, namespace, team label with defaults', async () => {
    const { w, ship } = await mountForm()
    expect(w.find('#ship-port').exists()).toBe(false)
    expect(w.find('#ship-namespace').exists()).toBe(false)
    const toggle = w.findAll('button').find(b => b.text() === 'Advanced settings')!
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect((w.get('#ship-port').element as HTMLInputElement).value).toBe('8080')
    expect((w.get('#ship-health').element as HTMLInputElement).value).toBe('/healthz')
    expect((w.get('#ship-bump').element as HTMLSelectElement).value).toBe('patch')
    expect((w.get('#ship-team').element as HTMLInputElement).value).toBe('software-engineering')
    expect((w.get('#ship-namespace').element as HTMLInputElement).value).toBe('')
    expect(ship.draft.port).toBe(8080)
    w.unmount()
  })

  it('shows the $PORT helper text and the configured port (AC-002-5)', async () => {
    const { w } = await mountForm()
    await w.findAll('button').find(b => b.text() === 'Advanced settings')!.trigger('click')
    const help = w.get('#ship-port-help').text()
    expect(help).toContain('$PORT')
    expect(help).toContain('8080')
    expect(w.get('#ship-health-help').text()).toContain('/health')
    w.unmount()
  })

  it('inline DNS-1123 validation on app name blocks submit', async () => {
    const { w, ship } = await mountForm()
    await ship.selectRepo('organization/my-app')
    await flushPromises()
    expect(w.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    await w.get('#ship-app').setValue('Bad_Name')
    await w.get('#ship-app').trigger('blur')
    expect(w.get('#ship-app-error').text()).toMatch(/lowercase letters/)
    expect(w.get('#ship-app').attributes('aria-invalid')).toBe('true')
    expect(w.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('validates port range and health path inline', async () => {
    const { w, ship } = await mountForm()
    await ship.selectRepo('organization/my-app')
    await flushPromises()
    await w.findAll('button').find(b => b.text() === 'Advanced settings')!.trigger('click')
    await w.get('#ship-port').setValue('80')
    await w.get('#ship-port').trigger('blur')
    await w.get('#ship-health').setValue('healthz')
    await w.get('#ship-health').trigger('blur')
    const text = w.text()
    expect(text).toMatch(/between 1024 and 65535/)
    expect(text).toMatch(/must start with "\/"/)
    expect(w.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('a reserved-namespace server error (400 VALIDATION_FAILED) is shown on the namespace field', async () => {
    api.startShip.mockRejectedValue(httpError(400, 'VALIDATION_FAILED', { details: [{ field: 'namespace', message: 'namespace is reserved' }] }))
    const { w, ship } = await mountForm()
    await ship.selectRepo('organization/my-app')
    await flushPromises()
    await w.findAll('button').find(b => b.text() === 'Advanced settings')!.trigger('click')
    await ship.submit()
    await flushPromises()
    expect(w.get('[data-kind="validation"]').exists()).toBe(true)
    w.unmount()
  })

  it('submitting emits submit only when valid; Ship is disabled and busy while submitting (S4)', async () => {
    const { w, ship } = await mountForm()
    await w.get('form').trigger('submit')
    expect(w.emitted('submit')).toBeUndefined() // nothing chosen yet
    await ship.selectRepo('organization/my-app')
    await flushPromises()
    await w.get('form').trigger('submit')
    expect(w.emitted('submit')).toHaveLength(1)
    ship.submitting = true
    await flushPromises()
    expect(w.get('button[type="submit"]').text()).toBe('Shipping…')
    expect(w.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(w.get('#ship-app').attributes('disabled')).toBeDefined()
    expect(w.get('form').attributes('aria-busy')).toBe('true')
    w.unmount()
  })

  it('a name owned by another repo blocks submit with an inline error naming the owner when known', async () => {
    api.getShipAppState.mockResolvedValue(ok({ appState: 'new', ownership: 'other_repo', owningRepo: 'org/owner', ownershipSource: 'github' }))
    const { w, ship } = await mountForm()
    await ship.selectRepo('organization/my-app')
    await flushPromises()
    await ship.runAdvisory()
    await flushPromises()
    await w.get('#ship-app').trigger('blur')
    expect(w.get('#ship-app-error').text()).toContain('org/owner')
    expect(w.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('rate-limited / unavailable / not-linked submit errors render their specific notices', async () => {
    const { w, ship } = await mountForm()
    ship.startError = { status: 429, code: 'PLATFORM_RATE_LIMITED', message: 'x', retryAfterSec: 120 }
    await flushPromises()
    expect(w.get('[data-kind="rate_limited"]').text()).toContain('about 120 seconds')
    ship.startError = { status: 503, code: 'SHIP_UNAVAILABLE', message: 'x' }
    await flushPromises()
    expect(w.get('[data-kind="unavailable"]').exists()).toBe(true)
    ship.startError = { status: 403, code: 'REPO_NOT_ACCESSIBLE', message: 'x', hint: 'IDENTITY_NOT_LINKED' }
    await flushPromises()
    expect(w.get('[data-kind="not_linked"]').exists()).toBe(true)
    w.unmount()
  })

  it('disabled (S2) locks every control', async () => {
    const { w } = await mountForm({ disabled: true })
    expect(w.get('#ship-repo').attributes('disabled')).toBeDefined()
    expect(w.get('#ship-app').attributes('disabled')).toBeDefined()
    expect(w.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })
})

describe('ShipConfigForm — advisory hints and post-merge (FT-13)', () => {
  it('after merge, port and health path are read-only text with the fixed-settings explanation', async () => {
    api.getShipAppState.mockResolvedValue(ok({ appState: 'merged', ownership: 'same_repo', ownershipSource: 'github', effectiveSettings: { port: 9000, healthPath: '/health' } }))
    const { w, ship } = await mountForm()
    await ship.selectRepo('organization/my-app')
    await flushPromises()
    await ship.runAdvisory()
    await flushPromises()
    await w.findAll('button').find(b => b.text() === 'Advanced settings')!.trigger('click')
    const pm = w.get('[data-testid="ship-post-merge"]')
    expect(pm.text()).toContain('9000')
    expect(pm.text()).toContain('/health')
    expect(pm.text()).toContain('Settings are fixed after your app is approved. Ask the platform team to change them.')
    expect(w.find('#ship-port').exists()).toBe(false)
    expect(w.find('#ship-health').exists()).toBe(false)
    expect(w.text()).toContain('New versions roll out automatically')
    w.unmount()
  })

  it('open / closed-without-merge PR hints', async () => {
    api.getShipAppState.mockResolvedValue(ok({ appState: 'preview_open', ownership: 'same_repo', ownershipSource: 'github' }))
    const { w, ship } = await mountForm()
    await ship.selectRepo('organization/my-app'); await flushPromises(); await ship.runAdvisory(); await flushPromises()
    expect(w.text()).toContain('already has an open pull request')
    api.getShipAppState.mockResolvedValue(ok({ appState: 'closed_unmerged', ownership: 'same_repo', ownershipSource: 'github' }))
    ship.draft.app = 'my-app2'
    await flushPromises(); await ship.runAdvisory(); await flushPromises()
    expect(w.text()).toContain('closed without merging')
    w.unmount()
  })
})

describe('ShipConfigForm — default view text (FT-06)', () => {
  it('collapsed form renders only user-facing terms: no namespace/image/tag/digest/Flux/buildpack/correlation ID', async () => {
    const { w, ship } = await mountForm()
    await ship.selectRepo('organization/my-app')
    await flushPromises()
    const text = w.text()
    for (const re of FORBIDDEN_DEFAULT_TERMS) expect(text, String(re)).not.toMatch(re)
    expect(text).not.toMatch(/\$PORT|health path|port\b/i) // port/health live under Advanced only
    expect(text).toContain('Repository')
    expect(text).toContain('Branch')
    expect(text).toContain('App name')
    expect(text).toContain('Ship')
    w.unmount()
  })

  it('technical terms appear only after expanding Advanced', async () => {
    const { w } = await mountForm()
    await w.findAll('button').find(b => b.text() === 'Advanced settings')!.trigger('click')
    expect(w.text()).toMatch(/Namespace/)
    expect(w.text()).toMatch(/\$PORT/)
    w.unmount()
  })
})
