/**
 * QA (ship-from-repo, independent) frontend checks: the feature is HIDDEN with the real data/environments.json on every
 * surface (home card is covered in App.spec.ts; here Docs section/nav link and the page itself, with zero API traffic),
 * the flag is strictly `=== true`, and hostile server strings render as inert text. Spec FT-01/02/06/11/14, §9.5.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import environmentsFile from '../../data/environments.json'

const api = vi.hoisted(() => ({
  getShipConfig: vi.fn(), listShipRepos: vi.fn(), listShipBranches: vi.fn(), getShipAppState: vi.fn(),
  startShip: vi.fn(), getShipStatus: vi.fn(), getShipLogs: vi.fn(), cancelShip: vi.fn(), retryShipConfigPr: vi.fn()
}))
vi.mock('@v2/services/api', () => ({ apiService: api, default: api }))
vi.mock('@v2/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 'oid-1', email: 'a@x.io', name: 'A', tenantId: 't' } }) }))

import ShipFromRepoPage from './ShipFromRepoPage.vue'
import DocsPage from './DocsPage.vue'
import ShipFailurePanel from '@v2/components/ship/ShipFailurePanel.vue'
import ShipLogViewer from '@v2/components/ship/ShipLogViewer.vue'
import { useEnvironmentsStore, type EnvironmentConfig } from '@v2/stores/environments'
import { CID, failed } from '@v2/components/ship/ship.fixtures'

const realEnvs = (environmentsFile as { environments: EnvironmentConfig[] }).environments

function withEnvs(envs: unknown[]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useEnvironmentsStore().environments = envs as EnvironmentConfig[]
  return pinia
}

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); localStorage.clear(); sessionStorage.clear() })

describe('hidden with the real data/environments.json (flag false on devsand)', () => {
  it('no environment in the real file is ship-enabled; the store reports shipEnabled=false', () => {
    withEnvs(realEnvs)
    const store = useEnvironmentsStore()
    expect(realEnvs.length).toBeGreaterThan(0)
    expect(store.shipEnvironments).toEqual([])
    expect(store.shipEnabled).toBe(false)
  })
  it('Docs: neither the Ship from Repo section nor its sidebar link exists', () => {
    const w = mount(DocsPage, { global: { plugins: [withEnvs(realEnvs)] } })
    expect(w.find('#ship-from-repo').exists()).toBe(false)
    expect(w.find('[data-testid="docs-ship-section"]').exists()).toBe(false)
    expect(w.find('a[href="#ship-from-repo"]').exists()).toBe(false)
    expect(w.text()).not.toMatch(/Ship from Repo/i)
  })
  it('the page itself (reachable only by deep link) shows the unavailable notice, no form, and makes ZERO API calls', async () => {
    const w = mount(ShipFromRepoPage, { global: { plugins: [withEnvs(realEnvs)] }, attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain("isn't available in any environment")
    expect(w.find('form').exists()).toBe(false)
    for (const [name, fn] of Object.entries(api)) expect(fn, name).not.toHaveBeenCalled()
    w.unmount()
  })
  it('the flag is strictly `=== true`: "true", 1, "yes", null, {} and an enabled=false environment all stay hidden', async () => {
    const base = { id: 'x', displayName: 'X', subscriptionId: 's', enabled: true }
    const variants = [
      { ...base, features: { aks: true, shipFromRepo: 'true' } },
      { ...base, features: { aks: true, shipFromRepo: 1 } },
      { ...base, features: { aks: true, shipFromRepo: 'yes' } },
      { ...base, features: { aks: true, shipFromRepo: null } },
      { ...base, features: { aks: true, shipFromRepo: {} } },
      { ...base, enabled: false, features: { aks: true, shipFromRepo: true } },
      { ...base, features: { aks: false, shipFromRepo: true } },
    ]
    for (const v of variants) {
      const pinia = withEnvs([v])
      expect(useEnvironmentsStore().shipEnabled, JSON.stringify(v)).toBe(false)
      const docs = mount(DocsPage, { global: { plugins: [pinia] } })
      expect(docs.find('#ship-from-repo').exists(), JSON.stringify(v)).toBe(false)
    }
  })
})

describe('hostile server strings render as inert text (no markup, no handlers)', () => {
  const HOSTILE = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>'
  it('failure panel: errorLine (BUILD_FAILED and other codes) is text', () => {
    for (const code of ['BUILD_FAILED', 'UNKNOWN']) {
      const w = mount(ShipFailurePanel, { props: { status: failed(code, 'fix_then_ship', { errorLine: HOSTILE, buildpackId: HOSTILE }) } })
      expect(w.find('img').exists(), code).toBe(false)
      expect(w.find('script').exists(), code).toBe(false)
      expect(w.html()).not.toMatch(/<img|<script/)
      expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    }
  })
  it('log viewer: <script>/<img> in build output is shown literally; no element is created', async () => {
    api.getShipLogs.mockResolvedValue({ success: true, data: { stage: 'build', text: `${HOSTILE}\n`, offset: 80, complete: true, available: true, truncated: false, skippedBytes: 0, totalBytes: 80 } })
    const w = mount(ShipLogViewer, { props: { correlationId: CID }, attachTo: document.body })
    await w.findAll('button').find((b) => b.text() === 'Show logs')!.trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="ship-log-text"]').text()).toContain('<script>')
    expect(w.find('img').exists()).toBe(false)
    expect(w.find('script').exists()).toBe(false)
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    w.unmount()
  })
})
