/**
 * FT-02: environments store — Ship from Repo gating is flag-driven (no hardcoded environment ids).
 * FT-01 (part): PageId 'ship' is navigable and runs cleanups.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEnvironmentsStore, type EnvironmentConfig } from './environments'
import { useNavigationStore } from './navigation'

const env = (id: string, over: Partial<EnvironmentConfig> & { features?: Partial<EnvironmentConfig['features']> } = {}): EnvironmentConfig => ({
  id,
  displayName: id,
  subscriptionId: `sub-${id}`,
  enabled: true,
  ...over,
  features: { customInfra: true, templates: true, aks: true, ...(over.features ?? {}) }
})

function load(store: ReturnType<typeof useEnvironmentsStore>, envs: EnvironmentConfig[]) {
  store.environments = envs
}

describe('environments store — ship gating (FT-02)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('is hidden by default: no flag, or flag=false, yields no ship environments', () => {
    const s = useEnvironmentsStore()
    load(s, [env('devsand'), env('other', { features: { shipFromRepo: false } })])
    expect(s.shipEnvironments).toEqual([])
    expect(s.shipEnabled).toBe(false)
  })

  it('is enabled by the data flag for ANY environment id (nothing is hardcoded)', () => {
    const s = useEnvironmentsStore()
    load(s, [env('zzz-custom-env', { features: { shipFromRepo: true } }), env('devsand')])
    expect(s.shipEnvironments.map(e => e.id)).toEqual(['zzz-custom-env'])
    expect(s.shipEnabled).toBe(true)
  })

  it('requires enabled AND features.aks AND features.shipFromRepo', () => {
    const s = useEnvironmentsStore()
    load(s, [
      env('a', { enabled: false, features: { shipFromRepo: true } }),
      env('b', { features: { aks: false, shipFromRepo: true } }),
      env('c', { features: { shipFromRepo: true } })
    ])
    expect(s.shipEnvironments.map(e => e.id)).toEqual(['c'])
  })

  it('treats a truthy non-boolean flag value as off (strict true only)', () => {
    const s = useEnvironmentsStore()
    load(s, [env('a', { features: { shipFromRepo: 'yes' as unknown as boolean } })])
    expect(s.shipEnabled).toBe(false)
  })

  it('fails closed when the environments catalogue is empty (fetch failure)', () => {
    const s = useEnvironmentsStore()
    load(s, [])
    expect(s.shipEnabled).toBe(false)
  })
})

describe('navigation store — ship page (FT-01)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it("accepts PageId 'ship' and runs registered cleanups when leaving it", () => {
    const nav = useNavigationStore()
    const cleanup = vi.fn()
    nav.navigateToPage('ship')
    expect(nav.currentPage).toBe('ship')
    nav.registerCleanup(cleanup)
    nav.navigateToPage('home')
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(nav.currentPage).toBe('home')
  })
})
