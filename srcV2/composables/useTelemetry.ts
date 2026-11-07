type TelemetryDimensions = Record<string, string | number | boolean>

/** Module-level timer map – shared across all useTelemetry() invocations */
const timers = new Map<string, number>()

/**
 * Emit a named telemetry event.
 * DEV: logs to console.debug for local observability.
 * PROD: dispatches 'app:telemetry' CustomEvent on window so external collectors
 * (e.g. Application Insights SDK snippet) can subscribe without coupling.
 */
function trackEvent(name: string, dimensions: TelemetryDimensions): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[telemetry]', name, dimensions)
  } else {
    window.dispatchEvent(
      new CustomEvent<{ name: string; dimensions: TelemetryDimensions; ts: number }>(
        'app:telemetry',
        { detail: { name, dimensions, ts: Date.now() } },
      ),
    )
  }
}

/**
 * Begin a named performance timer backed by window.performance.now().
 * @param key - Unique key for this timer (e.g. correlationId, URL+method).
 */
function startTimer(key: string): void {
  timers.set(key, window.performance.now())
}

/**
 * End a named timer and immediately emit a telemetry event with elapsed_ms.
 * @param key          - Timer key previously passed to startTimer.
 * @param eventName    - Telemetry event name to emit (snake_case).
 * @param extraDimensions - Additional dimensions merged into the event.
 */
function endTimer(
  key: string,
  eventName: string,
  extraDimensions?: TelemetryDimensions,
): void {
  const start = timers.get(key)
  timers.delete(key)
  const elapsed_ms = start !== undefined ? Math.round(window.performance.now() - start) : -1
  trackEvent(eventName, { elapsed_ms, ...extraDimensions })
}

export function useTelemetry() {
  return { trackEvent, startTimer, endTimer }
}
