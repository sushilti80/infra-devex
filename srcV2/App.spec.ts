/**
 * FT-01: home-card gating (hidden by default), page auth gate.
 * FT-16: deep link across the MSAL login redirect (sessionStorage ship.pendingDeepLink).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import environmentsFile from '../data/environments.json'

vi.mock('@v2/composables/useAuth', async () => {
  const { ref } = await import('vue')
  const isAuthenticated = ref(false)
  return {
    __isAuthenticated: isAuthenticated,
    useAuth: () => ({ isAuthenticated, login: vi.fn(), isLoading: ref(false) })
  }
})
// stores/auth pulls MSAL; App never needs it in these tests
vi.mock('@v2/services/authService', () => ({ getAuthInstance: vi.fn(() => ({})), loginRequest: {}, tokenRequest: {}, silentRequest: {}, setActiveAccount: vi.fn() }))

import App from './App.vue'
import * as authMock from '@v2/composables/useAuth'
import { useEnvironmentsStore, type EnvironmentConfig } from '@v2/stores/environments'
import { useNavigationStore } from '@v2/stores/navigation'
import { PENDING_DEEP_LINK_KEY } from '@v2/utils/shipHelpers'

const signedIn = (v: boolean) => { (authMock as unknown as { __isAuthenticated: { value: boolean } }).__isAuthenticated.value = v }
const V7 = '01926f3c-8a41-7b3e-9d2a-0123456789ab'
const env = (shipFromRepo?: boolean): EnvironmentConfig => ({
  id: 'any-env-id', displayName: 'Any', subscriptionId: 's', enabled: true,
  features: { customInfra: true, templates: true, aks: true, ...(shipFromRepo === undefined ? {} : { shipFromRepo }) }
})

function mountApp(envs: EnvironmentConfig[] = []) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useEnvironmentsStore().environments = envs
  const w = shallowMount(App, { global: { plugins: [pinia] } })
  return { w, nav: useNavigationStore(), envs: useEnvironmentsStore() }
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  signedIn(false)
})

describe('App — ship home card and page gate (FT-01)', () => {
  it('the card and page are hidden by default: the real data/environments.json has shipFromRepo=false on devsand', async () => {
    const file = environmentsFile as { environments: EnvironmentConfig[] }
    const devsand = file.environments.find(e => e.id === 'devsand')!
    expect(devsand.features.shipFromRepo).toBe(false)
    expect(file.environments.filter(e => e.features.shipFromRepo === true)).toEqual([])

    signedIn(true)
    const { w, envs } = mountApp(file.environments)
    expect(envs.shipEnabled).toBe(false)
    expect(w.find('[data-testid="ship-card"]').exists()).toBe(false)
    expect(w.text()).not.toContain('Ship an app from GitHub')
  })

  it('the card is hidden when the flag is absent or false, shown when any environment has it (no hardcoded ids)', async () => {
    signedIn(true)
    expect(mountApp([env()]).w.find('[data-testid="ship-card"]').exists()).toBe(false)
    expect(mountApp([env(false)]).w.find('[data-testid="ship-card"]').exists()).toBe(false)
    const on = mountApp([env(true)])
    expect(on.w.find('[data-testid="ship-card"]').exists()).toBe(true)
    expect(on.w.get('[data-testid="ship-card"]').text()).toContain('Ship an app from GitHub')
  })

  it('card appears/disappears reactively with the flag', async () => {
    signedIn(true)
    const { w, envs } = mountApp([env(false)])
    expect(w.find('[data-testid="ship-card"]').exists()).toBe(false)
    envs.environments = [env(true)]
    await nextTick()
    expect(w.find('[data-testid="ship-card"]').exists()).toBe(true)
  })

  it('clicking the card navigates to the ship page', async () => {
    signedIn(true)
    const { w, nav } = mountApp([env(true)])
    await w.get('[data-testid="ship-card"]').trigger('click')
    expect(nav.currentPage).toBe('ship')
    await nextTick()
    expect(w.findComponent({ name: 'ShipFromRepoPage' }).exists()).toBe(true)
  })

  it('page auth gate: unauthenticated users never get the ship page or card', async () => {
    const { w, nav } = mountApp([env(true)])
    nav.navigateToPage('ship')
    await nextTick()
    expect(w.findComponent({ name: 'ShipFromRepoPage' }).exists()).toBe(false)
    expect(w.find('[data-testid="ship-card"]').exists()).toBe(false)
  })

  it('direct navigation with no environment enabled still reaches the page (it renders S1 itself)', async () => {
    signedIn(true)
    const { w, nav } = mountApp([env(false)])
    nav.navigateToPage('ship')
    await nextTick()
    expect(w.findComponent({ name: 'ShipFromRepoPage' }).exists()).toBe(true)
  })
})

describe('App — ship deep link across login (FT-16)', () => {
  it('unauthenticated ?ship=<uuidv7> is parked in sessionStorage and does not navigate', () => {
    window.history.replaceState({}, '', `/?ship=${V7}`)
    const { nav } = mountApp([env(true)])
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe(V7)
    expect(nav.currentPage).toBe('home')
  })

  it('an invalid ?ship= (non UUIDv7, markup) is discarded, never stored', () => {
    for (const bad of ['abc', '"><script>', '01926f3c-8a41-4b3e-9d2a-0123456789ab']) {
      window.history.replaceState({}, '', `/?ship=${encodeURIComponent(bad)}`)
      mountApp([env(true)])
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull()
    }
  })

  it('after the MSAL redirect (query string dropped, authenticated at mount) the pending ID opens that ship and is cleared', () => {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, V7)
    signedIn(true)
    const { nav } = mountApp([env(true)])
    expect(nav.currentPage).toBe('ship')
    expect(window.location.search).toBe(`?ship=${V7}`)
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull()
  })

  it('signing in after mount also restores the pending ID', async () => {
    window.history.replaceState({}, '', `/?ship=${V7}`)
    const { nav } = mountApp([env(true)])
    expect(nav.currentPage).toBe('home')
    window.history.replaceState({}, '', '/') // redirect dropped the query
    signedIn(true)
    await nextTick()
    expect(nav.currentPage).toBe('ship')
    expect(window.location.search).toBe(`?ship=${V7}`)
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull()
  })

  it('authenticated user opening ?ship=<id> goes straight to the ship page (and nothing is left in sessionStorage)', () => {
    window.history.replaceState({}, '', `/?ship=${V7}`)
    signedIn(true)
    const { nav } = mountApp([env(true)])
    expect(nav.currentPage).toBe('ship')
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull()
  })

  it('a tampered pending value is discarded and cleared without navigating', () => {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, 'javascript:alert(1)')
    signedIn(true)
    const { nav } = mountApp([env(true)])
    expect(nav.currentPage).toBe('home')
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull()
  })

  it('without any ship link nothing changes', () => {
    signedIn(true)
    const { nav } = mountApp([env(true)])
    expect(nav.currentPage).toBe('home')
  })
})
