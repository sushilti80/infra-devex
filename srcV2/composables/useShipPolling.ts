import { ref, readonly, getCurrentScope, onScopeDispose } from 'vue'
import { useNavigationStore } from '@v2/stores/navigation'
import type { ShipStatus } from '@v2/types/ship.types'

/**
 * Ship status polling (spec §3.10.3, DD-6, AC-013-2): 15 s cadence, exponential backoff on errors (cap 60 s),
 * stops on `terminal`, cleans up on unmount/navigation. Separate file on purpose (open decision H-8): consumers
 * depend only on this small interface — { start, stop, isPolling } with `fetchStatus`/`onStatus` callbacks — so it can be
 * swapped for a useWorkflowPolling extension without touching the page or store.
 */
export interface ShipPollingOptions {
  fetchStatus: (correlationId: string) => Promise<ShipStatus>
  onStatus?: (status: ShipStatus) => void
  onError?: (error: unknown) => void
  /** Return true for errors that will never recover (e.g. 403/404) – polling stops instead of backing off. */
  isFatal?: (error: unknown) => boolean
  intervalMs?: number
  maxBackoffMs?: number
}

export interface ShipPollingStartOptions {
  /** After "Retry PR creation": keep polling while a terminal status still belongs to an older attempt. */
  minAttempt?: number
}

const MAX_STALE_TERMINAL_POLLS = 6

export function useShipPolling(options: ShipPollingOptions) {
  const intervalMs = options.intervalMs ?? 15_000
  const maxBackoffMs = options.maxBackoffMs ?? 60_000
  const navigationStore = useNavigationStore()

  const isPolling = ref(false)
  const consecutiveErrors = ref(0)
  let timer: ReturnType<typeof setTimeout> | null = null
  let generation = 0

  function clearTimer() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function stop() {
    generation++
    clearTimer()
    isPolling.value = false
    navigationStore.unregisterCleanup(stop)
  }

  function delayAfterError(): number {
    return Math.min(intervalMs * 2 ** consecutiveErrors.value, maxBackoffMs)
  }

  function start(correlationId: string, startOptions: ShipPollingStartOptions = {}) {
    stop()
    const myGeneration = generation
    let staleTerminalPolls = 0
    isPolling.value = true
    consecutiveErrors.value = 0
    navigationStore.registerCleanup(stop)

    const schedule = (ms: number) => {
      timer = setTimeout(tick, ms)
    }

    async function tick() {
      timer = null
      try {
        const status = await options.fetchStatus(correlationId)
        if (myGeneration !== generation) return
        consecutiveErrors.value = 0
        options.onStatus?.(status)
        const stale = status.terminal && startOptions.minAttempt !== undefined &&
          status.attempt < startOptions.minAttempt && ++staleTerminalPolls <= MAX_STALE_TERMINAL_POLLS
        if (status.terminal && !stale) {
          stop()
          return
        }
        schedule(intervalMs)
      } catch (error) {
        if (myGeneration !== generation) return
        options.onError?.(error)
        if (options.isFatal?.(error)) {
          stop()
          return
        }
        consecutiveErrors.value++
        schedule(delayAfterError())
      }
    }

    void tick()
  }

  if (getCurrentScope()) onScopeDispose(stop)

  return { start, stop, isPolling: readonly(isPolling), consecutiveErrors: readonly(consecutiveErrors) }
}
