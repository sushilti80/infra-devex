/**
 * Unit Tests — apiService.getAppMetadata() — FR-006
 * Spec: service-catalog-prefill-spec.json — FR-006, FE-related API tests
 *
 * Tests that:
 * - getAppMetadata method exists on apiService (FR-006)
 * - It calls GET /api/app-metadata/:appName/:environment (FR-006)
 * - It uses the shared axios instance so auth interceptor applies (FR-006)
 *
 * These tests FAIL until FR-006 is implemented (method missing from api.ts).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock axios instance
const mockAxiosInstance = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  request: vi.fn(),
  interceptors: {
    request: { use: vi.fn().mockReturnValue(0) },
    response: { use: vi.fn().mockReturnValue(0) },
  },
}

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockAxiosInstance),
  },
}))

vi.mock('@v2/stores/auth', () => ({
  useAuthStore: vi.fn(() => ({
    token: 'mock-bearer-token',
    isAuthenticated: true,
    acquireToken: vi.fn().mockResolvedValue('mock-bearer-token'),
  })),
}))

vi.mock('@v2/composables/useTelemetry', () => ({
  useTelemetry: vi.fn(() => ({
    trackEvent: vi.fn(),
  })),
}))

// ─────────────────────────────────────────────────────────────────────────────

describe('FR-006 — apiService.getAppMetadata()', () => {
  let api: any

  beforeEach(async () => {
    vi.clearAllMocks()
    mockAxiosInstance.get.mockResolvedValue({ success: true, data: {}, correlationId: 'cid-test' })

    const module = await import('@v2/services/api')
    api = module.default
  })

  describe('Method existence (FR-006)', () => {
    it('getAppMetadata is defined on apiService', () => {
      // FR-006: apiService.getAppMetadata(appName, environment) must exist
      expect(api).toHaveProperty('getAppMetadata')
    })

    it('getAppMetadata is a function', () => {
      expect(typeof api.getAppMetadata).toBe('function')
    })
  })

  describe('Correct endpoint called (FR-006)', () => {
    it('calls GET /api/app-metadata/:appName/:environment with correct path params', async () => {
      mockAxiosInstance.get.mockResolvedValue({ success: true, data: {}, correlationId: 'cid-1' })

      await api.getAppMetadata('jobplc', 'devsand')

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/app-metadata/jobplc/devsand')
    })

    it('interpolates appName and environment correctly', async () => {
      mockAxiosInstance.get.mockResolvedValue({ success: true, data: {} })

      await api.getAppMetadata('webapp01', 'sand')

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/app-metadata/webapp01/sand')
    })

    it('does NOT call any other endpoint', async () => {
      mockAxiosInstance.get.mockResolvedValue({ success: true, data: {} })

      await api.getAppMetadata('jobplc', 'devsand')

      const calledEndpoints = mockAxiosInstance.get.mock.calls.map((c: any[]) => c[0])
      expect(calledEndpoints).toHaveLength(1)
      expect(calledEndpoints[0]).toMatch(/^\/api\/app-metadata\//)
    })
  })

  describe('Uses shared axios instance (FR-006)', () => {
    it('returns the API response data directly (uses shared axios instance that returns response.data)', async () => {
      const mockResponse = {
        success: true,
        data: {
          name: 'jobplc',
          environment: 'devsand',
          modules: ['functionAppSvcWindows'],
        },
        correlationId: 'cid-1234',
      }
      mockAxiosInstance.get.mockResolvedValue(mockResponse)

      const result = await api.getAppMetadata('jobplc', 'devsand')

      expect(result.success).toBe(true)
      expect(result.correlationId).toBe('cid-1234')
    })

    it('propagates errors from failed requests (shared error handling)', async () => {
      const err = Object.assign(new Error('Request failed with status code 404'), {
        response: { status: 404, data: { success: false, error: 'App not found' } },
      })
      mockAxiosInstance.get.mockRejectedValue(err)

      await expect(api.getAppMetadata('notexist', 'devsand')).rejects.toThrow()
    })
  })

  describe('Parameter validation (client-side guidance)', () => {
    it('accepts valid appName (≤8 alphanumeric chars)', async () => {
      mockAxiosInstance.get.mockResolvedValue({ success: true, data: {} })
      // Method should not throw for valid inputs
      await expect(api.getAppMetadata('jobplc', 'devsand')).resolves.toBeDefined()
    })

    it('accepts valid environment from allowlist', async () => {
      mockAxiosInstance.get.mockResolvedValue({ success: true, data: {} })
      for (const env of ['devsand', 'sand', 'aisand']) {
        await expect(api.getAppMetadata('app1', env)).resolves.toBeDefined()
      }
    })
  })
})
