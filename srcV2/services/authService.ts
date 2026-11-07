import { PublicClientApplication, type Configuration, type AccountInfo } from '@azure/msal-browser'

/**
 * Get runtime configuration from window object (injected by server)
 * Falls back to Vite build-time env vars if not available
 */
function getRuntimeConfig(key: string): string {
  // Check if runtime config exists (for FluxCD/Kustomize deployments)
  if (typeof window !== 'undefined' && (window as any).ENV_CONFIG) {
    const value = (window as any).ENV_CONFIG[key]
    if (value && value !== '${' + key + '}') {
      return value
    }
  }
  // Fallback to Vite build-time env vars (for local development)
  return import.meta.env[key] || ''
}

/**
 * Wait for runtime config to be available
 * Config is loaded via <script src="/config.js"> in index.html
 */
function waitForConfig(): Promise<void> {
  return new Promise((resolve) => {
    // Check if config is already loaded
    if (typeof window !== 'undefined' && (window as any).ENV_CONFIG) {
      console.log('[MSAL] Runtime config already loaded')
      resolve()
      return
    }
    
    // Wait for config to load (with timeout)
    const checkInterval = setInterval(() => {
      if (typeof window !== 'undefined' && (window as any).ENV_CONFIG) {
        console.log('[MSAL] Runtime config loaded')
        clearInterval(checkInterval)
        resolve()
      }
    }, 50) // Check every 50ms
    
    // Timeout after 5 seconds
    setTimeout(() => {
      clearInterval(checkInterval)
      console.warn('[MSAL] Runtime config not loaded, using fallback')
      resolve()
    }, 5000)
  })
}

/**
 * MSAL instance - created lazily after config is loaded
 */
let msalInstance: PublicClientApplication | null = null

/**
 * Get or create MSAL instance
 */
function getMsalInstance(): PublicClientApplication {
  if (!msalInstance) {
    const clientId = getRuntimeConfig('VITE_ENTRA_CLIENT_ID')
    const authority = getRuntimeConfig('VITE_ENTRA_AUTHORITY')
    
    console.log('[MSAL] Creating instance with config:', { clientId, authority })
    
    if (!clientId || !authority) {
      throw new Error('Entra ID configuration not available. Please check environment variables or Key Vault secrets.')
    }
    
    const msalConfig: Configuration = {
      auth: {
        clientId,
        authority,
        redirectUri: window.location.origin,
        postLogoutRedirectUri: window.location.origin
      },
      cache: {
        cacheLocation: 'localStorage'
      },
      system: {
        loggerOptions: {
          logLevel: import.meta.env.DEV ? 3 : 0, // Verbose in dev, none in prod
          loggerCallback: (level, message, containsPii) => {
            if (containsPii) return
            
            switch (level) {
              case 0: // Error
                console.error('[MSAL]', message)
                break
              case 1: // Warning
                console.warn('[MSAL]', message)
                break
              case 2: // Info
                console.info('[MSAL]', message)
                break
              case 3: // Verbose
                console.debug('[MSAL]', message)
                break
            }
          }
        }
      }
    }
    
    msalInstance = new PublicClientApplication(msalConfig)
  }
  
  return msalInstance
}

/**
 * Login request configuration
 * Uses standard OpenID Connect scopes only for initial authentication
 */
export const loginRequest = {
  scopes: ['openid', 'profile', 'email'],
  prompt: 'select_account' as const
}

/**
 * Token request for API access
 * Uses GUID-only format (no api:// prefix) since app is requesting token for itself
 */
export const tokenRequest = {
  scopes: [`${getRuntimeConfig('VITE_ENTRA_CLIENT_ID')}/.default`],
  forceRefresh: false
}

/**
 * Silent token request (no user interaction)
 * Uses GUID-only format (no api:// prefix) since app is requesting token for itself
 */
export const silentRequest = {
  scopes: [`${getRuntimeConfig('VITE_ENTRA_CLIENT_ID')}/.default`],
  forceRefresh: false
}

/**
 * Initialize MSAL
 * Must be called before any MSAL operations
 * Handles redirect promise from login flow
 */
export async function initializeMsal(): Promise<AccountInfo | null> {
  // Wait for runtime config to be available
  await waitForConfig()
  
  // Get or create MSAL instance (will use loaded config)
  const instance = getMsalInstance()
  
  await instance.initialize()
  
  // Handle redirect promise (user returning from Microsoft login)
  const response = await instance.handleRedirectPromise()
  
  if (response) {
    console.log('[MSAL] Login redirect completed for:', response.account.username)
    return response.account
  }
  
  // Check if user is already logged in (from previous session)
  const accounts = instance.getAllAccounts()
  if (accounts.length > 0) {
    console.log('[MSAL] Existing session found for:', accounts[0].username)
    return accounts[0]
  }
  
  return null
}

/**
 * Get the current active account
 */
export function getActiveAccount(): AccountInfo | null {
  return getMsalInstance().getActiveAccount()
}

/**
 * Set the active account
 */
export function setActiveAccount(account: AccountInfo | null): void {
  getMsalInstance().setActiveAccount(account)
}

/**
 * Get MSAL instance for auth operations
 * Export for use in auth store
 */
export function getAuthInstance(): PublicClientApplication {
  return getMsalInstance()
}
