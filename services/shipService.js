/**
 * Ship orchestration (docs/architecture/ship-from-repo-spec.md §3.6, §3.7, §4.1, DD-14). Thin: validation lives in
 * utils/shipValidators.js, run/status logic in shipStatusService.js, identity in shipIdentityService.js.
 *
 * Credential discipline (NFR-003, §4.3): repo/branch/permission reads go through the Code App helpers
 * (githubService.codeApp*) and the identity provider; dispatch, run reads and cancel use the Infrastructure App
 * (githubService.triggerWorkflow / cancelWorkflowRun / aksService.getAppState). A function never mixes the two.
 */
const config = require('../config');
const logger = require('../utils/logger');
const { logMetric } = logger;
const githubService = require('./githubService');
const aksService = require('./aksService');
const identity = require('./shipIdentityService');
const status = require('./shipStatusService');
const TtlSingleFlightCache = require('../utils/ttlSingleFlightCache');
const { mintShipId, shipIdTimestamp } = require('../utils/shipId');
const { ShipError, mapGithubError } = require('../utils/shipErrors');
const { sanitizeActor, parseRepo, branchError, DEFAULTS, PORT_MIN, PORT_MAX } = require('../utils/shipValidators');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const now = () => Date.now();
const READ_PERMISSIONS = ['read', 'write', 'admin'];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const reposCache = new TtlSingleFlightCache({ max: 200, now });
const branchesCache = new TtlSingleFlightCache({ max: 500, now });
const appStateCache = new TtlSingleFlightCache({ max: 500, now });
const dedupe = new Map(); // `${oid}|${JSON of all validated input fields}` -> { at, promise } (set synchronously: concurrent duplicates share one start)
const recentRetries = new Map(); // cid -> timestamp (a retry in flight / just dispatched)
const startTimes = []; // global start timestamps (this process)
const userStartTimes = new Map(); // oid -> timestamps

const notAccessible = (hint) => new ShipError(403, 'REPO_NOT_ACCESSIBLE', 'That repository is not accessible to you.', hint ? { hint } : {});

// ------------------------------------------------------------------------------------------------
// identity / access
// ------------------------------------------------------------------------------------------------

async function requireReadAccess(user, repo) {
  const provider = identity.getProvider();
  const link = await provider.getLink(user);
  if (!link || link.state !== 'linked') throw notAccessible('IDENTITY_NOT_LINKED');
  const permission = await provider.getRepoPermission(user, link, repo.org, repo.name);
  if (!READ_PERMISSIONS.includes(permission)) throw notAccessible();
  return link;
}

// ------------------------------------------------------------------------------------------------
// GET /config, /repos, /repos/:org/:repo/branches, /apps/:env/:app
// ------------------------------------------------------------------------------------------------

async function getConfig(user) {
  const link = await identity.getProvider().getLink(user);
  const ident = link.state === 'linked' ? { state: 'linked' } : { state: 'unlinked', reason: link.reason };
  const previewConfiguredEnvs = Object.keys(config.ship.previewHosts || {}).filter((env) => status.buildPreviewUrl(env, 1, 'x').state === 'available');
  return {
    allowedOrgs: config.ship.allowedOrgs,
    supportedLanguages: config.ship.supportedLanguages,
    identity: ident,
    previewConfiguredEnvs,
    defaults: { ...DEFAULTS },
    limits: { portMin: PORT_MIN, portMax: PORT_MAX, recentMax: 20, pollIntervalMs: 15000 },
  };
}

async function listRepos(user, { q = '', limit = 100 } = {}) {
  const provider = identity.getProvider();
  const link = await provider.getLink(user);
  if (link.state !== 'linked') return { repos: [], identity: { state: 'unlinked', reason: link.reason }, truncated: false };
  const orgs = config.ship.allowedOrgs;
  let all;
  try {
    all = await reposCache.get(`repos:${user.id}`, () => provider.listAccessibleRepos(user, link, orgs), 5 * MIN);
  } catch (error) {
    throw mapGithubError(error);
  }
  const needle = String(q).toLowerCase();
  const filtered = all
    .filter((r) => orgs.some((o) => o.toLowerCase() === String(r.org).toLowerCase()) && r.fork !== true)
    .filter((r) => !needle || r.fullName.toLowerCase().includes(needle))
    .map((r) => ({ fullName: r.fullName, org: r.org, name: r.name, defaultBranch: r.defaultBranch, private: !!r.private }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const max = Math.min(Number(limit) || 100, 500);
  return { repos: filtered.slice(0, max), identity: { state: 'linked' }, truncated: filtered.length > max };
}

async function listBranches(user, org, name, { q = '', page = 1 } = {}) {
  const repo = parseRepo(`${org}/${name}`);
  if (!repo.ok) throw new ShipError(400, 'VALIDATION_FAILED', repo.message);
  await requireReadAccess(user, repo);
  const pageNo = Math.min(Math.max(Number(page) || 1, 1), 3);
  let data;
  try {
    data = await branchesCache.get(`branches:${user.id}:${repo.fullName}:${pageNo}`, async () => {
      const [list, meta] = await Promise.all([githubService.codeAppListBranches(repo.org, repo.name, pageNo), githubService.codeAppGetRepo(repo.org, repo.name)]);
      return list && meta ? { ...list, defaultBranch: meta.defaultBranch } : null;
    }, 5 * MIN);
    if (!data) throw notAccessible();
    let branches = data.branches.map((b) => ({ name: b.name, isDefault: b.name === data.defaultBranch }));
    const needle = String(q).toLowerCase();
    if (needle) branches = branches.filter((b) => b.name.toLowerCase().includes(needle));
    // typed branch not in the page: verify it directly
    if (q && !branches.some((b) => b.name === q) && !branchError(q) && await githubService.codeAppBranchExists(repo.org, repo.name, q)) {
      branches.push({ name: q, isDefault: q === data.defaultBranch });
    }
    branches.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
    return { branches, defaultBranch: data.defaultBranch, ...(data.hasNext && pageNo < 3 ? { nextPage: pageNo + 1 } : {}) };
  } catch (error) {
    throw mapGithubError(error);
  }
}

/**
 * §3.6.4 ownership. The ACR source-label step (H-3, `shipRegistryClient`) is NOT implemented — GitHub-only signals:
 * a merged app whose metadata `image_name` is not `…/selfserve/<app>` is bring-your-own-image ⇒ `unowned_existing`;
 * everything else is `unknown` (advisory only; `prepare` and `publish` enforce authoritatively).
 */
function checkOwnership(app, appInfo) {
  if (appInfo.appState === 'merged' && appInfo.imageName && !appInfo.imageName.endsWith(`/${config.ship.acrRepoPrefix}/${app}`)) {
    return { ownership: 'unowned_existing', ownershipSource: 'github' };
  }
  return { ownership: 'unknown', ownershipSource: 'none' };
}

function getAppInfo(env, app, repoFull) {
  return appStateCache.get(`appstate:${env}:${app}:${repoFull}`, () => aksService.getAppState(env, app), MIN);
}

async function getAppAdvisory(user, env, app, repoFull) {
  const repo = parseRepo(repoFull);
  await requireReadAccess(user, repo);
  let info;
  try { info = await getAppInfo(env, app, repo.fullName); } catch (error) { throw mapGithubError(error); }
  const { ownership, ownershipSource } = checkOwnership(app, info);
  return {
    appState: info.appState, ...(info.prNumber ? { prNumber: info.prNumber } : {}), ownership, ownershipSource,
    ...(info.effectiveSettings ? { effectiveSettings: info.effectiveSettings } : {}),
  };
}

// ------------------------------------------------------------------------------------------------
// POST /api/ship (§4.1 #5, DD-14, DD-11)
// ------------------------------------------------------------------------------------------------

function hourlyRetryAfter(times) {
  return Math.max(1, Math.ceil((times[0] + HOUR - now()) / 1000));
}

function enforceStartCaps(oid) {
  const cfg = config.ship;
  const cutoff = now() - HOUR;
  while (startTimes.length && startTimes[0] < cutoff) startTimes.shift();
  const mine = (userStartTimes.get(oid) || []).filter((x) => x >= cutoff);
  userStartTimes.set(oid, mine);
  const { total, mine: myActive } = status.activeCounts(oid);
  const snap = githubService.getRateLimitSnapshot && githubService.getRateLimitSnapshot();
  const breach =
    myActive >= cfg.maxActivePerUser ? ['user_active', 60]
      : mine.length >= cfg.maxStartsPerUserPerHour ? ['user_hourly', hourlyRetryAfter(mine)]
        : total >= cfg.maxActiveGlobal ? ['global_active', 60]
          : startTimes.length >= cfg.maxStartsPerHour ? ['global_hourly', hourlyRetryAfter(startTimes)]
            : snap && snap.remaining < cfg.rateLimitGuardRemaining ? ['github', Math.max(1, Math.ceil((snap.reset * 1000 - now()) / 1000)) || 60]
              : null;
  if (breach) {
    logMetric('ship_rate_limited', { limit: breach[0], actor_oid: oid, level: 'warn' });
    throw new ShipError(429, 'PLATFORM_RATE_LIMITED', 'Too many ships right now. Try again shortly.', { details: { limit: breach[0] }, retryAfterSec: breach[1] });
  }
}

/** Reserve a start synchronously (before any await) so concurrent POSTs cannot all pass the caps; undone on failure. */
function reserveStart(oid, correlationId) {
  const stamp = now();
  startTimes.push(stamp);
  userStartTimes.set(oid, [...(userStartTimes.get(oid) || []), stamp]);
  status.trackShip(correlationId, oid);
  return () => {
    const drop = (list) => { const i = list.indexOf(stamp); if (i >= 0) list.splice(i, 1); };
    drop(startTimes);
    drop(userStartTimes.get(oid) || []);
    status.untrackShip(correlationId);
  };
}

/**
 * @param {{ id: string, email?: string }} user  from requireAuth (never from the body)
 * @param {{ repo, branch, app, env, namespace, teamLabel, port, healthPath, bump }} input  validated + whitelist-picked
 * @param {{ provided?: { port?: boolean, healthPath?: boolean }, requestId?: string }} [opts]
 */
async function start(user, input, opts = {}) {
  const cfg = config.ship;
  const oid = String(user.id || '').toLowerCase();
  if (!GUID.test(oid)) throw new ShipError(403, 'FORBIDDEN', 'Your identity cannot be used to start a ship.');

  // DD-11: never dispatch the untrusted-build workflow on the default ref unless explicitly waived
  if (cfg.workflowRef === config.aks.fluxBranch && !cfg.allowDefaultRef) {
    throw new ShipError(503, 'SHIP_UNAVAILABLE', 'Ship from Repo is temporarily unavailable.');
  }

  // 10 s dedupe of identical POSTs; the entry is registered synchronously, so a double-click shares one start
  const dedupeKey = `${oid}|${JSON.stringify([input.repo, input.branch, input.app, input.env, input.namespace, input.teamLabel, input.port, input.healthPath, input.bump])}`;
  const prior = dedupe.get(dedupeKey);
  if (prior && now() - prior.at < 10 * 1000) return prior.promise;

  enforceStartCaps(oid);
  const correlationId = mintShipId();
  const release = reserveStart(oid, correlationId);
  const promise = doStart(user, oid, input, opts, correlationId).catch((error) => {
    release();
    if (dedupe.get(dedupeKey) && dedupe.get(dedupeKey).promise === promise) dedupe.delete(dedupeKey);
    throw error;
  });
  dedupe.set(dedupeKey, { at: now(), promise });
  return promise;
}

async function doStart(user, oid, input, { provided = {}, requestId } = {}, correlationId) {
  const cfg = config.ship;
  const repo = parseRepo(input.repo);
  const link = await requireReadAccess(user, repo); // identity `none` fails closed here — before any GitHub call
  let meta;
  let branchOk;
  try {
    meta = await githubService.codeAppGetRepo(repo.org, repo.name);
    if (!meta || meta.fork) throw notAccessible();
    branchOk = await githubService.codeAppBranchExists(repo.org, repo.name, input.branch);
  } catch (error) {
    throw mapGithubError(error);
  }
  if (!branchOk) throw new ShipError(400, 'VALIDATION_FAILED', 'Request validation failed', { details: [{ field: 'branch', message: 'branch not found' }] });

  let appInfo;
  try { appInfo = await aksService.getAppState(input.env, input.app); } catch (error) { throw mapGithubError(error); }
  const { ownership } = checkOwnership(input.app, appInfo);
  if (ownership === 'unowned_existing') throw new ShipError(403, 'APP_OWNED_BY_OTHER', 'That app name is already in use by another application.');

  // AC-012-3: after merge only the effective port/health path are used; changed values are ignored and reported
  const merged = appInfo.appState === 'merged' && appInfo.effectiveSettings;
  const effective = merged ? appInfo.effectiveSettings : { port: input.port, healthPath: input.healthPath };
  const settingsIgnored = [];
  if (merged) {
    if (provided.port && Number(input.port) !== effective.port) settingsIgnored.push('port');
    if (provided.healthPath && input.healthPath !== effective.healthPath) settingsIgnored.push('healthPath');
  }

  const inputs = {
    correlation_id: correlationId, repo: repo.fullName, branch: input.branch, app: input.app, namespace: input.namespace,
    team_label: input.teamLabel, env: input.env, port: String(effective.port), health_path: effective.healthPath, bump: input.bump,
    triggered_by: sanitizeActor(user.email) || 'unknown', triggered_by_oid: oid, requester_github_login: link.login, mode: 'full',
  };
  try {
    await githubService.triggerWorkflow(cfg.workflowRepo, cfg.workflowFile, cfg.workflowRef, inputs);
  } catch (error) {
    logger.error(`[${correlationId}] ship dispatch failed: ${error.message}`, { requestId });
    throw mapGithubError(error);
  }

  logMetric('ship_started', { correlationId, requestId, env: input.env, app: input.app, repo: repo.fullName });
  logger.info(`[${correlationId}] ship started by ${oid} for ${repo.fullName}@${input.branch} -> ${input.env}/${input.app}`, { requestId });
  return {
    correlationId, app: input.app, env: input.env, repo: repo.fullName, branch: input.branch,
    startedAt: new Date(shipIdTimestamp(correlationId)).toISOString(), appState: appInfo.appState,
    effectiveSettings: effective, settingsIgnored, rollout: appInfo.appState === 'merged' ? 'flux_auto_roll' : 'preview_pr',
  };
}

// ------------------------------------------------------------------------------------------------
// POST /:id/cancel, /:id/retry-config-pr (§3.6.3 mutate: starter or platform only)
// ------------------------------------------------------------------------------------------------

async function mutationContext(cid, user, notApplicableCode, action, requestId) {
  const ctx = await status.getShipContext(cid, user, requestId);
  if (ctx.meta.placeholder) throw new ShipError(409, notApplicableCode, 'This ship has not started yet. Try again in a moment.');
  const role = await status.authorize(user, ctx.meta, { mutate: true });
  if (!role) throw status.denyForbidden(cid, user, action, requestId);
  return ctx;
}

async function cancel(user, cid, { requestId } = {}) {
  const { meta } = await mutationContext(cid, user, 'CANCEL_NOT_ALLOWED', 'cancel', requestId);
  if (meta.N.terminal) throw new ShipError(409, 'CANCEL_NOT_ALLOWED', 'This ship has already finished.');
  if (meta.publishStarted) throw new ShipError(409, 'CANCEL_NOT_ALLOWED', "You can't cancel once publishing has started.");
  try {
    await githubService.cancelWorkflowRun(config.ship.workflowRepo, meta.N.run.id, cid);
  } catch (error) {
    if (error.status === 409 || error.status === 422) throw new ShipError(409, 'CANCEL_NOT_ALLOWED', 'This ship can no longer be cancelled.');
    throw mapGithubError(error);
  }
  status.flagCancelRequested(cid); // distinguishes CANCELLED from SUPERSEDED (DD-8)
  status.invalidate(cid);
  logger.info(`[${cid}] ship cancel requested by ${user.id}`, { requestId });
  return { state: 'cancelling' };
}

async function retryConfigPr(user, cid, opts = {}) {
  // One retry per ship per minute: the new run is not visible to the resolver for a few seconds, so a concurrent or
  // immediate second request would otherwise still see a terminal newest run and dispatch again.
  const last = recentRetries.get(cid);
  if (last && now() - last < MIN) throw new ShipError(409, 'RETRY_NOT_APPLICABLE', 'A retry for this ship is already in progress.');
  recentRetries.set(cid, now());
  try {
    return await doRetryConfigPr(user, cid, opts);
  } catch (error) {
    recentRetries.delete(cid); // nothing was dispatched
    throw error;
  }
}

async function doRetryConfigPr(user, cid, { requestId } = {}) {
  const cfg = config.ship;
  const { status: composed, meta } = await mutationContext(cid, user, 'RETRY_NOT_APPLICABLE', 'retry', requestId);
  const na = (msg) => new ShipError(409, 'RETRY_NOT_APPLICABLE', msg);
  if (!meta.N.terminal) throw na('A newer run of this ship is still active.');
  if (!meta.I) throw na('No published image exists for this ship.');
  if (!composed.failure || composed.failure.code !== 'CONFIG_PR_FAILED') throw na('Only a failed pull-request step can be retried.');
  if (now() > meta.startedAtMs + cfg.retryWindowHours * HOUR) throw na('The retry window for this ship has elapsed. Ship again.');
  if (!meta.settings) throw na('The settings for this ship are not available.');
  const link = await identity.getProvider().getLink(user);
  if (link.state !== 'linked') throw notAccessible('IDENTITY_NOT_LINKED');

  const s = meta.settings;
  const published = meta.I.annOf('publish');
  const inputs = {
    correlation_id: cid, repo: meta.repo, branch: s.inputs.branch, app: meta.app, namespace: s.inputs.namespace,
    team_label: s.inputs.teamLabel, env: meta.env, port: String(s.effective.port), health_path: s.effective.healthPath, bump: s.inputs.bump,
    triggered_by: meta.by, triggered_by_oid: meta.oid, requester_github_login: link.login, mode: 'config_only',
    config_image_tag: published.version, origin_run_id: String(meta.I.run.id), retry_by: sanitizeActor(user.email) || 'unknown',
  };
  try {
    await githubService.triggerWorkflow(cfg.workflowRepo, cfg.workflowFile, cfg.workflowRef, inputs);
  } catch (error) {
    throw mapGithubError(error);
  }
  status.trackShip(cid, meta.oid);
  status.invalidate(cid);
  logger.info(`[${cid}] config-only retry dispatched by ${user.id}`, { requestId });
  return { correlationId: cid, attempt: meta.runCount + 1 };
}

function _resetForTests() {
  for (const c of [reposCache, branchesCache, appStateCache]) c.clear();
  dedupe.clear();
  recentRetries.clear();
  startTimes.length = 0;
  userStartTimes.clear();
}

module.exports = { getConfig, listRepos, listBranches, getAppAdvisory, checkOwnership, start, cancel, retryConfigPr, _resetForTests };
