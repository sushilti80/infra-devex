/** FT-11 log viewer: fetch only when open, 15 s refresh, offset, copy/download, truncation notice, text-only. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ getShipLogs: vi.fn() }))
vi.mock('@v2/services/api', () => ({ apiService: api, default: api }))

import ShipLogViewer from './ShipLogViewer.vue'
import { CID, stages } from './ship.fixtures'

const chunk = (over: Record<string, unknown> = {}) => ({
  success: true,
  data: { stage: 'prepare', text: 'line1\n', offset: 6, complete: false, available: true, truncated: false, skippedBytes: 0, totalBytes: 6, ...over }
})
const mountViewer = (props: Record<string, unknown> = {}) => mount(ShipLogViewer, { props: { correlationId: CID, ...props }, attachTo: document.body })
const openIt = async (w: ReturnType<typeof mountViewer>) => {
  await w.findAll('button').find(b => b.text() === 'Show logs')!.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers()
  api.getShipLogs.mockReset()
  api.getShipLogs.mockResolvedValue(chunk())
})
afterEach(() => vi.useRealTimers())

describe('ShipLogViewer (FT-11)', () => {
  it('does not fetch anything until opened', async () => {
    const w = mountViewer()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.getShipLogs).not.toHaveBeenCalled()
    expect(w.find('[data-testid="ship-log-panel"]').exists()).toBe(false)
    w.unmount()
  })

  it('opening fetches the suggested (running) stage from offset 0 and renders it as text', async () => {
    const w = mountViewer({ stages: stages({ queued: 'succeeded', prepare: 'succeeded', build: 'running' }) })
    await openIt(w)
    expect(api.getShipLogs).toHaveBeenCalledTimes(1)
    expect(api.getShipLogs).toHaveBeenCalledWith(CID, 'build', 0)
    expect(w.get('[data-testid="ship-log-text"]').text()).toBe('line1')
    expect(w.get('button[aria-expanded]').attributes('aria-expanded')).toBe('true')
    w.unmount()
  })

  it('refreshes every 15 s using the returned offset and appends only the new text', async () => {
    api.getShipLogs
      .mockResolvedValueOnce(chunk({ text: 'AAA', offset: 3 }))
      .mockResolvedValueOnce(chunk({ text: 'BBB', offset: 6 }))
    const w = mountViewer()
    await openIt(w)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(api.getShipLogs).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.getShipLogs).toHaveBeenLastCalledWith(CID, 'prepare', 3)
    expect(w.get('[data-testid="ship-log-text"]').text()).toBe('AAABBB')
    w.unmount()
  })

  it('stops refreshing once the log is complete', async () => {
    api.getShipLogs.mockResolvedValue(chunk({ complete: true }))
    const w = mountViewer()
    await openIt(w)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(api.getShipLogs).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('stops refreshing when closed and on unmount (no fetch while closed)', async () => {
    const w = mountViewer()
    await openIt(w)
    await w.findAll('button').find(b => b.text() === 'Hide logs')!.trigger('click')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.getShipLogs).toHaveBeenCalledTimes(1)
    await openIt(w)
    expect(api.getShipLogs).toHaveBeenCalledTimes(2)
    w.unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.getShipLogs).toHaveBeenCalledTimes(2)
  })

  it('switching stage resets text/offset and loads the new stage once', async () => {
    const w = mountViewer()
    await openIt(w)
    api.getShipLogs.mockClear()
    await w.get('#ship-log-stage').setValue('scan')
    await flushPromises()
    expect(api.getShipLogs).toHaveBeenCalledTimes(1)
    expect(api.getShipLogs).toHaveBeenCalledWith(CID, 'scan', 0)
    w.unmount()
  })

  it('available:false shows a calm "not available yet" message and keeps polling', async () => {
    api.getShipLogs.mockResolvedValue(chunk({ available: false, text: '', offset: 0 }))
    const w = mountViewer()
    await openIt(w)
    expect(w.text()).toContain("Logs aren't available yet")
    await vi.advanceTimersByTimeAsync(15_000)
    expect(api.getShipLogs).toHaveBeenCalledTimes(2)
    w.unmount()
  })

  it('shows a truncation notice with the skipped amount', async () => {
    api.getShipLogs.mockResolvedValue(chunk({ truncated: true, skippedBytes: 12345 }))
    const w = mountViewer()
    await openIt(w)
    expect(w.get('[data-testid="ship-log-truncated"]').text()).toContain('12345')
    expect(w.get('[data-testid="ship-log-truncated"]').text()).toContain('Download the full log')
    w.unmount()
  })

  it('log text is untrusted: rendered as text, never HTML', async () => {
    api.getShipLogs.mockResolvedValue(chunk({ text: '<img src=x onerror=alert(1)><script>alert(2)</script>' }))
    const w = mountViewer()
    await openIt(w)
    expect(w.find('[data-testid="ship-log-text"] img').exists()).toBe(false)
    expect(w.find('[data-testid="ship-log-text"] script').exists()).toBe(false)
    expect(w.get('[data-testid="ship-log-text"]').text()).toContain('<img src=x onerror=alert(1)>')
    w.unmount()
  })

  it('Copy puts the accumulated log text on the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = mountViewer()
    await openIt(w)
    await w.findAll('button').find(b => b.text() === 'Copy')!.trigger('click')
    expect(writeText).toHaveBeenCalledWith('line1\n')
    w.unmount()
  })

  it('Download fetches the full log (download=1) and saves it as a text file', async () => {
    const createObjectURL = vi.fn(() => 'blob:x')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const w = mountViewer()
    await openIt(w)
    api.getShipLogs.mockResolvedValueOnce('FULL LOG TEXT')
    await w.findAll('button').find(b => b.text() === 'Download full log')!.trigger('click')
    await flushPromises()
    expect(api.getShipLogs).toHaveBeenLastCalledWith(CID, 'prepare', 0, true)
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    click.mockRestore()
    w.unmount()
  })

  it('Download of an unavailable log shows a message instead of a file', async () => {
    const w = mountViewer()
    await openIt(w)
    api.getShipLogs.mockResolvedValueOnce({ success: true, data: { available: false } })
    await w.findAll('button').find(b => b.text() === 'Download full log')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain("Logs aren't available to download yet")
    w.unmount()
  })

  it('a failed fetch shows a retrying message and keeps trying', async () => {
    api.getShipLogs.mockRejectedValueOnce(new Error('net')).mockResolvedValue(chunk())
    const w = mountViewer()
    await openIt(w)
    expect(w.text()).toContain("Couldn't load logs")
    await vi.advanceTimersByTimeAsync(15_000)
    expect(w.text()).not.toContain("Couldn't load logs")
    w.unmount()
  })
})
