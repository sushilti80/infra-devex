import { defineStore } from 'pinia'
import { ref } from 'vue'

export type PageId = 'home' | 'docs' | 'faq' | 'custom' | 'template' | 'apps' | 'aks' | 'aks-apps' | 'rbac' | 'change' | 'feedback' | 'secrets' | 'ship'

export interface PrefillContext {
  appName: string
  environment: string
}

export const useNavigationStore = defineStore('navigation', () => {
  // State
  const currentPage = ref<PageId>('home')
  const cleanups = ref<Set<() => void>>(new Set())
  const prefillContext = ref<PrefillContext | null>(null)

  /**
   * Navigate to a different page
   * Runs cleanup functions before navigating
   * @param page - target page id
   * @param context - optional prefill context (appName + environment)
   */
  function navigateToPage(page: PageId, context?: PrefillContext): void {
    // Run all cleanup functions
    cleanups.value.forEach(fn => fn())
    cleanups.value.clear()

    // Set or clear prefill context
    prefillContext.value = context ?? null

    // Update current page
    currentPage.value = page
  }

  /**
   * Clear the prefill context without navigating
   */
  function clearPrefillContext(): void {
    prefillContext.value = null
  }

  /**
   * Register a cleanup function to run on page navigation
   * Useful for stopping polling, clearing intervals, etc.
   */
  function registerCleanup(fn: () => void) {
    cleanups.value.add(fn)
  }

  /**
   * Unregister a cleanup function
   */
  function unregisterCleanup(fn: () => void) {
    cleanups.value.delete(fn)
  }

  return {
    currentPage,
    prefillContext,
    navigateToPage,
    clearPrefillContext,
    registerCleanup,
    unregisterCleanup
  }
})
