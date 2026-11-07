import axios, { type AxiosInstance } from 'axios'
import type { ApiResponse } from '@v2/types/infrastructure.types'
import { useAuthStore } from '@v2/stores/auth'
import { useTelemetry } from '@v2/composables/useTelemetry'
import type {
  ShipEnvelope, ShipConfig, ShipReposResult, ShipBranchesResult, ShipAppAdvisory, ShipStartRequest,
  ShipStartResponse, ShipStatus, ShipLogChunk, ShipLogStage
} from '@v2/types/ship.types'

const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

const { trackEvent } = useTelemetry()

/** Strip dynamic path segments (UUIDs, correlation IDs, numeric IDs) to prevent high-cardinality metric keys */
function normalizeEndpoint(url: string | undefined): string {
  if (!url) return 'unknown'
  return url
    .split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/cid-[a-z0-9-]+/gi, '/:cid')
    .replace(/\/\d+/g, '/:n')
}

// Request interceptor - Add Authorization header + record telemetry start time
api.interceptors.request.use(
  async (config) => {
    // Record start time for response duration measurement
    ;(config as any)._telemetryStartTime = window.performance.now()

    const authStore = useAuthStore()

    // Try to get existing token first
    let token = authStore.token

    // If no token, try to acquire one (will refresh if needed)
    if (!token && authStore.isAuthenticated) {
      token = await authStore.acquireToken()
    }

    // Attach token if available
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor - Handle token expiration + emit request telemetry
api.interceptors.response.use(
  (response) => {
    const cfg = response.config as any
    const duration_ms =
      cfg._telemetryStartTime !== undefined
        ? Math.round(window.performance.now() - cfg._telemetryStartTime)
        : -1
    trackEvent('api_request_completed', {
      endpoint: normalizeEndpoint(response.config.url),
      method: (response.config.method || 'get').toUpperCase(),
      status: response.status,
      duration_ms,
    })
    return response.data
  },
  async (error) => {
    const originalRequest = error.config

    // Compute failure telemetry (before any retry so we record the originating request)
    const failCfg = originalRequest as any
    const failDuration_ms =
      failCfg?._telemetryStartTime !== undefined
        ? Math.round(window.performance.now() - failCfg._telemetryStartTime)
        : -1
    // Only emit api_request_failed when the request is not about to be transparently retried
    if (!(error.response?.status === 401 && !failCfg?._retry)) {
      trackEvent('api_request_failed', {
        endpoint: normalizeEndpoint(originalRequest?.url),
        method: (originalRequest?.method || 'get').toUpperCase(),
        status: error.response?.status ? String(error.response.status) : 'network_error',
        duration_ms: failDuration_ms,
      })
    }

    // If 401 Unauthorized and we haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      const authStore = useAuthStore()

      // Try to get a fresh token
      const newToken = await authStore.acquireToken(true) // Force refresh

      if (newToken) {
        trackEvent('auth_token_refreshed', { success: true })
        // Retry the original request with new token
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return api.request(originalRequest)
      } else {
        trackEvent('auth_token_refreshed', { success: false })
        // Token refresh failed, user needs to re-login
        console.error('[API] Token refresh failed, redirecting to login')
        await authStore.logout()
        // Optionally redirect to login page or show modal
        return Promise.reject(error)
      }
    }

    console.error('API Error:', error.response?.data || error.message)
    return Promise.reject(error)
  }
)

const apiService = {
  // Infrastructure Management
  getInstalledApps: (): Promise<ApiResponse> => api.get('/api/installed-apps'),

  getSecrets: (appName: string, environment: string, target: 'live' | 'sand', vaultDir?: string, qualifier?: string): Promise<ApiResponse> => {
    const query = new URLSearchParams({ target })
    if (vaultDir) query.set('vaultDir', vaultDir)
    if (qualifier) query.set('qualifier', qualifier)
    return api.get(`/api/secrets/${encodeURIComponent(appName)}/${encodeURIComponent(environment)}?${query.toString()}`)
  },
  getSecretApps: (target: 'live' | 'sand'): Promise<ApiResponse> =>
    api.get(`/api/secrets/apps?${new URLSearchParams({ target }).toString()}`),
  submitSecret: (payload: Record<string, unknown>): Promise<ApiResponse> => api.post('/api/secrets', payload),
  setVaultNameOverride: (payload: Record<string, unknown>): Promise<ApiResponse> =>
    api.post('/api/secrets/vault-name-override', payload),

  // Provisioning
  provisionCustom: (payload: any): Promise<ApiResponse> => api.post('/api/custom', payload),
  provisionTemplate: (payload: any): Promise<ApiResponse> => api.post('/api/template', payload),

  // Lifecycle
  deleteInfrastructure: (payload: any): Promise<ApiResponse> => api.post('/api/delete', payload),
  promoteInfrastructure: (payload: any): Promise<ApiResponse> => api.post('/api/promote', payload),
  getInfraLiveEnvironments: (): Promise<ApiResponse> => api.get('/api/infra-live-environments'),

  // Workflow
  getWorkflowStatus: (correlationId: string, workflowType?: string): Promise<ApiResponse> =>
    api.get(`/api/status/${correlationId}${workflowType ? `?type=${workflowType}` : ''}`),

  // Catalog
  getModules: (): Promise<ApiResponse> => api.get('/api/modules'),
  getTemplates: (): Promise<ApiResponse> => api.get('/api/templates'),
  getRoles: (): Promise<ApiResponse> => api.get('/api/roles'),

  // FR-006: App metadata pre-fill
  getAppMetadata: (appName: string, environment: string): Promise<ApiResponse> =>
    api.get(`/api/app-metadata/${encodeURIComponent(appName)}/${encodeURIComponent(environment)}`),

  // AKS
  deployToAKS: (payload: any): Promise<ApiResponse> => api.post('/api/aks-deploy', payload),
  getAKSStatus: (correlationId: string): Promise<ApiResponse> =>
    api.get(`/api/aks-status-by-correlation/${correlationId}`),
  getAKSApps: (): Promise<ApiResponse> => api.get('/api/aks-apps'),

  // RBAC
  saveRBACRelationships: (payload: any): Promise<ApiResponse> =>
    api.post('/api/rbac-relationships', payload),

  // Agents
  getAgents: (): Promise<ApiResponse> => api.get('/api/agents'),
  submitAgentChange: (payload: any): Promise<ApiResponse> => api.post('/api/agent-change', payload),

  // Code Repository
  addCodeRepo: (payload: any): Promise<ApiResponse> => api.post('/api/add-code-repo', payload),

  // Labeling
  labelApp: (payload: any): Promise<ApiResponse> => api.post('/api/label', payload),

  // Feedback
  submitFeedback: (payload: any): Promise<ApiResponse> => api.post('/api/feedback', payload),

  // Ship from Repo (spec §4.1 endpoints 1-9; envelope { success, data | error, correlationId })
  getShipConfig: (): Promise<ShipEnvelope<ShipConfig>> => api.get('/api/ship/config'),
  listShipRepos: (q = '', limit = 500): Promise<ShipEnvelope<ShipReposResult>> =>
    api.get('/api/ship/repos', { params: { ...(q ? { q } : {}), limit } }),
  listShipBranches: (org: string, repo: string, q = '', page = 1): Promise<ShipEnvelope<ShipBranchesResult>> =>
    api.get(`/api/ship/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/branches`, {
      params: { ...(q ? { q } : {}), page }
    }),
  getShipAppState: (env: string, app: string, repo: string): Promise<ShipEnvelope<ShipAppAdvisory>> =>
    api.get(`/api/ship/apps/${encodeURIComponent(env)}/${encodeURIComponent(app)}`, { params: { repo } }),
  startShip: (payload: ShipStartRequest): Promise<ShipEnvelope<ShipStartResponse>> => api.post('/api/ship', payload),
  getShipStatus: (correlationId: string): Promise<ShipEnvelope<ShipStatus>> =>
    api.get(`/api/ship/status/${encodeURIComponent(correlationId)}`),
  /** `download: true` resolves to the whole redacted log as a plain string (text/plain attachment). */
  getShipLogs: (correlationId: string, stage: ShipLogStage, offset = 0, download = false): Promise<ShipEnvelope<ShipLogChunk> | string> =>
    api.get(`/api/ship/logs/${encodeURIComponent(correlationId)}`, {
      params: { stage, offset, ...(download ? { download: 1 } : {}) },
      ...(download ? { responseType: 'text' as const } : {})
    }),
  cancelShip: (correlationId: string): Promise<ShipEnvelope<{ state: 'cancelling' }>> =>
    api.post(`/api/ship/${encodeURIComponent(correlationId)}/cancel`),
  retryShipConfigPr: (correlationId: string): Promise<ShipEnvelope<{ correlationId: string; attempt: number }>> =>
    api.post(`/api/ship/${encodeURIComponent(correlationId)}/retry-config-pr`)
}

// Export both default and named
export { apiService }
export default apiService
