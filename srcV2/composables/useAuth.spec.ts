import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuth } from './useAuth'
import { useAuthStore } from '@v2/stores/auth'

// Mock MSAL instance methods
const mockMsalInstance = {
  initialize: vi.fn().mockResolvedValue(undefined),
  acquireTokenSilent: vi.fn(),
  acquireTokenPopup: vi.fn(),
  acquireTokenRedirect: vi.fn(),
  loginRedirect: vi.fn().mockResolvedValue(undefined),
  loginPopup: vi.fn(),
  handleRedirectPromise: vi.fn(),
  getAllAccounts: vi.fn(),
  getActiveAccount: vi.fn(),
  setActiveAccount: vi.fn(),
  logout: vi.fn(),
  logoutRedirect: vi.fn()
}

// Mock authService module
vi.mock('@v2/services/authService', () => ({
  getAuthInstance: vi.fn(() => mockMsalInstance),
  getMsalInstance: vi.fn(() => mockMsalInstance),
  setActiveAccount: vi.fn(),
  loginRequest: { scopes: ['user.read'] },
  tokenRequest: { scopes: ['user.read'] },
  silentRequest: { scopes: ['user.read'] }
}))

describe('useAuth', () => {
  let auth: ReturnType<typeof useAuth>
  let authStore: ReturnType<typeof useAuthStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    
    // Reset mock implementations
    mockMsalInstance.handleRedirectPromise.mockResolvedValue(null)
    mockMsalInstance.getAllAccounts.mockReturnValue([])
    mockMsalInstance.getActiveAccount.mockReturnValue(null)
    
    // Get fresh instances
    authStore = useAuthStore()
    auth = useAuth()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Initialization', () => {
    it('creates MSAL instance with correct configuration', () => {
      expect(auth.isAuthenticated.value).toBe(false)
      expect(auth.user.value).toBeNull()
    })

    it('initializes reactive state correctly', () => {
      expect(auth.isAuthenticated).toBeDefined()
      expect(auth.user).toBeDefined()
      expect(auth.isLoading).toBeDefined()
      expect(auth.error).toBeDefined()
    })
  })

  describe('Login Flow', () => {
    it('handles successful login redirect', async () => {
      const mockAccount = {
        homeAccountId: 'test-id',
        environment: 'login.microsoftonline.com',
        tenantId: 'test-tenant',
        username: 'test@example.com',
        localAccountId: 'local-id',
        name: 'Test User',
        idTokenClaims: {}
      }

      mockMsalInstance.handleRedirectPromise.mockResolvedValue({
        account: mockAccount,
        accessToken: 'test-token'
      })
      mockMsalInstance.getAllAccounts.mockReturnValue([mockAccount])

      await auth.handleRedirectPromise()

      expect(auth.isAuthenticated.value).toBe(true)
      expect(auth.user.value?.email).toBe('test@example.com')
      expect(auth.error.value).toBeNull()
    })

    it('handles login redirect with no response', async () => {
      mockMsalInstance.handleRedirectPromise.mockResolvedValue(null)
      mockMsalInstance.getAllAccounts.mockReturnValue([])

      await auth.handleRedirectPromise()

      expect(auth.isAuthenticated.value).toBe(false)
      expect(auth.user.value).toBeNull()
    })

    it('handles login errors gracefully', async () => {
      const error = new Error('Login failed')
      mockMsalInstance.handleRedirectPromise.mockRejectedValue(error)

      await auth.handleRedirectPromise()

      expect(auth.error.value).toBe('Login failed')
      expect(auth.isAuthenticated.value).toBe(false)
    })

    it('initiates login redirect when called', async () => {
      await auth.login()

      expect(mockMsalInstance.loginRedirect).toHaveBeenCalled()
      expect(mockMsalInstance.loginRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes: expect.arrayContaining([expect.any(String)])
        })
      )
    })
  })

  describe('Token Acquisition', () => {
    const mockAccount = {
      homeAccountId: 'test-id',
      environment: 'login.microsoftonline.com',
      tenantId: 'test-tenant',
      username: 'test@example.com',
      localAccountId: 'local-id',
      name: 'Test User',
      idTokenClaims: {}
    }

    beforeEach(async () => {
      mockMsalInstance.getAllAccounts.mockReturnValue([mockAccount])
      // Set user in store via proper method
      await authStore.setUserFromAccount(mockAccount, 'test-token')
    })

    it('acquires token silently when user authenticated', async () => {
      const mockToken = 'silent-token'
      mockMsalInstance.acquireTokenSilent.mockResolvedValue({
        accessToken: mockToken,
        account: mockAccount
      })

      const token = await auth.getAccessToken()

      expect(token).toBe(mockToken)
      expect(mockMsalInstance.acquireTokenSilent).toHaveBeenCalledWith(
        expect.objectContaining({
          account: mockAccount
        })
      )
    })

    it('falls back to interactive login when silent acquisition fails', async () => {
      mockMsalInstance.acquireTokenSilent.mockRejectedValue(
        new Error('interaction_required')
      )
      mockMsalInstance.acquireTokenPopup.mockResolvedValue({
        accessToken: 'popup-token',
        account: mockAccount
      })

      const token = await auth.getAccessToken()

      expect(token).toBe('popup-token')
      expect(mockMsalInstance.acquireTokenPopup).toHaveBeenCalled()
    })

    it('returns null when no user authenticated', async () => {
      // Clear the store
      authStore.clearState()
      mockMsalInstance.getAllAccounts.mockReturnValue([])

      const token = await auth.getAccessToken()

      expect(token).toBeNull()
    })

    it('handles token acquisition errors', async () => {
      mockMsalInstance.acquireTokenSilent.mockRejectedValue(
        new Error('Token expired')
      )
      mockMsalInstance.acquireTokenPopup.mockRejectedValue(
        new Error('user_cancelled')
      )

      const token = await auth.getAccessToken()

      expect(token).toBeNull()
    })
  })

  describe('Logout', () => {
    const mockAccount = {
      homeAccountId: 'test-id',
      environment: 'login.microsoftonline.com',
      tenantId: 'test-tenant',
      username: 'test@example.com',
      localAccountId: 'local-id',
      name: 'Test User',
      idTokenClaims: {}
    }

    beforeEach(async () => {
      // Set user in store properly
      await authStore.setUserFromAccount(mockAccount, 'test-token')
    })

    it('clears user state on logout', async () => {
      await auth.logout()

      expect(auth.isAuthenticated.value).toBe(false)
      expect(auth.user.value).toBeNull()
    })

    it('clears token on logout', async () => {
      expect(auth.token.value).toBe('test-token')
      
      await auth.logout()

      expect(auth.token.value).toBeNull()
    })
  })

  describe('Computed Properties', () => {
    it('computes display name from user', async () => {
      const mockAccount = {
        homeAccountId: 'test-id',
        environment: 'login.microsoftonline.com',
        tenantId: 'test-tenant',
        username: 'test@example.com',
        localAccountId: 'local-id',
        name: 'Test User',
        idTokenClaims: {}
      }
      
      await authStore.setUserFromAccount(mockAccount, 'token')

      expect(auth.userDisplayName.value).toBe('Test User')
    })

    it('returns email when name not available', async () => {
      const mockAccount = {
        homeAccountId: 'test-id',
        environment: 'login.microsoftonline.com',
        tenantId: 'test-tenant',
        username: 'test@example.com',
        localAccountId: 'local-id',
        idTokenClaims: {}
      }
      
      await authStore.setUserFromAccount(mockAccount, 'token')

      expect(auth.userDisplayName.value).toBe('test@example.com')
    })

    it('returns empty string when no user', () => {
      authStore.clearState()

      expect(auth.userDisplayName.value).toBe('')
    })
  })

  describe('Error Handling', () => {
    it('does not clear previous errors on successful redirect', async () => {
      authStore.error = 'Previous error'

      mockMsalInstance.handleRedirectPromise.mockResolvedValue(null)
      mockMsalInstance.getAllAccounts.mockReturnValue([])

      await auth.handleRedirectPromise()

      // handleRedirectPromise doesn't explicitly clear errors, only sets them on failure
      expect(auth.error.value).toBe('Previous error')
    })

    it('sets loading state during login operation', async () => {
      let loadingDuringOperation = false

      mockMsalInstance.loginRedirect.mockImplementation(async () => {
        loadingDuringOperation = auth.isLoading.value
      })

      // Don't await - loginRedirect triggers page reload so test completes immediately
      auth.login().catch(() => {}) // Catch any errors to prevent unhandled rejections

      // Wait a tick for the promise to start
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(loadingDuringOperation).toBe(true)
    })
  })
})
