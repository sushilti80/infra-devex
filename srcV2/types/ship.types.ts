/**
 * Ship from Repo – API and domain types (mirror of docs/architecture/ship-from-repo-spec.md §4.5).
 * The envelope is `{ success, data | error, correlationId }`; for per-ship endpoints `correlationId` is the ship ID.
 */

export type ShipFailureCode =
  | 'REPO_NOT_ACCESSIBLE' | 'APP_OWNED_BY_OTHER' | 'CLONE_FAILED' | 'UNSUPPORTED_LANGUAGE' | 'BUILD_FAILED'
  | 'BUILD_TIMEOUT' | 'SECURITY_GATE_FAILED' | 'SECURITY_SCAN_UNAVAILABLE' | 'PUBLISH_FAILED' | 'VERSION_COLLISION'
  | 'CONFIG_PR_FAILED' | 'RUNNER_UNAVAILABLE' | 'CANCELLED' | 'SUPERSEDED' | 'PLATFORM_RATE_LIMITED' | 'UNKNOWN'

export type ShipRetryKind = 'reship' | 'retry_config' | 'fix_then_ship'
export type ShipRunState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type ShipStageId = 'queued' | 'prepare' | 'build' | 'scan' | 'publish' | 'config_pr' | 'preview'
export type ShipStageState = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
export type ShipBump = 'patch' | 'minor' | 'major'

export interface ShipEnvelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string; details?: unknown; hint?: string }
  correlationId?: string
}

/** Normalised error thrown/returned by the ship store (never raw axios). */
export interface ShipApiError {
  status: number
  code: string
  message: string
  details?: unknown
  hint?: string
  retryAfterSec?: number
}

export interface ShipDefaults {
  port: number
  healthPath: string
  bump: ShipBump
  teamLabel: string
}

export interface ShipConfig {
  allowedOrgs: string[]
  supportedLanguages: string[]
  identity: { state: 'linked' | 'unlinked'; reason?: string }
  previewConfiguredEnvs: string[]
  defaults: ShipDefaults
  limits: { portMin: number; portMax: number; recentMax: number; pollIntervalMs: number }
}

export interface ShipRepo {
  fullName: string
  org: string
  name: string
  defaultBranch: string
  private: boolean
}

export interface ShipReposResult {
  repos: ShipRepo[]
  identity: { state: 'linked' | 'unlinked'; reason?: string }
  truncated: boolean
}

export interface ShipBranch {
  name: string
  isDefault: boolean
}

export interface ShipBranchesResult {
  branches: ShipBranch[]
  defaultBranch: string
  nextPage?: number
}

export type ShipAppState = 'new' | 'preview_open' | 'merged' | 'closed_unmerged'
export type ShipOwnership = 'unclaimed' | 'same_repo' | 'other_repo' | 'unowned_existing' | 'unknown'

export interface ShipAppAdvisory {
  appState: ShipAppState
  prNumber?: number
  ownership: ShipOwnership
  owningRepo?: string
  ownershipSource: 'acr' | 'github' | 'none'
  effectiveSettings?: { port: number; healthPath: string }
}

export interface ShipSettings {
  branch: string
  namespace: string
  teamLabel: string
  port: number
  healthPath: string
  bump: ShipBump
}

export interface ShipStartRequest {
  repo: string
  branch: string
  app: string
  env: string
  namespace?: string
  teamLabel?: string
  port?: number
  healthPath?: string
  bump?: ShipBump
}

export interface ShipStartResponse {
  correlationId: string
  app: string
  env: string
  repo: string
  branch: string
  startedAt: string
  appState: ShipAppState
  effectiveSettings: { port: number; healthPath: string }
  settingsIgnored: string[]
  rollout: 'preview_pr' | 'flux_auto_roll'
}

export interface ShipFinding {
  package: string
  version: string
  fixedIn?: string
  severity: string
}

export interface ShipFailure {
  code: ShipFailureCode | string
  message: string
  nextStep: string
  retry: ShipRetryKind
  details?: {
    buildpackId?: string
    errorLine?: string
    findings?: ShipFinding[]
    severityCounts?: Record<string, number>
    lastLines?: string[]
    runUrl?: string
    runStillQueued?: boolean
    hint?: string
  }
}

export interface ShipStage {
  id: ShipStageId
  state: ShipStageState
  startedAt?: string
  completedAt?: string
}

export type ShipPreviewState = 'pending' | 'available' | 'not_configured' | 'unavailable_chart'

export interface ShipStatus {
  correlationId: string
  app: string
  env: string
  repo: string
  startedAt: string
  completedAt?: string
  durationSec?: number
  state: ShipRunState
  terminal: boolean
  attempt: number
  queuedBehind: boolean
  runResolved: boolean
  stages: ShipStage[]
  version?: string
  sha?: string
  shortSha?: string
  imageRef?: string
  digest?: string
  scanId?: string
  settings?: ShipSettings
  pr?: { number: number; url: string; state: 'open' | 'merged' | 'closed' }
  rollout?: 'preview_pr' | 'flux_auto_roll'
  preview: { state: ShipPreviewState; url?: string }
  failure?: ShipFailure
}

export type ShipLogStage = 'prepare' | 'build' | 'scan' | 'publish' | 'config_pr'

export interface ShipLogChunk {
  stage: ShipLogStage
  text: string
  offset: number
  complete: boolean
  available: boolean
  truncated: boolean
  skippedBytes: number
  totalBytes: number
}

/** Recent-ship entry persisted in localStorage (untrusted on read). */
export interface RecentShipEntry {
  correlationId: string
  app: string
  env: string
  repo: string
  branch: string
  startedAt: string
  terminal?: { state: 'succeeded' | 'failed' | 'cancelled'; version?: string; prUrl?: string }
}

/** Form draft owned by the ship store. */
export interface ShipDraft {
  repo: string
  branch: string
  app: string
  env: string
  namespace: string
  teamLabel: string
  port: number | string
  healthPath: string
  bump: ShipBump
}
