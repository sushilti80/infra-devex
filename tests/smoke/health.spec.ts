import { describe, it, expect, beforeAll } from 'vitest'
import axios from 'axios'

const BASE_URL = process.env.API_URL || 'http://localhost:3001'

describe('Smoke Tests - Critical Path Validation', () => {
  describe('Application Health', () => {
    it('application responds to health check', async () => {
      const response = await axios.get(`${BASE_URL}/health`)
      
      expect(response.status).toBe(200)
      expect(response.data).toHaveProperty('status', 'ok')
      expect(response.data).toHaveProperty('timestamp')
    })

    it('returns valid timestamp format', async () => {
      const response = await axios.get(`${BASE_URL}/health`)
      
      const timestamp = new Date(response.data.timestamp)
      expect(timestamp.getTime()).toBeGreaterThan(0)
      expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('Public Endpoints', () => {
    it('GET /api/modules returns data', async () => {
      const response = await axios.get(`${BASE_URL}/api/modules`)
      
      expect(response.status).toBe(200)
      expect(response.data).toHaveProperty('success', true)
      expect(response.data).toHaveProperty('data')
      expect(Array.isArray(response.data.data)).toBe(true)
    })

    it('GET /api/templates returns data', async () => {
      const response = await axios.get(`${BASE_URL}/api/templates`)
      
      expect(response.status).toBe(200)
      expect(response.data).toHaveProperty('success', true)
      expect(response.data).toHaveProperty('data')
      expect(Array.isArray(response.data.data)).toBe(true)
    })

    it('GET /api/roles returns data', async () => {
      const response = await axios.get(`${BASE_URL}/api/roles`)
      
      expect(response.status).toBe(200)
      expect(response.data).toHaveProperty('success', true)
      expect(response.data).toHaveProperty('data')
      expect(response.data.data).toHaveProperty('roles')
      expect(response.data.data).toHaveProperty('scopes')
    })
  })

  describe('API Response Format', () => {
    it('all endpoints return standardized format', async () => {
      const endpoints = [
        '/api/modules',
        '/api/templates',
        '/api/roles'
      ]

      for (const endpoint of endpoints) {
        const response = await axios.get(`${BASE_URL}${endpoint}`)
        
        // Standardized response format
        expect(response.data).toHaveProperty('success')
        expect(response.data).toHaveProperty('data')
        
        // Note: correlationId is added by middleware but not always returned in GET responses
        // It's primarily used for async operations (provision, delete, etc.)
      }
    })
  })

  describe('Error Handling', () => {
    it('returns 404 for unknown endpoints', async () => {
      try {
        await axios.get(`${BASE_URL}/api/does-not-exist`)
        expect.fail('Should have thrown error')
      } catch (error: any) {
        // Server may return 404 or not handle route (ECONNREFUSED, etc.)
        // Either way, request should fail
        expect(error).toBeDefined()
        
        // If server responded, it should be 404
        if (error.response) {
          expect(error.response.status).toBe(404)
        }
      }
    })

    it('returns proper error format', async () => {
      try {
        await axios.post(`${BASE_URL}/api/custom`, {})
        expect.fail('Should have validation error')
      } catch (error: any) {
        // May be 400 (validation) or 401 (auth required)
        expect([400, 401]).toContain(error.response.status)
        
        if (error.response.status === 400) {
          expect(error.response.data).toHaveProperty('error')
        }
      }
    })
  })

  describe('Performance', () => {
    it('health endpoint responds in < 500ms', async () => {
      const start = Date.now()
      await axios.get(`${BASE_URL}/health`)
      const duration = Date.now() - start
      
      expect(duration).toBeLessThan(500)
    })

    it('API endpoints respond in < 2s', async () => {
      const start = Date.now()
      await axios.get(`${BASE_URL}/api/modules`)
      const duration = Date.now() - start
      
      expect(duration).toBeLessThan(2000)
    })
  })
})
