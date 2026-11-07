/**
 * Unit Tests — navigation.ts store
 * Covers: FR-002 — prefillContext state, navigateToPage optional context,
 *         clearPrefillContext action, backward-compatibility
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useNavigationStore } from './navigation'

describe('useNavigationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ─── Initial state ─────────────────────────────────────────────────────────
  it('initialises with currentPage = home and prefillContext = null', () => {
    const store = useNavigationStore()
    expect(store.currentPage).toBe('home')
    expect(store.prefillContext).toBeNull()
  })

  // ─── FR-002: navigateToPage without context ─────────────────────────────
  it('navigates without context and sets prefillContext to null', () => {
    const store = useNavigationStore()
    store.navigateToPage('custom')
    expect(store.currentPage).toBe('custom')
    expect(store.prefillContext).toBeNull()
  })

  it('sets prefillContext to null when context is omitted on a second call', () => {
    const store = useNavigationStore()
    // First call with context
    store.navigateToPage('custom', { appName: 'myapp', environment: 'sand' })
    expect(store.prefillContext).not.toBeNull()
    // Second call without context — must clear
    store.navigateToPage('home')
    expect(store.prefillContext).toBeNull()
    expect(store.currentPage).toBe('home')
  })

  // ─── FR-002: navigateToPage with context ────────────────────────────────
  it("sets prefillContext when context is provided", () => {
    const store = useNavigationStore()
    store.navigateToPage('custom', { appName: 'myapp', environment: 'sand' })
    expect(store.prefillContext).toEqual({ appName: 'myapp', environment: 'sand' })
    expect(store.currentPage).toBe('custom')
  })

  it('overwrites a previous prefillContext with a new one', () => {
    const store = useNavigationStore()
    store.navigateToPage('custom', { appName: 'app1', environment: 'dev' })
    store.navigateToPage('custom', { appName: 'app2', environment: 'prod' })
    expect(store.prefillContext).toEqual({ appName: 'app2', environment: 'prod' })
  })

  // ─── FR-002: clearPrefillContext ─────────────────────────────────────────
  it('clearPrefillContext sets prefillContext to null without navigating', () => {
    const store = useNavigationStore()
    store.navigateToPage('custom', { appName: 'myapp', environment: 'sand' })
    store.clearPrefillContext()
    expect(store.prefillContext).toBeNull()
    // currentPage unchanged
    expect(store.currentPage).toBe('custom')
  })

  // ─── Cleanup functions run on navigate ─────────────────────────────────
  it('runs registered cleanup functions when navigating', () => {
    const store = useNavigationStore()
    let cleanupRan = false
    store.registerCleanup(() => { cleanupRan = true })
    store.navigateToPage('docs')
    expect(cleanupRan).toBe(true)
  })

  it('clears cleanup registry after navigation', () => {
    const store = useNavigationStore()
    let count = 0
    store.registerCleanup(() => { count++ })
    store.navigateToPage('template')
    store.navigateToPage('home')
    // cleanup should only have run once
    expect(count).toBe(1)
  })

  it('unregisterCleanup removes a cleanup before navigation', () => {
    const store = useNavigationStore()
    let cleanupRan = false
    const fn = () => { cleanupRan = true }
    store.registerCleanup(fn)
    store.unregisterCleanup(fn)
    store.navigateToPage('apps')
    expect(cleanupRan).toBe(false)
  })

  // ─── All valid PageId values compile and route correctly ────────────────
  it.each([
    'home', 'docs', 'custom', 'template', 'apps',
    'aks', 'aks-apps', 'rbac', 'change', 'feedback'
  ] as const)('accepts PageId "%s"', (page) => {
    const store = useNavigationStore()
    store.navigateToPage(page)
    expect(store.currentPage).toBe(page)
  })
})
