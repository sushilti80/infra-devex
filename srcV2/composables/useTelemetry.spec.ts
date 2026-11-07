import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTelemetry } from './useTelemetry'

// Helper to temporarily switch DEV mode for a single test block.
// import.meta.env is a plain mutable object in the Vitest jsdom environment.
function setDevMode(value: boolean) {
  ;(import.meta.env as Record<string, unknown>).DEV = value
}

describe('useTelemetry', () => {
  describe('trackEvent – DEV mode', () => {
    beforeEach(() => {
      setDevMode(true)
      vi.spyOn(console, 'debug').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('calls console.debug with the event name and dimensions', () => {
      const { trackEvent } = useTelemetry()
      trackEvent('user_action', { page: 'home', count: 3 })
      expect(console.debug).toHaveBeenCalledWith('[telemetry]', 'user_action', {
        page: 'home',
        count: 3,
      })
    })

    it('does NOT dispatch a CustomEvent on window in DEV mode', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { trackEvent } = useTelemetry()
      trackEvent('dev_only_event', { x: true })
      expect(dispatchSpy).not.toHaveBeenCalled()
    })
  })

  describe('trackEvent – PROD mode', () => {
    const capturedEvents: CustomEvent[] = []
    let telemetryListener: (e: Event) => void

    beforeEach(() => {
      setDevMode(false)
      capturedEvents.length = 0
      telemetryListener = (e: Event) => capturedEvents.push(e as CustomEvent)
      window.addEventListener('app:telemetry', telemetryListener)
    })

    afterEach(() => {
      setDevMode(true)
      window.removeEventListener('app:telemetry', telemetryListener)
      vi.restoreAllMocks()
    })

    it('dispatches a CustomEvent of type "app:telemetry" on window', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { trackEvent } = useTelemetry()
      trackEvent('prod_event', { key: 'val' })
      expect(dispatchSpy).toHaveBeenCalledOnce()
      expect(dispatchSpy.mock.calls[0][0]).toBeInstanceOf(CustomEvent)
      expect((dispatchSpy.mock.calls[0][0] as CustomEvent).type).toBe('app:telemetry')
    })

    it('includes name, dimensions, and numeric ts in the CustomEvent detail', () => {
      const { trackEvent } = useTelemetry()
      trackEvent('my_prod_event', { userId: 'abc', count: 42 })
      expect(capturedEvents).toHaveLength(1)
      const detail = capturedEvents[0].detail
      expect(detail.name).toBe('my_prod_event')
      expect(detail.dimensions).toEqual({ userId: 'abc', count: 42 })
      expect(typeof detail.ts).toBe('number')
    })

    it('does NOT call console.debug in PROD mode', () => {
      const debugSpy = vi.spyOn(console, 'debug')
      const { trackEvent } = useTelemetry()
      trackEvent('prod_silent', { silent: true })
      expect(debugSpy).not.toHaveBeenCalled()
    })
  })

  describe('startTimer + endTimer', () => {
    beforeEach(() => {
      setDevMode(true)
      vi.spyOn(console, 'debug').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('produces the correct elapsed_ms using a mocked performance.now', () => {
      let now = 1000
      vi.spyOn(window.performance, 'now').mockImplementation(() => now)

      const { startTimer, endTimer } = useTelemetry()
      startTimer('op_a')

      now = 1350
      endTimer('op_a', 'op_a_done')

      expect(console.debug).toHaveBeenCalledWith(
        '[telemetry]',
        'op_a_done',
        expect.objectContaining({ elapsed_ms: 350 }),
      )
    })

    it('merges extraDimensions into the emitted event', () => {
      vi.spyOn(window.performance, 'now').mockReturnValue(0)

      const { startTimer, endTimer } = useTelemetry()
      startTimer('wf-1')
      endTimer('wf-1', 'workflow_terminal', {
        workflowType: 'infra',
        correlationId: 'cid-abc',
        finalStatus: 'success',
      })

      expect(console.debug).toHaveBeenCalledWith(
        '[telemetry]',
        'workflow_terminal',
        expect.objectContaining({
          elapsed_ms: 0,
          workflowType: 'infra',
          correlationId: 'cid-abc',
          finalStatus: 'success',
        }),
      )
    })

    it('uses elapsed_ms of -1 when startTimer was never called for the key', () => {
      const { endTimer } = useTelemetry()
      endTimer('nonexistent_key', 'orphan_event')

      expect(console.debug).toHaveBeenCalledWith(
        '[telemetry]',
        'orphan_event',
        expect.objectContaining({ elapsed_ms: -1 }),
      )
    })

    it('removes the timer entry after endTimer so it cannot be double-ended', () => {
      vi.spyOn(window.performance, 'now').mockReturnValue(500)

      const { startTimer, endTimer } = useTelemetry()
      startTimer('once_key')
      endTimer('once_key', 'first_end')
      // Second end should produce elapsed_ms = -1 (key already removed)
      endTimer('once_key', 'second_end')

      const calls = (console.debug as ReturnType<typeof vi.fn>).mock.calls
      const secondCall = calls.find((c) => c[1] === 'second_end')
      expect(secondCall?.[2]).toMatchObject({ elapsed_ms: -1 })
    })
  })

  describe('event naming convention', () => {
    it('all documented event names follow snake_case', () => {
      const snakeCase = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
      const eventNames = [
        'workflow_track_started',
        'workflow_status_changed',
        'workflow_poll_timeout',
        'workflow_terminal',
        'api_request_completed',
        'api_request_failed',
        'auth_token_refreshed',
      ]
      for (const name of eventNames) {
        expect(snakeCase.test(name), `"${name}" must be snake_case`).toBe(true)
      }
    })
  })
})
