import { useAuthStore } from '@v2/stores/auth'
import { computed } from 'vue'
import { getAuthInstance } from '@v2/services/authService'

/**
 * Authentication Composable
 * Provides reactive access to authentication state and methods
 * 
 * @example
 * ```vue
 * <script setup>
 * import { useAuth } from '@/composables/useAuth'
 * 
 * const { user, isAuthenticated, login, logout } = useAuth()
 * </script>
 * ```
 */
export function useAuth() {
  const authStore = useAuthStore()
  
  /**
   * Handle MSAL redirect promise after redirect from Microsoft login
   * Should be called on app initialization
   */
  async function handleRedirectPromise() {
    try {
      const response = await getAuthInstance().handleRedirectPromise()
      
      if (response && response.account) {
        // User successfully authenticated via redirect
        await authStore.setUserFromAccount(response.account, response.accessToken)
      } else {
        // No redirect response, try to restore existing session
        await authStore.restoreSession()
      }
    } catch (err: any) {
      console.error('[useAuth] handleRedirectPromise error:', err)
      authStore.error = err.message || 'Authentication failed'
    }
  }
  
  /**
   * Get access token for API calls
   * @returns Access token or null if not authenticated
   */
  async function getAccessToken(): Promise<string | null> {
    return authStore.acquireToken()
  }
  
  /**
   * User display name computed from user state
   */
  const userDisplayName = computed(() => {
    if (!authStore.user) return ''
    return authStore.user.name || authStore.user.email || ''
  })
  
  return {
    // State (reactive)
    user: computed(() => authStore.user),
    token: computed(() => authStore.token),
    isAuthenticated: computed(() => authStore.isAuthenticated),
    isLoading: computed(() => authStore.isLoading),
    error: computed(() => authStore.error),
    userDisplayName,
    
    // Actions
    login: authStore.login,
    logout: authStore.logout,
    acquireToken: authStore.acquireToken,
    restoreSession: authStore.restoreSession,
    clearError: authStore.clearError,
    handleRedirectPromise,
    getAccessToken
  }
}
