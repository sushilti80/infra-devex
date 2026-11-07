import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockAxiosInstance = {
  get: vi.fn(), post: vi.fn(), request: vi.fn(),
  interceptors: { request: { use: vi.fn(() => 0) }, response: { use: vi.fn(() => 0) } }
}
vi.mock('axios', () => ({ default: { create: vi.fn(() => mockAxiosInstance) } }))
vi.mock('@v2/stores/auth', () => ({ useAuthStore: vi.fn(() => ({ token: 't', isAuthenticated: true, acquireToken: vi.fn() })) }))

const CID = '01926f3c-8a41-7b3e-9d2a-0123456789ab'

describe('api — ship endpoints', () => {
  let api: any
  beforeEach(async () => {
    vi.clearAllMocks()
    mockAxiosInstance.get.mockResolvedValue({ success: true })
    mockAxiosInstance.post.mockResolvedValue({ success: true })
    api = (await import('@v2/services/api')).default
  })

  it('exposes the nine ship methods', () => {
    for (const m of ['getShipConfig', 'listShipRepos', 'listShipBranches', 'getShipAppState', 'startShip', 'getShipStatus', 'getShipLogs', 'cancelShip', 'retryShipConfigPr']) {
      expect(typeof api[m]).toBe('function')
    }
  })

  it('maps methods to the spec §4.1 paths', async () => {
    await api.getShipConfig()
    expect(mockAxiosInstance.get).toHaveBeenLastCalledWith('/api/ship/config')

    await api.listShipRepos('foo', 100)
    expect(mockAxiosInstance.get).toHaveBeenLastCalledWith('/api/ship/repos', { params: { q: 'foo', limit: 100 } })

    await api.listShipBranches('my org', 'r', 'ma', 2)
    expect(mockAxiosInstance.get).toHaveBeenLastCalledWith('/api/ship/repos/my%20org/r/branches', { params: { q: 'ma', page: 2 } })

    await api.getShipAppState('devsand', 'app', 'o/r')
    expect(mockAxiosInstance.get).toHaveBeenLastCalledWith('/api/ship/apps/devsand/app', { params: { repo: 'o/r' } })

    const body = { repo: 'o/r', branch: 'main', app: 'a', env: 'devsand' }
    await api.startShip(body)
    expect(mockAxiosInstance.post).toHaveBeenLastCalledWith('/api/ship', body)

    await api.getShipStatus(CID)
    expect(mockAxiosInstance.get).toHaveBeenLastCalledWith(`/api/ship/status/${CID}`)

    await api.getShipLogs(CID, 'build', 10)
    expect(mockAxiosInstance.get).toHaveBeenLastCalledWith(`/api/ship/logs/${CID}`, { params: { stage: 'build', offset: 10 } })

    await api.getShipLogs(CID, 'scan', 0, true)
    expect(mockAxiosInstance.get).toHaveBeenLastCalledWith(`/api/ship/logs/${CID}`, { params: { stage: 'scan', offset: 0, download: 1 }, responseType: 'text' })

    await api.cancelShip(CID)
    expect(mockAxiosInstance.post).toHaveBeenLastCalledWith(`/api/ship/${CID}/cancel`)

    await api.retryShipConfigPr(CID)
    expect(mockAxiosInstance.post).toHaveBeenLastCalledWith(`/api/ship/${CID}/retry-config-pr`)
  })
})
