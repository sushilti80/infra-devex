import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getAuthInstance,
  loginRequest,
  tokenRequest,
  silentRequest,
  setActiveAccount
} from '@v2/services/authService'
import type { AccountInfo, AuthenticationResult } from '@azure/msal-browser'
import { useNavigationStore } from './navigation'
import { clearShipRecent } from '@v2/utils/shipRecentStorage'

/**
 * User information extracted from MSAL account
 */
export interface User {
  id: string
  email: string
  name: string
  tenantId: string
}

/**
 * Authentication Store
 * Manages user authentication state and MSAL operations
 */
export const useAuthStore = defineStore('auth', () => {
  // State
  const user = ref<User | null>(null)
  const token = ref<string | null>(null)
  const account = ref<AccountInfo | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const isAuthenticated = computed(() => !!user.value && !!token.value)

  /**
   * Login with redirect
   * Redirects to Microsoft login page (more reliable than popup)
   */
  async function login(): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      console.log('[Auth Store] Starting login redirect...')
      // Using redirect instead of popup - more reliable, no nested popup issues
      await getAuthInstance().loginRedirect(loginRequest)
      // Note: Page will reload after redirect, restoreSession() will complete the flow
    } catch (err: any) {
      const errorMsg = err.message || 'Login failed'
      error.value = errorMsg
      console.error('[Auth Store] Login error:', err)
      isLoading.value = false
      throw new Error(errorMsg)
    }
  }

  /**
   * Logout and clear session
   * Performs local logout without redirecting to Microsoft
   * This provides instant logout without showing Entra ID account picker
   */
  async function logout(): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      console.log('[Auth Store] Logout initiated')

      // Shared-profile hygiene (R-L1): drop this user's recent ships before the identity is cleared
      clearShipRecent(user.value?.id)

      // Clear local app state (user, token, account, and active account)
      clearState()

      console.log('[Auth Store] Logout successful - local state cleared')

      // Force navigation to home page to show landing page
      const navigationStore = useNavigationStore()
      navigationStore.navigateToPage('home')

      isLoading.value = false
    } catch (err: any) {
      const errorMsg = err.message || 'Logout failed'
      error.value = errorMsg
      console.error('[Auth Store] Logout error:', err)
      isLoading.value = false
      throw new Error(errorMsg)
    }
  }

  /**
   * Acquire access token silently (no user interaction)
   * Falls back to interactive login if silent acquisition fails
   * @param forceRefresh - Force token refresh
   * @param allowPopup - Allow popup fallback (default: true, set false during initialization)
   */
  async function acquireToken(forceRefresh = false, allowPopup = true): Promise<string | null> {
    const accounts = getAuthInstance().getAllAccounts()

    if (accounts.length === 0) {
      console.warn('[Auth Store] No accounts found, user needs to login')
      return null
    }

    try {
      // Try silent token acquisition first
      const response = await getAuthInstance().acquireTokenSilent({
        ...silentRequest,
        account: accounts[0],
        forceRefresh
      })

      token.value = response.accessToken
      console.log('[Auth Store] Token acquired silently')
      return response.accessToken

    } catch (silentError: any) {
      // Suppress expected MSAL errors during initialization (common in dev with blocked cookies/iframes)
      const expectedErrors = ['block_iframe_reload', 'timed_out', 'monitor_window_timeout']
      const isExpectedError = expectedErrors.some(err => silentError.message?.includes(err))

      if (!isExpectedError) {
        console.warn('[Auth Store] Silent token acquisition failed:', silentError.message)
      }

      // Skip popup during initialization to reduce console noise
      if (!allowPopup) {
        return null
      }

      // Silent acquisition failed, try interactive popup
      try {
        const response = await getAuthInstance().acquireTokenPopup(tokenRequest)
        token.value = response.accessToken
        console.log('[Auth Store] Token acquired via popup')
        return response.accessToken

      } catch (popupError: any) {
        // Suppress expected popup errors (user cancelled, popup blocked, etc.)
        const expectedPopupErrors = ['popup_window_error', 'user_cancelled', 'user_login_error']
        const isExpectedPopupError = expectedPopupErrors.some(err => popupError.message?.includes(err))

        if (!isExpectedPopupError) {
          error.value = popupError.message || 'Token acquisition failed'
          console.error('[Auth Store] Popup token acquisition failed:', popupError)
        }
        return null
      }
    }
  }

  /**
   * Set user from MSAL account info
   * Extracts user details and stores token
   */
  async function setUserFromAccount(accountInfo: AccountInfo, accessToken?: string): Promise<void> {
    account.value = accountInfo

    // If token not provided, acquire it
    if (accessToken) {
      token.value = accessToken
    } else {
      await acquireToken()
    }

    // Extract user info from account
    user.value = {
      id: accountInfo.localAccountId,
      email: accountInfo.username,
      name: accountInfo.name || accountInfo.username,
      tenantId: accountInfo.tenantId
    }

    console.log('[Auth Store] User set:', user.value.email)
  }

  /**
   * Restore session from existing MSAL cache
   * Called on app initialization
   */
  async function restoreSession(): Promise<boolean> {
    const accounts = getAuthInstance().getAllAccounts()

    if (accounts.length === 0) {
      console.log('[Auth Store] No existing session found')
      return false
    }

    try {
      // Set the active account
      setActiveAccount(accounts[0])
      account.value = accounts[0]

      // Set user info immediately
      user.value = {
        id: accounts[0].localAccountId,
        email: accounts[0].username,
        name: accounts[0].name || accounts[0].username,
        tenantId: accounts[0].tenantId
      }

      console.log('[Auth Store] Session found for:', user.value.email)

      // Try to acquire API token silently (no popup during initialization)
      const accessToken = await acquireToken(false, false)

      if (accessToken) {
        console.log('[Auth Store] Session restored with API token')
        return true
      }

      console.log('[Auth Store] Session restored (API token will be acquired on first API call)')
      return true

    } catch (err: any) {
      console.error('[Auth Store] Session restoration failed:', err)
      clearState()
      return false
    }
  }

  /**
   * Clear all authentication state
   */
  function clearState(): void {
    user.value = null
    token.value = null
    account.value = null
    error.value = null
    setActiveAccount(null)
  }

  /**
   * Clear error message
   */
  function clearError(): void {
    error.value = null
  }

  return {
    // State
    user,
    token,
    account,
    isLoading,
    error,

    // Computed
    isAuthenticated,

    // Actions
    login,
    logout,
    acquireToken,
    setUserFromAccount,
    restoreSession,
    clearState,
    clearError
  }
})
