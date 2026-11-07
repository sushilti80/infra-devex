/**
 * Ship failure classification (spec §3.5 "Failure classification", BT-12). Pure.
 * User-facing `message` / `nextStep` / `retry` come only from the static catalogue — never from
 * workflow text. Untrusted strings may appear only in `details`, control-stripped and ≤300 chars/line.
 */
const { redactLine } = require('../utils/logRedactor');

const CODES = Object.freeze([
  'REPO_NOT_ACCESSIBLE', 'APP_OWNED_BY_OTHER', 'CLONE_FAILED', 'UNSUPPORTED_LANGUAGE', 'BUILD_FAILED',
  'BUILD_TIMEOUT', 'SECURITY_GATE_FAILED', 'SECURITY_SCAN_UNAVAILABLE', 'PUBLISH_FAILED', 'VERSION_COLLISION',
  'CONFIG_PR_FAILED', 'RUNNER_UNAVAILABLE', 'CANCELLED', 'SUPERSEDED', 'PLATFORM_RATE_LIMITED', 'UNKNOWN',
]);

const CATALOGUE = Object.freeze({
  REPO_NOT_ACCESSIBLE: { message: 'We could not access that repository with your GitHub permissions.', nextStep: 'Ask the repository owner for read access, then ship again.', retry: 'fix_then_ship' },
  APP_OWNED_BY_OTHER: { message: 'That app name is already used by a different source repository.', nextStep: 'Choose a different app name, then ship again.', retry: 'fix_then_ship' },
  CLONE_FAILED: { message: 'We could not fetch the branch (it may be missing, too large, or use submodules or Git LFS).', nextStep: 'Check the branch name and repository contents, then ship again.', retry: 'fix_then_ship' },
  UNSUPPORTED_LANGUAGE: { message: 'We could not detect a supported language in this repository.', nextStep: 'Make sure the project root has a supported language manifest (see the supported languages list), then ship again.', retry: 'fix_then_ship' },
  BUILD_FAILED: { message: 'The build failed. Private package feeds, build-time secrets, submodules and Git LFS are not supported.', nextStep: 'Fix the build error shown in the details, then ship again.', retry: 'fix_then_ship' },
  BUILD_TIMEOUT: { message: 'The build ran past the 30-minute limit.', nextStep: 'Reduce the build time, then ship again.', retry: 'fix_then_ship' },
  SECURITY_GATE_FAILED: { message: 'The security scan blocked this image. Nothing was published.', nextStep: 'Fix the findings shown in the details, then ship again.', retry: 'fix_then_ship' },
  SECURITY_SCAN_UNAVAILABLE: { message: 'The security scan could not run, so nothing was published.', nextStep: 'Try shipping again in a few minutes.', retry: 'reship' },
  PUBLISH_FAILED: { message: 'Publishing the image failed.', nextStep: 'Try shipping again in a few minutes.', retry: 'reship' },
  VERSION_COLLISION: { message: 'The next image version already exists. This is a platform integrity problem.', nextStep: 'Copy the details and the correlation ID and contact the platform team.', retry: 'fix_then_ship' },
  CONFIG_PR_FAILED: { message: 'The image was published but the deployment pull request could not be created.', nextStep: 'Retry the pull request step; the image is not rebuilt.', retry: 'retry_config' },
  RUNNER_UNAVAILABLE: { message: 'No build runner picked up this ship in time.', nextStep: 'Cancel it and try shipping again.', retry: 'reship' },
  CANCELLED: { message: 'This ship was cancelled.', nextStep: 'Ship again when ready.', retry: 'reship' },
  SUPERSEDED: { message: 'A newer ship for the same app replaced this one before it published.', nextStep: 'Check the newer ship, or ship again.', retry: 'reship' },
  PLATFORM_RATE_LIMITED: { message: 'The platform is rate limited right now.', nextStep: 'Wait a few minutes, then ship again.', retry: 'reship' },
  UNKNOWN: { message: 'The ship failed for an unrecognised reason.', nextStep: 'Copy the details and the correlation ID and contact the platform team.', retry: 'fix_then_ship' },
});

const ALLOWED_ANNOTATION_CODES = Object.freeze({
  prepare: ['REPO_NOT_ACCESSIBLE', 'APP_OWNED_BY_OTHER', 'CLONE_FAILED'],
  build: ['BUILD_FAILED', 'UNSUPPORTED_LANGUAGE'],
  scan: ['SECURITY_GATE_FAILED', 'SECURITY_SCAN_UNAVAILABLE'],
  publish: ['PUBLISH_FAILED', 'VERSION_COLLISION', 'APP_OWNED_BY_OTHER'],
  config: ['CONFIG_PR_FAILED'],
});

const BUILD_TIMEOUT_SEC = 29.5 * 60;
const MAX_LINE = 300;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const clean = (value, max = MAX_LINE) => redactLine(String(value ?? '').replace(CONTROL_CHARS, ' ').trim()).slice(0, max);

/**
 * @param {{ failedStage?: 'prepare'|'build'|'scan'|'publish'|'config_pr'|null,
 *           annotationCode?: string, annotationRejected?: boolean, stepFailed?: boolean,
 *           buildHintCode?: string, buildDurationSec?: number,
 *           runnerUnavailable?: boolean, cancelled?: boolean, superseded?: boolean }} ctx
 * @returns {string} one of CODES
 */
function classifyFailure(ctx = {}) {
  if (ctx.cancelled) return ctx.superseded ? 'SUPERSEDED' : 'CANCELLED';
  if (ctx.runnerUnavailable) return 'RUNNER_UNAVAILABLE';
  // A rejected (untrusted) annotation can never name a cause — but a failed trusted step still does.
  if (ctx.annotationRejected && !ctx.stepFailed) return 'UNKNOWN';
  const allowed = (stage) => ALLOWED_ANNOTATION_CODES[stage].includes(ctx.annotationCode);
  switch (ctx.failedStage) {
    case 'prepare': return allowed('prepare') ? ctx.annotationCode : 'UNKNOWN';
    case 'build':
      if (Number(ctx.buildDurationSec) >= BUILD_TIMEOUT_SEC) return 'BUILD_TIMEOUT';
      return ctx.buildHintCode === 'UNSUPPORTED_LANGUAGE' ? 'UNSUPPORTED_LANGUAGE' : 'BUILD_FAILED';
    case 'scan': return allowed('scan') ? ctx.annotationCode : 'UNKNOWN';
    case 'publish':
      if (allowed('publish')) return ctx.annotationCode;
      return ctx.stepFailed ? 'PUBLISH_FAILED' : 'UNKNOWN';
    case 'config_pr': return allowed('config') || ctx.stepFailed ? 'CONFIG_PR_FAILED' : 'UNKNOWN';
    default: return 'UNKNOWN';
  }
}

function sanitizeDetails(details = {}) {
  const out = {};
  if (details.buildpackId) out.buildpackId = clean(details.buildpackId, 100);
  if (details.errorLine) out.errorLine = clean(details.errorLine);
  if (Array.isArray(details.lastLines)) out.lastLines = details.lastLines.slice(-10).map((l) => clean(l));
  if (Array.isArray(details.findings)) {
    out.findings = details.findings.slice(0, 10).map((f) => ({
      package: clean(f?.package, 100), version: clean(f?.version, 50), fixedIn: clean(f?.fixedIn, 50), severity: clean(f?.severity, 20),
    }));
  }
  if (details.severityCounts && typeof details.severityCounts === 'object') {
    out.severityCounts = Object.fromEntries(
      Object.entries(details.severityCounts).filter(([, n]) => Number.isInteger(n) && n >= 0).slice(0, 8).map(([k, n]) => [clean(k, 20), n]));
  }
  if (typeof details.runUrl === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9._/-]+$/.test(details.runUrl)) out.runUrl = details.runUrl;
  if (details.runStillQueued === true) out.runStillQueued = true;
  if (details.hint === 'runner_busy') out.hint = 'runner_busy';
  return out;
}

/** `{ code, message, nextStep, retry, details? }` from the static catalogue (unknown codes → UNKNOWN). */
function buildFailure(code, details, { retryWindowElapsed = false } = {}) {
  const safeCode = CATALOGUE[code] ? code : 'UNKNOWN';
  const entry = CATALOGUE[safeCode];
  const failure = { code: safeCode, message: entry.message, nextStep: entry.nextStep, retry: entry.retry };
  if (safeCode === 'CONFIG_PR_FAILED' && retryWindowElapsed) failure.retry = 'reship';
  const d = sanitizeDetails(details);
  if (Object.keys(d).length) failure.details = d;
  return failure;
}

module.exports = { CODES, CATALOGUE, ALLOWED_ANNOTATION_CODES, BUILD_TIMEOUT_SEC, classifyFailure, buildFailure, sanitizeDetails };
