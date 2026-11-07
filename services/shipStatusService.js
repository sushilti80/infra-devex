/**
 * Ship status resolver (docs/architecture/ship-from-repo-spec.md §3.5, §3.6.3, §4.5). Stateless: GitHub is the
 * database. Locates every run of a ship from the UUIDv7 time window, folds the runs into one ShipStatus,
 * validates trusted `ship.result` annotations (consumer-side rules 1–7), serves redacted logs and answers the
 * per-ship authorization question (read vs mutate).
 *
 * Verification gates (spec §2.4/§11 Phase 2): two code paths exist but are NOT enable-able until the human
 * gate PASS is recorded —
 *   V-3  `config.ship.annotationsVerified`  — reading/validating `ship.result` annotations. While false, stages are
 *        derived from job/step conclusions only and no trusted payload (version, sha, digest, settings…) is exposed.
 *   V-4  `config.ship.queueSignalsVerified` — queue watchdog (report-only, DD-7), SUPERSEDED (DD-8), queuedBehind.
 * Both are exercised only by fixtures in tests (BT-10/11/19/20).
 */
const config = require('../config');
const logger = require('../utils/logger');
const { logMetric } = logger;
const githubService = require('./githubService');
const aksService = require('./aksService');
const TtlSingleFlightCache = require('../utils/ttlSingleFlightCache');
const { classifyShipId, shipIdTimestamp, runSearchWindow } = require('../utils/shipId');
const { redactText } = require('../utils/logRedactor');
const { isPlatformMember } = require('../utils/platformTeam');
const { ShipError, mapGithubError } = require('../utils/shipErrors');
const { classifyFailure, buildFailure, sanitizeDetails, ALLOWED_ANNOTATION_CODES } = require('./shipFailureClassifier');
const identity = require('./shipIdentityService');
const { branchError, dnsLabelError, portError } = require('../utils/shipValidators');

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = () => Date.now();

const RUN_NAME_REGEX = /^ship cid=([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) app=([a-z0-9-]{1,63}) env=([a-z0-9]{1,32}) repo=([A-Za-z0-9._/-]{3,141}) by=([a-z0-9._%+@-]{1,254}) oid=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) mode=(full|config_only) retry_by=([a-z0-9._%+@-]{1,254})$/;
const ANNOTATION_REGEX = /^ship\.result\.v1:(prepare|scan|publish|config):([A-Za-z0-9_-]{1,6000})$/;
const BUILD_ANNOTATION_REGEX = /^ship\.result\.v1:build:([A-Za-z0-9_-]{1,6000})$/;
const MAX_RUN_PAGES = 5;
const MAX_ANNOTATION_BYTES = 4096;
const WATCHDOG_MS = 10 * MIN;
const ACTIVE_MAX_MS = 40 * MIN;
const LOG_VIEW_CAP = 5 * 1024 * 1024;
const LOG_DOWNLOAD_CAP = 100 * 1024 * 1024;
const LOG_CHUNK = 256 * 1024;

// Step groups are matched by EXACT name, never by prefix (N3-A4).
const PUBLISH_STEPS = ['Publish: guard', 'Publish: verify image', 'Publish: version', 'Publish: push'];
const CONFIG_STEPS = ['Config PR: decide', 'Config PR: guard', 'Config PR: dispatch', 'Config PR: wait'];
const STAGE_IDS = ['queued', 'prepare', 'build', 'scan', 'publish', 'config_pr', 'preview'];

const runIdsCache = new TtlSingleFlightCache({ max: 500, now });
const statusCache = new TtlSingleFlightCache({ max: 500, now });
const jobsCache = new TtlSingleFlightCache({ max: 500, now });
const annotationsCache = new TtlSingleFlightCache({ max: 1000, now });
const prCache = new TtlSingleFlightCache({ max: 200, now });
const permCache = new TtlSingleFlightCache({ max: 500, now });
const logsCache = new TtlSingleFlightCache({ max: 10, now }); // entries hold ≤ the 5 MB view-cap tail ⇒ ≤ 10 × 5 MB ≈ the 50 MB budget
const flags = new TtlSingleFlightCache({ max: 2000, now }); // cancel-requested, watchdog-cancelled, metric de-dup
const freshMarks = new TtlSingleFlightCache({ max: 2000, now }); // fresh-ID miss-cap markers: own bounded cache so a lookup flood can never evict the de-dup flags (QA-008)
const misses = new Map(); // oid -> [timestamps] (negative-lookup cap, DD-14)
const activeShips = new Map(); // cid -> { oid, startedAt } started in this process, not yet observed terminal (DD-14)

// ------------------------------------------------------------------------------------------------
// small helpers
// ------------------------------------------------------------------------------------------------

function parseRunName(name) {
  const m = RUN_NAME_REGEX.exec(typeof name === 'string' ? name : '');
  if (!m) return null;
  return { cid: m[1], app: m[2], env: m[3], repo: m[4], by: m[5], oid: m[6], mode: m[7], retryBy: m[8] };
}

const toMs = (iso) => (iso ? Date.parse(iso) : NaN);

function markOnce(cid, event, stage = '') {
  const key = `metric:${cid}:${event}:${stage}`;
  if (flags.peek(key)) return false;
  flags.set(key, true, DAY);
  return true;
}

function flagCancelRequested(cid) {
  flags.set(`cancel:${cid}`, true, HOUR);
}

function trackShip(cid, oid) {
  activeShips.set(cid, { oid, startedAt: now() });
}

function untrackShip(cid) {
  activeShips.delete(cid);
}

function activeCounts(oid) {
  const cutoff = now() - ACTIVE_MAX_MS;
  let total = 0;
  let mine = 0;
  for (const [cid, a] of activeShips) {
    if (a.startedAt < cutoff) { activeShips.delete(cid); continue; }
    total++;
    if (a.oid === oid) mine++;
  }
  return { total, mine };
}

function reasonRejected(cid, stage, reason) {
  logMetric('ship_annotation_rejected', { correlationId: cid, stage, reason, level: 'warn' });
  return { status: 'rejected', reason };
}

// ------------------------------------------------------------------------------------------------
// run lookup (§3.5, B-7)
// ------------------------------------------------------------------------------------------------

function pickRun(r, parsed) {
  return {
    id: r.id, runAttempt: r.run_attempt || 1, createdAt: r.created_at, runStartedAt: r.run_started_at || r.created_at,
    updatedAt: r.updated_at, status: r.status, conclusion: r.conclusion, htmlUrl: r.html_url, parsed,
  };
}

/** Every run of the ship (+ other ships' active runs for same-app queue detection), from the UUIDv7 window. */
async function listRuns(cid) {
  const t = shipIdTimestamp(cid);
  return runIdsCache.get(`runIds:${cid}`, async () => {
    const { retryWindowHours } = config.ship;
    const window = runSearchWindow(cid, { now: now(), retryWindowHours });
    const matched = [];
    const others = [];
    let page = 1;
    for (; page <= MAX_RUN_PAGES; page++) {
      const runs = await githubService.listWorkflowRunsInWindow(config.ship.workflowRepo, config.ship.workflowFile, { created: window.created, page, perPage: 100, correlationId: cid });
      for (const r of runs) {
        const parsed = parseRunName(r.display_title || r.name);
        if (!parsed) continue;
        if (parsed.cid === cid) matched.push(pickRun(r, parsed));
        else others.push({ id: r.id, app: parsed.app, status: r.status, createdAt: r.created_at });
      }
      if (runs.length < 100) break; // window exhausted — no "found ⇒ stop" shortcut
    }
    logMetric('ship_run_lookup_pages', { correlationId: cid, pages: Math.min(page, MAX_RUN_PAGES), level: page >= MAX_RUN_PAGES ? 'warn' : 'info' });
    matched.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id);
    return { runs: matched, others };
  }, (value) => {
    if (!value.runs.length) return 10 * SEC;
    const newest = value.runs[value.runs.length - 1];
    const windowOpen = now() < t + config.ship.retryWindowHours * HOUR;
    return newest.status !== 'completed' || windowOpen ? MIN : DAY;
  });
}

function getJobs(run, cid) {
  return jobsCache.get(`jobs:${run.id}`, () => githubService.listJobsForRun(config.ship.workflowRepo, run.id, cid), () => (run.status === 'completed' ? DAY : 10 * SEC));
}

function getAnnotations(job, cid) {
  return annotationsCache.get(`ann:${job.id}`, () => githubService.listJobAnnotations(config.ship.workflowRepo, job.id, cid), DAY);
}

// ------------------------------------------------------------------------------------------------
// trusted-result validation (§3.5 rules 1–7, §4.5)
// ------------------------------------------------------------------------------------------------

const RE = { sha: /^[0-9a-f]{40}$/, shortSha: /^[0-9a-f]{7,12}$/, digest: /^sha256:[0-9a-f]{64}$/, sha256: /^[0-9a-f]{64}$/, version: /^\d+\.\d+\.\d+$/, env: /^[a-z0-9]{1,32}$/, health: /^\/[A-Za-z0-9._~/-]{0,254}$/, repoUrl: /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, token: /^[A-Za-z0-9._:/@-]{1,200}$/ };

class Reject extends Error {}
const bad = (reason) => { throw new Reject(reason); };
const opt = (obj, key, fn) => (obj[key] === undefined ? undefined : fn(obj[key]));
const str = (re) => (v) => (typeof v === 'string' && re.test(v) ? v : bad('format'));
const int = (min, max) => (v) => (Number.isInteger(v) && v >= min && v <= max ? v : bad('format'));
const bool = (v) => (typeof v === 'boolean' ? v : bad('format'));
const oneOf = (list) => (v) => (list.includes(v) ? v : bad('format'));
const dropUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function parsePayload(tag, o, { run, cid }) {
  if (o.v !== 1) bad('version');
  if (o.stage !== tag || o.cid !== cid || o.runId !== run.id || o.runAttempt !== run.runAttempt) bad('identity');
  const common = { v: 1, stage: tag, cid, runId: run.id, runAttempt: run.runAttempt, ok: bool(o.ok) };
  const code = opt(o, 'code', oneOf(ALLOWED_ANNOTATION_CODES[tag]));
  if (common.ok && code) bad('format');
  if (tag === 'prepare') {
    const i = o.inputs && typeof o.inputs === 'object' ? o.inputs : bad('format');
    const e = o.effective && typeof o.effective === 'object' ? o.effective : bad('format');
    const check = (m) => (m ? bad('format') : undefined);
    check(branchError(i.branch)); check(dnsLabelError(i.app, 'app')); check(dnsLabelError(i.namespace, 'namespace')); check(dnsLabelError(i.teamLabel, 'teamLabel')); check(portError(i.port));
    return dropUndefined({
      ...common, mode: oneOf(['full', 'config_only'])(o.mode), code,
      sha: opt(o, 'sha', str(RE.sha)), shortSha: opt(o, 'shortSha', str(RE.shortSha)), repoUrl: opt(o, 'repoUrl', str(RE.repoUrl)),
      builderRef: opt(o, 'builderRef', str(/^[A-Za-z0-9._/:@-]{1,200}$/)), sourceBytes: opt(o, 'sourceBytes', int(0, 10 ** 12)),
      appState: oneOf(['new', 'preview_open', 'merged', 'closed_unmerged'])(o.appState),
      effective: { port: int(1024, 65535)(e.port), healthPath: str(RE.health)(e.healthPath) },
      skipConfig: bool(o.skipConfig),
      inputs: { branch: i.branch, env: str(RE.env)(i.env), app: i.app, namespace: i.namespace, teamLabel: i.teamLabel, port: Number(i.port), healthPath: str(RE.health)(i.healthPath), bump: oneOf(['patch', 'minor', 'major'])(i.bump) },
    });
  }
  if (tag === 'scan') {
    const findings = opt(o, 'findings', (f) => (Array.isArray(f) && f.length <= 10 ? f.map((x) => ({ package: String(x?.package ?? ''), version: String(x?.version ?? ''), fixedIn: String(x?.fixedIn ?? ''), severity: String(x?.severity ?? '') })) : bad('format')));
    const severityCounts = opt(o, 'severityCounts', (c) => (c && typeof c === 'object' && !Array.isArray(c) ? c : bad('format')));
    return dropUndefined({ ...common, code, scanId: opt(o, 'scanId', str(RE.token)), tarSha256: opt(o, 'tarSha256', str(RE.sha256)), severityCounts, findings });
  }
  if (tag === 'publish') {
    const prefix = `${config.ship.registry}/${config.ship.acrRepoPrefix}/${run.parsed.app}`;
    const imageRef = opt(o, 'imageRef', (v) => (typeof v === 'string' && (v === prefix || v.startsWith(`${prefix}:`) || v.startsWith(`${prefix}@`)) ? v : bad('format')));
    return dropUndefined({
      ...common, code, version: opt(o, 'version', str(RE.version)), imageRef, digest: opt(o, 'digest', str(RE.digest)),
      shaTag: opt(o, 'shaTag', str(/^sha-[0-9a-f]{7,12}$/)), scanId: opt(o, 'scanId', str(RE.token)), tarSha256: opt(o, 'tarSha256', str(RE.sha256)),
    });
  }
  // config
  return dropUndefined({
    ...common, code, skipped: opt(o, 'skipped', bool), prNumber: opt(o, 'prNumber', int(1, 10 ** 9)),
    prUrl: opt(o, 'prUrl', str(/^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/\d+$/)),
    rollout: oneOf(['preview_pr', 'flux_auto_roll'])(o.rollout),
    configRunUrl: opt(o, 'configRunUrl', str(/^https:\/\/github\.com\/[A-Za-z0-9._/-]+$/)), configQueued: opt(o, 'configQueued', bool),
    imageTag: opt(o, 'imageTag', str(RE.version)), originRunId: opt(o, 'originRunId', int(1, Number.MAX_SAFE_INTEGER)),
  });
}

/** Steps 2–5 of rules 1–5 for one annotation message. */
function decodeAnnotation(tag, encoded, ctx) {
  const buf = Buffer.from(encoded, 'base64url');
  if (buf.toString('base64url') !== encoded) return { reason: 'base64' };
  if (buf.length > MAX_ANNOTATION_BYTES) return { reason: 'oversize' };
  let obj;
  try { obj = JSON.parse(buf.toString('utf8')); } catch (e) { return { reason: 'json' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { reason: 'json' };
  try {
    return { payload: parsePayload(tag, obj, ctx) };
  } catch (e) {
    if (e instanceof Reject) return { reason: e.message };
    throw e;
  }
}

/**
 * Rules 1–5 for the stage tags expected on one job. Returns `{ [tag]: {status:'ok',payload}|{status:'rejected',reason}|{status:'absent'} }`.
 * Rule 6 (evidence) and rule 7 (cross-stage) are applied by the caller.
 */
function validateJobAnnotations(annotations, expectedTags, ctx) {
  const byTag = {};
  for (const a of annotations || []) {
    if (!a || a.title !== 'ship.result') continue;
    const m = ANNOTATION_REGEX.exec(typeof a.message === 'string' ? a.message : '');
    if (!m) { reasonRejected(ctx.cid, 'unknown', 'format'); continue; }
    (byTag[m[1]] = byTag[m[1]] || []).push(m[2]);
  }
  const out = {};
  for (const tag of Object.keys(byTag)) if (!expectedTags.includes(tag)) reasonRejected(ctx.cid, tag, 'unexpected_stage'); // rule 2: ignored
  for (const tag of expectedTags) {
    const found = byTag[tag] || [];
    if (found.length === 0) out[tag] = { status: 'absent' };
    else if (found.length > 1) out[tag] = reasonRejected(ctx.cid, tag, 'duplicate'); // rule 1: tamper
    else {
      const r = decodeAnnotation(tag, found[0], ctx);
      out[tag] = r.payload ? { status: 'ok', payload: r.payload } : reasonRejected(ctx.cid, tag, r.reason);
    }
  }
  return out;
}

/** Rule 6: `ok:true` / `skipped:true` is honoured only with success evidence for THAT stage. */
function applyEvidence(cid, tag, res, evidenceOk) {
  if (res.status !== 'ok') return res;
  if ((res.payload.ok === true || res.payload.skipped === true) && !evidenceOk) return reasonRejected(cid, tag, 'ok_without_evidence');
  return res;
}

/** Build-job hint: display-only, never a decision input; failure of any kind ⇒ no hint. */
function readBuildHint(annotations) {
  const texts = (annotations || []).filter((a) => a && a.title === 'ship.result').map((a) => BUILD_ANNOTATION_REGEX.exec(typeof a.message === 'string' ? a.message : '')).filter(Boolean);
  if (texts.length !== 1) return null;
  try {
    const buf = Buffer.from(texts[0][1], 'base64url');
    if (buf.length > MAX_ANNOTATION_BYTES) return null;
    const o = JSON.parse(buf.toString('utf8'));
    return { code: ALLOWED_ANNOTATION_CODES.build.includes(o.code) ? o.code : undefined, buildpackId: typeof o.buildpackId === 'string' ? o.buildpackId : undefined, errorLine: typeof o.errorLine === 'string' ? o.errorLine : undefined };
  } catch (e) {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------
// per-run stage derivation (§3.5 "Stage derivation")
// ------------------------------------------------------------------------------------------------

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required']);

function jobStage(job) {
  if (!job) return { state: 'pending' };
  const times = { startedAt: job.started_at || undefined, completedAt: job.completed_at || undefined };
  if (job.status === 'completed') {
    if (job.conclusion === 'success' || job.conclusion === 'neutral') return { state: 'succeeded', ...times };
    if (job.conclusion === 'skipped') return { state: 'skipped' };
    return { state: 'failed', ...times };
  }
  return { state: job.status === 'in_progress' ? 'running' : 'pending', ...times };
}

function stepGroup(job, names) {
  const steps = ((job && job.steps) || []).filter((s) => names.includes(s.name));
  if (!steps.length) return { state: 'pending' };
  const times = { startedAt: steps.map((s) => s.started_at).filter(Boolean).sort()[0], completedAt: steps.map((s) => s.completed_at).filter(Boolean).sort().pop() };
  const started = steps.some((s) => s.status !== 'queued' && s.status !== 'pending');
  if (steps.some((s) => s.status === 'completed' && FAILED.has(s.conclusion))) return { state: 'failed', started, ...times };
  if (steps.some((s) => s.status === 'in_progress')) return { state: 'running', started, ...times };
  const allPresent = names.every((n) => steps.some((s) => s.name === n));
  if (allPresent && steps.every((s) => s.status === 'completed' && s.conclusion === 'success')) return { state: 'succeeded', started, ...times };
  return { state: 'pending', started };
}

const emitSucceeded = (job, name) => ((job && job.steps) || []).some((s) => s.name === name && s.status === 'completed' && s.conclusion === 'success');

async function analyzeRun(cid, run) {
  const jobs = await getJobs(run, cid);
  const byName = (n) => jobs.find((j) => j.name === n);
  const J = { prepare: byName('prepare'), build: byName('build'), scan: byName('scan'), publish: byName('publish') };
  const mode = run.parsed.mode;
  const a = { run, mode, jobs: J, terminal: run.status === 'completed', ann: {}, rejected: {}, buildHint: null };

  const publishGroup = stepGroup(J.publish, PUBLISH_STEPS);
  const configGroup = stepGroup(J.publish, CONFIG_STEPS);
  a.publishGroup = publishGroup;
  a.configGroup = configGroup;

  // trusted annotations (V-3 gate)
  const trusted = config.ship.annotationsVerified;
  if (trusted) {
    const ctx = { run, cid };
    const read = async (job, tags) => (job && job.status === 'completed' ? validateJobAnnotations(await getAnnotations(job, cid), tags, ctx) : {});
    const prepare = await read(J.prepare, ['prepare']);
    const scan = mode === 'full' ? await read(J.scan, ['scan']) : {};
    const publish = await read(J.publish, mode === 'full' ? ['publish', 'config'] : ['config']);
    const evidence = {
      prepare: J.prepare && J.prepare.conclusion === 'success',
      scan: J.scan && J.scan.conclusion === 'success',
      publish: publishGroup.state === 'succeeded' && emitSucceeded(J.publish, 'Emit: publish'),
      config: configGroup.state === 'succeeded' && emitSucceeded(J.publish, 'Emit: config'),
    };
    for (const [tag, res] of Object.entries({ ...prepare, ...scan, ...publish })) a.ann[tag] = applyEvidence(cid, tag, res, evidence[tag]);
    if (a.ann.prepare && a.ann.prepare.status === 'ok' && a.ann.prepare.payload.mode !== mode) a.ann.prepare = reasonRejected(cid, 'prepare', 'mode_mismatch');
    // rule 7: cross-stage consistency
    const s = a.ann.scan; const p = a.ann.publish;
    if (s && p && s.status === 'ok' && p.status === 'ok' && s.payload.ok && p.payload.ok && (p.payload.tarSha256 !== s.payload.tarSha256 || p.payload.scanId !== s.payload.scanId)) {
      a.ann.publish = reasonRejected(cid, 'publish', 'cross_stage_mismatch');
    }
    for (const [tag, res] of Object.entries(a.ann)) if (res.status === 'rejected') a.rejected[tag] = true;
    if (J.build && J.build.status === 'completed' && J.build.conclusion !== 'success') a.buildHint = readBuildHint(await getAnnotations(J.build, cid));
  }
  const annOk = (tag) => a.ann[tag] && a.ann[tag].status === 'ok';
  const annOf = (tag) => (annOk(tag) ? a.ann[tag].payload : null);
  a.annOf = annOf;
  a.publishOk = mode === 'full' && !!annOf('publish') && annOf('publish').ok === true;

  // stages (this run's own view)
  const anyStarted = jobs.some((j) => j.status !== 'queued');
  const own = {};
  own.queued = { state: anyStarted ? 'succeeded' : 'running' };
  own.prepare = jobStage(J.prepare);
  own.build = mode === 'config_only' ? { state: 'skipped' } : jobStage(J.build);
  own.scan = mode === 'config_only' ? { state: 'skipped' } : jobStage(J.scan);
  own.publish = mode === 'config_only' ? { state: 'skipped' } : { state: publishGroup.state, startedAt: publishGroup.startedAt, completedAt: publishGroup.completedAt };
  // trusted-job stages: a "succeeded" job whose trusted result is missing/rejected is failed UNKNOWN, never success
  if (trusted) {
    for (const tag of ['prepare', 'scan']) {
      if (own[tag].state === 'succeeded' && !(annOk(tag) && a.ann[tag].payload.ok)) { own[tag] = { ...own[tag], state: 'failed' }; a.rejected[tag] = true; }
    }
    if (own.publish.state === 'succeeded' && !a.publishOk && mode === 'full') { own.publish = { ...own.publish, state: 'failed' }; a.rejected.publish = true; }
  }
  const configAnn = annOf('config');
  let config_pr;
  if (configGroup.state === 'running') config_pr = { state: 'running', startedAt: configGroup.startedAt };
  else if (configGroup.state === 'failed') config_pr = { state: 'failed', startedAt: configGroup.startedAt, completedAt: configGroup.completedAt };
  else if (configGroup.state === 'succeeded') {
    const times = { startedAt: configGroup.startedAt, completedAt: configGroup.completedAt };
    if (!trusted) config_pr = { state: 'succeeded', ...times };
    else if (configAnn && configAnn.ok && configAnn.skipped) config_pr = { state: 'skipped', ...times };
    else if (configAnn && configAnn.ok) config_pr = { state: 'succeeded', ...times };
    else { config_pr = { state: 'failed', ...times }; if (!configAnn) a.rejected.config = true; }
  } else config_pr = { state: 'pending' };
  own.config_pr = config_pr;
  a.stages = own;
  return a;
}

// ------------------------------------------------------------------------------------------------
// preview + PR
// ------------------------------------------------------------------------------------------------

/** §3.8 — never a default domain: only from config.ship.previewHosts. */
function buildPreviewUrl(env, prNumber, app, { previewCapable = true } = {}) {
  if (!previewCapable) return { state: 'unavailable_chart' };
  if (!Number.isInteger(prNumber)) return { state: 'pending' };
  const entry = (config.ship.previewHosts || {})[env];
  if (!entry || !/^[a-z0-9.-]+$/i.test(entry.suffix || '') || !['http', 'https'].includes(entry.scheme)) return { state: 'not_configured' };
  return { state: 'available', url: `${entry.scheme}://pr-${prNumber}-${app}.${entry.suffix}` };
}

function getPr(env, app) {
  return prCache.get(`pr:${env}:${app}`, () => githubService.findPullRequestForBranch(config.ship.workflowRepo, `auto/gen-${env}-${app}`, 'all'), 15 * SEC);
}

// ------------------------------------------------------------------------------------------------
// the fold (§3.5 "Attempt composition")
// ------------------------------------------------------------------------------------------------

function watchdogSignal(N, others, cid) {
  if (!config.ship.queueSignalsVerified || N.terminal) return { queuedBehind: false };
  const age = (job) => now() - toMs(job.created_at || job.started_at || N.run.createdAt);
  const prep = N.jobs.prepare;
  if (prep && prep.status === 'queued' && age(prep) > WATCHDOG_MS) return { queuedBehind: false, runnerUnavailable: true, job: 'prepare' };
  const pub = N.jobs.publish;
  if (pub && pub.status === 'queued' && N.mode === 'full' && N.stages.scan.state === 'succeeded') {
    const blocked = others.some((o) => o.app === N.run.parsed.app && o.status !== 'completed' && Date.parse(o.createdAt) <= Date.parse(N.run.createdAt));
    if (blocked) return { queuedBehind: true };
    if (age(pub) > WATCHDOG_MS) return { queuedBehind: false, runnerUnavailable: true, job: 'publish' };
  }
  if (pub && pub.status === 'queued' && N.mode === 'config_only' && N.stages.prepare.state === 'succeeded') {
    const blocked = others.some((o) => o.app === N.run.parsed.app && o.status !== 'completed');
    return blocked ? { queuedBehind: true } : (age(pub) > WATCHDOG_MS ? { queuedBehind: false, runnerUnavailable: true, job: 'publish' } : { queuedBehind: false });
  }
  return { queuedBehind: false };
}

function neverStarted(job) {
  return !job || !job.started_at || !((job.steps || []).some((s) => s.status !== 'queued' && s.status !== 'pending' && s.conclusion !== 'skipped'));
}

function composeStatus(cid, analyzed, others, pr) {
  const n = analyzed.length;
  const N = analyzed[n - 1];
  const fulls = analyzed.filter((a) => a.mode === 'full');
  const I = [...fulls].reverse().find((a) => a.publishOk) || null;
  const F = fulls[fulls.length - 1] || null;
  const carry = I || F || N;
  const first = analyzed[0];
  const parsed = first.run.parsed;
  const trusted = config.ship.annotationsVerified;

  // stages: carried from I (else F), config_pr/preview from N
  const stageOf = (id) => ({ id, ...(carry.stages[id]) });
  const stages = [stageOf('queued'), stageOf('prepare'), stageOf('build'), stageOf('scan'), stageOf('publish'), { id: 'config_pr', ...N.stages.config_pr }];
  const configState = stages[5].state;
  const prNumber = pr ? pr.number : (N.annOf('config') && N.annOf('config').prNumber);
  const preview = configState === 'succeeded' ? buildPreviewUrl(parsed.env, prNumber, parsed.app) : { state: 'pending' };
  stages.push({ id: 'preview', state: configState === 'skipped' ? 'skipped' : configState === 'succeeded' && Number.isInteger(prNumber) ? 'succeeded' : 'pending' });

  // carried trusted values
  const prep = carry.annOf('prepare');
  const pub = carry.annOf('publish');
  const scanAnn = carry.annOf('scan');
  const settingsRun = [...analyzed].reverse().find((a) => a.annOf('prepare') && a.annOf('prepare').ok);
  const settings = settingsRun ? (({ branch, namespace, teamLabel, port, healthPath, bump }) => ({ branch, namespace, teamLabel, port, healthPath, bump }))(settingsRun.annOf('prepare').inputs) : undefined;

  // N's result
  const signal = watchdogSignal(N, others, cid);
  let state;
  let failure;
  let terminal = N.terminal;
  const failedStage = ['prepare', 'build', 'scan', 'publish', 'config_pr'].find((s) => N.stages[s].state === 'failed') || null;
  const rejectedAny = Object.keys(N.rejected).length > 0;

  const stageAnn = (s) => ({ prepare: 'prepare', scan: 'scan', publish: 'publish', config_pr: 'config' }[s]);
  const failWith = (extra = {}) => {
    const annTag = stageAnn(failedStage);
    const payload = annTag ? N.annOf(annTag) : null;
    const buildJob = N.jobs.build;
    const buildDurationSec = failedStage === 'build' && buildJob && buildJob.started_at && buildJob.completed_at ? (toMs(buildJob.completed_at) - toMs(buildJob.started_at)) / 1000 : undefined;
    const code = classifyFailure({
      failedStage, annotationCode: payload && payload.ok === false ? payload.code : undefined,
      annotationRejected: !!(failedStage && N.rejected[failedStage === 'config_pr' ? 'config' : failedStage]) || (!failedStage && rejectedAny),
      stepFailed: failedStage === 'publish' ? N.publishGroup.state === 'failed' : failedStage === 'config_pr' ? N.configGroup.state === 'failed' : false,
      buildHintCode: N.buildHint && N.buildHint.code, buildDurationSec, ...extra,
    });
    const details = { runUrl: N.run.htmlUrl };
    if (code === 'SECURITY_GATE_FAILED' && payload) { details.findings = payload.findings; details.severityCounts = payload.severityCounts; }
    if ((code === 'BUILD_FAILED' || code === 'UNSUPPORTED_LANGUAGE') && N.buildHint) { details.buildpackId = N.buildHint.buildpackId; details.errorLine = N.buildHint.errorLine; }
    const windowElapsed = now() > shipIdTimestamp(cid) + config.ship.retryWindowHours * HOUR;
    return buildFailure(code, details, { retryWindowElapsed: windowElapsed });
  };

  if (N.terminal) {
    if (N.run.conclusion === 'cancelled') {
      const requested = !!flags.peek(`cancel:${cid}`);
      const superseded = config.ship.queueSignalsVerified && !requested && N.mode === 'full' && !!N.jobs.publish && N.jobs.publish.conclusion === 'cancelled' && neverStarted(N.jobs.publish);
      state = 'cancelled';
      failure = buildFailure(superseded ? 'SUPERSEDED' : 'CANCELLED', { runUrl: N.run.htmlUrl });
    } else if (N.run.conclusion === 'success') {
      const configOnlyMismatch = N.mode === 'config_only' && trusted && !(I && N.annOf('config') && N.annOf('config').imageTag === (I.annOf('publish') || {}).version && N.annOf('config').originRunId === I.run.id);
      const missing = trusted && (!N.annOf('prepare') || (N.mode === 'full' && (!N.annOf('scan') || !N.annOf('publish'))) || !N.annOf('config') || rejectedAny);
      if (configOnlyMismatch || missing || failedStage) {
        state = 'failed';
        failure = failWith();
        if (configOnlyMismatch) { stages[5] = { ...stages[5], state: 'failed' }; stages[6] = { ...stages[6], state: 'pending' }; }
      } else state = 'succeeded';
    } else {
      state = 'failed';
      failure = failWith();
    }
  } else if (signal.runnerUnavailable) {
    state = 'failed';
    terminal = false;
    failure = buildFailure('RUNNER_UNAVAILABLE', { runUrl: N.run.htmlUrl, runStillQueued: true });
  } else {
    state = N.stages.queued.state === 'running' ? 'queued' : 'running';
  }

  const runDurations = analyzed.map((a) => {
    const start = toMs(a.run.runStartedAt);
    const end = a.terminal ? toMs(a.run.updatedAt) : now();
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 1000) : 0;
  });
  const status = dropUndefinedDeep({
    correlationId: cid, app: parsed.app, env: parsed.env, repo: parsed.repo,
    startedAt: first.run.createdAt, completedAt: terminal ? N.run.updatedAt : undefined,
    durationSec: Math.round(runDurations.reduce((s, d) => s + d, 0)),
    state, terminal, attempt: n, queuedBehind: !!signal.queuedBehind, runResolved: true,
    stages, version: get(pub, 'version'), sha: get(prep, 'sha'), shortSha: get(prep, 'shortSha'), imageRef: get(pub, 'imageRef'), digest: get(pub, 'digest'),
    scanId: get(pub, 'scanId') || get(scanAnn, 'scanId'), tarSha256: get(pub, 'tarSha256') || get(scanAnn, 'tarSha256'),
    // untrusted text: control-stripped, redacted, ≤300 chars (same path as failure.details)
    buildHint: carry.buildHint ? sanitizeDetails({ buildpackId: carry.buildHint.buildpackId, errorLine: carry.buildHint.errorLine }) : undefined,
    settings,
    pr: pr ? { number: pr.number, url: pr.url, state: pr.state } : undefined,
    rollout: get(N.annOf('config'), 'rollout') || (prep ? (prep.appState === 'merged' ? 'flux_auto_roll' : 'preview_pr') : undefined),
    preview, failure,
  });
  if (failure && failure.details) failure.details = dropUndefinedDeep(failure.details);

  // internal context: authz keys, retry preconditions, log targets, watchdog candidate
  const logTarget = (stage) => {
    const src = stage === 'config_pr' ? N : carry;
    const job = { prepare: src.jobs.prepare, build: src.jobs.build, scan: src.jobs.scan, publish: src.jobs.publish, config_pr: N.jobs.publish }[stage];
    return job ? { runId: src.run.id, job, stage } : null;
  };
  const meta = {
    oid: parsed.oid, repo: parsed.repo, app: parsed.app, env: parsed.env, by: parsed.by, startedAtMs: shipIdTimestamp(cid),
    N, I, runCount: n, settings: settingsRun ? settingsRun.annOf('prepare') : null, logTarget,
    watchdog: signal.runnerUnavailable && signal.job === 'prepare' && neverStarted(N.jobs.prepare) ? { runId: N.run.id } : null,
    publishStarted: !!N.jobs.publish && N.jobs.publish.status !== 'queued' && N.jobs.publish.conclusion !== 'skipped' && !neverStarted(N.jobs.publish),
  };
  return { status, meta };
}

const get = (o, k) => (o ? o[k] : undefined);

function dropUndefinedDeep(v) {
  if (Array.isArray(v)) return v.map(dropUndefinedDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, dropUndefinedDeep(x)]));
  return v;
}

/** Actual stage duration from GitHub's own step/job timestamps; undefined (field omitted) when the stage carries none (queued, preview). */
function stageDurationMs(s) {
  const d = toMs(s.completedAt) - toMs(s.startedAt);
  return Number.isFinite(d) ? Math.max(0, d) : undefined;
}

function emitStageMetrics(cid, status) {
  for (const s of status.stages) if (['succeeded', 'failed'].includes(s.state) && markOnce(cid, 'ship_stage_completed', s.id)) logMetric('ship_stage_completed', { correlationId: cid, stage: s.id, state: s.state, duration_ms: stageDurationMs(s) });
}

function emitMetrics(cid, status) {
  if (!status.terminal) {
    emitStageMetrics(cid, status);
    return;
  }
  activeShips.delete(cid);
  emitStageMetrics(cid, status);
  if (status.state === 'succeeded' && markOnce(cid, 'ship_succeeded')) logMetric('ship_succeeded', { correlationId: cid, duration_ms: (status.durationSec || 0) * 1000 });
  else if (status.failure && markOnce(cid, 'ship_failed')) logMetric('ship_failed', { correlationId: cid, code: status.failure.code, duration_ms: (status.durationSec || 0) * 1000, level: 'warn' });
}

// ------------------------------------------------------------------------------------------------
// context (cached compose) + authorization
// ------------------------------------------------------------------------------------------------

async function compose(cid) {
  const { runs, others } = await listRuns(cid);
  const t = shipIdTimestamp(cid);
  if (!runs.length) {
    if (now() - t < 3 * MIN) {
      const stages = STAGE_IDS.map((id) => ({ id, state: id === 'queued' ? 'running' : 'pending' }));
      return { placeholder: true, status: { correlationId: cid, startedAt: new Date(t).toISOString(), state: 'queued', terminal: false, attempt: 0, queuedBehind: false, runResolved: false, stages, preview: { state: 'pending' } }, meta: { placeholder: true } };
    }
    return { notFound: true };
  }
  const p = runs[0].parsed;
  if (runs.some((r) => r.parsed.oid !== p.oid || r.parsed.app !== p.app || r.parsed.env !== p.env || r.parsed.repo !== p.repo)) {
    logMetric('ship_annotation_rejected', { correlationId: cid, reason: 'runs_identity_mismatch', level: 'warn' });
    return { notFound: true };
  }
  const analyzed = [];
  for (const run of runs) analyzed.push(await analyzeRun(cid, run));
  const first = composeStatus(cid, analyzed, others, null);
  let pr = null;
  const publishDone = first.status.stages.find((s) => s.id === 'publish').state === 'succeeded';
  if (publishDone && first.status.stages.find((s) => s.id === 'config_pr').state !== 'skipped') {
    try { pr = await getPr(p.env, p.app); } catch (error) { logger.warn(`[${cid}] PR lookup failed: ${error.message}`); }
  }
  const result = pr ? composeStatus(cid, analyzed, others, pr) : first;
  emitMetrics(cid, result.status);
  return result;
}

function statusTtl(value) {
  if (value.notFound) return MIN;
  if (value.placeholder) return 10 * SEC;
  const snap = githubService.getRateLimitSnapshot && githubService.getRateLimitSnapshot();
  if (snap && snap.remaining < config.ship.rateLimitGuardRemaining) return MIN;
  return value.status.terminal ? MIN : 10 * SEC;
}

function recordMiss(oid, cid, requestId) {
  const cutoff = now() - MIN;
  const list = (misses.get(oid) || []).filter((x) => x > cutoff);
  list.push(now());
  misses.set(oid, list);
  if (list.length > 30) {
    logMetric('ship_rate_limited', { correlationId: cid, requestId, limit: 'user_misses', actor_oid: oid, level: 'warn' });
    throw new ShipError(429, 'PLATFORM_RATE_LIMITED', 'Too many unknown ship lookups. Try again shortly.', { details: { limit: 'user_misses' }, retryAfterSec: 60 });
  }
}

/** Resolves a ship ID to `{status, meta}`; throws ShipError 404 (no GitHub call for future/expired IDs), 429/503. */
async function getShipContext(cid, user, requestId) {
  if (classifyShipId(cid, { retentionDays: config.ship.retentionDays }) !== 'ok') throw new ShipError(404, 'NOT_FOUND', 'Ship not found.');
  // A fresh ID (inside the 3-minute queued-placeholder window) is answered "queued" for ANYONE, so it can never be a
  // negative-cache miss; each distinct fresh ID a user opens therefore counts against the same per-user cap BEFORE the
  // GitHub search (once per ID, so the starter polling their own ship is not penalised) — DD-14/T12.
  const fresh = `fresh:${user.id}:${cid}`;
  if (now() - shipIdTimestamp(cid) < 3 * MIN && !freshMarks.peek(fresh)) { freshMarks.set(fresh, true, 3 * MIN); recordMiss(user.id, cid, requestId); }
  let ctx;
  try {
    ctx = await statusCache.get(`status:${cid}`, () => compose(cid), statusTtl);
  } catch (error) {
    throw mapGithubError(error);
  }
  if (ctx.notFound) { recordMiss(user.id, cid, requestId); throw new ShipError(404, 'NOT_FOUND', 'Ship not found.'); }
  return ctx;
}

async function isRepoReader(user, repoFull) {
  const provider = identity.getProvider();
  const link = await provider.getLink(user);
  if (!link || link.state !== 'linked') return false;
  const [org, name] = repoFull.split('/');
  const perm = await permCache.get(`perm:${link.login}:${repoFull}`, () => provider.getRepoPermission(user, link, org, name), 5 * MIN);
  return ['read', 'write', 'admin'].includes(perm);
}

/**
 * §3.6.3: starter (immutable Entra oid) | repo reader | platform member.
 * Read: any of the three. Mutate: starter or platform member only.
 * @returns {Promise<'starter'|'platform'|'repo_reader'|null>}
 */
async function authorize(user, meta, { mutate = false } = {}) {
  if (meta.placeholder) return mutate ? null : 'starter';
  if (user && meta.oid === String(user.id || '').toLowerCase()) return 'starter';
  if (isPlatformMember(user)) return 'platform';
  if (!mutate && await isRepoReader(user, meta.repo)) return 'repo_reader';
  return null;
}

function denyForbidden(cid, user, action, requestId) {
  logMetric('ship_authz_denied', { correlationId: cid, requestId, action, actor_oid: user && user.id, level: 'warn' });
  return new ShipError(403, 'FORBIDDEN', 'You do not have access to this ship.');
}

async function maybeWatchdogCancel(cid, ctx, user, role, requestId) {
  if (!config.ship.queueSignalsVerified || !config.ship.watchdogCancelEnabled || !ctx.meta.watchdog) return;
  if (role !== 'starter' && role !== 'platform') return;
  if (flags.peek(`wdcancel:${cid}`) || flags.peek(`cancel:${cid}`)) return;
  flags.set(`wdcancel:${cid}`, true, HOUR);
  flagCancelRequested(cid);
  try {
    await githubService.cancelWorkflowRun(config.ship.workflowRepo, ctx.meta.watchdog.runId, cid);
    logMetric('ship_watchdog_cancel', { correlationId: cid, requestId, actor_oid: user.id, run_id: ctx.meta.watchdog.runId });
    statusCache.delete(`status:${cid}`);
  } catch (error) {
    logger.warn(`[${cid}] watchdog cancel failed: ${error.message}`, { requestId });
  }
}

/** GET /api/ship/status/:id — authorized ShipStatus (internal fields never leave this service). */
async function getStatus(cid, user, { requestId } = {}) {
  const ctx = await getShipContext(cid, user, requestId);
  const role = await authorize(user, ctx.meta);
  if (!role) throw denyForbidden(cid, user, 'status', requestId);
  await maybeWatchdogCancel(cid, ctx, user, role, requestId);
  return ctx.status;
}

// ------------------------------------------------------------------------------------------------
// logs (§3.5 "Logs", FR-009)
// ------------------------------------------------------------------------------------------------

const TS_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s?/;

/** Keep only log lines whose timestamp falls in the selected steps' [started, completed] ranges (lines without a timestamp follow the previous line). */
function filterLogBySteps(text, steps) {
  if (!steps) return text;
  const ranges = steps.filter((s) => s.started_at).map((s) => [toMs(s.started_at) - 1000, (s.completed_at ? toMs(s.completed_at) : Infinity) + 1000]);
  let keep = false;
  return text.split('\n').filter((line) => {
    const m = TS_LINE.exec(line);
    if (m) { const ts = toMs(m[1]); keep = ranges.some(([a, b]) => ts >= a && ts <= b); }
    return keep;
  }).join('\n');
}

async function getLogs(cid, user, { stage, offset = 0, download = false, requestId }) {
  const ctx = await getShipContext(cid, user, requestId);
  const role = await authorize(user, ctx.meta);
  if (!role) throw denyForbidden(cid, user, 'logs', requestId);
  const target = ctx.meta.logTarget && ctx.meta.logTarget(stage);
  const empty = { stage, text: '', offset, complete: false, available: false, truncated: false, skippedBytes: 0, totalBytes: 0 };
  if (!target || target.job.status === 'queued') return empty;
  const job = target.job;
  const done = job.status === 'completed';
  let steps = null;
  if (stage === 'publish') steps = (job.steps || []).filter((s) => !s.name.startsWith('Config PR:'));
  if (stage === 'config_pr') steps = (job.steps || []).filter((s) => s.name.startsWith('Config PR:'));
  // Cache only the capped view tail (+ the full length) so the cache is bounded by 10 x LOG_VIEW_CAP (~50 MB, §3.5);
  // a download of a log larger than the view cap is re-fetched uncached instead.
  const load = async (cap) => {
    const raw = await githubService.downloadJobLogs(config.ship.workflowRepo, job.id, cid);
    if (raw === null) return null;
    const full = redactText(filterLogBySteps(raw, steps));
    return { total: full.length, text: full.length > cap ? full.slice(full.length - cap) : full };
  };
  let entry;
  try {
    entry = await logsCache.get(`logs:${job.id}:${stage}`, () => load(LOG_VIEW_CAP), (v) => (v === null ? 0 : done ? 365 * DAY : 10 * SEC));
    if (entry && download && entry.total > LOG_VIEW_CAP) entry = await load(LOG_DOWNLOAD_CAP);
  } catch (error) {
    throw mapGithubError(error);
  }
  if (entry === null) return empty; // in-progress job with no log yet (V-5)
  const cap = download ? LOG_DOWNLOAD_CAP : LOG_VIEW_CAP;
  const truncated = entry.total > cap;
  const skippedBytes = truncated ? entry.total - cap : 0;
  const text = entry.text;
  if (download) return { download: true, stage, text, complete: done, available: true, truncated, skippedBytes, totalBytes: text.length };
  const start = Math.min(Math.max(0, offset), text.length);
  const chunk = text.slice(start, start + LOG_CHUNK);
  const next = start + chunk.length;
  return { stage, text: chunk, offset: next, complete: done && next >= text.length, available: true, truncated, skippedBytes, totalBytes: text.length };
}

function invalidate(cid) {
  statusCache.delete(`status:${cid}`);
  runIdsCache.delete(`runIds:${cid}`);
}

function _resetForTests() {
  for (const c of [runIdsCache, statusCache, jobsCache, annotationsCache, prCache, permCache, logsCache, flags, freshMarks]) c.clear();
  misses.clear();
  activeShips.clear();
}

module.exports = {
  parseRunName, RUN_NAME_REGEX, PUBLISH_STEPS, CONFIG_STEPS, STAGE_IDS,
  buildPreviewUrl, getShipContext, authorize, denyForbidden, getStatus, getLogs,
  validateJobAnnotations, applyEvidence, parsePayload, filterLogBySteps,
  trackShip, untrackShip, activeCounts, flagCancelRequested, invalidate, _resetForTests,
};
