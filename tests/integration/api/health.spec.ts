import { describe, it, expect, beforeAll } from 'vitest'

const API_URL = process.env.API_URL || 'http://localhost:3001'

describe('Integration Tests - API Health', () => {
  let serverAvailable = false

  beforeAll(async () => {
    // Check if server is running
    try {
      const response = await fetch(`${API_URL}/health`)
      serverAvailable = response.ok
    } catch (error) {
      console.error('Server not available:', error)
      serverAvailable = false
    }
  })

  describe('Health Endpoint', () => {
    it('should respond to health check', async () => {
      const response = await fetch(`${API_URL}/health`)
      expect(response.ok).toBe(true)
    })

    it('should return JSON with status', async () => {
      const response = await fetch(`${API_URL}/health`)
      const data = await response.json()
      
      expect(data).toHaveProperty('status')
      expect(data.status).toBe('ok')
    })

    it('should return timestamp', async () => {
      const response = await fetch(`${API_URL}/health`)
      const data = await response.json()
      
      expect(data).toHaveProperty('timestamp')
      expect(new Date(data.timestamp).getTime()).toBeGreaterThan(0)
    })

    it('should return version information', async () => {
      const response = await fetch(`${API_URL}/health`)
      const data = await response.json()
      
      expect(data).toHaveProperty('version')
      expect(data.version).toHaveProperty('app')
      expect(data.version).toHaveProperty('node')
    })

    it('should return service status', async () => {
      const response = await fetch(`${API_URL}/health`)
      const data = await response.json()
      
      expect(data).toHaveProperty('services')
      expect(data.services).toHaveProperty('github')
    })
  })

  describe('API Endpoints Availability', () => {
    it('should have /api/modules endpoint', async () => {
      const response = await fetch(`${API_URL}/api/modules`)
      // Should return 200 or 500 (GitHub not initialized), but not 404
      expect([200, 500].includes(response.status)).toBe(true)
    })

    it('should have /api/templates endpoint', async () => {
      const response = await fetch(`${API_URL}/api/templates`)
      expect([200, 500].includes(response.status)).toBe(true)
    })

    it('should have /api/roles endpoint', async () => {
      const response = await fetch(`${API_URL}/api/roles`)
      expect([200, 500].includes(response.status)).toBe(true)
    })

    it('should have /api/installed-apps endpoint', async () => {
      const response = await fetch(`${API_URL}/api/installed-apps`)
      // Requires auth, returns 401 when no token provided
      expect(response.status).toBe(401)
    })
  })

  describe('Error Handling', () => {
    it('should return 404 for non-existent endpoints', async () => {
      const response = await fetch(`${API_URL}/api/nonexistent`)
      expect(response.status).toBe(404)
    })

    it('should handle CORS preflight requests', async () => {
      const response = await fetch(`${API_URL}/api/modules`, {
        method: 'OPTIONS'
      })
      expect(response.ok).toBe(true)
    })
  })
})
