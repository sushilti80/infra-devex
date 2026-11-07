const express = require('express');
const router = express.Router();
const { check, body, oneOf, validationResult } = require('express-validator');
const { escape: escapeHtml } = require('validator');
const githubService = require('../services/githubService');
const infrastructureService = require('../services/infrastructureService');
const aksService = require('../services/aksService');
const databaseService = require('../services/databaseService');
const hclParser = require('../services/hclParser');
const secretsService = require('../services/secretsService');
const logger = require('../utils/logger');
const verifyWebhook = require('../middleware/verifyWebhook');
const config = require('../config');
const { sanitizeActor } = require('../utils/shipValidators');
const { isPlatformMember } = require('../utils/platformTeam');
const { parseRunName } = require('../services/shipStatusService');

// Import authentication middleware (optional - enable when Entra ID is configured)
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');

// NOTE: To enable authentication, uncomment the middleware imports above and apply them to routes:
// - Public routes (no auth required): /templates, /modules, /roles, /health
// - Protected routes (requireAuth): /custom, /template, /delete, /promote, /aks-deploy
// - Admin routes (requireRole('admin')): sensitive operations
//
// Example:
// router.post('/custom', requireAuth, [...validators], async (req, res) => {
//   // req.user will contain authenticated user info (email, name, roles)
//   logger.info(`[${req.correlationId}] User ${req.user.email} creating infrastructure`);
//   ...
// });

// Ship from Repo (docs/architecture/ship-from-repo-spec.md §4.1) — router applies requireAuth to every endpoint
router.use('/ship', require('./ship'));

// Get all available templates
router.get('/templates', async (req, res) => {
  try {
    logger.info(`[${req.correlationId}] Fetching templates`);
    const templates = await infrastructureService.getTemplates();
    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error fetching templates: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch templates',
      correlationId: req.correlationId
    });
  }
});

// Get all installed applications from Metadata folder in GitHub repository
// NFR-002: p95 latency target ≤3000ms — latency_ms emitted via app_list_fetched event.
router.get('/installed-apps', requireAuth, async (req, res) => {
  const startMs = Date.now();
  try {
    logger.info(`[${req.correlationId}] User ${req.user.email} fetching installed applications from GitHub metadata`);

    // Get applications from the infrastructureService which now fetches from GitHub 'docs/metadata' folder
    const applications = await infrastructureService.getInstalledApps();

    // Transform the data to match the expected format by the frontend
    const formattedApps = applications.map(app => {
      // Handle both string and array formats for modules
      let modulesList = [];
      if (app.modules) {
        if (typeof app.modules === 'string') {
          modulesList = app.modules.split(', ');
        } else if (Array.isArray(app.modules)) {
          modulesList = app.modules;
        }
      }

      return {
        name: app.projectName,
        environment: app.environment,
        owner: app.owner,
        deployedAt: app.createdAt,
        lifecycle: app.lifecycle || 'experimental',
        status: app.status || 'active',
        modules: modulesList,
        age: app.age || 'Unknown', // Include the age field for display in the UI
        description: app.description || 'No description available' // Add the description field
      };
    });

    // Sort applications by name
    formattedApps.sort((a, b) => a.name.localeCompare(b.name));

    // NFR-002 / NFR-006: Structured event for the app-list selector population path.
    // app_count + latency_ms feed the Datadog workflow-reliability dashboard.
    logger.logMetric('app_list_fetched', {
      correlationId: req.correlationId,
      app_count: formattedApps.length,
      latency_ms: Date.now() - startMs,
      source: 'installed-apps-route'
    });

    res.json({
      success: true,
      count: formattedApps.length,
      data: formattedApps,
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error fetching installed applications: ${error.message}`, {
      error: error.stack,
      correlationId: req.correlationId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch installed applications',
      message: error.message,
      correlationId: req.correlationId
    });
  }
});

// Get all available modules
router.get('/modules', async (req, res) => {
  try {
    const modules = await infrastructureService.getModules();
    res.json({
      success: true,
      data: modules
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error fetching modules: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch modules',
      correlationId: req.correlationId
    });
  }
});

// Get RBAC roles
router.get('/roles', async (req, res) => {
  try {
    const roles = await infrastructureService.getRoles();
    res.json({
      success: true,
      data: roles
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error fetching roles: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch roles',
      correlationId: req.correlationId
    });
  }
});

// Get all available environments
router.get('/environments', async (req, res) => {
  try {
    logger.info(`[${req.correlationId}] Fetching environments`);
    const environments = await infrastructureService.getEnvironments();
    res.json({
      success: true,
      data: environments,
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error fetching environments: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch environments',
      correlationId: req.correlationId
    });
  }
});

// FR-001: platform-filtered application list for the Secrets page. New endpoint — does not
// modify /api/installed-apps, which has other consumers (AKS pages, installed-apps page).
router.get('/secrets/apps', requireAuth, [
  check('target').isIn(['live', 'sand']).withMessage('target must be live or sand')
], async (req, res) => {
  const startMs = Date.now();
  const { target } = req.query;

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, error: 'target must be live or sand', correlationId: req.correlationId });
  }

  try {
    // secrets-environment-bundles §2.3/§3.2: load once per request and thread the same
    // bundleConfig into both discoverAppsForTarget() (per-entry bundleId) and getBundleCatalog()
    // (the catalog surfaced for the bundle-mode UI) — never a second independent load.
    const { config: bundleConfig } = secretsService.loadSecretBundles(req.correlationId);
    const apps = await secretsService.discoverAppsForTarget(target, req.correlationId, bundleConfig);
    const bundles = secretsService.getBundleCatalog(bundleConfig);
    logger.logMetric('secret_apps_discovered', {
      correlationId: req.correlationId,
      user: req.user?.email,
      target,
      app_count: apps.length,
      latency_ms: Date.now() - startMs
    });
    return res.json({ success: true, data: apps, bundles, correlationId: req.correlationId });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error discovering apps for target=${target}: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to discover applications for target', correlationId: req.correlationId });
  }
});

// Secret metadata and GitOps submission (synchronous; the returned PR is the terminal result).
// FR-006/NFR-OBS-001: secret_list_fetched is emitted on every code path (never includes a
// `value`/`secretValue` field — only names/metadata ever cross this boundary).
router.get('/secrets/:appName/:environment', requireAuth, [
  check('appName').matches(/^[a-zA-Z0-9_-]{1,64}$/).withMessage('Invalid app name'),
  check('environment').matches(/^[a-zA-Z0-9_-]{1,32}$/).withMessage('Invalid environment'),
  check('target').isIn(['live', 'sand']).withMessage('target must be live or sand'),
  check('vaultDir').optional().isLength({ min: 1, max: 512 }).withMessage('Invalid vault directory'),
  check('qualifier').optional().matches(/^[a-zA-Z0-9_-]{1,64}$/).withMessage('Invalid qualifier')
], async (req, res) => {
  const startMs = Date.now();
  const { appName, environment } = req.params;
  const { target } = req.query;

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.logMetric('secret_list_fetched', {
      correlationId: req.correlationId,
      user: req.user?.email,
      target,
      appName,
      environment,
      outcome: 'error',
      error_code: 400,
      latency_ms: Date.now() - startMs
    });
    return res.status(400).json({ success: false, errors: errors.array(), correlationId: req.correlationId });
  }

  try {
    const { vaultDir, qualifier } = req.query;
    const data = await secretsService.getSecretsList(
      target,
      appName,
      environment,
      vaultDir,
      req.correlationId,
      qualifier
    );

    // FR-004 Round 4: if the vault paths have multiple sub-app qualifiers and the caller didn't
    // supply one, return 422 with the qualifier list so the UI can prompt for disambiguation.
    // An explicit vaultDir is an equally valid disambiguation (validated below via vaultMismatch),
    // so it also bypasses this gate — otherwise picking the exact vault from the UI can never work.
    if (data.qualifiers && data.qualifiers.length > 1 && !qualifier && !vaultDir) {
      logger.logMetric('secret_list_fetched', {
        correlationId: req.correlationId, user: req.user?.email, target, appName, environment,
        outcome: 'error', error_code: 422, reason: 'QUALIFIER_AMBIGUOUS', latency_ms: Date.now() - startMs
      });
      return res.status(422).json({
        success: false,
        error: 'Multiple sub-app qualifiers found; qualifier is required',
        qualifiers: data.qualifiers,
        vaults: data.vaults,
        correlationId: req.correlationId
      });
    }

    if (data.vaultMismatch) {
      logger.logMetric('secret_list_fetched', {
        correlationId: req.correlationId, user: req.user?.email, target, appName, environment,
        outcome: 'error', error_code: 422, latency_ms: Date.now() - startMs
      });
      return res.status(422).json({
        success: false,
        error: 'vaultDir does not match a discovered vault',
        vaults: data.vaults,
        correlationId: req.correlationId
      });
    }

    // A resolved, unambiguous vault with no secrets.enc.yaml yet is a legitimate empty state (no
    // one has added a secret to it through this flow yet) — only "no vault could be resolved at
    // all" is a real 404. Otherwise a brand-new vault could never be used to add a first secret.
    if (!data.found) {
      logger.logMetric('secret_list_fetched', {
        correlationId: req.correlationId, user: req.user?.email, target, appName, environment,
        outcome: 'error', error_code: 404, latency_ms: Date.now() - startMs
      });
      return res.status(404).json({
        success: false,
        error: 'No Key Vault secret file found for this app and environment',
        vaults: data.vaults,
        qualifiers: data.qualifiers || [],
        correlationId: req.correlationId
      });
    }

    logger.logMetric('secret_list_fetched', {
      correlationId: req.correlationId,
      user: req.user?.email,
      target,
      appName,
      environment,
      outcome: 'success',
      secret_count: data.secrets.length,
      latency_ms: Date.now() - startMs
    });
    return res.json({ success: true, data: data.secrets, vaults: data.vaults, qualifiers: data.qualifiers || [], correlationId: req.correlationId });
  } catch (error) {
    logger.logMetric('secret_list_fetched', {
      correlationId: req.correlationId, user: req.user?.email, target, appName, environment,
      outcome: 'error', error_code: 500, latency_ms: Date.now() - startMs
    });
    logger.error(`[${req.correlationId}] Error listing secrets: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to list secrets', correlationId: req.correlationId });
  }
});

// FR-006/NFR-OBS-001: secret_create_submitted is emitted on every code path. `secretValue` is
// never included in any log line or metric payload (enforced by grep in CI).
// FR-003: accepts either a bulk `secrets[]` array (1-20 entries) or the legacy singular
// `secretName`/`secretValue` shape for backward compatibility.
// FR-004/FR-006 (secrets-environment-scope): accepts either the legacy singular `environment`
// field or a new `environments[]` array (1-10 entries) for fan-out submission — exactly one of
// the two must be present (enforced below; express-validator has no built-in XOR check).
router.post('/secrets', requireAuth, [
  check('target').isIn(['live', 'sand']).withMessage('target must be live or sand'),
  check('appName').matches(/^[a-zA-Z0-9_-]{1,64}$/).withMessage('Invalid app name'),
  check('environment').optional().matches(/^[a-zA-Z0-9_-]{1,32}$/).withMessage('Invalid environment'),
  check('environments').optional().isArray({ min: 1, max: 10 }).withMessage('environments must contain 1-10 entries'),
  check('environments.*').matches(/^[a-zA-Z0-9_-]{1,32}$/).withMessage('Invalid environment'),
  check('vaultDir').optional().isLength({ min: 1, max: 512 }).withMessage('Invalid vault directory'),
  check('qualifier').optional().matches(/^[a-zA-Z0-9_-]{1,64}$/).withMessage('Invalid qualifier'),
  check('jiraTicket').notEmpty().matches(/^[A-Za-z]+-\d+$/).withMessage('Jira ticket is required, e.g. JIRA-1234'),
  check('confirmedProductionWrite').optional().isBoolean().withMessage('confirmedProductionWrite must be a boolean'),
  oneOf([
    [
      check('secrets').isArray({ min: 1, max: 20 }).withMessage('secrets must contain 1-20 entries'),
      check('secrets.*.secretName').matches(/^[a-zA-Z0-9-]{1,127}$/).withMessage('Invalid secret name'),
      check('secrets.*.secretValue').isString().notEmpty().withMessage('Secret value is required')
    ],
    [
      check('secretName').matches(/^[a-zA-Z0-9-]{1,127}$/).withMessage('Invalid secret name'),
      check('secretValue').isString().notEmpty().withMessage('Secret value is required')
    ],
    [
      // secrets-environment-bundles §3.3: bundle-mode shape — bundleId + environmentSecrets[]
      // (1-10 entries), each with its own environment/secrets[] (1-20 entries per environment).
      // Bundle *membership* itself is validated server-side in handleBundleSecretsSubmission()/
      // secretsService.validateBundleMembership() (NFR-SEC-002) — express-validator here only
      // checks request shape.
      check('bundleId').matches(/^[a-zA-Z0-9-]{1,64}$/).withMessage('Invalid bundle id'),
      check('environmentSecrets').isArray({ min: 1, max: 10 }).withMessage('environmentSecrets must contain 1-10 entries'),
      check('environmentSecrets.*.environment').matches(/^[a-zA-Z0-9_-]{1,32}$/).withMessage('Invalid environment'),
      check('environmentSecrets.*.vaultDir').optional().isLength({ min: 1, max: 512 }).withMessage('Invalid vault directory'),
      check('environmentSecrets.*.qualifier').optional().matches(/^[a-zA-Z0-9_-]{1,64}$/).withMessage('Invalid qualifier'),
      check('environmentSecrets.*.secrets').isArray({ min: 1, max: 20 }).withMessage('secrets must contain 1-20 entries'),
      check('environmentSecrets.*.secrets.*.secretName').matches(/^[a-zA-Z0-9-]{1,127}$/).withMessage('Invalid secret name'),
      check('environmentSecrets.*.secrets.*.secretValue').isString().notEmpty().withMessage('Secret value is required')
    ]
  ], { message: 'Request must include either a secrets[] array (1-20 entries), a legacy secretName/secretValue pair, or a bundleId with environmentSecrets[] (1-10 entries)' })
], async (req, res) => {
  const startMs = Date.now();
  const { target, appName, environment, jiraTicket } = req.body;

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // NFR-SEC-001: express-validator's default error objects include the submitted `value` —
    // never let a submitted secretValue leak into an HTTP error response.
    const redactSecretValues = error => {
      if (Array.isArray(error)) return error.map(redactSecretValues);

      const sanitizedError = { ...error };
      if (sanitizedError.path && /secretValue/.test(sanitizedError.path)) {
        sanitizedError.value = '[REDACTED]';
      }
      if (sanitizedError.nestedErrors) {
        sanitizedError.nestedErrors = redactSecretValues(sanitizedError.nestedErrors);
      }
      return sanitizedError;
    };
    const sanitized = errors.array().map(redactSecretValues);
    logger.logMetric('secret_create_submitted', {
      correlationId: req.correlationId,
      user: req.user?.email,
      target,
      appName,
      environment,
      environments: req.body.environments,
      outcome: 'error',
      error_code: 400,
      latency_ms: Date.now() - startMs
    });
    return res.status(400).json({ success: false, errors: sanitized, correlationId: req.correlationId });
  }

  // FR-004(a)/FR-006(c) + secrets-environment-bundles §3.3: exactly one of environment (legacy
  // singular), environments (fan-out array), or bundleId+environmentSecrets (bundle mode).
  const hasSingular = environment !== undefined && environment !== null && environment !== '';
  const hasArray = Array.isArray(req.body.environments);
  const hasBundle = req.body.bundleId !== undefined && req.body.bundleId !== null && req.body.bundleId !== '' &&
    Array.isArray(req.body.environmentSecrets);
  const selectedModeCount = [hasSingular, hasArray, hasBundle].filter(Boolean).length;
  if (selectedModeCount !== 1) {
    logger.logMetric('secret_create_submitted', {
      correlationId: req.correlationId, user: req.user?.email, target, appName,
      outcome: 'error', error_code: 400, reason: 'REQUEST_SHAPE_CONFLICT', latency_ms: Date.now() - startMs
    });
    return res.status(400).json({
      success: false,
      error: 'Provide exactly one of: environment, environments, or bundleId with environmentSecrets',
      correlationId: req.correlationId
    });
  }

  if (hasBundle) {
    return handleBundleSecretsSubmission(req, res, startMs);
  }

  const environments = hasArray ? req.body.environments : [environment];

  // FR-004(b): duplicate environment entries rejected, case-insensitive (mirrors the secret-name
  // duplicate check below).
  const seenEnvironments = new Set();
  const duplicateEnvironments = [];
  for (const env of environments) {
    const key = String(env).toLowerCase();
    if (seenEnvironments.has(key)) duplicateEnvironments.push(env);
    else seenEnvironments.add(key);
  }
  if (duplicateEnvironments.length > 0) {
    logger.logMetric('secret_create_submitted', {
      correlationId: req.correlationId, user: req.user?.email, target, appName, environments,
      outcome: 'error', error_code: 400, reason: 'DUPLICATE_ENVIRONMENT', latency_ms: Date.now() - startMs
    });
    return res.status(400).json({
      success: false,
      error: `Duplicate environment(s): ${duplicateEnvironments.join(', ')}`,
      correlationId: req.correlationId
    });
  }

  const secrets = Array.isArray(req.body.secrets)
    ? req.body.secrets
    : [{ secretName: req.body.secretName, secretValue: req.body.secretValue }];

  // Case-insensitive duplicate detection (matches the UI's toLowerCase check and the downstream
  // bulkBranchHash / Key Vault secret-name semantics, which are all case-insensitive). Comparing
  // raw strings would let ['Api-Token','api-token'] slip through and collide at GitOps time.
  const seen = new Set();
  const duplicates = [];
  for (const s of secrets) {
    const key = String(s.secretName).toLowerCase();
    if (seen.has(key)) {
      duplicates.push(s.secretName);
    } else {
      seen.add(key);
    }
  }
  if (duplicates.length > 0) {
    logger.logMetric('secret_create_submitted', {
      correlationId: req.correlationId,
      user: req.user?.email,
      target,
      appName,
      environments,
      outcome: 'error',
      error_code: 400,
      reason: 'DUPLICATE_SECRET_NAME',
      latency_ms: Date.now() - startMs
    });
    return res.status(400).json({
      success: false,
      error: `Duplicate secret name(s): ${duplicates.join(', ')}`,
      correlationId: req.correlationId
    });
  }

  const statusByCode = {
    FOUND_FALSE: 422,
    VAULT_AMBIGUOUS: 422,
    VAULT_INVALID: 422,
    PR_EXISTS: 409,
    CONFLICT: 503,
    ENCRYPTION_FAILED: 400,
    SOPS_NOT_CONFIGURED: 503,
    QUALIFIER_AMBIGUOUS: 422,
    QUALIFIER_MISMATCH: 422
  };

  try {
    const results = await secretsService.submitSecretsFanOut({
      target,
      appName,
      environments,
      vaultDir: req.body.vaultDir,
      qualifier: req.body.qualifier,
      jiraTicket,
      secrets,
      userEmail: req.user?.email || 'unknown',
      correlationId: req.correlationId
    });

    const successCount = results.filter(r => r.success).length;
    const allSucceeded = successCount === results.length;
    const partialFailure = successCount > 0 && !allSucceeded;
    const failures = results.filter(r => !r.success).map(r => ({
      environment: r.environment,
      error_code: Object.hasOwn(statusByCode, r.errorCode) ? r.errorCode : 'UNKNOWN'
    }));
    const failureCodes = new Set(results.filter(r => !r.success).map(r => r.errorCode));
    const uniformCode = failureCodes.size === 1 ? [...failureCodes][0] : null;
    const statusCode = allSucceeded ? 201 : partialFailure ? 207
      : uniformCode ? (statusByCode[uniformCode] || 500) : 500;

    // NFR-SEC-002: independently re-derive which requested environments are production-tier
    // server-side for the audit trail — never trust client input for the classification itself,
    // only its confirmedProductionWrite acknowledgement.
    const productionEnvironments = environments.filter(env => secretsService.classifyEnvironmentTier(env) === 'production');

    logger.logMetric('secret_create_submitted', {
      level: allSucceeded ? 'info' : partialFailure ? 'warn' : 'error',
      correlationId: req.correlationId,
      user: req.user?.email,
      target,
      appName,
      environments,
      jiraTicket,
      outcome: allSucceeded ? 'success' : (partialFailure ? 'partial' : 'error'),
      partialFailure,
      status_code: statusCode,
      failures,
      secretCount: secrets.length,
      ...(productionEnvironments.length > 0
        ? { confirmedProductionWrite: req.body.confirmedProductionWrite === true, productionEnvironments }
        : {}),
      latency_ms: Date.now() - startMs
    });

    const responseBody = {
      success: allSucceeded,
      correlationId: req.correlationId,
      secretCount: secrets.length,
      results
    };
    // FR-006(b): legacy top-level fields (prNumber/prUrl) remain present in addition to results[]
    // whenever the batch resolves to exactly one (successful) result — covers both the legacy
    // singular `environment` field and a new single-element `environments` array alike.
    if (results.length === 1 && results[0].success) {
      responseBody.prNumber = results[0].prNumber;
      responseBody.prUrl = results[0].prUrl;
    }

    if (allSucceeded) return res.status(201).json(responseBody);
    // FR-005(b): partial success -> HTTP 207, success:false; client reads results[] for detail.
    if (partialFailure) return res.status(207).json(responseBody);

    // All environments failed. Use the shared status code when every failure has the same
    // errorCode; mixed codes across environments fall back to 500 (results[] is authoritative
    // either way for the caller).
    return res.status(statusCode).json({ ...responseBody, error: results[0].error });
  } catch (error) {
    // Reachable only for a bug/unexpected throw outside the per-environment fan-out itself —
    // every per-environment GitOps error is already isolated into results[] via Promise.allSettled.
    logger.logMetric('secret_create_submitted', {
      level: 'error',
      correlationId: req.correlationId,
      user: req.user?.email,
      target,
      appName,
      environments,
      outcome: 'error',
      error_code: 500,
      status_code: 500,
      reason: 'UNKNOWN',
      latency_ms: Date.now() - startMs
    });
    return res.status(500).json({ success: false, error: 'Failed to submit secrets', correlationId: req.correlationId });
  }
});

// secrets-environment-bundles §3.3: bundle-mode branch of POST /api/secrets — atomic
// multi-environment submission for one of the 3 configured bundles (independent/developer/
// release). Bundle membership itself is re-derived server-side (NFR-SEC-002) inside
// secretsService.submitSecretBundleViaGitOps(); this handler only owns request-shape checks that
// don't require the loaded bundle config (duplicate environment names, the 20-distinct-secret-
// name union cap) and the errorCode -> HTTP status mapping for the bundle error taxonomy.
const BUNDLE_STATUS_BY_CODE = {
  BUNDLE_CONFIG_UNAVAILABLE: 503,
  BUNDLE_UNKNOWN: 400,
  ENVIRONMENT_NOT_IN_BUNDLE: 400,
  INCOMPLETE_BUNDLE: 400,
  NO_ELIGIBLE_ENVIRONMENTS: 422,
  PR_EXISTS: 409,
  ENCRYPTION_FAILED: 400,
  CONFLICT: 503,
  SOPS_NOT_CONFIGURED: 503,
  PR_CREATION_FAILED: 500
};

async function handleBundleSecretsSubmission(req, res, startMs) {
  const { target, appName, jiraTicket, bundleId, environmentSecrets } = req.body;

  // Case-insensitive duplicate environment-name rejection (mirrors the fan-out duplicate check
  // above, applied here across environmentSecrets[].environment instead of environments[]).
  const seenEnvironments = new Set();
  const duplicateEnvironments = [];
  for (const entry of environmentSecrets) {
    const key = String(entry.environment).toLowerCase();
    if (seenEnvironments.has(key)) duplicateEnvironments.push(entry.environment);
    else seenEnvironments.add(key);
  }
  if (duplicateEnvironments.length > 0) {
    logger.logMetric('secret_create_submitted', {
      correlationId: req.correlationId, user: req.user?.email, target, appName, bundleId,
      outcome: 'error', error_code: 400, reason: 'DUPLICATE_ENVIRONMENT', latency_ms: Date.now() - startMs
    });
    return res.status(400).json({
      success: false,
      error: `Duplicate environment(s): ${duplicateEnvironments.join(', ')}`,
      correlationId: req.correlationId
    });
  }

  // FR-005(e): 20-distinct-secret-name cap across the UNION of all environments in the bundle
  // submission (not per-environment) — case-insensitive, matching the single-environment cap.
  const distinctSecretNames = new Set();
  for (const entry of environmentSecrets) {
    for (const secret of entry.secrets) distinctSecretNames.add(String(secret.secretName).toLowerCase());
  }
  if (distinctSecretNames.size > 20) {
    logger.logMetric('secret_create_submitted', {
      correlationId: req.correlationId, user: req.user?.email, target, appName, bundleId,
      outcome: 'error', error_code: 400, reason: 'SECRET_NAME_CAP_EXCEEDED', latency_ms: Date.now() - startMs
    });
    return res.status(400).json({
      success: false,
      error: `Bundle submission exceeds the 20-distinct-secret-name limit (found ${distinctSecretNames.size})`,
      correlationId: req.correlationId
    });
  }

  try {
    const result = await secretsService.submitSecretBundleViaGitOps({
      target,
      appName,
      bundleId,
      environmentSecrets,
      jiraTicket,
      userEmail: req.user?.email || 'unknown',
      correlationId: req.correlationId
    });

    // PR_CREATION_FAILED resolves (does not throw) with success:false after a successful commit
    // (spec.md §2.4) — mapped through the same errorCode -> status table as thrown errors.
    if (result && result.success === false) {
      const status = BUNDLE_STATUS_BY_CODE[result.errorCode] || 500;
      logger.logMetric('secret_create_submitted', {
        level: 'error',
        correlationId: req.correlationId, user: req.user?.email, target, appName, bundleId,
        environments: environmentSecrets.map(entry => entry.environment),
        outcome: 'error', error_code: status, status_code: status,
        reason: Object.hasOwn(BUNDLE_STATUS_BY_CODE, result.errorCode) ? result.errorCode : 'UNKNOWN',
        latency_ms: Date.now() - startMs
      });
      return res.status(status).json({
        success: false,
        error: result.error,
        errorCode: result.errorCode,
        branchName: result.branchName,
        commitSha: result.commitSha,
        correlationId: req.correlationId
      });
    }

    logger.logMetric('secret_create_submitted', {
      correlationId: req.correlationId, user: req.user?.email, target, appName, bundleId,
      environments: result.includedEnvironments,
      outcome: 'success', status_code: 201, secretCount: result.secretCount, latency_ms: Date.now() - startMs
    });

    return res.status(201).json({
      success: true,
      bundleId,
      prNumber: result.prNumber,
      prUrl: result.prUrl,
      includedEnvironments: result.includedEnvironments,
      excludedEnvironments: result.excludedEnvironments,
      secretCount: result.secretCount,
      correlationId: req.correlationId
    });
  } catch (error) {
    const status = BUNDLE_STATUS_BY_CODE[error.code] || 500;
    logger.logMetric('secret_create_submitted', {
      level: 'error',
      correlationId: req.correlationId, user: req.user?.email, target, appName, bundleId,
      environments: environmentSecrets.map(entry => entry.environment),
      outcome: 'error', error_code: status, status_code: status,
      reason: Object.hasOwn(BUNDLE_STATUS_BY_CODE, error.code) ? error.code : 'UNKNOWN',
      latency_ms: Date.now() - startMs
    });
    return res.status(status).json({
      success: false,
      error: error.message,
      errorCode: error.code,
      ...(error.branchName ? { branchName: error.branchName } : {}),
      ...(error.commitSha ? { commitSha: error.commitSha } : {}),
      correlationId: req.correlationId
    });
  }
}

// vault-resolution-override: self-heal correction for vaults the live resolver cannot name.
// vaultDir must be allow-list validated against resolveKeyVaults() before any GitHub write, and
// the write commits directly to the service-catalog repo's default branch (no PR) via
// secretsService.setVaultNameOverride() — see docs/architecture/vault-resolution-override-spec.md §2.4.
router.post('/secrets/vault-name-override', requireAuth, [
  check('vaultDir').isLength({ min: 1, max: 512 }).withMessage('Invalid vault directory'),
  check('name').isLength({ min: 1, max: 256 }).withMessage('Invalid Key Vault name'),
  check('resourceGroup').optional().isLength({ min: 1, max: 256 }).withMessage('Invalid resource group'),
  check('appName').matches(/^[a-zA-Z0-9_-]{1,64}$/).withMessage('Invalid app name'),
  check('environment').matches(/^[a-zA-Z0-9_-]{1,32}$/).withMessage('Invalid environment'),
  check('target').isIn(['live', 'sand']).withMessage('target must be live or sand'),
  check('qualifier').optional().matches(/^[a-zA-Z0-9_-]{1,64}$/).withMessage('Invalid qualifier')
], async (req, res) => {
  const startMs = Date.now();
  const { vaultDir, name, resourceGroup, appName, environment, target, qualifier } = req.body;

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.logMetric('vault_name_override_submitted', {
      correlationId: req.correlationId, user: req.user?.email, target, appName, environment,
      outcome: 'error', error_code: 400, latency_ms: Date.now() - startMs
    });
    return res.status(400).json({ success: false, errors: errors.array(), correlationId: req.correlationId });
  }

  try {
    const { vaults } = await secretsService.resolveKeyVaults(appName, environment, target, req.correlationId, qualifier);
    const discovered = vaults.some(v => v.vaultDir === vaultDir);
    if (!discovered) {
      logger.warn(`[${req.correlationId}] vault-name-override rejected: vaultDir=${vaultDir} not discovered for appName=${appName} environment=${environment} target=${target}`);
      logger.logMetric('vault_name_override_submitted', {
        correlationId: req.correlationId, user: req.user?.email, target, appName, environment,
        outcome: 'error', error_code: 422, latency_ms: Date.now() - startMs
      });
      return res.status(422).json({ success: false, error: 'vaultDir does not match a discovered vault', correlationId: req.correlationId });
    }

    const data = await secretsService.setVaultNameOverride({
      vaultDir,
      name,
      resourceGroup,
      appName,
      environment,
      qualifier,
      verifiedBy: req.user?.email || 'unknown',
      correlationId: req.correlationId
    });

    logger.logMetric('vault_name_override_submitted', {
      correlationId: req.correlationId, user: req.user?.email, target, appName, environment,
      outcome: 'success', latency_ms: Date.now() - startMs
    });
    return res.json({ success: true, data, correlationId: req.correlationId });
  } catch (error) {
    if (error.code === 'CONFLICT') {
      logger.logMetric('vault_name_override_submitted', {
        correlationId: req.correlationId, user: req.user?.email, target, appName, environment,
        outcome: 'error', error_code: 409, latency_ms: Date.now() - startMs
      });
      return res.status(409).json({ success: false, error: error.message, correlationId: req.correlationId });
    }
    logger.error(`[${req.correlationId}] Error setting vault name override: ${error.message}`);
    logger.logMetric('vault_name_override_submitted', {
      correlationId: req.correlationId, user: req.user?.email, target, appName, environment,
      outcome: 'error', error_code: 500, latency_ms: Date.now() - startMs
    });
    return res.status(500).json({ success: false, error: 'Failed to persist vault name override', correlationId: req.correlationId });
  }
});

// Get all installed applications
router.get('/apps', requireAuth, async (req, res) => {
  try {
    logger.info(`[${req.correlationId}] User ${req.user.email} fetching apps`);
    // Get apps using the infrastructure service
    const apps = await infrastructureService.getInstalledApps();
    res.json(apps);
  } catch (error) {
    logger.error(`[${req.correlationId}] Error fetching installed apps: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch installed apps', correlationId: req.correlationId });
  }
});

// Save RBAC relationships and trigger workflow
router.post('/rbac-relationships', requireAuth, async (req, res) => {
  try {
    logger.info(`[${req.correlationId}] User ${req.user.email} saving RBAC relationships`);
    const rbacConfig = req.body;

    // Validate the request body
    if (!rbacConfig || !rbacConfig.resources || !rbacConfig.relationships || rbacConfig.relationships.length === 0) {
      logger.error(`[${req.correlationId}] Invalid RBAC relationships data`);
      return res.status(400).json({
        success: false,
        error: 'Invalid RBAC relationships data',
        correlationId: req.correlationId
      });
    }

    logger.info(`[${req.correlationId}] Saving RBAC relationships and triggering workflow`, {
      resourceCount: rbacConfig.resources.length,
      relationshipCount: rbacConfig.relationships.length,
      correlationId: req.correlationId
    });

    // In a real implementation, you would:
    // 1. Save the RBAC configuration to a database or file
    // 2. Trigger an infrastructure workflow to apply these relationships
    // 3. Return a workflow ID or job reference for tracking

    // For now, we'll just simulate a successful workflow trigger
    const workflowId = 'rbac-workflow-' + Date.now();

    // Here you would call your infrastructure service to apply the RBAC relationships
    // Example: await infrastructureService.applyRBACRelationships(rbacConfig, workflowId);

    // Return success response
    res.json({
      success: true,
      message: 'RBAC relationships saved and workflow triggered',
      workflowId: workflowId,
      correlationId: req.correlationId
    });

  } catch (error) {
    logger.error(`[${req.correlationId}] Error saving RBAC relationships: ${error.message}`, {
      error: error.stack,
      correlationId: req.correlationId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to save RBAC relationships',
      message: error.message,
      correlationId: req.correlationId
    });
  }
});

// Build custom infrastructure
router.post('/custom', requireAuth, [
  check('projectName').notEmpty().withMessage('Project abbreviation is required'),
  check('project_desc').notEmpty().withMessage('Service name is required'),
  check('environment').notEmpty().withMessage('Environment is required'),
  check('modules').isArray({ min: 1 }).withMessage('At least one module must be selected'),
  check('owner').notEmpty().withMessage('Owner is required'),
  check('crNumber').notEmpty().withMessage('JIRA# number is required'),
  check('projectAge').isInt({ min: 1 }).withMessage('Project age must be a positive integer'),
  check('correlationId').notEmpty().withMessage('Correlation ID is required')
], async (req, res) => {
  // Log the incoming request body for debugging
  logger.info(`[Custom API] Request received: ${JSON.stringify(req.body)}`);

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.error(`[Custom API] Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { projectName, project_desc, environment, modules, owner, crNumber, projectAge, correlationId, rbacPairs } = req.body;

    // Debug: Log user information
    logger.info(`[${req.correlationId}] User object:`, {
      hasUser: !!req.user,
      userEmail: req.user?.email,
      userName: req.user?.name,
      userId: req.user?.id
    });

    // Log the extracted values
    logger.info(`[${req.correlationId}] User ${req.user.email} creating custom infrastructure: ${projectName} in ${environment}`);
    logger.info(`[Custom API] Extracted values: projectName=${projectName}, project_desc=${project_desc}, environment=${environment}`);
    if (rbacPairs) {
      logger.info(`[Custom API] RBAC pairs: ${rbacPairs}`);
    }

    // Use client-provided correlation ID instead of server-generated one
    const workflowCorrelationId = correlationId || req.correlationId;

    // Get authenticated user email safely (fallback to owner if not available)
    const triggeredBy = req.user?.email || owner || 'unknown';

    const result = await infrastructureService.buildCustomInfrastructure(
      projectName,
      project_desc,
      environment,
      modules,
      owner,
      crNumber,
      projectAge,
      workflowCorrelationId,
      rbacPairs || '', // Pass RBAC pairs parameter
      triggeredBy // Pass authenticated user email for PR description
    );

    res.json({
      success: true,
      message: 'Custom infrastructure workflow triggered successfully',
      url: result.url,
      correlationId: workflowCorrelationId
    });
  } catch (error) {
    const workflowCorrelationId = req.body.correlationId || req.correlationId;
    logger.error(`[${workflowCorrelationId}] Error building custom infrastructure:`, {
      message: error.message,
      stack: error.stack,
      user: req.user ? { email: req.user.email, id: req.user.id } : 'No user',
      body: req.body
    });
    res.status(500).json({
      success: false,
      error: 'Failed to build custom infrastructure',
      message: error.message,
      correlationId: workflowCorrelationId
    });
  }
});

// Deploy from template
router.post('/template', requireAuth, [
  check('templateName').notEmpty().withMessage('Template name is required'),
  check('projectName').notEmpty().withMessage('Project abbreviation is required'),
  check('project_desc').if(value => value !== undefined && value !== null && value !== '').notEmpty().withMessage('If provided, service name cannot be empty'),
  check('environment').notEmpty().withMessage('Environment is required'),
  check('owner').notEmpty().withMessage('Owner is required'),
  check('projectAge').isInt({ min: 1 }).withMessage('Project age must be a positive integer'),
  check('correlationId').notEmpty().withMessage('Correlation ID is required')
], async (req, res) => {
  // Add logging without disrupting functionality
  logger.info(`[Template API] User ${req.user.email} request received: ${JSON.stringify({
    templateName: req.body.templateName,
    projectName: req.body.projectName,
    hasDescriptiveName: !!req.body.descriptiveName,
    environment: req.body.environment,
    owner: req.body.owner,
    projectAge: req.body.projectAge,
    correlationId: req.body.correlationId
  })}`);

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.error(`[Template API] Validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    // Extract values with fallbacks
    const {
      templateName,
      projectName,
      project_desc = projectName || 'Unnamed Project', // Provide a fallback for project_desc
      environment,
      owner,
      projectAge,
      correlationId,
      jira
    } = req.body;

    // Log the extracted values
    logger.info(`Extracted values: templateName=${templateName}, projectName=${projectName}, project_desc=${project_desc}, environment=${environment}`);

    // Use client-provided correlation ID instead of server-generated one
    const workflowCorrelationId = correlationId || req.correlationId;

    // Get authenticated user email safely (fallback to owner if not available)
    const triggeredBy = req.user?.email || owner || 'unknown';

    const result = await infrastructureService.deployFromTemplate(
      templateName,
      projectName,
      project_desc,
      environment,
      owner,
      projectAge,
      workflowCorrelationId,
      jira || '', // Pass Jira/CR number (optional)
      triggeredBy // Pass authenticated user email for PR description
    );

    res.json({
      success: true,
      message: 'Template deployment workflow triggered successfully',
      url: result.url,
      correlationId: workflowCorrelationId
    });
  } catch (error) {
    const workflowCorrelationId = req.body.correlationId || req.correlationId;
    logger.error(`[${workflowCorrelationId}] Error deploying from template: ${error.message}`);
    res.status(500).json({
      error: 'Failed to deploy from template',
      message: error.message,
      correlationId: workflowCorrelationId
    });
  }
});

// Delete infrastructure
router.post('/delete', requireAuth, [
  check('projectName').notEmpty().withMessage('Project abbreviation is required'),
  check('environment').notEmpty().withMessage('Environment is required')
  // correlationId is optional - will be generated if not provided
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { projectName, environment, correlationId } = req.body;

    // Generate correlation ID if not provided
    const workflowCorrelationId = correlationId || `del-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    logger.info(`[${workflowCorrelationId}] User ${req.user.email} deleting infrastructure: ${projectName} in ${environment}`);

    // Get authenticated user email safely (fallback to 'unknown' if not available)
    const triggeredBy = req.user?.email || 'unknown';

    const result = await infrastructureService.deleteInfrastructure(
      projectName,
      environment,
      workflowCorrelationId,
      triggeredBy // Pass authenticated user email for PR description
    );

    res.json({
      message: result.message || 'Infrastructure deletion request submitted successfully',
      success: true
    });
  } catch (error) {
    // Generate correlation ID if not provided (same logic as above)
    const workflowCorrelationId = req.body.correlationId || `del-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    logger.error(`[${workflowCorrelationId}] Error deleting infrastructure: ${error.message}`);
    res.status(500).json({
      error: 'Failed to delete infrastructure',
      message: error.message,
      success: false
    });
  }
});

// Environment folders selectable for Move to Infrastructure-Live
router.get('/infra-live-environments', (req, res) => {
  try {
    res.json({
      success: true,
      data: infrastructureService.getInfraLiveEnvironments(),
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error fetching infra-live environments: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch infra-live environments',
      correlationId: req.correlationId
    });
  }
});

// Move to Infrastructure-Live: copy the source environment into each selected environment folder
router.post('/promote', requireAuth, [
  check('projectName').matches(/^[A-Za-z0-9_-]{1,64}$/).withMessage('Project name is required and must be alphanumeric'),
  check('environment').matches(/^[A-Za-z0-9_-]{1,32}$/).withMessage('Source environment is required and must be alphanumeric'),
  check('crNumber').matches(/^[A-Za-z0-9._#-]{1,50}$/).withMessage('Change Request (CR) number is required'),
  check('environments').isArray({ min: 1 }).withMessage('Select at least one target environment'),
  check('environments').custom((value) => {
    const allowed = infrastructureService.getInfraLiveEnvironments();
    return Array.isArray(value) && value.length <= allowed.length && value.every((env) => allowed.includes(env));
  }).withMessage('Unsupported target environment'),
  check('correlationId').optional()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { projectName, environment, crNumber, correlationId } = req.body;
    const targetEnvironments = [...new Set(req.body.environments)];

    // Use client-provided correlation ID or generate a new one for workflow tracking
    const workflowCorrelationId = correlationId || req.correlationId;

    logger.info(`[${workflowCorrelationId}] User ${req.user.email} moving ${projectName} from ${environment} to infrastructure-live environments [${targetEnvironments.join(', ')}] (CR: ${crNumber})`);

    // Get authenticated user email safely (fallback to 'unknown' if not available)
    const triggeredBy = req.user?.email || 'unknown';

    // Pass the project name, environment, CR number, and correlation ID to the infrastructure service
    const result = await infrastructureService.promoteToProduction(
      projectName,
      environment,
      crNumber,
      workflowCorrelationId,
      triggeredBy, // Pass authenticated user email for PR description
      targetEnvironments
    );

    res.json({
      message: result.message || 'Promotion to production request submitted successfully',
      success: true
    });
  } catch (error) {
    const workflowCorrelationId = req.body.correlationId || req.correlationId;
    logger.error(`[${workflowCorrelationId}] Error promoting to production: ${error.message}`);
    res.status(500).json({
      error: 'Failed to promote to production',
      message: error.message,
      success: false
    });
  }
});

// Get workflow status by correlation ID
router.get('/status/:correlationId', async (req, res) => {
  try {
    const { correlationId } = req.params;
    const { type } = req.query; // Optional workflow type for better filtering

    if (!correlationId) {
      return res.status(400).json({ error: 'Correlation ID is required' });
    }

    // Log the request with workflow type if available
    logger.info(`Fetching status for ${correlationId}${type ? ` (${type} workflow)` : ''}`);

    // Get workflow status from GitHub
    const result = await githubService.getWorkflowStatusByCorrelationId(correlationId, type);

    if (result) {
      logger.info(`Retrieved workflow status for ${correlationId}:`, result);
      res.json({
        status: result.status,
        conclusion: result.conclusion,
        url: result.url || result.html_url || null,
        prUrl: result.prUrl || null,
        message: result.message || '',
        correlationId: correlationId,
        workflowType: type || result.workflowType || 'unknown',
        data: result // Include the full result for additional details
      });
    } else {
      res.status(404).json({
        error: 'Workflow not found',
        correlationId: correlationId
      });
    }
  } catch (error) {
    logger.error(`Error getting workflow status: ${error.message}`);
    res.status(500).json({
      error: 'Failed to get workflow status',
      message: error.message,
      correlationId: req.params.correlationId
    });
  }
});

// FR-002: Get normalized metadata for a single app/environment pair
// Reads docs/metadata/{appName}-{environment}.json from the service-catalog repo.
// NFR-001: p95 latency target ≤2000ms — latency_ms is emitted on every outcome event.
// NFR-004: requireAuth enforces auth before any GitHub I/O.
// NFR-006: correlationId present in every response and log line.
router.get('/app-metadata/:appName/:environment',
  requireAuth,
  [
    check('appName')
      .matches(/^[a-zA-Z0-9]{1,8}$/)
      .withMessage('appName must be 1–8 alphanumeric characters'),
    check('environment')
      .custom(value => {
        // Load allowlist from data/environments.json at request time (small file, sync OK)
        const fs = require('fs');
        const path = require('path');
        const envData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/environments.json'), 'utf8'));
        const validIds = envData.environments.map(e => e.id);
        if (!validIds.includes(value)) {
          throw new Error(`environment must be one of: ${validIds.join(', ')}`);
        }
        return true;
      })
  ],
  async (req, res) => {
    const startMs = Date.now();
    const { appName, environment } = req.params;
    const correlationId = req.correlationId;

    // NFR-006: Emit catalog_prefill_requested on every inbound call before any I/O.
    logger.logMetric('catalog_prefill_requested', {
      correlationId,
      app_name: appName,
      environment,
      user: req.user?.email
    });

    // Input validation (NFR-004: auth already enforced above by requireAuth)
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      logger.logMetric('catalog_prefill_failed', {
        correlationId,
        app_name: appName,
        environment,
        error_code: 400,
        reason: 'validation_failed',
        latency_ms: Date.now() - startMs
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid appName or environment',
        details: validationErrors.array(),
        correlationId
      });
    }

    logger.info(`[${correlationId}] GET /api/app-metadata appName=${appName} env=${environment}`);

    try {
      const metadata = await infrastructureService.getApplicationDetails(appName, environment);
      const latency_ms = Date.now() - startMs;

      if (!metadata) {
        // NFR-003: Graceful degradation — return structured 404, never expose stack traces.
        logger.logMetric('catalog_prefill_failed', {
          correlationId,
          app_name: appName,
          environment,
          error_code: 404,
          reason: 'metadata_not_found',
          latency_ms
        });
        logger.info(`[${correlationId}] app-metadata fetch failed appName=${appName} env=${environment} error=metadata_not_found`);
        return res.status(404).json({
          success: false,
          error: 'App not found',
          correlationId
        });
      }

      // NFR-001: Record latency on success for p95 SLO tracking.
      logger.logMetric('catalog_prefill_succeeded', {
        correlationId,
        app_name: appName,
        environment,
        latency_ms
      });
      logger.info(`[${correlationId}] app-metadata fetched appName=${appName} env=${environment} durationMs=${latency_ms}`);

      return res.json({
        success: true,
        data: metadata,
        correlationId
      });
    } catch (error) {
      const latency_ms = Date.now() - startMs;
      logger.logMetric('catalog_prefill_failed', {
        correlationId,
        app_name: appName,
        environment,
        error_code: 500,
        reason: 'github_api_error',
        latency_ms
      });
      logger.error(`[${correlationId}] app-metadata fetch failed appName=${appName} env=${environment} error=${error.message}`);
      // NFR-003: Never expose internal error details in production responses.
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch metadata',
        correlationId
      });
    }
  }
);

// Get all deployed applications from database
router.get('/deployed-apps', requireAuth, async (req, res) => {
  try {
    const apps = await databaseService.getDeployedApplications();
    res.json(apps);
  } catch (error) {
    logger.error(`[${req.correlationId}] Error fetching deployed applications: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch deployed applications', correlationId: req.correlationId });
  }
});

// Get a deployed application by project name and environment
router.get('/deployed-apps/:projectName/:environment', requireAuth, async (req, res) => {
  try {
    const { projectName, environment } = req.params;
    logger.info(`[${req.correlationId}] Fetching application details for ${projectName} in ${environment}`);

    const appDetails = await infrastructureService.getApplicationDetails(projectName, environment);

    if (!appDetails) {
      return res.status(404).json({
        error: `Application not found: ${projectName} in ${environment}`,
        correlationId: req.correlationId
      });
    }

    res.json(appDetails);
  } catch (error) {
    logger.error(`[${req.correlationId}] Error fetching application details: ${error.message}`);
    res.status(500).json({
      error: 'Failed to fetch application details',
      details: error.message,
      correlationId: req.correlationId
    });
  }
});

// Update a deployed application with PR information
router.post('/deployed-apps/update-pr', [
  check('correlationId').notEmpty().withMessage('Correlation ID is required'),
  check('prNumber').isInt().withMessage('PR number must be an integer'),
  check('prUrl').isURL().withMessage('PR URL must be a valid URL')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array(), correlationId: req.correlationId });
  }

  try {
    const { correlationId, prNumber, prUrl } = req.body;
    // We're not using the database anymore, so just return a success response
    logger.info(`[${req.correlationId}] Mock PR update for correlation ID: ${correlationId}, PR: ${prNumber}`);

    res.json({ success: true, message: 'PR information updated successfully', correlationId });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error updating PR information: ${error.message}`);
    res.status(500).json({ error: 'Failed to update PR information', correlationId: req.correlationId });
  }
});

// Request production transition for an application
router.post('/deployed-apps/:id/request-production', [
  check('requestedBy').notEmpty().withMessage('Requester name is required'),
  check('approvalTicket').optional(),
  check('notes').optional()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array(), correlationId: req.correlationId });
  }

  try {
    const applicationId = parseInt(req.params.id, 10);
    const { requestedBy, approvalTicket, notes } = req.body;

    // We're not using the database anymore, just log the request
    logger.info(`[${req.correlationId}] Production transition requested for app ID ${applicationId} by ${requestedBy}`);

    res.json({
      success: true,
      message: 'Production transition requested successfully',
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error requesting production transition: ${error.message}`);
    res.status(500).json({ error: 'Failed to request production transition', correlationId: req.correlationId });
  }
});

// Approve production transition
router.post('/lifecycle-transitions/:id/approve', [
  check('approvedBy').notEmpty().withMessage('Approver name is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array(), correlationId: req.correlationId });
  }

  try {
    const transitionId = parseInt(req.params.id, 10);
    const { approvedBy } = req.body;

    // We're not using the database anymore, just log the approval
    logger.info(`[${req.correlationId}] Production transition ${transitionId} approved by ${approvedBy}`);

    res.json({
      success: true,
      message: 'Production transition approved successfully',
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error approving production transition: ${error.message}`);
    res.status(500).json({ error: 'Failed to approve production transition', correlationId: req.correlationId });
  }
});

// GitHub Webhook endpoint
router.post('/webhook/github', verifyWebhook, express.json(), async (req, res) => {
  try {
    const event = req.headers['x-github-event'];
    const payload = req.body;

    // Process the webhook event
    await githubService.handleWebhookEvent(event, payload);

    res.status(202).json({ status: 'accepted' });
  } catch (error) {
    logger.error(`Error processing webhook: ${error.message}`, { error });
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Test endpoint to check repository structure
router.get('/test-repo-structure', async (req, res) => {
  try {
    // Check if GitHub service is initialized
    if (!githubService.initialized) {
      await githubService.initialize();
    }

    // Get the repository details from config
    const [owner, repo] = config.github.serviceRepo.split('/');

    // Get root contents
    const rootContents = await githubService.octokit.rest.repos.getContent({
      owner,
      repo,
      path: ''
    });

    // Format the response
    const formattedContents = rootContents.data.map(item => ({
      name: item.name,
      type: item.type,
      path: item.path
    }));

    res.json({
      success: true,
      data: formattedContents,
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error checking repo structure: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to check repo structure',
      message: error.message,
      correlationId: req.correlationId
    });
  }
});

// Test endpoint to check docs folder structure
router.get('/test-docs-structure', async (req, res) => {
  try {
    // Check if GitHub service is initialized
    if (!githubService.initialized) {
      await githubService.initialize();
    }

    // Get the repository details from config
    const [owner, repo] = config.github.serviceRepo.split('/');

    // Get docs contents
    const docsContents = await githubService.octokit.rest.repos.getContent({
      owner,
      repo,
      path: 'docs'
    });

    // Format the response
    const formattedContents = docsContents.data.map(item => ({
      name: item.name,
      type: item.type,
      path: item.path
    }));

    res.json({
      success: true,
      data: formattedContents,
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error checking docs structure: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to check docs structure',
      message: error.message,
      correlationId: req.correlationId
    });
  }
});

// Test endpoint to check docs/metadata folder structure
router.get('/test-metadata-structure', async (req, res) => {
  try {
    // Check if GitHub service is initialized
    if (!githubService.initialized) {
      await githubService.initialize();
    }

    // Get the repository details from config
    const [owner, repo] = config.github.serviceRepo.split('/');

    // Get metadata contents
    const metadataContents = await githubService.octokit.rest.repos.getContent({
      owner,
      repo,
      path: 'docs/metadata'
    });

    // Format the response
    const formattedContents = metadataContents.data.map(item => ({
      name: item.name,
      type: item.type,
      path: item.path
    }));

    res.json({
      success: true,
      data: formattedContents,
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error checking metadata structure: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to check metadata structure',
      message: error.message,
      correlationId: req.correlationId
    });
  }
});

// Label an application as Live or Experiment
router.post('/label', requireAuth, [
  check('projectName').notEmpty().withMessage('Project name is required'),
  check('environment').notEmpty().withMessage('Environment is required'),
  check('labelType').isIn(['live', 'experiment']).withMessage('Label type must be either live or experiment')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
      correlationId: req.correlationId
    });
  }

  const { projectName, environment, labelType } = req.body;
  const correlationId = req.body.correlationId || `cid-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  logger.info(`[${correlationId}] User ${req.user.email} labeling ${projectName} in ${environment} as ${labelType}`);

  try {
    logger.info(`[${correlationId}] Labeling application ${projectName} in ${environment} as ${labelType} using UpdateMetadataLive.yaml workflow`);

    // Get service catalog branch from environment variable
    const serviceCatalogBranch = process.env.SERVICE_CATALOG_BRANCH || 'main';

    // Get authenticated user email safely
    const triggeredBy = req.user?.email || 'unknown';

    // Trigger the UpdateMetadataLive.yaml workflow
    const result = await githubService.triggerWorkflow(
      config.github.serviceRepo,
      'UpdateMetadataLive.yaml',
      serviceCatalogBranch,  // Use configured branch for workflow dispatch
      {
        app_name: projectName,
        triggered_by: triggeredBy
      }
    );

    logger.info(`[${correlationId}] UpdateMetadataLive.yaml workflow triggered for ${projectName} with label ${labelType}`);

    // Return success response
    return res.json({
      success: true,
      message: `Application ${projectName} in ${environment} is being labeled as ${labelType} using UpdateMetadataLive.yaml workflow`,
      correlationId,
      workflowId: result?.data?.id || 'unknown'
    });
  } catch (error) {
    logger.error(`[${correlationId}] Error labeling application: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to label application',
      message: error.message,
      correlationId
    });
  }
});

// Get all AKS deployed applications
router.get('/aks-apps', requireAuth, async (req, res) => {
  try {
    logger.info(`[${req.correlationId}] User ${req.user.email} fetching AKS apps`);
    const apps = await infrastructureService.getAKSInstalledApps();
    res.json({ success: true, data: apps, correlationId: req.correlationId });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error fetching AKS apps: ${error.message}`);
    res.status(500).json({ success: false, error: 'Failed to fetch AKS apps', correlationId: req.correlationId });
  }
});

// AKS deployment endpoint
router.post('/aks-deploy', requireAuth, [
  check('correlation_id').optional().isString().matches(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)
    .withMessage('correlation_id must be an identifier of 1 to 128 characters'),
  check('envname').notEmpty().withMessage('Environment name is required'),
  check('appname').notEmpty().withMessage('Application name is required')
    .matches(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/).withMessage('App name must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric'),
  check('namespace').notEmpty().withMessage('Namespace is required')
    .matches(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/).withMessage('Namespace must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric'),
  check('is_web_app').isBoolean().withMessage('is_web_app must be a boolean (true for app, false for agent)'),
  check('image_name').notEmpty().withMessage('Image name is required')
    .matches(/^[a-zA-Z0-9._/-]+$/).withMessage('Invalid image name format'),
  check('image_tag').notEmpty().withMessage('Image tag is required')
    .matches(/^[a-zA-Z0-9._-]+$/).withMessage('Invalid image tag format'),
  // Optional web-app-only fields
  check('team_label').optional().isString().withMessage('team_label must be a string'),
  check('port').optional().isInt({ min: 1, max: 65535 }).withMessage('port must be between 1 and 65535'),
  check('health_path').optional().isString().withMessage('health_path must be a string'),
  check('external_secret_enabled').optional().isIn(['true', 'false']).withMessage('external_secret_enabled must be "true" or "false"'),
  check('kv_secrets').optional().custom((val) => {
    try { const p = JSON.parse(val); return Array.isArray(p); } catch { return false; }
  }).withMessage('kv_secrets must be a valid JSON array'),
  check('env_vars').optional().custom((val) => {
    try { const p = JSON.parse(val); return Array.isArray(p); } catch { return false; }
  }).withMessage('env_vars must be a valid JSON array'),
  check('secret_env_vars').optional().custom((val) => {
    try { const p = JSON.parse(val); return Array.isArray(p); } catch { return false; }
  }).withMessage('secret_env_vars must be a valid JSON array'),
  // Optional agent-only fields
  check('agent_name').optional().isString().matches(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/).withMessage('agent_name must be lowercase alphanumeric with hyphens'),
  check('pool_name').optional().isString().withMessage('pool_name must be a string'),
  check('allow_update').optional().isIn(['true', 'false']).withMessage('allow_update must be "true" or "false"'),
  check('exposure_mode').optional().isIn(['legacy', 'private-gateway']).withMessage('Invalid exposure mode'),
  // The portal sends string booleans, but JSON clients can send native booleans.
  // Validate both forms before dispatch; never let native true bypass eligibility.
  check('create_postgres_db').optional().custom(val =>
    val === 'true' || val === 'false' || val === true || val === false
  ).withMessage('create_postgres_db must be true or false'),
  check('create_postgres_db').optional().custom((val, { req }) => {
    if (val !== 'true' && val !== true) return true;
    const name = req.body.appname;
    return ['sand', 'devsand'].includes(req.body.envname) &&
      typeof name === 'string' && name.length > 0 && name.length <= 60 &&
      name === req.body.namespace &&
      (req.body.is_web_app === true || req.body.is_web_app === 'true') &&
      req.body.allow_update !== true && req.body.allow_update !== 'true';
  }).withMessage('PostgreSQL database requires a new sand/devsand web app with matching namespace and an app name of at most 60 characters'),
  check('exposure_mode').optional().custom((mode, { req }) => {
    if (mode !== 'private-gateway') return true;
    return ['sand', 'devsand'].includes(req.body.envname) &&
      req.body.appname === req.body.namespace &&
      (req.body.is_web_app === true || req.body.is_web_app === 'true') &&
      req.body.allow_update !== true && req.body.allow_update !== 'true';
  }).withMessage('Private gateway requires a new sand or devsand web app with matching namespace and no overwrite'),
  // External resource access grants (optional, applies to both web apps and agents)
  check('workload_identity_grants')
    .optional()
    .custom((val) => {
      try {
        const p = JSON.parse(val);
        return Array.isArray(p) && p.every(g =>
          g &&
          typeof g.resourceType === 'string' && g.resourceType.length > 0 &&
          typeof g.resourceName === 'string' && g.resourceName.length > 0 &&
          typeof g.role === 'string' && g.role.length > 0
        );
      } catch { return false; }
    })
    .withMessage('workload_identity_grants must be a valid JSON array of {resourceType, resourceName, role} objects')
], async (req, res) => {
  const correlationId = typeof req.body.correlation_id === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(req.body.correlation_id)
    ? req.body.correlation_id
    : req.correlationId;
  req.correlationId = correlationId;

  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.logMetric('aks_deployment_rejected', {
        correlationId,
        level: 'warn',
        status_code: 400,
        failed_fields: [...new Set(errors.array().map(error => error.path))]
      });
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
        correlationId
      });
    }

    // Extract request parameters
    const {
      envname, appname, namespace, is_web_app, image_name, image_tag,
      team_label, port, health_path, external_secret_enabled, kv_secrets, env_vars, secret_env_vars,
      agent_name, pool_name, allow_update, exposure_mode, create_postgres_db,
      workload_identity_grants
    } = req.body;

    logger.logMetric('aks_deployment_requested', {
      correlationId,
      envname,
      appname,
      namespace,
      deploymentType: is_web_app === true || is_web_app === 'true' ? 'app' : 'agent'
    });

    // Get authenticated user email safely (fallback to 'unknown' if not available)
    const triggeredBy = req.user?.email || 'unknown';

    // Deploy to AKS
    const result = await aksService.deployToAks(
      envname,
      appname,
      namespace,
      is_web_app,
      image_name,
      image_tag,
      team_label,
      port,
      health_path,
      external_secret_enabled,
      kv_secrets,
      env_vars,
      secret_env_vars,
      agent_name,
      pool_name,
      allow_update,
      workload_identity_grants,
      exposure_mode || 'legacy',
      create_postgres_db || 'false',
      correlationId,
      triggeredBy // Pass authenticated user email for PR description
    );

    // Return success response
    return res.json({
      success: true,
      message: result.message,
      correlationId: result.correlationId,
      workflowId: result.workflowId,
      workflowUrl: result.workflowUrl,
      repository: result.repository,
      inputs: result.inputs
    });

  } catch (error) {
    logger.logMetric('aks_deployment_failed', {
      correlationId,
      level: 'error',
      status_code: 500,
      reason: 'DISPATCH_FAILED'
    });

    return res.status(500).json({
      success: false,
      error: 'AKS deployment failed',
      message: error.message,
      correlationId
    });
  }
});

// Legacy status lookup ownership (ship-from-repo B-5, spec §3.6.3). `by=` of the run-name, else the `Triggered by:`
// log line; both sides normalised with sanitizeActor. system/unknown/empty never match a user; platform members always may.
function legacyRunOwner(displayTitle) {
  const ship = parseRunName(displayTitle);
  if (ship) return ship.by;
  const match = /\bby=(.+)$/.exec(displayTitle || '');
  return match ? match[1].trim() : null;
}

async function canViewLegacyStatus(user, workflowStatus) {
  if (isPlatformMember(user)) return true;
  const by = legacyRunOwner(workflowStatus.displayTitle) || await aksService.getTriggeredByFromJobLog(workflowStatus.jobId);
  const owner = sanitizeActor(by);
  if (!owner || owner === 'system' || owner === 'unknown') return false;
  return owner === sanitizeActor(user && user.email);
}

// Get AKS deployment status by correlation ID
router.get('/aks-status-by-correlation/:correlationId', requireAuth, async (req, res) => {
  const { correlationId } = req.params;

  try {
    const { displayTitle, jobId, ...status } = await aksService.getDeploymentStatusByCorrelationId(correlationId);
    // Authorize only when a run was actually matched; not_found / search errors keep the legacy body for any authenticated user
    if ((displayTitle || jobId) && !(await canViewLegacyStatus(req.user, { displayTitle, jobId }))) {
      logger.logMetric('ship_authz_denied', { correlationId, request_correlation_id: req.correlationId, action: 'legacy_status', level: 'warn' });
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'You do not have access to this deployment.'
      });
    }
    logger.logMetric('aks_status_request_completed', {
      correlationId,
      request_correlation_id: req.correlationId,
      status: status.status
    });

    return res.json({
      success: true,
      status: status
    });
  } catch (error) {
    logger.logMetric('aks_status_request_failed', {
      correlationId,
      request_correlation_id: req.correlationId,
      level: 'error',
      status_code: 500
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to get deployment status',
      message: error.message
    });
  }
});

// Get AKS deployment status
router.get('/aks-status/:workflowId', async (req, res) => {
  const { workflowId } = req.params;

  try {
    const status = await aksService.getDeploymentStatus(workflowId);

    return res.json({
      success: true,
      status: status
    });
  } catch (error) {
    logger.error(`Failed to get AKS deployment status:`, { error: error.message });

    return res.status(500).json({
      success: false,
      error: 'Failed to get deployment status',
      message: error.message
    });
  }
});



// Add code repository - triggers create-app.yml workflow in AyaHealthcare/self-service-catalog
router.post('/add-code-repo', [
  check('projectName').notEmpty().withMessage('Project name is required'),
  check('templateRepo').notEmpty().withMessage('Template repository is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
        correlationId: req.correlationId
      });
    }

    const { projectName, templateRepo, jiraNumber, correlationId: clientCorrelationId } = req.body;

    // Use client-provided correlationId if available, otherwise fall back to server-generated one
    const correlationId = clientCorrelationId || req.correlationId;
    req.correlationId = correlationId;

    logger.info(`[${correlationId}] Triggering create-app workflow for ${projectName} with template ${templateRepo}`);

    // Step 1: Get the code deployment GitHub App installation token
    logger.info(`[${req.correlationId}] Getting code deployment GitHub App token...`);
    const codeAppToken = await githubService.getInstallationAccessToken(true);

    // Step 2: Create/update the CODE_DEPLOYMENT_TOKEN secret in the target repository
    logger.info(`[${req.correlationId}] Creating CODE_DEPLOYMENT_TOKEN secret in AyaHealthcare/self-service-catalog...`);
    await githubService.createOrUpdateRepoSecret(
      'AyaHealthcare/self-service-catalog',
      'CODE_DEPLOYMENT_TOKEN',
      codeAppToken,
      true // Use code deployment app to create the secret
    );

    // Step 3: Trigger create-app.yml workflow in AyaHealthcare/self-service-catalog repository
    // Use the separate code deployment GitHub App
    let workflowResult;

    try {
      workflowResult = await githubService.triggerWorkflow(
        'AyaHealthcare/self-service-catalog',
        'create-app.yml',
        'main',
        {
          appname: projectName,
          template_repo: templateRepo,
          jira_number: jiraNumber || '',
          correlation_id: req.correlationId
        },
        true // Use code deployment GitHub App
      );
    } catch (error) {
      // If .yml fails, try .yaml extension
      if (error.message.includes('Not Found')) {
        logger.info(`[${req.correlationId}] Workflow create-app.yml not found, trying create-app.yaml`);
        workflowResult = await githubService.triggerWorkflow(
          'AyaHealthcare/self-service-catalog',
          'create-app.yaml',
          'main',
          {
            appname: projectName,
            template_repo: templateRepo,
            jira_number: jiraNumber || '',
            correlation_id: req.correlationId
          },
          true // Use code deployment GitHub App
        );
      } else {
        throw error;
      }
    }

    logger.info(`[${req.correlationId}] Code repo workflow triggered successfully`);

    res.json({
      success: true,
      message: 'Code repository workflow triggered successfully',
      workflowUrl: `https://github.com/AyaHealthcare/self-service-catalog/actions`,
      correlationId: req.correlationId
    });

  } catch (error) {
    logger.error(`[${req.correlationId}] Error triggering code repo workflow: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      correlationId: req.correlationId
    });
  }
});

// Debug endpoint: List all GitHub App installations
router.get('/debug/installations', async (req, res) => {
  try {
    logger.info(`[${req.correlationId}] Listing GitHub App installations`);

    const installations = await githubService.listInstallations();

    res.json({
      success: true,
      installations: installations,
      currentInstallationId: process.env.GITHUB_INSTALLATION_ID,
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error listing installations: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || 'No additional details',
      correlationId: req.correlationId
    });
  }
});

// Debug endpoint: Test GitHub App access to AyaHealthcare/self-service-catalog
router.get('/debug/github-access', async (req, res) => {
  try {
    logger.info(`[${req.correlationId}] Testing code deployment GitHub App access to AyaHealthcare/self-service-catalog`);

    const accessTest = await githubService.testRepositoryAccess('AyaHealthcare/self-service-catalog', true); // Use code app

    res.json({
      success: true,
      repository: 'AyaHealthcare/self-service-catalog',
      usingCodeApp: true,
      access: accessTest,
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error testing access: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || 'No additional details',
      correlationId: req.correlationId
    });
  }
});

// Debug endpoint: List available workflows in AyaHealthcare/self-service-catalog
router.get('/debug/workflows', async (req, res) => {
  try {
    logger.info(`[${req.correlationId}] Listing workflows in AyaHealthcare/self-service-catalog`);

    const workflows = await githubService.listWorkflows('AyaHealthcare/self-service-catalog');

    res.json({
      success: true,
      repository: 'AyaHealthcare/self-service-catalog',
      workflows: workflows,
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error listing workflows: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || 'No additional details',
      correlationId: req.correlationId
    });
  }
});

// Get available infrastructure agents
router.get('/agents', async (req, res) => {
  try {
    logger.info(`[${req.correlationId}] Fetching available agents`);

    const agents = await infrastructureService.getAgents();

    res.json({
      success: true,
      data: agents,
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`[${req.correlationId}] Error fetching agents: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch agents',
      message: error.message,
      correlationId: req.correlationId
    });
  }
});

// Submit agent-based infrastructure change
router.post('/agent-change', optionalAuth, [
  check('agentName').notEmpty().withMessage('Agent name is required'),
  check('inputs').isObject().withMessage('Agent inputs must be an object'),
  check('correlationId').notEmpty().withMessage('Correlation ID is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
      correlationId: req.correlationId
    });
  }

  try {
    const { agentName, inputs, correlationId, triggeredBy, jiraTicket } = req.body;
    const effectiveTriggeredBy = triggeredBy || req.user?.email || 'unknown';

    logger.info(`[${correlationId}] Agent change request: ${agentName}, body.triggeredBy="${triggeredBy}", req.user?.email="${req.user?.email}", effective="${effectiveTriggeredBy}"`);

    // Trigger agent dispatch workflow in infrastructure-live repository
    const result = await infrastructureService.submitAgentChange({
      agentName,
      inputs,
      correlationId,
      triggeredBy: effectiveTriggeredBy,
      jiraTicket
    });

    logger.info(`[${correlationId}] Agent change workflow triggered successfully`);

    res.json({
      success: true,
      message: result.message,
      correlationId,
      workflowUrl: result.workflowUrl,
      data: {
        agentName,
        status: 'workflow_triggered',
        triggeredAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error(`[${req.body.correlationId || req.correlationId}] Error processing agent change: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to process agent change request',
      message: error.message,
      correlationId: req.body.correlationId || req.correlationId
    });
  }
});

// POST /api/feedback — Create GitHub Issue from feedback form
router.post('/feedback',
  requireAuth,
  [
    body('type').isIn(['bug', 'feature-request', 'agent-request']).withMessage('type must be bug, feature-request, or agent-request'),
    body('title').notEmpty().isLength({ max: 120 }).withMessage('title is required and must be ≤120 chars'),
    body('description').notEmpty().withMessage('description is required'),
  ],
  async (req, res) => {
    const correlationId = req.correlationId;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array(), correlationId });
    }

    try {
      const { type, title, description, correlationId: clientCid } = req.body;
      const effectiveCorrelationId = clientCid || correlationId;
      const submittedBy = req.user?.email || 'unknown';

      logger.info(`[${effectiveCorrelationId}] User ${submittedBy} submitting feedback: type=${type}, title=${title}`);

      // Sanitise helper — use validator.escape() for full HTML entity encoding (prevents XSS)
      const sanitise = (str) => {
        if (typeof str !== 'string') return '';
        return escapeHtml(str.substring(0, 10000).trim());
      };

      const safeTitle = sanitise(title);
      const safeDesc = sanitise(description);
      const safeSubmittedBy = sanitise(submittedBy);

      let issueBody = '';

      if (type === 'bug') {
        const observedBehaviour = sanitise(req.body.observedBehaviour || description);
        const expectedBehaviour = sanitise(req.body.expectedBehaviour || '');
        const stepsToReproduce = sanitise(req.body.stepsToReproduce || '');
        const severity = sanitise(req.body.severity || 'Medium');

        issueBody = [
          `## Observed Behaviour`,
          observedBehaviour,
          ``,
          `## Expected Behaviour`,
          expectedBehaviour || '_Not provided_',
          ``,
          `## Steps to Reproduce`,
          stepsToReproduce || '_Not provided_',
          ``,
          `## Severity`,
          severity,
          ``,
          `## Submitted By`,
          safeSubmittedBy,
          ``,
          `## Correlation ID`,
          effectiveCorrelationId
        ].join('\n');
      } else if (type === 'feature-request') {
        const painPoint = sanitise(req.body.painPoint || description);
        const desiredOutcome = sanitise(req.body.desiredOutcome || '');
        const businessJustification = sanitise(req.body.businessJustification || '');
        const priority = sanitise(req.body.priority || 'Medium');

        issueBody = [
          `## Pain Point / Problem Statement`,
          painPoint,
          ``,
          `## Desired Outcome`,
          desiredOutcome || '_Not provided_',
          ``,
          `## Business Justification`,
          businessJustification || '_Not provided_',
          ``,
          `## Priority`,
          priority,
          ``,
          `## Submitted By`,
          safeSubmittedBy,
          ``,
          `## Correlation ID`,
          effectiveCorrelationId
        ].join('\n');
      } else {
        // agent-request
        const agentType = sanitise(req.body.agentType || '');
        const agentBehaviour = sanitise(req.body.agentBehaviour || description);
        const businessJustification = sanitise(req.body.businessJustification || '');

        issueBody = [
          `## Existing Infrastructure / Agent Type`,
          agentType || '_Not specified_',
          ``,
          `## What the Agent Should Do`,
          agentBehaviour,
          ``,
          `## Business Justification`,
          businessJustification || '_Not provided_',
          ``,
          `## Submitted By`,
          safeSubmittedBy,
          ``,
          `## Correlation ID`,
          effectiveCorrelationId
        ].join('\n');
      }

      const result = await githubService.createIssue(
        config.github.selfServiceRepo,
        safeTitle,
        issueBody,
        [type],
        effectiveCorrelationId
      );

      logger.info(`[${effectiveCorrelationId}] GitHub issue created: #${result.issueNumber} — ${result.issueUrl}`);

      return res.status(201).json({
        success: true,
        issueUrl: result.issueUrl,
        issueNumber: result.issueNumber,
        correlationId: effectiveCorrelationId
      });
    } catch (error) {
      const effectiveCorrelationId = req.body?.correlationId || correlationId;
      logger.error(`[${effectiveCorrelationId}] Error creating feedback issue: ${error.message}`);

      if (error.status === 429 || error.retryAfter) {
        return res.status(429).json({
          success: false,
          error: 'GitHub rate limit exceeded. Please try again later.',
          retryAfter: error.retryAfter || '60',
          correlationId: effectiveCorrelationId
        });
      }

      if (error.code === 'GITHUB_TIMEOUT') {
        return res.status(503).json({
          success: false,
          error: 'GitHub API timed out. Please try again.',
          correlationId: effectiveCorrelationId
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to create feedback issue. Please try again.',
        message: error.message,
        correlationId: effectiveCorrelationId
      });
    }
  }
);

module.exports = router;
