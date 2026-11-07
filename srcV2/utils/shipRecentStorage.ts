/**
 * Recent ships (FR-015, spec §3.10.4). localStorage is UNTRUSTED: every read schema-validates, drops malformed
 * entries and length-caps strings. No tokens are ever stored. Key is scoped to the Entra object ID.
 */
import type { RecentShipEntry } from '@v2/types/ship.types'
import { isShipId, safeHttpsUrl } from './shipHelpers'

export const RECENT_MAX = 20
const keyFor = (userId: string) => `ship.recent.v1.${userId}`
const TERMINAL_STATES = ['succeeded', 'failed', 'cancelled'] as const

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null

/** Returns a clean entry or null. Exported for tests. */
export function validateEntry(raw: unknown): RecentShipEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const correlationId = isShipId(r.correlationId) ? r.correlationId : null
  const app = str(r.app, 63)
  const env = str(r.env, 63)
  const repo = str(r.repo, 140)
  const branch = str(r.branch, 200)
  const startedAt = str(r.startedAt, 40)
  if (!correlationId || !app || !env || !repo || !branch || !startedAt || Number.isNaN(Date.parse(startedAt))) return null
  const entry: RecentShipEntry = { correlationId, app, env, repo, branch, startedAt }
  if (r.terminal !== undefined) {
    const t = r.terminal as Record<string, unknown> | null
    if (!t || typeof t !== 'object' || !(TERMINAL_STATES as readonly unknown[]).includes(t.state)) return null
    entry.terminal = { state: t.state as (typeof TERMINAL_STATES)[number] }
    const version = str(t.version, 32)
    if (version) entry.terminal.version = version
    const prUrl = safeHttpsUrl(t.prUrl)
    if (prUrl) entry.terminal.prUrl = prUrl
  }
  return entry
}

export function readRecent(userId: string): RecentShipEntry[] {
  if (!userId) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(keyFor(userId)) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const out: RecentShipEntry[] = []
    for (const raw of parsed) {
      const e = validateEntry(raw)
      if (e && !seen.has(e.correlationId)) {
        seen.add(e.correlationId)
        out.push(e)
      }
    }
    return out.slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

export function writeRecent(userId: string, entries: RecentShipEntry[]): void {
  if (!userId) return
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(entries.slice(0, RECENT_MAX)))
  } catch {
    /* storage full / disabled – recents are best effort */
  }
}

/** Adds (or replaces) an entry, newest first, capped at 20. Returns the new list. */
export function addRecent(userId: string, entry: RecentShipEntry): RecentShipEntry[] {
  const next = [entry, ...readRecent(userId).filter(e => e.correlationId !== entry.correlationId)].slice(0, RECENT_MAX)
  writeRecent(userId, next)
  return next
}

export function removeRecent(userId: string, correlationId: string): RecentShipEntry[] {
  const next = readRecent(userId).filter(e => e.correlationId !== correlationId)
  writeRecent(userId, next)
  return next
}

export function setRecentTerminal(userId: string, correlationId: string, terminal: RecentShipEntry['terminal']): RecentShipEntry[] {
  const next = readRecent(userId).map(e => (e.correlationId === correlationId ? { ...e, terminal } : e))
  writeRecent(userId, next)
  return next
}

/** Called from authStore.logout() and by the "Clear list" action (shared-profile hygiene, R-L1). */
export function clearShipRecent(userId: string | null | undefined): void {
  if (!userId) return
  try {
    localStorage.removeItem(keyFor(userId))
  } catch {
    /* ignore */
  }
}
