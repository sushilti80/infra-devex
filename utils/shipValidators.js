/**
 * Ship-from-repo request validation (spec §4.4, NFR-004). Pure checks + express-validator chains.
 * Allowlists/flags are read from config at call time. Every value that reaches the aya-flux
 * workflow is whitelisted here (it is string-interpolated into shell/Python there).
 */
const { body, param, query, validationResult } = require('express-validator');
const config = require('../config');
const { isShipId } = require('./shipId');

const REPO_REGEX = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const DNS_LABEL_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const BRANCH_REGEX = /^[A-Za-z0-9._/-]+$/;
const HEALTH_PATH_REGEX = /^\/[A-Za-z0-9._~/-]{0,254}$/;
const SEARCH_REGEX = /^[A-Za-z0-9._/-]{0,100}$/;
const STAGES = ['prepare', 'build', 'scan', 'publish', 'config_pr'];
const BUMPS = ['patch', 'minor', 'major'];

const DEFAULTS = Object.freeze({ port: 8080, healthPath: '/healthz', bump: 'patch', teamLabel: 'software-engineering' });
const PORT_MIN = 1024;
const PORT_MAX = 65535;

const BUILTIN_RESERVED = ['kube-*', 'flux-*', 'default', 'cert-manager', 'ingress-nginx'];

/** Display/audit-only actor string: lower-case, chars outside [a-z0-9._%+@-] → `_`. NOT an authorization key. */
function sanitizeActor(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9._%+@-]/g, '_').slice(0, 254);
}

function isReservedNamespace(ns) {
  return [...BUILTIN_RESERVED, ...(config.ship.reservedNamespaces || [])].some((entry) => {
    const e = entry.toLowerCase();
    return e.endsWith('*') ? ns.startsWith(e.slice(0, -1)) : ns === e;
  });
}

/** @returns {{ ok: true, org: string, name: string, fullName: string } | { ok: false, message: string }} */
function parseRepo(value) {
  if (typeof value !== 'string' || !REPO_REGEX.test(value)) return { ok: false, message: 'repo must be "org/name"' };
  const [org, name] = value.split('/');
  if (name === '.' || name === '..' || name.endsWith('.git')) return { ok: false, message: 'repo name is not allowed' };
  const canonicalOrg = (config.ship.allowedOrgs || []).find((o) => o.toLowerCase() === org.toLowerCase());
  if (!canonicalOrg) return { ok: false, message: 'repo organisation is not allowed' };
  return { ok: true, org: canonicalOrg, name, fullName: `${canonicalOrg}/${name}` };
}

/** git-ref rules; the value is later used only via env: and quoted as refs/heads/$BRANCH. */
function branchError(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) return 'branch must be 1-200 characters';
  if (!BRANCH_REGEX.test(value)) return 'branch contains characters that are not allowed';
  if (value.includes('..') || value.includes('//') || value.includes('@{')) return 'branch is not a valid git ref';
  if (/^[-/]/.test(value) || /[/.]$/.test(value) || value.endsWith('.lock')) return 'branch is not a valid git ref';
  return null;
}

function dnsLabelError(value, what) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 63 || !DNS_LABEL_REGEX.test(value)) {
    return `${what} must be a DNS-1123 label (lower-case letters, digits, "-"; max 63)`;
  }
  return null;
}

function portError(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= PORT_MIN && n <= PORT_MAX ? null : `port must be an integer ${PORT_MIN}-${PORT_MAX}`;
}

const fail = (msg) => { throw new Error(msg); };
const check = (fn) => (value) => { const m = fn(value); if (m) fail(m); return true; };

const startShipValidators = [
  body('repo').custom((v) => { const r = parseRepo(v); if (!r.ok) fail(r.message); return true; }),
  body('branch').custom(check(branchError)),
  body('app').custom(check((v) => dnsLabelError(v, 'app'))),
  body('env').custom((v) => {
    if (typeof v !== 'string' || !(config.ship.supportedShipEnvironments || []).includes(v)) fail('env is not enabled for Ship from Repo');
    return true;
  }),
  body('namespace').optional().custom((v) => {
    const m = dnsLabelError(v, 'namespace');
    if (m) fail(m);
    if (isReservedNamespace(v)) fail('namespace is reserved');
    return true;
  }),
  body('teamLabel').optional().custom(check((v) => dnsLabelError(v, 'teamLabel'))),
  body('port').optional().custom(check(portError)),
  body('healthPath').optional().custom(check((v) => (typeof v === 'string' && HEALTH_PATH_REGEX.test(v) ? null : 'healthPath must start with "/" and use only [A-Za-z0-9._~/-]'))),
  body('bump').optional().custom(check((v) => (BUMPS.includes(v) ? null : 'bump must be patch, minor or major'))),
  // A reserved default can only come from an app name (namespace defaults to app).
  body('app').custom((v, { req }) => {
    if (typeof v === 'string' && req.body?.namespace === undefined && isReservedNamespace(v)) fail('app would default to a reserved namespace');
    return true;
  }),
];

const shipIdParam = [param('correlationId').custom((v) => (isShipId(v) ? true : fail('correlationId must be a UUIDv7')))];

const logsQuery = [
  query('stage').custom((v) => (STAGES.includes(v) ? true : fail(`stage must be one of ${STAGES.join('|')}`))),
  query('offset').optional().custom((v) => (/^\d{1,12}$/.test(String(v)) ? true : fail('offset must be an integer >= 0'))),
  query('download').optional().custom((v) => (['0', '1'].includes(String(v)) ? true : fail('download must be 0 or 1'))),
];

const reposQuery = [
  query('q').optional().custom((v) => (typeof v === 'string' && SEARCH_REGEX.test(v) ? true : fail('q must be <=100 chars of [A-Za-z0-9._/-]'))),
  query('limit').optional().custom((v) => (/^\d{1,3}$/.test(String(v)) && Number(v) >= 1 && Number(v) <= 500 ? true : fail('limit must be 1-500'))),
];

const branchesParams = [
  param('org').custom((org, { req }) => { const r = parseRepo(`${org}/${req.params.repo}`); if (!r.ok) fail(r.message); return true; }),
  query('q').optional().custom((v) => (typeof v === 'string' && SEARCH_REGEX.test(v) ? true : fail('q must be <=100 chars of [A-Za-z0-9._/-]'))),
  query('page').optional().custom((v) => (/^\d{1,3}$/.test(String(v)) && Number(v) >= 1 ? true : fail('page must be an integer >= 1'))),
];

const appStateParams = [
  param('env').custom((v) => ((config.ship.supportedShipEnvironments || []).includes(v) ? true : fail('env is not enabled for Ship from Repo'))),
  param('app').custom(check((v) => dnsLabelError(v, 'app'))),
  query('repo').custom((v) => { const r = parseRepo(v); if (!r.ok) fail(r.message); return true; }),
];

/** Whitelist pick: only these keys are ever read from the POST body (spec §4.1). */
function pickStartBody(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const repo = parseRepo(b.repo);
  const app = b.app;
  return {
    repo: repo.ok ? repo.fullName : b.repo,
    branch: b.branch,
    app,
    env: b.env,
    namespace: b.namespace ?? app,
    teamLabel: b.teamLabel ?? DEFAULTS.teamLabel,
    port: b.port === undefined ? DEFAULTS.port : Number(b.port),
    healthPath: b.healthPath ?? DEFAULTS.healthPath,
    bump: b.bump ?? DEFAULTS.bump,
  };
}

/** express middleware: 400 `VALIDATION_FAILED` envelope with field errors; no side effects happen before it. */
function handleValidation(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const details = result.array().map((e) => ({ field: e.path, message: e.msg }));
  return res.status(400).json({
    success: false,
    error: { code: 'VALIDATION_FAILED', message: 'Request validation failed', details },
    correlationId: req.correlationId,
  });
}

module.exports = {
  DEFAULTS, PORT_MIN, PORT_MAX, STAGES, BUMPS,
  sanitizeActor, isReservedNamespace, parseRepo, branchError, dnsLabelError, portError,
  startShipValidators, shipIdParam, logsQuery, reposQuery, branchesParams, appStateParams,
  pickStartBody, handleValidation,
};
