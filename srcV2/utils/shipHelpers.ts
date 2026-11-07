/**
 * Ship from Repo – small pure helpers (validation, URL safety, error normalisation, deep-link storage).
 * Client-side validation is a convenience mirror of docs/architecture/ship-from-repo-spec.md §4.4;
 * the backend remains authoritative.
 */
import type { ShipApiError, ShipStage, ShipStageId, ShipStageState, ShipStatus } from '@v2/types/ship.types'

/** UUIDv7 (RFC 9562) – the only accepted ship / correlation ID shape (spec §4.4). */
export const SHIP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const isShipId = (value: unknown): value is string => typeof value === 'string' && SHIP_ID_RE.test(value)

const DNS_1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/
const HEALTH_PATH = /^\/[A-Za-z0-9._~/-]{0,254}$/
const BRANCH_CHARS = /^[A-Za-z0-9._/-]+$/
const REPO_RE = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/

export function dnsLabelError(label: string, value: string): string | null {
  if (!value) return `${label} is required.`
  if (value.length > 63) return `${label} must be 63 characters or fewer.`
  if (!DNS_1123.test(value)) return `${label} may only contain lowercase letters, numbers and "-", and must start and end with a letter or number.`
  return null
}

export function portError(value: unknown, min: number, max: number): string | null {
  const text = String(value ?? '').trim()
  const n = Number(text)
  if (text === '' || !Number.isInteger(n) || n < min || n > max) return `Port must be a whole number between ${min} and ${max}.`
  return null
}

export function healthPathError(value: string): string | null {
  return HEALTH_PATH.test(value) ? null : 'Health path must start with "/" and use only letters, numbers and . _ ~ / -'
}

export function branchError(value: string): string | null {
  if (!value) return 'Branch is required.'
  if (value.length > 200 || !BRANCH_CHARS.test(value) || value.includes('..') || value.includes('//') ||
      value.startsWith('-') || value.startsWith('/') || value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock')) {
    return 'That is not a valid branch name.'
  }
  return null
}

/** Accepts `org/name` or `https://github.com/org/name(.git)` – returns canonical `org/name` or null. */
export function parseRepoInput(input: string): string | null {
  let v = String(input ?? '').trim()
  const url = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(v)
  if (url) v = url[1]
  return REPO_RE.test(v) ? v : null
}

/** Sanitise a repo name into a DNS-1123 label (AC-002-6); empty string when nothing usable remains. */
export function appNameFromRepo(repoFullName: string): string {
  const name = repoFullName.split('/')[1] ?? ''
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '')
}

function safeUrl(value: unknown, protocols: string[]): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const u = new URL(value)
    return protocols.includes(u.protocol) && !u.username && !u.password ? u.toString() : null
  } catch {
    return null
  }
}

/** Only https links are rendered as hrefs for PR/repo links (API and localStorage data are not trusted). */
export const safeHttpsUrl = (value: unknown): string | null => safeUrl(value, ['https:'])

/** Preview URLs may be http on internal clusters – the scheme comes from platform config (AC-010-2). */
export const safePreviewUrl = (value: unknown): string | null => safeUrl(value, ['https:', 'http:'])

/** Normalises an axios error (or anything thrown) into a ShipApiError. */
export function toShipApiError(err: unknown): ShipApiError {
  const e = err as { response?: { status?: number; data?: any; headers?: Record<string, string> } }
  const res = e?.response
  if (!res) return { status: 0, code: 'NETWORK', message: 'We could not reach the server.' }
  const body = res.data?.error
  const retryAfter = Number(res.headers?.['retry-after'])
  return {
    status: res.status ?? 0,
    code: typeof body?.code === 'string' ? body.code : 'UNKNOWN',
    message: typeof body?.message === 'string' ? body.message : 'Unexpected error.',
    details: body?.details,
    hint: typeof body?.hint === 'string' ? body.hint : undefined,
    retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
  }
}

// ─── Deep link (?ship=<correlationId>) ───────────────────────────────────────
export const PENDING_DEEP_LINK_KEY = 'ship.pendingDeepLink'

export function readShipParam(search: string): string | null {
  const v = new URLSearchParams(search).get('ship')
  return isShipId(v) ? v : null
}

/** Stored before the MSAL login redirect (redirectUri drops the query string, A-10 #3). */
export function storePendingDeepLink(id: string): void {
  if (isShipId(id)) sessionStorage.setItem(PENDING_DEEP_LINK_KEY, id)
}

/** Returns a validated pending ID and always clears the key. */
export function takePendingDeepLink(): string | null {
  const v = sessionStorage.getItem(PENDING_DEEP_LINK_KEY)
  sessionStorage.removeItem(PENDING_DEEP_LINK_KEY)
  return isShipId(v) ? v : null
}

/** Sets or removes only the `ship` query parameter via history.replaceState (no router, pattern 4). */
export function setShipQueryParam(id: string | null): void {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('ship', id)
  else url.searchParams.delete('ship')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

// ─── Progress mapping (spec §3.5 display mapping, AC-013-1) ──────────────────
export type DisplayStageLabel = 'Build' | 'Security check' | 'Publish' | 'Review PR' | 'Preview'
const DISPLAY_GROUPS: Array<{ label: DisplayStageLabel; ids: ShipStageId[] }> = [
  { label: 'Build', ids: ['queued', 'prepare', 'build'] },
  { label: 'Security check', ids: ['scan'] },
  { label: 'Publish', ids: ['publish'] },
  { label: 'Review PR', ids: ['config_pr'] },
  { label: 'Preview', ids: ['preview'] }
]

/** Collapses the 7 internal stages into the 5 user-facing labels. */
export function toDisplayStages(stages: ShipStage[]): Array<{ label: DisplayStageLabel; state: ShipStageState }> {
  return DISPLAY_GROUPS.map(({ label, ids }) => {
    const states = ids.map(id => stages.find(s => s.id === id)?.state ?? 'pending')
    let state: ShipStageState
    if (states.includes('failed')) state = 'failed'
    else if (states.includes('running')) state = 'running'
    else if (states.every(s => s === 'succeeded' || s === 'skipped')) state = states.includes('succeeded') ? 'succeeded' : 'skipped'
    else if (states.every(s => s === 'pending' || s === 'skipped')) state = 'pending'
    else state = 'running' // some done, some still to do
    return { label, state }
  })
}

/** Plain-text support payload for "Copy details" – includes the correlation ID (spec §3.10.2 S7). */
export function buildCopyPayload(s: ShipStatus): string {
  const f = s.failure
  const lines = [
    `Ship ${s.state}${f ? `: ${f.code}` : ''}`,
    `App: ${s.app}`,
    `Environment: ${s.env}`,
    `Repository: ${s.repo}`,
    `Correlation ID: ${s.correlationId}`,
    `Attempt: ${s.attempt}`
  ]
  if (f) {
    lines.push(`Message: ${f.message}`)
    if (f.details?.buildpackId) lines.push(`Buildpack: ${f.details.buildpackId}`)
    if (f.details?.errorLine) lines.push(`Error: ${f.details.errorLine}`)
    if (f.details?.lastLines?.length) lines.push('Last lines:', ...f.details.lastLines.slice(-50))
  }
  return lines.join('\n')
}

/** Which notice a start/list error maps to – fail-closed responses are never a generic error. */
export type NoticeKind = 'not_linked' | 'not_accessible' | 'unavailable' | 'rate_limited' | 'validation' | 'generic' | null
export function noticeKindForError(e: ShipApiError | null): NoticeKind {
  if (!e) return null
  if (e.code === 'REPO_NOT_ACCESSIBLE') return e.hint === 'IDENTITY_NOT_LINKED' ? 'not_linked' : 'not_accessible'
  if (e.code === 'SHIP_UNAVAILABLE') return 'unavailable'
  if (e.code === 'PLATFORM_RATE_LIMITED' || e.status === 429) return 'rate_limited'
  if (e.code === 'VALIDATION_FAILED') return 'validation'
  if (e.code === 'APP_OWNED_BY_OTHER') return null // shown on the app name field
  return 'generic'
}
