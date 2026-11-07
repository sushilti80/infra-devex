/** FT-08: useShipPolling — 15 s cadence, backoff (cap 60 s), stop on terminal, cleanup on unmount/navigation. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useShipPolling, type ShipPollingOptions } from './useShipPolling'
import { useNavigationStore } from '@v2/stores/navigation'
import type { ShipStatus } from '@v2/types/ship.types'

const CID = '01926f3c-8a41-7b3e-9d2a-0123456789ab'
const status = (over: Partial<ShipStatus> = {}): ShipStatus => ({
  correlationId: CID, app: 'a', env: 'devsand', repo: 'o/r', startedAt: '2026-01-01T00:00:00Z',
  state: 'running', terminal: false, attempt: 1, queuedBehind: false, runResolved: true, stages: [],
  preview: { state: 'pending' }, ...over
})

let activePinia = createPinia()

function host(opts: ShipPollingOptions) {
  let api!: ReturnType<typeof useShipPolling>
  const wrapper = mount(defineComponent({ setup() { api = useShipPolling(opts); return () => h('div') } }), { global: { plugins: [activePinia] } })
  return { api, wrapper }
}

describe('useShipPolling (FT-08)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    activePinia = createPinia()
    setActivePinia(activePinia)
  })
  afterEach(() => vi.useRealTimers())

  it('fetches immediately, then every 15 s while non-terminal', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(status())
    const { api } = host({ fetchStatus })
    api.start(CID)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchStatus).toHaveBeenCalledTimes(3)
    expect(api.isPolling.value).toBe(true)
  })

  it('publishes each status via onStatus', async () => {
    const onStatus = vi.fn()
    const { api } = host({ fetchStatus: vi.fn().mockResolvedValue(status()), onStatus })
    api.start(CID)
    await vi.advanceTimersByTimeAsync(0)
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ correlationId: CID }))
  })

  it('stops on terminal status and stops rescheduling', async () => {
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status({ state: 'succeeded', terminal: true }))
    const { api } = host({ fetchStatus })
    api.start(CID)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(api.isPolling.value).toBe(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
  })

  it('keeps polling a failed-but-not-terminal status (report-only RUNNER_UNAVAILABLE)', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(status({ state: 'failed', terminal: false }))
    const { api } = host({ fetchStatus })
    api.start(CID)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchStatus).toHaveBeenCalledTimes(3)
    expect(api.isPolling.value).toBe(true)
  })

  it('backs off exponentially on errors (30 s, 60 s, capped 60 s) and resets after a success', async () => {
    const fetchStatus = vi.fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue(status())
    const onError = vi.fn()
    const { api } = host({ fetchStatus, onError })
    api.start(CID)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(api.consecutiveErrors.value).toBe(1)

    await vi.advanceTimersByTimeAsync(29_999)
    expect(fetchStatus).toHaveBeenCalledTimes(1) // 1st error => 30 s
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchStatus).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(59_999)
    expect(fetchStatus).toHaveBeenCalledTimes(2) // 2nd error => 60 s
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchStatus).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(59_999)
    expect(fetchStatus).toHaveBeenCalledTimes(3) // 3rd error => capped at 60 s
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchStatus).toHaveBeenCalledTimes(4)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStatus).toHaveBeenCalledTimes(5) // success
    expect(api.consecutiveErrors.value).toBe(0)
    await vi.advanceTimersByTimeAsync(15_000) // back to 15 s cadence
    expect(fetchStatus).toHaveBeenCalledTimes(6)
    expect(onError).toHaveBeenCalledTimes(4)
  })

  it('stops (no backoff loop) on a fatal error such as 403/404', async () => {
    const fetchStatus = vi.fn().mockRejectedValue({ response: { status: 404 } })
    const { api } = host({ fetchStatus, isFatal: e => (e as any)?.response?.status === 404 })
    api.start(CID)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(api.isPolling.value).toBe(false)
  })

  it('stop() halts polling and ignores an in-flight response that lands afterwards', async () => {
    let resolve!: (s: ShipStatus) => void
    const fetchStatus = vi.fn().mockReturnValue(new Promise<ShipStatus>(r => { resolve = r }))
    const onStatus = vi.fn()
    const { api } = host({ fetchStatus, onStatus })
    api.start(CID)
    api.stop()
    resolve(status())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onStatus).not.toHaveBeenCalled()
    expect(fetchStatus).toHaveBeenCalledTimes(1)
  })

  it('restarting for another ship replaces the previous poll (one timer at a time)', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(status())
    const { api } = host({ fetchStatus })
    api.start(CID)
    await vi.advanceTimersByTimeAsync(0)
    api.start('01926f3c-8a41-7b3e-9d2a-0123456789ac')
    await vi.advanceTimersByTimeAsync(0)
    fetchStatus.mockClear()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(fetchStatus).toHaveBeenCalledWith('01926f3c-8a41-7b3e-9d2a-0123456789ac')
  })

  it('stops on component unmount', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(status())
    const { api, wrapper } = host({ fetchStatus })
    api.start(CID)
    await vi.advanceTimersByTimeAsync(0)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(api.isPolling.value).toBe(false)
  })

  it('stops on page navigation (registered cleanup) and unregisters itself', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(status())
    const nav = useNavigationStore()
    const register = vi.spyOn(nav, 'registerCleanup')
    const unregister = vi.spyOn(nav, 'unregisterCleanup')
    const { api } = host({ fetchStatus })
    api.start(CID)
    await vi.advanceTimersByTimeAsync(0)
    expect(register).toHaveBeenCalledTimes(1)
    nav.navigateToPage('home')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(api.isPolling.value).toBe(false)
    expect(unregister).toHaveBeenCalled()
  })

  it('unregisters the cleanup when it stops on its own (terminal)', async () => {
    const nav = useNavigationStore()
    const unregister = vi.spyOn(nav, 'unregisterCleanup')
    const { api } = host({ fetchStatus: vi.fn().mockResolvedValue(status({ state: 'failed', terminal: true })) })
    api.start(CID)
    await vi.advanceTimersByTimeAsync(0)
    expect(unregister).toHaveBeenCalledTimes(2) // once by start()'s reset, once on terminal stop
    expect(api.isPolling.value).toBe(false)
  })

  it('minAttempt: keeps polling a stale terminal status from a previous attempt (after Retry PR creation)', async () => {
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce(status({ state: 'failed', terminal: true, attempt: 1 }))
      .mockResolvedValueOnce(status({ state: 'running', terminal: false, attempt: 2 }))
      .mockResolvedValueOnce(status({ state: 'succeeded', terminal: true, attempt: 2 }))
    const { api } = host({ fetchStatus })
    api.start(CID, { minAttempt: 2 })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.isPolling.value).toBe(true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchStatus).toHaveBeenCalledTimes(3)
    expect(api.isPolling.value).toBe(false)
  })

  it('minAttempt: gives up on a stale terminal status after a bounded number of polls', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(status({ state: 'failed', terminal: true, attempt: 1 }))
    const { api } = host({ fetchStatus })
    api.start(CID, { minAttempt: 2 })
    await vi.advanceTimersByTimeAsync(15_000 * 20)
    expect(fetchStatus.mock.calls.length).toBeLessThanOrEqual(8)
    expect(api.isPolling.value).toBe(false)
  })
})
