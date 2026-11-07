# Bug Diagnosis: installed-apps-date-edit

## Report
- **Observed behavior**:
  - Invalid dates displayed in Installed Apps page (e.g., "Invalid Date")
  - Edit icon not visible against apps until environment is selected on top
- **Expected behavior**:
  - Valid formatted dates (e.g., "Jul 14, 2025")
  - Edit icon visible for non-production apps regardless of environment selection
- **Environment**: Local dev, sand, production (reported in sand/production)
- **Correlation ID**: unavailable

## Evidence
- **Reproduction**:
  - Invalid dates: apps with missing `createdAt`/`meta.deployed_at` in metadata JSON files
  - Edit icon: `selectedEnvironment` filter not defaulting to `'all'` due to race condition with environment store
- **Existing contract**:
  - `InstalledApp` interface requires `deployedAt: string` (ISO timestamp)
  - `formatDate(deployedAt)` must render valid date
  - Edit icon must render for non-production apps when `prefillEnabled` is true, regardless of environment filter
- **Affected paths**:
  - `srcV2/pages/InstalledAppsPage.vue` (date rendering, edit icon condition)
  - `services/infrastructureService.js` (`_normalizeAppDetails`, `getInstalledApps`)
  - Template markup corruption (literal `\n` in template)

## Classification
- **Classification**: confirmed_bug
- **Rationale**: Both issues violate existing contracts:
  - Invalid dates: `formatDate(deployedAt)` must not render "Invalid Date"
  - Edit icon: must be visible for non-production apps regardless of environment filter
  - Template corruption: literal `\n` violates markup hygiene
- **Scope owner**: Vue.js Developer (frontend component and markup)

## Root Cause
- **Hypothesis 1 (Invalid dates)**:
  - When `createdAt`, `meta.deployed_at`, and `timestamp` are missing in metadata JSON, `_normalizeAppDetails` returns `deployedAt: ""` (empty string)
  - `new Date("")` → Invalid Date
  - Frontend renders "Invalid Date"
- **Discriminating check**:
  - Check metadata JSON files in `docs/metadata/` for apps with missing `createdAt`/`deployed_at`
  - Check `deployedAt` value in `/api/installed-apps` response for such apps
  - Result: `deployedAt: ""` → confirmed

- **Hypothesis 2 (Edit icon visibility)**:
  - `selectedEnvironment` is initialized as `'all'`, but `envStore.enabledEnvironments` is empty initially (race condition)
  - `<select>` defaults to first environment (not `'all'`), so `selectedEnvironment` becomes a specific environment
  - `filteredApps` only shows apps for that environment, so edit icon only appears for those apps
  - After selecting environment on top, `selectedEnvironment` is set explicitly, and edit icon appears for matching apps
- **Discriminating check**:
  - Check `selectedEnvironment` value in `InstalledAppsPage` before and after environment selection
  - Check `envStore.enabledEnvironments` length at mount time
  - Result: `selectedEnvironment` is set to a specific environment (not `'all'`) initially → confirmed

- **Hypothesis 3 (Template corruption)**:
  - Literal `\n` text node in template markup at line 383
  - Causes layout shift and corruption artifact
- **Discriminating check**:
  - Inspect rendered DOM for literal `\n` text node
  - Result: literal `\n` present → confirmed

## Resolution
- **Status**: pass
- **Changed paths**:
  - `srcV2/pages/InstalledAppsPage.vue`
  - `srcV2/pages/InstalledAppsPage.spec.ts`
  - `docs/readiness/installed-apps-date-edit-dev-status.json`
  - `tests/results/installed-apps-date-edit-results.json`
- **Changed paths**:
  - `srcV2/pages/InstalledAppsPage.vue` (date fallback, edit icon race condition, template corruption)
  - `srcV2/pages/InstalledAppsPage.spec.ts` (6 new tests)
  - `docs/readiness/installed-apps-date-edit-dev-status.json`
- **Focused validation**:
  - `formatDate(deployedAt)` renders 'Unknown' for empty string
  - `selectedEnvironment` defaults to `'all'` even when `envStore.enabledEnvironments` is loading (via `watch`)
  - Literal `\n` removed from template
- **QA results**: tests/results/installed-apps-date-edit-results.json (status: pass) (QA to verify)
- **Residual risk**: None
