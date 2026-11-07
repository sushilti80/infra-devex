/**
 * secretsService.js
 *
 * secret-self-service: Key Vault discovery (FR-003), secret listing (FR-001), and the GitOps
 * secret submission flow (FR-002). Uses `githubService.octokit` only (Infrastructure App) — this
 * feature must never touch `githubService.codeOctokit` (Code Deployment App).
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const nodePath = require('path');

const config = require('../config');
const githubService = require('./githubService');
const infrastructureService = require('./infrastructureService');
const terragruntLocalsResolver = require('./terragruntLocalsResolver');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);

function mapRepo(target) {
  if (target === 'live') return config.github.infrastructureLiveRepo;
  if (target === 'sand') return config.github.serviceRepo;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// vault-resolution-override: human-correctable override tier (priority: override > metadata > live)
// ─────────────────────────────────────────────────────────────────────────────

const OVERRIDES_PATH = 'docs/overrides/keyvault-overrides.json';
const OVERRIDES_CACHE_TTL_MS = 60 * 1000;
const OVERRIDES_CACHE_KEY = 'overrides';
const overridesCache = new Map(); // key -> { promise, expiresAt }

function getDefaultBranchName() {
  return process.env.SERVICE_CATALOG_BRANCH || 'main';
}

// Reads/parses docs/overrides/keyvault-overrides.json from config.github.serviceRepo ONLY —
// never mapRepo(target); the sidecar lives in one place regardless of which repo a vault was
// discovered in. Never throws: a missing file or malformed JSON both resolve to an empty map so
// resolution always falls through to the live resolver.
async function loadVaultOverrides(correlationId) {
  const now = Date.now();
  const cached = overridesCache.get(OVERRIDES_CACHE_KEY);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (async () => {
    let file;
    try {
      file = await githubService.getFileContent(config.github.serviceRepo, OVERRIDES_PATH, getDefaultBranchName());
    } catch (error) {
      logger.warn(`[${correlationId}] loadVaultOverrides: read failed, falling through to live resolver: ${error.message}`);
      return {};
    }
    if (!file) return {};
    try {
      return JSON.parse(file.content);
    } catch (error) {
      logger.warn(`[${correlationId}] loadVaultOverrides: malformed JSON in ${OVERRIDES_PATH}, falling through to live resolver: ${error.message}`);
      return {};
    }
  })();

  overridesCache.set(OVERRIDES_CACHE_KEY, { promise, expiresAt: now + OVERRIDES_CACHE_TTL_MS });
  promise.catch(() => { overridesCache.delete(OVERRIDES_CACHE_KEY); });
  return promise;
}

// Priority: override > metadata > live. `metadata` is always undefined at the resolveKeyVaults()
// call site in this PRD's scope (Phase B pass-through slot) — a missing metadata/metadata.keyvaults
// is a normal no-op, never an error.
async function resolveVaultNameWithFallback(vaultEntry, overrides, metadata, target, correlationId) {
  const override = overrides && overrides[vaultEntry.vaultDir];
  if (override) {
    return { name: override.name, resourceGroup: override.resourceGroup ?? null, source: 'override' };
  }

  const metadataEntry = metadata && Array.isArray(metadata.keyvaults)
    ? metadata.keyvaults.find(kv => kv.vaultDir === vaultEntry.vaultDir)
    : undefined;
  if (metadataEntry) {
    return { name: metadataEntry.name, resourceGroup: metadataEntry.resourceGroup ?? null, source: 'metadata' };
  }

  const name = await terragruntLocalsResolver.resolveName(vaultEntry.vaultDir, target, correlationId);
  const resourceGroup = await terragruntLocalsResolver.resolveResourceGroup(vaultEntry.vaultDir, target, correlationId);
  return { name, resourceGroup, source: name ? 'live' : 'unresolved' };
}

// Read-modify-write of the override sidecar, keyed by vaultDir. sha-based optimistic concurrency
// (same pattern as submitSecretViaGitOps): a stale sha surfaces as err.code = 'CONFLICT' for the
// route to map to 409. Commits directly to the default branch — no feature branch/PR (spec §2.4).
async function setVaultNameOverride({ vaultDir, name, resourceGroup, appName, environment, qualifier, verifiedBy, correlationId }) {
  const repo = config.github.serviceRepo;
  const branch = getDefaultBranchName();

  const file = await githubService.getFileContent(repo, OVERRIDES_PATH, branch);
  let overrides = {};
  if (file) {
    try {
      overrides = JSON.parse(file.content);
    } catch (error) {
      logger.warn(`[${correlationId}] setVaultNameOverride: malformed existing JSON in ${OVERRIDES_PATH}, overwriting: ${error.message}`);
      overrides = {};
    }
  }

  const entry = {
    name,
    resourceGroup: resourceGroup || null,
    appName,
    environment,
    qualifier: qualifier || null,
    verifiedBy,
    verifiedAt: new Date().toISOString()
  };
  overrides[vaultDir] = entry;

  const content = `${JSON.stringify(overrides, null, 2)}\n`;
  const message = `chore(overrides): set Key Vault name override for ${vaultDir}`;
  try {
    await githubService.createOrUpdateFile(repo, branch, OVERRIDES_PATH, content, message, file ? file.sha : null);
  } catch (error) {
    if (error.status === 409 || error.status === 422 || error.status === 412) {
      const err = new Error('Override file was modified concurrently; retry the request');
      err.code = 'CONFLICT';
      throw err;
    }
    throw error;
  }

  overridesCache.delete(OVERRIDES_CACHE_KEY); // invalidate so the next loadVaultOverrides() reflects this write immediately
  return { vaultDir, ...entry };
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-003: resolveKeyVaults — one-shot tree enumeration + repo-level cache
// ─────────────────────────────────────────────────────────────────────────────

const VAULT_DIR_RE = /^keyvault\d*$/i;
const VAULT_FILE_RE = /^keyvault\.hcl$/i;

// FR-003 Round 4: two top-level roots can hold keyvault dirs — `infrastructure/` (per-app layout)
// and `azureDatabricks/` (synthetic appName='azureDatabricks' per env, no app segment). Anything
// outside this table is ignored. Spec §FR-003(b), §4 row 1.
const VAULT_ROOTS = ['infrastructure', 'azureDatabricks'];

// FR-003 Round 4: grouping directories that organise sub-apps under one app but are themselves
// neither an environment nor a vault. Spec §FR-003(c), §4 row 2. Curated allow-list (not
// auto-learned): `keyvaults` (plural, ayaCoreServices), `_idmapplications` (idm sub-apps).
const GROUPING_DIR_SKIP_LIST = new Set(['keyvaults', '_idmapplications']);
const QUALIFIER_GROUPING_DIRS = new Set(['_idmapplications']);
const QUALIFIER_BEFORE_GROUPING_DIRS = new Set(['keyvaults']);

// Segment name used by Terragrunt include-only directories (e.g. itg/_common/keyvault.hcl) that
// are never themselves a selectable vault. NOT an env-agnostic "matches any environment" marker —
// a literal `shared` segment (e.g. ayaApplications/ayaCoreServices/keyvaults/shared) is a real,
// distinct sibling environment alongside dev/prod/sand and must only match when requested.
const SHARED_SEGMENT_RE = /(^_?common$|^shared$)/i;

// FR-003 Round 4: validate optional qualifier (sub-app path segment) — single-segment, alphanumeric
// with hyphens/underscores, ≤ 64 chars. Mirrors the route validator.
const QUALIFIER_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// Cache is keyed by `target` ALONE (repo-level, not per app/env tuple) and stores the in-flight
// Promise itself (not the resolved value) so concurrent requests for the same target share one
// GitHub call (stampede protection). A rejected promise is evicted so the next call retries.
const CACHE_TTL_MS = 5 * 60 * 1000;
const treeCache = new Map(); // target -> { promise, expiresAt }

function getCachedTree(target, repo) {
  const now = Date.now();
  const cached = treeCache.get(target);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = githubService.getRepoTree(repo);
  treeCache.set(target, { promise, expiresAt: now + CACHE_TTL_MS });
  promise.catch(() => treeCache.delete(target));
  return promise;
}

// FR-003 Round 4: resolve a single tree entry against the root table + grouping-dir skip-list
// + shared heuristic + qualifier. Returns { vaultDir, qualifier } or null if the entry is not
// a vault under one of the two recognised roots for the requested appName/environment.
//
// Root shapes (spec §FR-003(b), §4 row 1):
//   infrastructure/<appName>[/<qualifier>...]/<environment>[/<groupingDir>]/keyvault[N]
//   azureDatabricks/<environment>/keyvault        (synthetic appName='azureDatabricks')
//
// `qualifier` (optional, Option A — single-segment sub-app identifier, spec §4 row 4) filters
// sub-apps under a grouping dir (e.g. idm/_idmapplications/notif/dev/keyvault → qualifier=notif).
// When `qualifier` is omitted but the entry resolves to one or more sub-app qualifiers, the
// caller gets `qualifiers` back so the UI can prompt the user to disambiguate.
function classifyVaultEntry(parts, appName, environment, qualifier) {
  const root = parts[0];
  if (!VAULT_ROOTS.includes(root)) return null;

  // azureDatabricks root: azureDatabricks/<env>/keyvault — appName is synthetic, no app segment.
  if (root === 'azureDatabricks') {
    if (appName !== 'azureDatabricks') return null;
    // Expect exactly [azureDatabricks, <env>, keyvault]
    if (parts.length !== 3) return null;
    if (parts[1] !== environment) return null;
    return { appName: 'azureDatabricks', qualifier: null};
  }

  // infrastructure root: infrastructure/<appName>[...]/keyvault[N]
  if (parts.length < 3) return null;
  if (parts[1] !== appName) return null;

  // Segments between appName (parts[1]) and the vault dir/file (parts[parts.length-1]).
  const middle = parts.slice(2, parts.length - 1);
  // `app/keyvaults/...` is only a grouping path. A nested application is represented by the
  // segment immediately before `keyvaults` (for example, `app/nestedApp/keyvaults/...`).
  if (middle[0] === 'keyvaults') return null;
  // Filter out grouping dirs (skip-list) so they don't masquerade as environment/qualifier.
  const realSegs = middle.filter(s => !GROUPING_DIR_SKIP_LIST.has(s));

  // Env-agnostic only when there is no environment segment at all (e.g. infrastructure/idm/keyvault).
  // A named `shared`/`common` segment is treated as a literal environment name, not a wildcard —
  // see SHARED_SEGMENT_RE comment above.
  const isShared = middle.length === 0;

  // Determine the qualifier — the sub-app segment immediately after a grouping dir, if any.
  // For idm/_idmapplications/notif/dev/keyvault: middle = [_idmapplications, notif, dev],
  // realSegs = [notif, dev] (grouping dir stripped). The qualifier is notif; env is dev.
  let entryQualifier = null;
  for (let i = 0; i < middle.length; i++) {
    if (QUALIFIER_GROUPING_DIRS.has(middle[i]) && middle[i + 1]) {
      entryQualifier = middle[i + 1];
      break;
    }
    if (QUALIFIER_BEFORE_GROUPING_DIRS.has(middle[i]) && middle[i - 1]) {
      entryQualifier = middle[i - 1];
      break;
    }
  }

  // If the caller supplied a qualifier, it must match (or both must be null for non-sub-app paths).
  if (qualifier) {
    if (entryQualifier !== qualifier) return null;
  }

  // Filter on environment: a real (non-qualifier) segment must equal the requested environment,
  // unless there is no environment segment at all (isShared, matches any environment).
  const envSegs = realSegs.filter(s => s !== entryQualifier);
  if (!isShared && !envSegs.includes(environment)) return null;

  return { appName, qualifier: entryQualifier };
}

function matchVaultsFromEntries(entries, appName, environment, qualifier) {
  const vaults = [];
  const qualifierSet = new Set();

  for (const entry of entries) {
    const parts = entry.path.split('/');
    const last = parts[parts.length - 1];

    let vaultDir = null;
    if (entry.type === 'tree' && VAULT_DIR_RE.test(last)) {
      vaultDir = entry.path;
    } else if (entry.type === 'blob' && VAULT_FILE_RE.test(last)) {
      vaultDir = parts.slice(0, -1).join('/');
    } else {
      continue;
    }

    // Shared keyvault.hcl files are Terragrunt include configs, not selectable vaults. The
    // environment-specific keyvault directory includes this file (for example itg/dev/keyvault).
    if (entry.type === 'blob' && SHARED_SEGMENT_RE.test(parts[parts.length - 2] || '')) continue;

    const classified = classifyVaultEntry(parts, appName, environment, qualifier);
    if (!classified) {
      // Even when the entry doesn't match the requested qualifier, collect the qualifier so the
      // caller can surface a disambiguation prompt (FR-004: sub-app selector).
      if (qualifier === undefined) {
        const probe = classifyVaultEntry(parts, appName, environment, undefined);
        if (probe && probe.qualifier) qualifierSet.add(probe.qualifier);
      }
      continue;
    }

    if (classified.qualifier) qualifierSet.add(classified.qualifier);

    if (!vaults.some(v => v.vaultDir === vaultDir)) {
      const vault = { vaultDir, vaultName: null, resourceGroup: null };
      if (classified.qualifier) vault.qualifier = classified.qualifier;
      vaults.push(vault);
    }
  }

  return { vaults, qualifiers: Array.from(qualifierSet).sort() };
}

function deriveQualifier(middle) {
  for (let i = 0; i < middle.length; i++) {
    if (QUALIFIER_GROUPING_DIRS.has(middle[i]) && middle[i + 1]) return middle[i + 1];
    if (QUALIFIER_BEFORE_GROUPING_DIRS.has(middle[i]) && middle[i - 1]) return middle[i - 1];
  }
  return null;
}

// FR-003(e) Round 4: truncated-tree fallback — bounded, per-app directory walk. Now also seeds
// the `azureDatabricks` root when the synthetic appName is requested (no new githubService
// method; reuses githubService.octokit directly, same convention as hclParser.js).
async function fallbackListForApp(repo, appName, correlationId) {
  const octokit = githubService.octokit;
  const [owner, repoName] = repo.split('/');
  const entries = [];
  const queue = appName === 'azureDatabricks'
    ? ['azureDatabricks']
    : [`infrastructure/${appName}`];
  let guard = 0;

  while (queue.length && guard < 500) {
    guard++;
    const dirPath = queue.shift();
    let items;
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo: repoName, path: dirPath });
      items = Array.isArray(data) ? data : [data];
    } catch (error) {
      if (error.status === 404) continue;
      throw error;
    }
    for (const item of items) {
      entries.push({ path: item.path, type: item.type === 'dir' ? 'tree' : 'blob' });
      if (item.type === 'dir') queue.push(item.path);
    }
  }

  logger.warn(`[${correlationId}] secretsService: tree truncated for ${repo}; used per-directory fallback for appName=${appName}`);
  return entries;
}

/**
 * Tree-fetch + path-matching only (no override/terragrunt name resolution) — shared by
 * resolveKeyVaults() and, for secrets-environment-bundles, resolveBundleEnvironments(). Never
 * throws; returns `{ found: false, vaults: [], qualifiers: [] }` on any discovery failure
 * (FR-003(g)). Each returned vault has `vaultDir`/`qualifier` populated but `vaultName`/
 * `resourceGroup` left `null` — callers that need the human-readable name must additionally run
 * the vault through `resolveVaultNameWithFallback()` (see resolveKeyVaults()).
 */
async function resolveVaultCandidates(appName, environment, target, correlationId, qualifier) {
  const repo = mapRepo(target);
  if (!repo) {
    logger.warn(`[${correlationId}] resolveVaultCandidates: unconfigured target=${target}`);
    return { found: false, vaults: [], qualifiers: [] };
  }

  let entries;
  try {
    const treeResult = await getCachedTree(target, repo);
    entries = treeResult.truncated
      ? await fallbackListForApp(repo, appName, correlationId)
      : treeResult.tree;
  } catch (error) {
    logger.error(`[${correlationId}] resolveVaultCandidates: tree fetch failed for ${repo}: ${error.message}`);
    return { found: false, vaults: [], qualifiers: [] };
  }

  const { vaults, qualifiers } = matchVaultsFromEntries(entries, appName, environment, qualifier);
  return { found: vaults.length > 0, vaults, qualifiers };
}

/**
 * Resolves the Key Vault(s) backing an app/environment. Never throws; returns
 * `{ found: false, vaults: [], qualifiers: [] }` on any discovery failure (FR-003(g)).
 *
 * FR-003 Round 4: `qualifier` is an optional single-segment sub-app identifier. When omitted and
 * the vault path has one or more sub-app qualifiers, `qualifiers` is populated so the caller can
 * prompt the user to disambiguate (FR-004). When supplied, only vaults matching that qualifier
 * are returned.
 */
async function resolveKeyVaults(appName, environment, target, correlationId, qualifier) {
  const { found, vaults, qualifiers } = await resolveVaultCandidates(appName, environment, target, correlationId, qualifier);
  if (!found) return { found, vaults, qualifiers };

  const overrides = await loadVaultOverrides(correlationId);

  for (const vault of vaults) {
    const result = await resolveVaultNameWithFallback(vault, overrides, undefined, target, correlationId);
    vault.vaultName = result.name;
    vault.resourceGroup = result.resourceGroup;
    try {
      logger.debug(`[${correlationId}] resolveKeyVaults: vaultDir=${vault.vaultDir} source=${result.source}`);
    } catch (error) {
      // Logging must never interrupt resolution.
    }
  }

  return { found: vaults.length > 0, vaults, qualifiers };
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-001: discoverAppsForTarget — platform-filtered app list for the Secrets page.
// Own per-target cache (not a reuse of treeCache/getInstalledApps, neither of which caches
// discovery results today).
// ─────────────────────────────────────────────────────────────────────────────

const DISCOVER_CACHE_TTL_MS = 5 * 60 * 1000;
const discoverCache = new Map(); // target -> { promise, expiresAt }

function getDiscoverCache(target, fetchFn) {
  const now = Date.now();
  const cached = discoverCache.get(target);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchFn();
  discoverCache.set(target, { promise, expiresAt: now + DISCOVER_CACHE_TTL_MS });
  promise.catch(() => discoverCache.delete(target));
  return promise;
}

// FR-003 Round 4: enumerate every unique {name, environment, qualifier?} pair under the two
// recognised roots, skipping grouping dirs (they organise sub-apps but are not an app/env).
// azureDatabricks/<env>/keyvault emits a synthetic {name:'azureDatabricks', environment} entry.
// Sub-apps under a grouping dir (e.g. idm/_idmapplications/notif/dev/keyvault) emit
// {name:'idm', environment:'dev', qualifier:'notif'} so the UI can render a sub-app selector.
function extractAppEnvPairs(entries) {
  const seen = new Map();
  for (const entry of entries) {
    const parts = entry.path.split('/');
    const root = parts[0];

    // azureDatabricks root: azureDatabricks/<env>/keyvault — synthetic per-env entries.
    if (root === 'azureDatabricks') {
      // Expect azureDatabricks/<env>/keyvault(+ optional numeric suffix)
      if (parts.length < 3 || !VAULT_DIR_RE.test(parts[parts.length - 1])) continue;
      const environment = parts[1];
      const key = `azureDatabricks::${environment}`;
      if (!seen.has(key)) seen.set(key, { name: 'azureDatabricks', environment });
      continue;
    }

    // infrastructure root: infrastructure/<appName>[/<qualifier>/...]/<environment>/keyvault[N]
    if (root !== 'infrastructure' || parts.length < 3) continue;

    const appName = parts[1];
    const middle = parts.slice(2, parts.length - 1);
    const last = parts[parts.length - 1];

    if (entry.type === 'blob' && VAULT_FILE_RE.test(last) && SHARED_SEGMENT_RE.test(middle[middle.length - 1] || '')) continue;

    if (middle[0] === 'keyvaults') continue;

    // Skip non-leaf entries — only emit app/env pairs when a real vault dir/file exists.
    // Apps without keyvault/** or equivalent should not appear in the dropdown (Bug 1 fix).
    if (!VAULT_DIR_RE.test(last) && !VAULT_FILE_RE.test(last)) {
      continue;
    }

    // If there's a grouping dir in the middle, the segment after it is the qualifier, and the
    // remaining non-grouping segment(s) include the environment.
    const qualifier = deriveQualifier(middle);
    let environment = null;
    const realSegs = middle.filter(s => !GROUPING_DIR_SKIP_LIST.has(s));

    // Environment is the last non-grouping segment that isn't the qualifier, or a shared segment.
    const envCandidates = realSegs.filter(s => s !== qualifier);
    environment = envCandidates.length > 0 ? envCandidates[envCandidates.length - 1] : null;

    if (!environment) continue;

    const key = `${appName}::${qualifier || ''}::${environment}`;
    const record = { name: appName, environment };
    if (qualifier) record.qualifier = qualifier;
    if (!seen.has(key)) seen.set(key, record);
  }
  return Array.from(seen.values());
}

// FR-001 truncated-tree mitigation: paginated non-recursive directory listing to recover
// top-level app names + their environment subdirectories from both `infrastructure/` and
// `azureDatabricks/` roots when the full tree fetch is truncated (FR-003 Round 4: dual root).
async function fallbackListInfrastructureDirs(repo, correlationId) {
  const octokit = githubService.octokit;
  const [owner, repoName] = repo.split('/');
  const entries = [];

  for (const root of VAULT_ROOTS) {
    let topLevel;
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo: repoName, path: root });
      topLevel = (Array.isArray(data) ? data : []).filter(item => item.type === 'dir');
    } catch (error) {
      logger.warn(`[${correlationId}] discoverAppsForTarget: fallback listing of ${root} failed: ${error.message}`);
      continue;
    }

    if (root === 'azureDatabricks') {
      // azureDatabricks/<env>/keyvault — environment dirs are directly under the root.
      for (const envDir of topLevel) {
        entries.push({ path: `${root}/${envDir.name}/keyvault`, type: 'tree' });
      }
      continue;
    }

    // infrastructure/<appName>/... — drill into each app directory for its environment subdirs.
    for (const app of topLevel) {
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo: repoName, path: app.path });
        for (const envItem of (Array.isArray(data) ? data : []).filter(item => item.type === 'dir')) {
          if (GROUPING_DIR_SKIP_LIST.has(envItem.name)) {
            // Recurse one level deeper for grouping dirs to find sub-apps
            try {
              const { data: subData } = await octokit.rest.repos.getContent({ owner, repo: repoName, path: envItem.path });
              for (const subApp of (Array.isArray(subData) ? subData : []).filter(item => item.type === 'dir')) {
                entries.push({ path: `${app.path}/${envItem.name}/${subApp.name}/_discovered`, type: 'blob' });
              }
            } catch (e) { /* skip */ }
          } else {
            entries.push({ path: `${app.path}/${envItem.name}/_discovered`, type: 'blob' });
          }
        }
      } catch (error) {
        // ponytail: skip an app whose directory listing fails rather than aborting all discovery
        continue;
      }
    }
  }

  logger.warn(`[${correlationId}] discoverAppsForTarget: tree truncated for ${repo}; used non-recursive fallback listing`);
  return entries;
}

async function discoverAppsForTargetRaw(target, correlationId) {
  if (target === 'sand') {
    return getDiscoverCache(target, async () => {
      const apps = await infrastructureService.getInstalledApps();
      return apps.map(app => ({ name: app.projectName, environment: app.environment }));
    });
  }

  if (target === 'live') {
    const repo = mapRepo(target);
    return getDiscoverCache(target, async () => {
      let entries;
      try {
        const treeResult = await getCachedTree(target, repo);
        entries = treeResult.truncated
          ? await fallbackListInfrastructureDirs(repo, correlationId)
          : treeResult.tree;
      } catch (error) {
        logger.error(`[${correlationId}] discoverAppsForTarget: tree fetch failed for ${repo}: ${error.message}`);
        return [];
      }
      return extractAppEnvPairs(entries);
    });
  }

  return [];
}

// FR-001 (secrets-environment-scope): classify an environment folder name against the curated
// data/environmentTiers.json groups. Read synchronously at call time (small file, same convention
// as the data/environments.json allow-list read in routes/api.js) so Platform Engineering edits
// take effect without a discoverCache eviction. Never throws — a missing/malformed config file is
// treated as no classifications available, per FR-001(b)'s safe-default.
function classifyEnvironmentTier(environment) {
  let groups;
  try {
    groups = JSON.parse(require('fs').readFileSync(nodePath.join(__dirname, '../data/environmentTiers.json'), 'utf8'));
  } catch (error) {
    return 'unclassified';
  }
  const env = String(environment).toLowerCase();
  if ((groups.production || []).some(name => String(name).toLowerCase() === env)) return 'production';
  if ((groups.nonProduction || []).some(name => String(name).toLowerCase() === env)) return 'non-production';
  // Names in the 'other' group and names absent from every group both fall through here —
  // 'other' is curated documentation only, not a distinct tier value (FR-001(a)/(b)).
  return 'unclassified';
}

// secrets-environment-bundles §2.3 (Round 1 Advisory A5): `bundleConfig` is the already-loaded
// `{ config }` value from loadSecretBundles(), threaded down by the caller (once per request) —
// discoverAppsForTarget() itself performs zero additional file reads for bundle classification.
// Omitted/undefined (legacy callers) resolves to bundleId: null for every entry, never throws.
async function discoverAppsForTarget(target, correlationId, bundleConfig) {
  const apps = await discoverAppsForTargetRaw(target, correlationId);
  return apps.map(app => ({
    ...app,
    tier: classifyEnvironmentTier(app.environment),
    bundleId: classifyBundleMembership(app.environment, bundleConfig)
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// secrets-environment-bundles: data/secretBundles.json loader + bundle-membership logic.
// See docs/architecture/secrets-environment-bundles-spec.md §2.3-§2.6.
// ─────────────────────────────────────────────────────────────────────────────

const BUNDLES_CONFIG_PATH = nodePath.join(__dirname, '../data/secretBundles.json');

// Survives across calls within one process; reset only by restart/test (_internal accessor).
let lastKnownGoodBundleConfig = null;

// Checks: bundles is a non-empty array; every bundle has string id/displayName, numeric order,
// boolean releaseControlled, and a non-empty environments: string[]; id is unique
// case-insensitively; no environment (case-insensitive) appears in more than one bundle's
// environments[]. Returns null when valid, else a short description of the first violation.
function validateBundleConfigShape(candidate) {
  if (!candidate || !Array.isArray(candidate.bundles) || candidate.bundles.length === 0) {
    return 'bundles must be a non-empty array';
  }
  const seenIds = new Set();
  const seenEnvironments = new Set();
  for (const bundle of candidate.bundles) {
    if (!bundle || typeof bundle.id !== 'string' || !bundle.id) return 'bundle id must be a non-empty string';
    if (typeof bundle.displayName !== 'string' || !bundle.displayName) return `bundle "${bundle.id}" displayName must be a non-empty string`;
    if (typeof bundle.order !== 'number') return `bundle "${bundle.id}" order must be numeric`;
    if (typeof bundle.releaseControlled !== 'boolean') return `bundle "${bundle.id}" releaseControlled must be boolean`;
    if (!Array.isArray(bundle.environments) || bundle.environments.length === 0) return `bundle "${bundle.id}" environments must be a non-empty array`;

    const idKey = bundle.id.toLowerCase();
    if (seenIds.has(idKey)) return `duplicate bundle id (case-insensitive): ${bundle.id}`;
    seenIds.add(idKey);

    for (const env of bundle.environments) {
      const envKey = String(env).toLowerCase();
      if (seenEnvironments.has(envKey)) return `environment "${env}" appears in more than one bundle`;
      seenEnvironments.add(envKey);
    }
  }
  return null;
}

// Broken out so tests can monkey-patch the read via module.exports._internal (same convention
// as encryptValueWithSops) instead of mutating the global 'fs' module.
function readBundleConfigFile() {
  return require('fs').readFileSync(BUNDLES_CONFIG_PATH, 'utf8');
}

// Per-call-synchronous-read (mirrors classifyEnvironmentTier()'s convention so a config edit
// takes effect without a cache eviction), but fails closed with a last-known-good fallback
// instead of a silent documentation-only degrade — bundle-mode submission is a governance
// boundary (§2.3). Callers must invoke this at most once per HTTP request and thread the
// returned `{ config, source }` down as a plain argument (never a new TTL cache).
function loadSecretBundles(correlationId) {
  let candidate;
  try {
    candidate = JSON.parse(module.exports._internal.readBundleConfigFile());
  } catch (error) {
    logger.error(`[${correlationId}] loadSecretBundles: parse failure: ${error.message}`);
    return fallback();
  }
  const validationError = validateBundleConfigShape(candidate);
  if (validationError) {
    logger.error(`[${correlationId}] loadSecretBundles: invalid config: ${validationError}`);
    return fallback();
  }
  lastKnownGoodBundleConfig = candidate;
  return { config: candidate, source: 'fresh' };

  function fallback() {
    if (lastKnownGoodBundleConfig) {
      logger.warn(`[${correlationId}] loadSecretBundles: serving last-known-good bundle configuration`);
      return { config: lastKnownGoodBundleConfig, source: 'stale' };
    }
    return { config: null, source: 'unavailable' };
  }
}

// Pure, synchronous — takes the already-loaded bundleConfig (the `config` field from
// loadSecretBundles()). Returns the matching bundle id (case-insensitive) or null, including
// when bundleConfig === null. No file I/O of its own.
function classifyBundleMembership(environment, bundleConfig) {
  if (!bundleConfig) return null;
  const env = String(environment).toLowerCase();
  const bundle = bundleConfig.bundles.find(b => b.environments.some(e => String(e).toLowerCase() === env));
  return bundle ? bundle.id : null;
}

// Pure function over the same preloaded bundleConfig; [] whenever config is unavailable.
function getBundleCatalog(bundleConfig) {
  if (!bundleConfig) return [];
  return bundleConfig.bundles
    .map(b => ({ id: b.id, displayName: b.displayName, order: b.order, releaseControlled: b.releaseControlled }))
    .sort((a, b) => a.order - b.order);
}

// Single call per POST request (its own one-time loadSecretBundles() call, unaffected by the
// request-scoped-loading rule above since it was never a per-entry call). Throws
// BUNDLE_CONFIG_UNAVAILABLE, BUNDLE_UNKNOWN, or ENVIRONMENT_NOT_IN_BUNDLE; else returns the
// matched bundle object. FR-003 — bundle membership is always server-derived, never trusted
// from client-supplied claims (NFR-SEC-002).
function validateBundleMembership(bundleId, environments, correlationId) {
  const { config: bundleConfig } = loadSecretBundles(correlationId);
  if (!bundleConfig) {
    const err = new Error('Bundle configuration is temporarily unavailable');
    err.code = 'BUNDLE_CONFIG_UNAVAILABLE';
    throw err;
  }
  const bundle = bundleConfig.bundles.find(b => b.id.toLowerCase() === String(bundleId).toLowerCase());
  if (!bundle) {
    const err = new Error(`Unknown secret bundle: ${bundleId}`);
    err.code = 'BUNDLE_UNKNOWN';
    throw err;
  }
  const memberSet = new Set(bundle.environments.map(e => String(e).toLowerCase()));
  const invalid = (environments || []).filter(env => !memberSet.has(String(env).toLowerCase()));
  if (invalid.length > 0) {
    const err = new Error(`Environment(s) not part of bundle "${bundle.id}": ${invalid.join(', ')}`);
    err.code = 'ENVIRONMENT_NOT_IN_BUNDLE';
    err.environments = invalid;
    throw err;
  }
  return bundle;
}

// secrets-environment-bundles §2.5 pseudocode, transcribed. Iterates the bundle's FULL declared
// environments list (not just submitted ones) so the server knows the true currently-eligible set
// independent of what the client happened to submit (FR-005(a.2)). Throws INCOMPLETE_BUNDLE when a
// currently-eligible (unambiguous) environment has no submitted entry / empty secrets[].
async function resolveBundleEnvironments(bundle, environmentSecretsByEnv, target, appName, correlationId) {
  const included = [];
  const excluded = [];
  for (const env of bundle.environments) {
    const submitted = environmentSecretsByEnv[env.toLowerCase()];
    // Deliberately never forward the submitted qualifier here: resolveVaultCandidates() filters
    // vaults BY qualifier when one is passed, which would collapse "not deployed at all" and
    // "deployed, but this qualifier doesn't match" into the same found:false/vaults:[] result.
    // Fetch the full (unfiltered) vault/qualifier set once, then apply qualifier disambiguation
    // ourselves so the two cases map to distinct exclusion reasons (NOT_DEPLOYED vs
    // QUALIFIER_MISMATCH). Uses the lighter resolveVaultCandidates() (not resolveKeyVaults()):
    // only vaultDir/qualifier are needed to build the write path, so the override-sidecar +
    // per-vault Terragrunt name/resourceGroup resolution that resolveKeyVaults() performs for
    // display purposes would be pure unused GitHub API overhead here.
    const { found, vaults, qualifiers } = await resolveVaultCandidates(appName, env, target, correlationId);
    if (!found) continue; // NOT_DEPLOYED — silently absent (FR-002(c)/FR-004(b))

    let candidateVaults = vaults;
    // A submitted vaultDir disambiguates just as precisely as a qualifier — it names one exact
    // vault from the full candidate set matched below, so it also bypasses this gate.
    if (qualifiers.length > 1 && !(submitted && (submitted.qualifier || submitted.vaultDir))) {
      excluded.push({ environment: env, reason: 'QUALIFIER_AMBIGUOUS', qualifiers });
      continue;
    }
    if (submitted && submitted.qualifier) {
      candidateVaults = vaults.filter(v => v.qualifier === submitted.qualifier);
      if (candidateVaults.length === 0) {
        excluded.push({ environment: env, reason: 'QUALIFIER_MISMATCH', qualifiers });
        continue;
      }
    }

    let selectedVault;
    if (submitted && submitted.vaultDir) {
      selectedVault = candidateVaults.find(v => v.vaultDir === submitted.vaultDir) || null;
    } else {
      selectedVault = candidateVaults.length === 1 ? candidateVaults[0] : null;
    }
    if (!selectedVault) {
      excluded.push({ environment: env, reason: submitted && submitted.vaultDir ? 'VAULT_INVALID' : 'VAULT_AMBIGUOUS', vaults: candidateVaults });
      continue;
    }

    // env is now "currently eligible" per FR-004(a).
    if (!submitted || !Array.isArray(submitted.secrets) || submitted.secrets.length === 0) {
      logger.warn(`[${correlationId}] resolveBundleEnvironments: currently-eligible environment omitted from bundle submission: ${env}`);
      const err = new Error(`Bundle submission is missing eligible environment: ${env}`);
      err.code = 'INCOMPLETE_BUNDLE';
      err.environment = env;
      throw err;
    }
    included.push({ environment: env, vault: selectedVault, qualifier: submitted.qualifier, secrets: submitted.secrets });
  }
  return { included, excluded };
}

// secrets-environment-bundles §2.6 (FR-005(g), NFR-REL-002). Extends the existing
// bulkBranchHash() precedent (lowercase-before-sort, sha256, first 8 hex) across the whole
// bundle's structural shape, excluding secret values.
function computeBundleContentHash({ target, appName, bundleId, included }) {
  const canonicalEnvs = included
    .map(e => ({
      environment: e.environment.toLowerCase(),
      vaultDir: (e.vault.vaultDir || '').toLowerCase(),
      qualifier: (e.qualifier || '').toLowerCase(),
      secretNames: e.secrets.map(s => s.secretName.toLowerCase()).sort()
    }))
    .sort((a, b) => a.environment.localeCompare(b.environment));
  const canonical = JSON.stringify({ target, appName: appName.toLowerCase(), bundleId: bundleId.toLowerCase(), environments: canonicalEnvs });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 8);
}

const BUNDLE_ENCRYPTION_CONCURRENCY_LIMIT = 10;

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * secrets-environment-bundles §2.4/§2.5 — atomic single-commit/single-PR bundle submission via
 * the Git Data API. Throws typed errors (`error.code`) for the route to map to HTTP responses:
 * BUNDLE_CONFIG_UNAVAILABLE | BUNDLE_UNKNOWN | ENVIRONMENT_NOT_IN_BUNDLE | INCOMPLETE_BUNDLE |
 * NO_ELIGIBLE_ENVIRONMENTS | PR_EXISTS | ENCRYPTION_FAILED | SOPS_NOT_CONFIGURED | CONFLICT.
 * A PR-creation failure after a successful commit does NOT throw — it resolves to
 * `{ success: false, errorCode: 'PR_CREATION_FAILED', branchName, commitSha, error }` so the
 * caller can surface the partial-artifact state (FR-005(f)) without treating it as a generic
 * unhandled error.
 */
async function submitSecretBundleViaGitOps({ target, appName, bundleId, environmentSecrets, jiraTicket, userEmail, correlationId }) {
  const repo = mapRepo(target);
  if (!repo) {
    const err = new Error('Unconfigured target repository');
    err.code = 'FOUND_FALSE';
    throw err;
  }

  const bundle = validateBundleMembership(bundleId, environmentSecrets.map(e => e.environment), correlationId);
  const tag = `[${correlationId}][bundle:${bundle.id}]`;
  logger.info(`${tag} membership validated: bundle=${bundle.id}, releaseControlled=${bundle.releaseControlled}`);

  const environmentSecretsByEnv = {};
  for (const entry of environmentSecrets) {
    environmentSecretsByEnv[entry.environment.toLowerCase()] = entry;
  }

  const { included, excluded } = await resolveBundleEnvironments(bundle, environmentSecretsByEnv, target, appName, correlationId);
  logger.info(`${tag} resolution complete: included=[${included.map(e => e.environment).join(',')}], excluded=[${excluded.map(e => e.environment).join(',')}]`);

  if (included.length === 0) {
    const err = new Error('No eligible environments remain for this bundle submission');
    err.code = 'NO_ELIGIBLE_ENVIRONMENTS';
    throw err;
  }

  const bundleContentHash = computeBundleContentHash({ target, appName, bundleId: bundle.id, included });
  const branchName = `secrets/${appName}-${bundle.id}-${bundleContentHash}`;

  const existingPr = await githubService.findOpenPullRequest(repo, branchName);
  if (existingPr) {
    const err = new Error('A pull request for this bundle is already open');
    err.code = 'PR_EXISTS';
    err.prUrl = existingPr.html_url;
    throw err;
  }

  const defaultBranch = await getDefaultBranch(repo);
  const filePathByEnv = new Map(included.map(e => [e.environment, `${e.vault.vaultDir}/secrets.enc.yaml`]));

  // Pre-encryption SHA capture (FR-002(k) precedent, extended to N environments).
  const preFiles = await Promise.all(
    included.map(e => githubService.getFileContent(repo, filePathByEnv.get(e.environment), defaultBranch, correlationId))
  );
  const preShaByPath = new Map();
  const preContentByPath = new Map();
  included.forEach((e, i) => {
    const path = filePathByEnv.get(e.environment);
    preShaByPath.set(path, preFiles[i] ? preFiles[i].sha : null);
    preContentByPath.set(path, preFiles[i] ? preFiles[i].content : '');
  });

  // Encryption: chunked concurrency (§2.8) — bounded-concurrency Promise.allSettled, sequential
  // across chunks so a failure in chunk N stops chunk N+1 from starting. Abort-all on first
  // failure; zero writes have occurred by this point.
  const allPairs = [];
  for (const e of included) {
    for (const s of e.secrets) allPairs.push({ environment: e.environment, secretName: s.secretName, secretValue: s.secretValue });
  }
  const encryptedByEnvAndName = new Map(); // `${environment}::${secretName}` -> encrypted blob
  for (const batch of chunk(allPairs, BUNDLE_ENCRYPTION_CONCURRENCY_LIMIT)) {
    const settled = await Promise.allSettled(
      batch.map(pair => module.exports._internal.encryptValueWithSops(pair.secretValue, {
        correlationId, target, appName, environment: pair.environment, bundleId
      }))
    );
    const failures = [];
    settled.forEach((result, i) => {
      if (result.status === 'rejected') {
        failures.push({ environment: batch[i].environment, secretName: batch[i].secretName, error: result.reason });
      } else {
        encryptedByEnvAndName.set(`${batch[i].environment}::${batch[i].secretName}`, result.value);
      }
    });
    if (failures.length > 0) {
      const sopsNotConfigured = failures.find(f => f.error && f.error.code === 'SOPS_NOT_CONFIGURED');
      if (sopsNotConfigured) throw sopsNotConfigured.error;
      const err = new Error(`Encryption failed for ${failures.length} secret(s)`);
      err.code = 'ENCRYPTION_FAILED';
      err.failures = failures.map(f => ({ environment: f.environment, secretName: f.secretName }));
      throw err;
    }
  }
  const totalSecretCount = allPairs.length;
  logger.info(`${tag} encryption complete: ${totalSecretCount} secret(s) across ${included.length} environment(s)`);

  // Post-encryption re-check (pre-write conflict, §2.5): the last read this caller controls
  // before handing off to createMultiFileCommit()'s own write-time CAS re-read.
  const currentFiles = await Promise.all(
    included.map(e => githubService.getFileContent(repo, filePathByEnv.get(e.environment), defaultBranch, correlationId))
  );
  const expectedFileShas = {};
  const files = [];
  included.forEach((e, i) => {
    const path = filePathByEnv.get(e.environment);
    const currentSha = currentFiles[i] ? currentFiles[i].sha : null;
    if (currentSha !== preShaByPath.get(path)) {
      logger.warn(`${tag} pre-write SHA conflict detected for ${e.environment}`);
      const err = new Error(`The target file changed since this submission started: ${e.environment}`);
      err.code = 'CONFLICT';
      throw err;
    }
    let newContent = currentFiles[i] ? currentFiles[i].content : '';
    for (const secret of e.secrets) {
      newContent = upsertSecretBlock(newContent, secret.secretName, encryptedByEnvAndName.get(`${e.environment}::${secret.secretName}`));
    }
    files.push({ path, content: newContent });
    expectedFileShas[path] = currentSha;
  });

  const commitMessage = `chore(secrets): bundle update for ${appName} (${bundle.id}) [${jiraTicket}]`;
  const { commitSha } = await githubService.createMultiFileCommit(repo, {
    branchName,
    baseBranch: defaultBranch,
    files,
    expectedFileShas,
    commitMessage,
    correlationId
  });
  logger.info(`${tag} commit created: ${commitSha} on ${branchName}`);

  const prTitle = `${bundle.releaseControlled ? '[RELEASE] ' : ''}Secrets bundle: ${bundle.displayName} (${appName}) [${jiraTicket}]`;
  const distinctSecretNames = new Set(allPairs.map(p => p.secretName.toLowerCase()));
  const prBody = [
    `**Target**: ${target}`,
    `**App**: ${appName}`,
    `**Bundle**: ${bundle.displayName} (${bundle.id})`,
    `**Included environments**: ${included.map(e => e.environment).join(', ')}`,
    ...(excluded.length > 0 ? [`**Excluded environments**: ${excluded.map(e => `${e.environment} (${e.reason})`).join(', ')}`] : []),
    ...(bundle.releaseControlled ? ['**Release-controlled**: yes — this bundle requires PR review per CODEOWNERS/branch-protection policy.'] : []),
    `**Jira**: ${jiraTicket}`,
    `**Secret names**: ${[...distinctSecretNames].join(', ')}`,
    `**Submitted by**: ${userEmail}`,
    `**Correlation ID**: ${correlationId}`
  ].join('\n');

  let pr;
  try {
    pr = await githubService.createPullRequest(repo, defaultBranch, branchName, prTitle, prBody, correlationId);
  } catch (error) {
    logger.error(`${tag} PR creation failed after successful commit ${commitSha}: ${error.message}`);
    return {
      success: false,
      errorCode: 'PR_CREATION_FAILED',
      branchName,
      commitSha,
      error: `Commit created but PR creation failed: ${error.message}`
    };
  }
  logger.info(`${tag} PR created: ${pr.prUrl}`);

  return {
    success: true,
    bundleId: bundle.id,
    releaseControlled: bundle.releaseControlled,
    prNumber: pr.prNumber,
    prUrl: pr.prUrl,
    includedEnvironments: included.map(e => e.environment),
    excludedEnvironments: excluded,
    secretCount: distinctSecretNames.size,
    branchName,
    commitSha
  };
}

// OQ-002: deterministic bulk branch hash — lowercase then sort, comma-join, sha256, first 8 hex.
// Lowercasing BEFORE sort is required: JS sort is case-sensitive (code-unit order), so sorting
// mixed-case names first would put 'B' before 'a' and produce a different order than the
// case-insensitive logical set, breaking the determinism contract for inputs like
// ['Api-Token','api-token'] vs ['api-token','API-TOKEN'].
function bulkBranchHash(secrets) {
  const sortedNames = secrets.map(s => s.secretName.toLowerCase()).sort();
  return crypto.createHash('sha256').update(sortedNames.join(',')).digest('hex').slice(0, 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-001: secrets.enc.yaml — key-name parsing only (values are never decrypted server-side)
// ─────────────────────────────────────────────────────────────────────────────

// Top-level keys are un-indented `name: |` lines; indented lines are opaque blob body.
function parseSecretNames(content) {
  const names = [];
  const keyRe = /^([A-Za-z0-9_-]{1,127}):/;
  for (const line of (content || '').split('\n')) {
    if (/^\s/.test(line)) continue;
    const m = keyRe.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

async function getSecretsList(target, appName, environment, vaultDirFilter, correlationId, qualifier) {
  const repo = mapRepo(target);
  const { found, vaults, qualifiers } = await resolveKeyVaults(appName, environment, target, correlationId, qualifier);

  if (!found) {
    return { found: false, vaultMismatch: false, anyFileFound: false, secrets: [], vaults: [], qualifiers };
  }

  if (vaultDirFilter && !vaults.some(v => v.vaultDir === vaultDirFilter)) {
    return { found: true, vaultMismatch: true, anyFileFound: false, secrets: [], vaults, qualifiers };
  }

  const targetVaults = vaultDirFilter ? vaults.filter(v => v.vaultDir === vaultDirFilter) : vaults;
  const secrets = [];
  let anyFileFound = false;

  for (const vault of targetVaults) {
    const filePath = `${vault.vaultDir}/secrets.enc.yaml`;
    const file = await githubService.getFileContent(repo, filePath);
    if (!file) continue;

    anyFileFound = true;
    const lastUpdated = await githubService.getFileLastCommitDate(repo, filePath);
    for (const name of parseSecretNames(file.content)) {
      secrets.push({ name, vaultDir: vault.vaultDir, vaultName: vault.vaultName, lastUpdated });
    }
  }

  return { found: true, vaultMismatch: false, anyFileFound, secrets, vaults, qualifiers };
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-002: per-value SOPS blob read/write — plain-text span manipulation, never a full YAML
// parse/re-serialize, so every other key's blob stays byte-identical.
// ─────────────────────────────────────────────────────────────────────────────

function splitIntoSpans(content) {
  const keyRe = /^([A-Za-z0-9_-]{1,127}):/;
  const spans = [];
  let current = null;

  for (const line of (content || '').replace(/\n+$/, '').split('\n')) {
    if (!/^\s/.test(line) && keyRe.test(line)) {
      if (current) spans.push(current);
      current = { key: keyRe.exec(line)[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
    // stray content before any key is discarded (malformed file; nothing sensible to preserve)
  }
  if (current) spans.push(current);
  return spans;
}

function buildBlockLines(secretName, encryptedBlobText) {
  const bodyLines = encryptedBlobText.replace(/\n$/, '').split('\n');
  return [`${secretName}: |`, ...bodyLines.map(l => `  ${l}`)];
}

function upsertSecretBlock(content, secretName, encryptedBlobText) {
  const spans = splitIntoSpans(content);
  const newSpan = { key: secretName, lines: buildBlockLines(secretName, encryptedBlobText) };
  const idx = spans.findIndex(s => s.key === secretName);
  if (idx >= 0) {
    spans[idx] = newSpan;
  } else {
    spans.push(newSpan);
  }
  return spans.flatMap(s => s.lines).join('\n') + '\n';
}

// NFR-SEC-001: secretValue is written only to a 0600 temp file consumed by the sops CLI, and is
// never logged. Only the encrypted blob (stdout from sops) is returned.
async function encryptValueWithSops(secretValue, { correlationId, target, appName, environment, bundleId } = {}) {
  const startMs = Date.now();
  const context = { correlation_id: correlationId, target, appName, environment, bundleId };
  let phase = 'configuration';
  let tmpDir;
  try {
    if (!config.sops.keyVaultUrl || !config.sops.keyVersion) {
      const missingSetting = config.sops.keyVaultUrl ? 'SOPS_KEY_VERSION' : 'SOPS_KEYVAULT_URL';
      const err = new Error(`${missingSetting} is not configured`);
      err.code = 'SOPS_NOT_CONFIGURED';
      throw err;
    }

    phase = 'local_io';
    tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'sops-'));
    const inputPath = nodePath.join(tmpDir, 'value.json');
    await fs.writeFile(inputPath, JSON.stringify({ value: secretValue }), { mode: 0o600 });
    const kmsArg = `${config.sops.keyVaultUrl}/keys/${config.sops.keyName}/${config.sops.keyVersion}`;
    phase = 'sops_encrypt';
    const { stdout } = await execFileAsync('sops', [
      '--encrypt',
      '--input-type', 'json',
      '--output-type', 'json',
      '--azure-kv', kmsArg,
      inputPath
    ]);
    return stdout;
  } catch (error) {
    const failureCategory = phase === 'configuration' ? 'configuration_missing'
      : phase === 'local_io' ? 'local_io_failed'
      : error.code === 'ENOENT' ? 'sops_missing'
      : ['EACCES', 'EPERM'].includes(error.code) ? 'sops_not_executable'
      : error.code === 'ETIMEDOUT' ? 'timeout'
      : error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'output_limit'
      : 'process_failed';
    // Never log subprocess messages, stderr, stdout or arguments: they may contain secrets.
    const safeCode = Number.isInteger(error.code) ||
      ['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ENOSPC', 'EROFS', 'EMFILE', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(error.code);
    logger.error('secret_encryption_failed', {
      ...context,
      event: 'secret_encryption_failed',
      operation: 'sops_encrypt',
      phase,
      error_code: phase === 'configuration' ? 'SOPS_NOT_CONFIGURED' : 'ENCRYPTION_FAILED',
      failure_category: failureCategory,
      ...(safeCode ? { process_code: error.code } : {}),
      duration_ms: Date.now() - startMs
    });
    throw error;
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {
        logger.warn('secret_encryption_cleanup_failed', {
          ...context, event: 'secret_encryption_cleanup_failed', operation: 'sops_encrypt'
        });
      });
    }
  }
}

async function getDefaultBranch(repo) {
  const [owner, repoName] = repo.split('/');
  const { data } = await githubService.octokit.rest.repos.get({ owner, repo: repoName });
  return data.default_branch;
}

/**
 * Submits one or more secrets via the GitOps flow described in spec.md §3, in a single
 * commit/PR (FR-003). Throws typed errors (`error.code`) for the route handler to map to HTTP
 * responses: FOUND_FALSE | VAULT_AMBIGUOUS | VAULT_INVALID | PR_EXISTS | CONFLICT |
 * ENCRYPTION_FAILED | SOPS_NOT_CONFIGURED | QUALIFIER_AMBIGUOUS | QUALIFIER_MISMATCH
 *
 * FR-004 Round 4: `qualifier` is an optional single-segment sub-app identifier. When omitted
 * and the vault resolution returns multiple qualifiers, QUALIFIER_AMBIGUOUS is thrown (422)
 * with `err.qualifiers` listing the disambiguation options. When supplied but doesn't match
 * any resolved vault path, QUALIFIER_MISMATCH is thrown (422).
 */
async function submitSecretViaGitOps({ target, appName, environment, vaultDir, secrets, jiraTicket, userEmail, correlationId, qualifier }) {
  const repo = mapRepo(target);
  if (!repo) {
    const err = new Error('Unconfigured target repository');
    err.code = 'FOUND_FALSE';
    throw err;
  }

  const { found, vaults, qualifiers } = await resolveKeyVaults(appName, environment, target, correlationId, qualifier);
  if (!found) {
    // FR-004: if the caller omitted qualifier and the vault paths have sub-app qualifiers,
    // report them so the user can disambiguate rather than a bare "not found".
    if (qualifiers && qualifiers.length > 0) {
      const err = new Error('Multiple sub-app qualifiers found; qualifier is required');
      err.code = 'QUALIFIER_AMBIGUOUS';
      err.qualifiers = qualifiers;
      throw err;
    }
    if (qualifier) {
      const err = new Error('qualifier does not match any resolved vault path');
      err.code = 'QUALIFIER_MISMATCH';
      err.qualifiers = qualifiers || [];
      throw err;
    }
    const err = new Error('Cannot resolve Key Vault for this app/environment');
    err.code = 'FOUND_FALSE';
    throw err;
  }

  // FR-002(l): vaultDir must be allow-list validated against the live resolveKeyVaults() result
  // BEFORE it is used to construct any repo path — never trust client input directly.
  let selectedVault;
  if (vaultDir) {
    selectedVault = vaults.find(v => v.vaultDir === vaultDir);
    if (!selectedVault) {
      const err = new Error('vaultDir does not match a resolved vault');
      err.code = 'VAULT_INVALID';
      throw err;
    }
  } else if (vaults.length === 1) {
    selectedVault = vaults[0];
  } else {
    const err = new Error('Multiple Key Vaults found; vaultDir is required');
    err.code = 'VAULT_AMBIGUOUS';
    err.vaults = vaults;
    throw err;
  }

  const defaultBranch = await getDefaultBranch(repo);
  const filePath = `${selectedVault.vaultDir}/secrets.enc.yaml`;
  const vaultSlug = selectedVault.vaultDir.split('/').pop();
  const secretNames = secrets.map(s => s.secretName);
  const qualifierPrefix = qualifier ? `${qualifier}-` : '';

  // OQ-002: a single secret (bulk array of 1, or the legacy singular shape already wrapped by
  // the route) keeps the v1 branch name unchanged; only true multi-secret batches use the
  // deterministic bulk-hash branch name.
  const branchName = secrets.length === 1
    ? `secrets/${appName}-${environment}-${qualifierPrefix}${vaultSlug}-${secretNames[0]}`
    : `secrets/${appName}-${environment}-${qualifierPrefix}${vaultSlug}-bulk-${bulkBranchHash(secrets)}`;

  const existingPr = await githubService.findOpenPullRequest(repo, branchName);
  if (existingPr) {
    const err = new Error('A pull request for this secret is already open');
    err.code = 'PR_EXISTS';
    err.prUrl = existingPr.html_url;
    throw err;
  }

  // FR-002(k): capture the default branch's current file SHA before the slow encrypt step, then
  // re-check immediately before writing. On drift, abort — no merge/rebase is ever attempted,
  // scoped only to this vaultDir's file (sibling vaults never false-conflict).
  const preFile = await githubService.getFileContent(repo, filePath, defaultBranch);
  const preSha = preFile ? preFile.sha : null;

  // FR-003(j): encrypt every entry in memory first; abort with zero GitHub writes on the first
  // failure, naming only the failing secretName (never secretValue).
  const encryptedBySecretName = new Map();
  for (const { secretName, secretValue } of secrets) {
    try {
      encryptedBySecretName.set(secretName, await module.exports._internal.encryptValueWithSops(secretValue, {
        correlationId, target, appName, environment
      }));
    } catch (error) {
      // SOPS_NOT_CONFIGURED is an environment misconfiguration (503, unchanged from v1), not a
      // per-secret encryption failure — never mask it as ENCRYPTION_FAILED (400).
      if (error.code === 'SOPS_NOT_CONFIGURED') throw error;
      const err = new Error(`Encryption failed for: ${secretName}`);
      err.code = 'ENCRYPTION_FAILED';
      err.secretNames = [secretName];
      throw err;
    }
  }

  const currentFile = await githubService.getFileContent(repo, filePath, defaultBranch);
  const currentSha = currentFile ? currentFile.sha : null;
  if (currentSha !== preSha) {
    const err = new Error('Concurrent secret submission detected, please retry');
    err.code = 'CONFLICT';
    throw err;
  }

  let newContent = currentFile ? currentFile.content : '';
  for (const secretName of secretNames) {
    newContent = upsertSecretBlock(newContent, secretName, encryptedBySecretName.get(secretName));
  }

  const branchAlreadyExists = await githubService.branchExists(repo, branchName);
  if (!branchAlreadyExists) {
    await githubService.createBranch(repo, defaultBranch, branchName);
  }

  const branchFile = await githubService.getFileContent(repo, filePath, branchName);
  const branchSha = branchFile ? branchFile.sha : null;

  const commitMessage = secrets.length === 1
    ? `chore(secrets): update ${secretNames[0]} in ${selectedVault.vaultDir} [${jiraTicket}]`
    : `chore(secrets): add ${secrets.length} secrets for ${appName}/${environment} [${jiraTicket}]`;
  await githubService.createOrUpdateFile(repo, branchName, filePath, newContent, commitMessage, branchSha);

  const prTitle = secrets.length === 1
    ? `Secret update: ${secretNames[0]} (${appName}/${environment}${qualifier ? `/${qualifier}` : ''}) [${jiraTicket}]`
    : `Secrets update: ${secrets.length} secrets (${appName}/${environment}${qualifier ? `/${qualifier}` : ''}) [${jiraTicket}]`;
  const prBody = [
    `**Target**: ${target}`,
    `**App**: ${appName}`,
    `**Environment**: ${environment}`,
    ...(qualifier ? [`**Qualifier**: ${qualifier}`] : []),
    `**Vault**: ${selectedVault.vaultDir}`,
    `**Jira**: ${jiraTicket}`,
    `**Secrets**: ${secretNames.join(', ')}`,
    `**Submitted by**: ${userEmail}`,
    `**Correlation ID**: ${correlationId}`
  ].join('\n');

  const pr = await githubService.createPullRequest(repo, defaultBranch, branchName, prTitle, prBody);
  return { ...pr, secretCount: secrets.length };
}

// FR-004 (secrets-environment-scope): fan-out the unmodified single-environment
// submitSecretViaGitOps() across N environments. NFR-PERF-001 requires concurrent (not serial)
// execution — Promise.allSettled runs every environment's GitOps call in parallel and isolates
// each outcome, which also satisfies NFR-REL-001 (one environment's failure never blocks,
// rolls back, or delays another's independent commit/PR).
async function submitSecretsFanOut({ target, appName, environments, vaultDir, qualifier, jiraTicket, secrets, userEmail, correlationId }) {
  // Call through module.exports (not the bare closure reference) so tests can monkey-patch
  // submitSecretViaGitOps per environment, same convention as encryptValueWithSops above.
  const outcomes = await Promise.allSettled(
    environments.map(environment =>
      module.exports.submitSecretViaGitOps({ target, appName, environment, vaultDir, qualifier, secrets, jiraTicket, userEmail, correlationId })
    )
  );

  return environments.map((environment, index) => {
    const outcome = outcomes[index];
    if (outcome.status === 'fulfilled') {
      const { prNumber, prUrl, secretCount } = outcome.value;
      return { environment, success: true, prNumber, prUrl, secretCount };
    }
    const error = outcome.reason;
    // NFR-SEC-001: never include secretValue; error.message text here never contains it (all
    // submitSecretViaGitOps error paths that touch secret content only ever name secretName).
    return { environment, success: false, errorCode: error.code || 'UNKNOWN', error: error.message };
  });
}

module.exports = {
  resolveKeyVaults,
  getSecretsList,
  submitSecretViaGitOps,
  submitSecretsFanOut,
  discoverAppsForTarget,
  classifyEnvironmentTier,
  loadVaultOverrides,
  resolveVaultNameWithFallback,
  setVaultNameOverride,
  // secrets-environment-bundles
  loadSecretBundles,
  classifyBundleMembership,
  getBundleCatalog,
  validateBundleMembership,
  resolveBundleEnvironments,
  computeBundleContentHash,
  submitSecretBundleViaGitOps,
  // Exported for focused unit testing of pure text/matching logic without mocking GitHub.
  // encryptValueWithSops is looked up via module.exports._internal at call time (not the bare
  // closure reference) so tests can monkey-patch it, same pattern as githubService methods.
  // treeCache/discoverCache are exposed only so tests can .clear() them between cases.
  _internal: {
    parseSecretNames, upsertSecretBlock, matchVaultsFromEntries, bulkBranchHash, extractAppEnvPairs, encryptValueWithSops, classifyVaultEntry, treeCache, discoverCache, overridesCache,
    validateBundleConfigShape,
    readBundleConfigFile,
    // test-only reset for the module-level last-known-good bundle config fallback cache.
    resetLastKnownGoodBundleConfig: () => { lastKnownGoodBundleConfig = null; }
  }
};
