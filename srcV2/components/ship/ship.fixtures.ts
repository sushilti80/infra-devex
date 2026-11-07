import type { ShipStage, ShipStageId, ShipStageState, ShipStatus } from '@v2/types/ship.types'

/** Test fixtures shared by the ship component/page specs (not production code). */
export const CID = '01926f3c-8a41-7b3e-9d2a-0123456789ab'

const ORDER: ShipStageId[] = ['queued', 'prepare', 'build', 'scan', 'publish', 'config_pr', 'preview']

export function stages(states: Partial<Record<ShipStageId, ShipStageState>> = {}, fill: ShipStageState = 'pending'): ShipStage[] {
  return ORDER.map(id => ({ id, state: states[id] ?? fill }))
}

export function status(over: Partial<ShipStatus> = {}): ShipStatus {
  return {
    correlationId: CID, app: 'my-app', env: 'devsand', repo: 'Aya-DevOpsTeam/my-app', startedAt: '2026-01-01T00:00:00Z',
    state: 'running', terminal: false, attempt: 1, queuedBehind: false, runResolved: true,
    stages: stages({ queued: 'succeeded', prepare: 'running' }), preview: { state: 'pending' }, ...over
  }
}

export const succeeded = (over: Partial<ShipStatus> = {}) => status({
  state: 'succeeded', terminal: true, durationSec: 192, version: '0.1.3', sha: 'a'.repeat(40), shortSha: 'aaaaaaa',
  imageRef: 'registry.example/selfserve/my-app:0.1.3', digest: 'sha256:' + 'b'.repeat(64), rollout: 'preview_pr',
  stages: stages({}, 'succeeded'), pr: { number: 17, url: 'https://github.com/Aya-DevOpsTeam/aya-flux/pull/17', state: 'open' },
  preview: { state: 'available', url: 'https://pr-17-my-app.preview.example' }, settings: { branch: 'main', namespace: 'my-app', teamLabel: 'software-engineering', port: 8080, healthPath: '/healthz', bump: 'patch' },
  ...over
})

export const failed = (code: string, retry: 'reship' | 'retry_config' | 'fix_then_ship' = 'fix_then_ship', details: Record<string, unknown> = {}, over: Partial<ShipStatus> = {}) => status({
  state: 'failed', terminal: true, stages: stages({ queued: 'succeeded', prepare: 'succeeded', build: 'failed' }),
  failure: { code, message: `server message for ${code}`, nextStep: 'server next step', retry, details }, ...over
})

export const ALL_FAILURE_CODES = [
  'REPO_NOT_ACCESSIBLE', 'APP_OWNED_BY_OTHER', 'CLONE_FAILED', 'UNSUPPORTED_LANGUAGE', 'BUILD_FAILED', 'BUILD_TIMEOUT',
  'SECURITY_GATE_FAILED', 'SECURITY_SCAN_UNAVAILABLE', 'PUBLISH_FAILED', 'VERSION_COLLISION', 'CONFIG_PR_FAILED',
  'RUNNER_UNAVAILABLE', 'CANCELLED', 'SUPERSEDED', 'PLATFORM_RATE_LIMITED', 'UNKNOWN'
] as const

/** Terms that may appear only inside Advanced / Details / Technical details (AC-001-8). */
export const FORBIDDEN_DEFAULT_TERMS = [/\bimage\b/i, /\btag\b/i, /\bdigest\b/i, /\bnamespace\b/i, /\bflux\b/i, /\bbuildpack\b/i, /correlation id/i]
