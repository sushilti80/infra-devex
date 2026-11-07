import { describe,it, expect, beforeEach, vi } from 'vitest'

// Create mock axios instance
const mockAxiosInstance = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  request: vi.fn(),
  interceptors: {
    request: {
      use: vi.fn((onFulfilled) => {
        // Store interceptor for later if needed
        return 0
      })
    },
    response: {
      use: vi.fn((onFulfilled, onRejected) => {
        // Store interceptors for later if needed
        return 0
      })
    }
  }
}

// Mock axios module before importing api service
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockAxiosInstance)
  }
}))

// Mock auth store
vi.mock('@v2/stores/auth', () => ({
  useAuthStore: vi.fn(() => ({
    token: 'mock-token',
    isAuthenticated: true,
    acquireToken: vi.fn().mockResolvedValue('mock-token')
  }))
}))

describe('API Service', () => {
  let api: any

  beforeEach(async () => {
    vi.clearAllMocks()
    
    // Reset mock return values
    mockAxiosInstance.get.mockResolvedValue({ success: true, data: [] })
    mockAxiosInstance.post.mockResolvedValue({ success: true })
    mockAxiosInstance.delete.mockResolvedValue({ success: true })
    
    // Dynamically import to ensure fresh module with mocks applied
    const module = await import('@v2/services/api')
    api = module.default
  })

  describe('Endpoint Availability', () => {
    it('has getInstalledApps method', () => {
      expect(api).toHaveProperty('getInstalledApps')
      expect(typeof api.getInstalledApps).toBe('function')
    })

    it('has provisionCustom method', () => {
      expect(api).toHaveProperty('provisionCustom')
      expect(typeof api.provisionCustom).toBe('function')
    })

    it('has provisionTemplate method', () => {
      expect(api).toHaveProperty('provisionTemplate')
      expect(typeof api.provisionTemplate).toBe('function')
    })

    it('has deleteInfrastructure method', () => {
      expect(api).toHaveProperty('deleteInfrastructure')
      expect(typeof api.deleteInfrastructure).toBe('function')
    })

    it('has promoteInfrastructure method', () => {
      expect(api).toHaveProperty('promoteInfrastructure')
      expect(typeof api.promoteInfrastructure).toBe('function')
    })

    it('has getWorkflowStatus method', () => {
      expect(api).toHaveProperty('getWorkflowStatus')
      expect(typeof api.getWorkflowStatus).toBe('function')
    })

    it('has getModules method', () => {
      expect(api).toHaveProperty('getModules')
      expect(typeof api.getModules).toBe('function')
    })

    it('has getTemplates method', () => {
      expect(api).toHaveProperty('getTemplates')
      expect(typeof api.getTemplates).toBe('function')
    })

    it('has getRoles method', () => {
      expect(api).toHaveProperty('getRoles')
      expect(typeof api.getRoles).toBe('function')
    })

    it('has deployToAKS method', () => {
      expect(api).toHaveProperty('deployToAKS')
      expect(typeof api.deployToAKS).toBe('function')
    })

    it('has getAKSStatus method', () => {
      expect(api).toHaveProperty('getAKSStatus')
      expect(typeof api.getAKSStatus).toBe('function')
    })

    it('has saveRBACRelationships method', () => {
      expect(api).toHaveProperty('saveRBACRelationships')
      expect(typeof api.saveRBACRelationships).toBe('function')
    })

    it('has getAgents method', () => {
      expect(api).toHaveProperty('getAgents')
      expect(typeof api.getAgents).toBe('function')
    })
  })

  describe('API Methods - Basic Functionality', () => {
    it('getInstalledApps calls correct endpoint', async () => {
      mockAxiosInstance.get.mockResolvedValue({ success: true, data: [] })
      
      await api.getInstalledApps()

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/installed-apps')
    })

    it('provisionCustom calls correct endpoint with payload', async () => {
      const payload = {
        projectName: 'test',
        environment: 'dev',
        modules: ['storage']
      }
      mockAxiosInstance.post.mockResolvedValue({ success: true, correlationId: 'uuid-123' })

      await api.provisionCustom(payload)

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/custom', payload)
    })

    it('getWorkflowStatus calls correct endpoint with correlationId', async () => {
      mockAxiosInstance.get.mockResolvedValue({ success: true, status: 'completed' })
      
      await api.getWorkflowStatus('test-correlation-id')

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/status/test-correlation-id')
    })

    it('deleteInfrastructure calls correct endpoint', async () => {
      const payload = {
        projectName: 'test',
        environment: 'dev'
      }
      mockAxiosInstance.post.mockResolvedValue({ success: true })

      await api.deleteInfrastructure(payload)

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/delete', payload)
    })

    it('handles successful responses', async () => {
      const mockResponse = {
        success: true,
        correlationId: 'test-uuid-123',
        prNumber: 456
      }
      mockAxiosInstance.post.mockResolvedValue(mockResponse)

      const response = await api.provisionCustom({})

      expect(response.success).toBe(true)
      expect(response.correlationId).toBe('test-uuid-123')
      expect(response.prNumber).toBe(456)
    })

    it('propagates errors from failed requests', async () => {
      const errorResponse = new Error('Network error')
      mockAxiosInstance.post.mockRejectedValue(errorResponse)

      await expect(api.provisionCustom({})).rejects.toThrow('Network error')
    })
  })

  describe('Catalog Endpoints', () => {
    it('getModules calls /api/modules', async () => {
      mockAxiosInstance.get.mockResolvedValue({ success: true, data: [] })
      
      await api.getModules()

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/modules')
    })

    it('getTemplates calls /api/templates', async () => {
      mockAxiosInstance.get.mockResolvedValue({ success: true, data: [] })
      
      await api.getTemplates()

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/templates')
    })

    it('getRoles calls /api/roles', async () => {
      mockAxiosInstance.get.mockResolvedValue({ success: true, data: [] })
      
      await api.getRoles()

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/roles')
    })

    it('getAgents calls /api/agents', async () => {
      mockAxiosInstance.get.mockResolvedValue({ success: true, data: [] })
      
      await api.getAgents()

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/agents')
    })
  })

  describe('AKS Endpoints', () => {
    it('deployToAKS calls correct endpoint', async () => {
      const payload = { namespace: 'default', image: 'app:latest' }
      mockAxiosInstance.post.mockResolvedValue({ success: true })

      await api.deployToAKS(payload)

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/aks-deploy', payload)
    })

    it('getAKSStatus calls correct endpoint', async () => {
      mockAxiosInstance.get.mockResolvedValue({ success: true, status: 'running' })
      
      await api.getAKSStatus('correlation-123')

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/aks-status-by-correlation/correlation-123')
    })
  })

  describe('RBAC Endpoints', () => {
    it('saveRBACRelationships calls correct endpoint', async () => {
      const payload = { relationships: [] }
      mockAxiosInstance.post.mockResolvedValue({ success: true })

      await api.saveRBACRelationships(payload)

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/rbac-relationships', payload)
    })
  })
})
