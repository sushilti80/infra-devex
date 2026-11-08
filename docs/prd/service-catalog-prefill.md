# PRD: Service-Catalog Metadata Pre-fill

## 1. Title and Metadata

| Field        | Value                                                                      |
|--------------|----------------------------------------------------------------------------|
| Feature Name | Service-Catalog Metadata Pre-fill                                          |
| Author       | Product Manager Agent                                                      |
| Date         | 2025-07-15                                                                 |
| Status       | `draft`                                                                    |
| Stakeholders | Platform Engineering, DevOps Team, App Developers (self-service consumers) |
| Repository   | `organization/self-service-infra`                                        |
| PRD Slug     | `service-catalog-prefill`                                                  |

---

## 2. Problem Statement

### User Persona

**Alex — Application Developer (Platform Consumer)**
Alex is an engineer who owns one or more applications already provisioned through the self-service
platform. When an application needs to be modified (e.g., new modules added, environment changed,
re-provisioned after a failed run), Alex must navigate to a form and manually retype all the
project metadata they already entered the first time (project name, owner, description, modules,
environment). This is error-prone, tedious, and inconsistent — the existing metadata in the
service-catalog repository (`docs/metadata/`) is the authoritative source, but it is never surfaced
back into the UI.

### Current Pain

When a user selects **Custom Infrastructure** in the self-service UI, every
form field is blank. There is no way to choose an existing app from the catalog and have the form
pre-populated. The user must remember or re-lookup the project abbreviation, owner, environment,
and module selection. Typos in `projectName` (max 8 characters, alphanumeric) cause silent
mismatches in the service-catalog metadata files.

### Why Now

The platform is growing its user base. `GET /api/installed-apps` already returns all deployed apps
from `docs/metadata/`. A read-only detail endpoint also exists
(`GET /api/deployed-apps/:projectName/:environment`) but it is incomplete: it uses the wrong file
naming convention (`{projectName}.json` instead of `{appName}-{environment}.json`), returns raw
unformatted JSON, and is never wired to the frontend. All ingredients exist; they just need to be
connected.

### Expected Business Value

- **Fewer input errors**: Pre-filling from the authoritative metadata source eliminates
  transcription mistakes in project names and owner fields.
- **Faster re-provisioning**: Reduces form completion time for returning users from ~3 minutes to
  < 30 seconds for repeat workflows.
- **Better data consistency**: All changes start from the canonical record in `service-catalog`,
  ensuring fields like `cost_center` and `lifecycle` stay in sync.
- **Foundation for edit workflows**: Once pre-fill exists, future "edit existing app" and
  "promote to production" flows can reuse the same pattern.

---

## 3. Goals and Non-Goals

### Goals

1. Add an optional **"Load Existing App"** selector to the **Custom Infrastructure** form.
2. When a user selects an app + environment combination, all matching fields in the form must be
   pre-populated from the `docs/metadata/{appName}-{environment}.json` file in the
   `organization/service-catalog` repository.
3. Pre-filled values must remain fully editable — the user can override any field before submitting.
4. The selector must use data from the existing `GET /api/installed-apps` endpoint (no new
   catalog list call required).
5. A new **`GET /api/app-metadata/:appName/:environment`** endpoint must return normalized,
   frontend-ready metadata for a single app/environment pair.
6. All fields available in the canonical schema (including `modules`, `rbac_pairs`,
   `description`, `cost_center`, `lifecycle`) must be surfaced in the pre-fill response.
7. Correlation IDs must be threaded through all new backend calls per platform convention.

### Non-Goals

- This feature does **not** submit changes to the infrastructure — pre-fill is read-only.
- This feature does **not** add a new page; it extends existing form pages.
- This feature does **not** implement real-time sync or webhooks from `service-catalog`.
- This feature does **not** support pre-filling Template Deploy (`TemplateDeployPage.vue`) — Template Deploy pre-fill is explicitly out of scope for this release.
- This feature does **not** support pre-filling AKS deployment forms (`AKSDeployPage.vue`) in
  this phase.
- This feature does **not** create/edit RBAC relationships in metadata files; pre-fill only
  restores existing `rbac_pairs` into the form for review and optional adjustment before submit.

---

## 4. Current State Assessment

### What Exists Today

| Capability | Location | Notes |
|---|---|---|
| List all installed apps | `routes/api.js:49` → `GET /api/installed-apps` | Returns normalized list from `docs/metadata/`. Used by `InstalledAppsPage.vue`. |
| Single app detail fetch | `routes/api.js:536` → `GET /api/deployed-apps/:projectName/:environment` | Calls `infrastructureService.getApplicationDetails()`. Returns raw metadata. |
| `getApplicationDetails()` service method | `services/infrastructureService.js:617` | Reads `docs/metadata/` from GitHub. **Bug**: tries `{projectName}.json` naming before `{appName}-{environment}.json`. |
| `getInstalledApps()` service method | `services/infrastructureService.js:143` | Reads all files in `docs/metadata/`, normalises shape. Correct canonical implementation. |
| `InstalledApp` TypeScript interface | `srcV2/types/infrastructure.types.ts:28` | Missing `costCenter`, `commitSha`, `modules` (listed but not consistently surfaced). |
| `CustomInfrastructurePage.vue` form (Step 0) | `srcV2/pages/CustomInfrastructurePage.vue` | `ProjectInfoForm` accepts: `projectName`, `descriptiveName`, `environment`, `owner`, `lifecycle`, `projectAge`, `approvalNumber`. No pre-fill capability. |
| `TemplateDeployPage.vue` form | `srcV2/pages/TemplateDeployPage.vue` | Fields: `templateName`, `projectName`, `descriptiveName`, `environment`, `owner`, `approvalNumber`. No pre-fill capability. |
| `apiService.getInstalledApps()` | `srcV2/services/api.ts:118` | Calls `GET /api/installed-apps`. Wired to `InstalledAppsPage.vue`. |
| Module metadata canonical schema | `.github/skills/service-catalog-metadata/SKILL.md` | `project`, `environment`, `modules`, `meta.name`, `meta.description`, `meta.owner`, `meta.cost_center`, `meta.lifecycle`, `meta.deployed_at`, `meta.commit_sha` |

### Gaps and Limitations

1. **No pre-fill API endpoint**: `GET /api/deployed-apps/:projectName/:environment` exists but
   (a) uses wrong file naming convention, (b) returns raw JSON not normalized for frontend
   consumption, (c) has no dedicated route that matches the correct file name pattern
   `{appName}-{environment}.json`.
2. **No app selector component**: Neither `CustomInfrastructurePage.vue` nor
   `TemplateDeployPage.vue` contains a dropdown or search-select for existing apps.
3. **`getApplicationDetails()` has a naming bug**: It first tries `docs/metadata/{projectName}.json`
   (no environment suffix), which will fail or return the wrong file for any app with multiple
   environments. It should target `docs/metadata/{projectName}-{environment}.json` directly.
4. **`InstalledApp` type is incomplete**: `costCenter`, `commitSha`, and `version` from the
   canonical schema are not in the TypeScript interface.
5. **`apiService` has no single-app fetch method**: There is no `getAppMetadata(name, env)` in
   `srcV2/services/api.ts`.

---

## 5. Requirement Classification Matrix

| Capability | Classification | Evidence | Proposed Action |
|---|---|---|---|
| List existing apps for selector dropdown | `existing-refine` | `GET /api/installed-apps` already returns `name` + `environment` pairs | Reuse `apiService.getInstalledApps()` — no new endpoint needed |
| Single-app metadata API endpoint | `existing-extend` | `GET /api/deployed-apps/:projectName/:environment` exists but returns raw JSON with wrong file naming | Create `GET /api/app-metadata/:appName/:environment` that targets `{appName}-{environment}.json` and returns normalized shape |
| `getApplicationDetails()` service method | `existing-extend` | Method exists at `infrastructureService.js:617` but has naming bug | Fix to use `docs/metadata/{appName}-{environment}.json` directly; return normalized shape matching `InstalledApp` + extra fields |
| App selector UI component | `new-feature` | No such component exists in `srcV2/components/` | Build `AppSelector.vue` (combobox/searchable dropdown) in `srcV2/components/infrastructure/` |
| Pre-fill logic in `ProjectInfoForm.vue` | `new-feature` | `ProjectInfoForm.vue` has no external data wiring | Add `prefillData` prop + watcher in `ProjectInfoForm.vue` |
| Pre-fill logic in `TemplateDeployPage.vue` | ~~`new-feature`~~ | **OUT OF SCOPE** — Template Deploy pre-fill is deferred to a future release |
| `apiService.getAppMetadata()` method | `new-feature` | `srcV2/services/api.ts` has no single-app fetch | Add `getAppMetadata(appName, env)` → `GET /api/app-metadata/:appName/:environment` |
| `InstalledApp` type enrichment | `existing-extend` | Missing `costCenter`, `commitSha`, `version` fields | Add missing fields to `infrastructure.types.ts` |
| Modules pre-fill into `ModuleSelector` | `new-feature` | `ModuleSelector.vue` accepts `selected-modules` prop but nothing pre-populates it | Wire prefilled `modules[]` into `CustomInfrastructurePage.vue` Step 1 state |

---

## 6. Functional Requirements (FR)

---

### FR-001 — App + Environment Selector on Custom Infrastructure Form

**Description**: On `CustomInfrastructurePage.vue`, before Step 0 (Project Information), display
an optional **"Load from Existing App"** section containing a searchable dropdown of all apps
currently in the service-catalog. Selecting an app + environment combination triggers metadata
pre-fill (see FR-003).

**Priority**: `must`

**Rationale**: This is the primary entry point for the feature. Most users modifying
infrastructure will start here.

**Acceptance Criteria**:
- AC-001-1: The selector section is visually distinct from the rest of Step 0 and labelled
  "Load from Existing App (optional)".
- AC-001-2: The app dropdown is populated by calling `GET /api/installed-apps`. The list loads
  within 3 seconds on a stable network connection (see NFR-001).
- AC-001-3: The dropdown supports keyboard navigation and text search/filter by app name.
- AC-001-4: Selecting an app name reveals a second dropdown scoped to that app's available
  environments (derived from the same `/api/installed-apps` response — no second API call).
- AC-001-5: A **"Load"** button (or auto-trigger on environment selection) initiates the pre-fill
  API call (FR-002).
- AC-001-6: While the metadata fetch is in progress, the Load button shows a loading spinner and
  is disabled to prevent double-submission.
- AC-001-7: If the user has already entered data in the form and then loads an existing app, a
  confirmation dialog warns that current form values will be overwritten.
- AC-001-8: The selector section can be collapsed or dismissed without affecting form state.

**Dependencies**: FR-002, FR-003, new `AppSelector.vue` component.

---

### FR-002 — New API Endpoint: `GET /api/app-metadata/:appName/:environment`

**Description**: Create a new authenticated REST endpoint that accepts an app name and environment
as path parameters and returns a normalized metadata object sourced from
`docs/metadata/{appName}-{environment}.json` in the `organization/service-catalog` repository.

**Priority**: `must`

**Rationale**: The frontend must have a clean, normalized, single-app metadata API. The existing
`/api/deployed-apps/:projectName/:environment` returns raw JSON with an incorrect file naming
assumption and is not suitable for direct frontend consumption.

**Acceptance Criteria**:
- AC-002-1: `GET /api/app-metadata/:appName/:environment` returns HTTP 200 with the following
  shape when the file `docs/metadata/{appName}-{environment}.json` exists:
  ```json
  {
    "success": true,
    "data": {
      "name": "jobplc",
      "environment": "devsand",
      "description": "jobplc",
      "owner": "Example User",
      "lifecycle": "Live",
      "modules": ["functionAppSvcWindows"],
      "costCenter": "self-service",
      "commitSha": "649f071b29d6d9eec2c4cba417278735ce4d23a8",
      "deployedAt": "2025-07-14T21:59:14Z"
    },
    "correlationId": "cid-xxxxxxxxxx-xxxx"
  }
  ```
- AC-002-2: Returns HTTP 404 with `{ "success": false, "error": "App not found", "correlationId": "..." }`
  when the file `docs/metadata/{appName}-{environment}.json` does not exist.
- AC-002-3: Returns HTTP 400 if `appName` contains characters outside `[a-zA-Z0-9]` or `environment`
  is not a recognized value from `data/environments.json`.
- AC-002-4: Returns HTTP 401 if the request lacks a valid ****** (`requireAuth` middleware).
- AC-002-5: The endpoint targets the file `docs/metadata/{appName}-{environment}.json` directly
  (not a scan of all files) as the primary lookup strategy.
- AC-002-6: Correlation ID from `req.correlationId` is included in every response and every log line.
- AC-002-7: Response time is ≤ 2 000 ms at p95 under normal load (see NFR-001).

**Dependencies**: `services/infrastructureService.js` fix (FR-007).

---

### FR-003 — Form Pre-fill on App Selection (Custom Infrastructure)

**Description**: When a user selects an existing app on `CustomInfrastructurePage.vue` and
triggers the load action, all matching fields in the **Project Information** step (Step 0) and
**Module Selection** step (Step 1) must be pre-populated with the values returned from FR-002.

**Priority**: `must`

**Rationale**: The core value of this feature — eliminating manual re-entry of existing app data.

**Field Mapping**:

| Metadata field (FR-002 response) | Form field | Component |
|---|---|---|
| `data.name` | `projectName` | `ProjectInfoForm.vue` |
| `data.description` | `descriptiveName` | `ProjectInfoForm.vue` |
| `data.environment` | `environment` (dropdown) | `ProjectInfoForm.vue` |
| `data.owner` | `owner` | `ProjectInfoForm.vue` |
| `data.lifecycle` | `lifecycle` (hidden, always `experimental`) | `ProjectInfoForm.vue` — **not** pre-filled (lifecycle is reset on re-provision; see Non-Goals) |
| `data.modules` | `selectedModules` | `CustomInfrastructurePage.vue` Step 1 state |
| `projectAge` | — | Not pre-filled (lifespan is always specified fresh per-request) |
| `approvalNumber` | — | Not pre-filled (requires a new JIRA/CR each time) |

**Acceptance Criteria**:
- AC-003-1: After a successful pre-fill, `projectName`, `descriptiveName`, `environment`, `owner`
  in `ProjectInfoForm.vue` reflect the values from the API response.
- AC-003-2: The `selectedModules` array in `CustomInfrastructurePage.vue` is set to
  `data.modules` from the API response. `ModuleSelector.vue` renders these as selected.
- AC-003-3: `projectAge` and `approvalNumber` fields are left blank/default — the user must fill
  these in.
- AC-003-4: All pre-filled fields remain editable; the user can change any value before
  proceeding to the next step.
- AC-003-5: A dismissible banner (e.g., "📋 Pre-filled from jobplc / devsand") appears below the
  selector confirming which app's data was loaded.
- AC-003-6: If the pre-fill API call returns an error (HTTP 404/500), the form is not modified
  and a user-visible error message is displayed in the selector section.

**Dependencies**: FR-001, FR-002, FR-005.

---

### FR-004 — ~~Form Pre-fill on App Selection (Template Deploy)~~ — **OUT OF SCOPE**

> ⚠️ **This requirement has been removed from this release per product decision.**
> Template Deploy (`TemplateDeployPage.vue`) pre-fill is deferred to a future release.
> Only **Custom Infrastructure** (`CustomInfrastructurePage.vue`) pre-fill is in scope.

**Status**: `removed`

---

### FR-005 — `AppSelector.vue` Reusable Component

**Description**: Create a new reusable Vue 3 component `AppSelector.vue` located at
`srcV2/components/infrastructure/AppSelector.vue`. The component encapsulates the app list
loading, two-level selection (app name → environment), loading spinner, and emitting the final
pre-fill data to the parent.

**Priority**: `must`

**Rationale**: `CustomInfrastructurePage.vue` needs this behaviour. A dedicated component keeps the page clean and allows future extension.

**Acceptance Criteria**:
- AC-005-1: Component exposes an `@prefill` event that emits the full metadata object returned
  from `GET /api/app-metadata/:appName/:environment`.
- AC-005-2: Component exposes an `@error` event with the error message when the metadata fetch
  fails.
- AC-005-3: The app list is loaded on component mount via `apiService.getInstalledApps()`.
  Results are cached for the lifetime of the parent page (no re-fetching on each render).
- AC-005-4: Selecting a different app name resets the environment dropdown.
- AC-005-5: The "Load" button is only enabled when both an app name and an environment have been
  selected.
- AC-005-6: Component renders in a loading state (spinner, disabled inputs) while fetching app
  list or metadata.
- AC-005-7: Component renders an empty/no-apps state if `GET /api/installed-apps` returns zero
  results or fails.

**Dependencies**: FR-002, `apiService.getAppMetadata()` (FR-006).

---

### FR-006 — `apiService.getAppMetadata()` Frontend API Method

**Description**: Add a new method `getAppMetadata(appName: string, environment: string)` to
`srcV2/services/api.ts` that calls `GET /api/app-metadata/:appName/:environment`.

**Priority**: `must`

**Rationale**: Follows the existing pattern in `apiService`. All API calls go through this
service object.

**Acceptance Criteria**:
- AC-006-1: Method is exported from `apiService` and follows the existing
  `(): Promise<ApiResponse>` return type pattern.
- AC-006-2: Method is typed with explicit string parameters:
  `getAppMetadata: (appName: string, environment: string) => Promise<ApiResponse>`.
- AC-006-3: Axios interceptors (auth token injection, telemetry tracking) apply automatically
  because the method uses the shared `api` Axios instance.

**Dependencies**: FR-002.

---

### FR-007 — Fix `getApplicationDetails()` File Naming in `infrastructureService.js`

**Description**: The existing `getApplicationDetails(projectName, environment)` method in
`services/infrastructureService.js` (line 617) currently first attempts to open
`docs/metadata/{projectName}.json`, which does not match the canonical `{appName}-{environment}.json`
naming convention. This causes unnecessary GitHub API calls and potential incorrect matches. Fix
the method to use the correct file path as primary lookup.

**Priority**: `must`

**Rationale**: This is a correctness bug. Any consumer of `getApplicationDetails()` today gets
wrong behavior for apps deployed to multiple environments. FR-002 depends on this fix.

**Acceptance Criteria**:
- AC-007-1: The primary lookup path is `docs/metadata/{projectName}-{environment}.json`.
- AC-007-2: The full directory scan fallback (for edge-case files) is retained but only runs
  if the primary lookup returns 404.
- AC-007-3: Return value is normalized using the same shape as `getInstalledApps()` produces
  per entry, extended with `costCenter` and `commitSha`.
- AC-007-4: Existing callers (`GET /api/deployed-apps/:projectName/:environment`) continue to
  work without modification.

---

### FR-008 — `InstalledApp` TypeScript Type Enrichment

**Description**: Extend the `InstalledApp` interface in `srcV2/types/infrastructure.types.ts`
with the additional fields exposed by FR-002 that are currently missing.

**Priority**: `should`

**Rationale**: TypeScript strict typing prevents runtime field-access bugs in the pre-fill
component. These fields are already returned by the backend (see `getInstalledApps()` line 198)
but not typed.

**Acceptance Criteria**:
- AC-008-1: `InstalledApp` interface adds the following optional fields:
  - `costCenter?: string`
  - `commitSha?: string`
- AC-008-2: A new `AppMetadata` interface (or type alias) matches the `data` object shape from
  the `GET /api/app-metadata` response for use in `AppSelector.vue`.
- AC-008-3: No TypeScript compilation errors introduced (`tsc --noEmit` passes).

**Dependencies**: FR-002.

---

## 7. Non-Functional Requirements (NFR)

---

### NFR-001 — Performance: Metadata Fetch Latency

**Target**: `GET /api/app-metadata/:appName/:environment` responds in ≤ 2 000 ms at p95 under
normal operating conditions (GitHub API available, ≤ 50 concurrent users).

**Measurement**: Measured via application logs (request duration already emitted via
`trackEvent('api_request_completed', { duration_ms })`).

**Rationale**: Pre-fill is a blocking user action — the user waits for the form to populate.
Exceeding 2 000 ms degrades perceived responsiveness significantly.

---

### NFR-002 — Performance: App List Load Time

**Target**: The app list in `AppSelector.vue` must be populated within 3 000 ms of component
mount at p95, sourced from `GET /api/installed-apps`.

**Measurement**: Measured via existing `api_request_completed` telemetry event for the
`/api/installed-apps` endpoint.

---

### NFR-003 — Reliability: Graceful Degradation

**Target**: If `GET /api/app-metadata` returns HTTP 4xx or 5xx, or if GitHub is unavailable:
1. The form must remain fully functional (user can still fill in all fields manually).
2. A human-readable error message must appear in the selector section within 500 ms of the
   error response.
3. The error must be logged server-side with the correlation ID and full stack trace.

**Measurement**: Verified by unit tests that mock API failures and assert form remains operable.

---

### NFR-004 — Security: Authentication Enforcement

**Target**: `GET /api/app-metadata/:appName/:environment` must be protected by `requireAuth`
middleware. Unauthenticated requests must receive HTTP 401 with no metadata payload.

**Measurement**: Integration test asserting that a request without a valid ****** returns
HTTP 401.

---

### NFR-005 — Security: Input Validation

**Target**: `appName` and `environment` path parameters must be validated server-side:
- `appName`: matches `/^[a-zA-Z0-9]{1,8}$/` (max 8 alphanumeric chars, per platform convention).
- `environment`: must be one of the values in `data/environments.json` (dynamic whitelist).
- Invalid inputs return HTTP 400 immediately without touching the GitHub API.

**Measurement**: Unit tests verifying HTTP 400 for `appName` = `"../../etc/passwd"`,
`"toolongnamemore"`, and `environment` = `"invalid-env"`.

---

### NFR-006 — Observability: Correlation IDs

**Target**: Every backend log line emitted during a `GET /api/app-metadata` request must include
`req.correlationId`. The correlation ID must also appear in the response JSON under `correlationId`.

**Measurement**: Log inspection confirms presence of `correlationId` key in all relevant
`logger.info` / `logger.error` calls for the new route and any new service methods.

---

### NFR-007 — Accessibility: WCAG 2.1 AA Compliance for AppSelector Component

**Target**: The `AppSelector.vue` component must meet WCAG 2.1 AA criteria:
- Dropdown and button elements are keyboard-navigable (Tab / Arrow keys / Enter).
- Loading state is announced to screen readers via `aria-busy` or `aria-live` region.
- Error messages are associated with the selector via `aria-describedby`.

**Measurement**: Verified manually with keyboard-only navigation and checked with an automated
accessibility lint tool (e.g., `axe-core` or `vue-axe`).

---

### NFR-008 — Scalability: No N+1 GitHub API Calls on Pre-fill

**Target**: A single pre-fill action (user selecting one app + environment) must result in
exactly **one** GitHub API call to retrieve the metadata file. The app list required for the
selector must not generate per-app GitHub calls on selector open.

**Measurement**: Verified via unit tests that mock `githubService.octokit.rest.repos.getContent`
and assert call count is 1 for the pre-fill operation (plus the initial list load which uses the
existing `getInstalledApps()` path).

---

### NFR-009 — Usability: Pre-fill Confirmation Visibility

**Target**: The "pre-filled from" confirmation banner must be visible without scrolling on all
screen widths ≥ 375 px (mobile) and must remain visible until the user dismisses it or navigates
to a new step.

**Measurement**: Visual review at 375 px, 768 px, and 1 280 px viewport widths.

---

## 8. API and Data Impact

### New Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/app-metadata/:appName/:environment` | `requireAuth` | Returns normalized metadata for a single app/environment pair from `docs/metadata/{appName}-{environment}.json` |

### Modified Endpoints

| Method | Path | Change |
|---|---|---|
| `GET` | `/api/deployed-apps/:projectName/:environment` | No signature change. The underlying `getApplicationDetails()` service method is fixed (FR-007) which improves its correctness, but the route handler is unchanged. |
| `GET` | `/api/installed-apps` | No change. Reused as-is for the selector app list. |

### New Frontend API Method

```ts
// srcV2/services/api.ts (addition to apiService object)
getAppMetadata: (appName: string, environment: string): Promise<ApiResponse> =>
  api.get(`/api/app-metadata/${appName}/${environment}`)
```

### Response Shape: `GET /api/app-metadata/:appName/:environment`

```json
{
  "success": true,
  "data": {
    "name": "jobplc",
    "environment": "devsand",
    "description": "jobplc",
    "owner": "Example User",
    "lifecycle": "Live",
    "modules": ["functionAppSvcWindows"],
    "costCenter": "self-service",
    "commitSha": "649f071b29d6d9eec2c4cba417278735ce4d23a8",
    "deployedAt": "2025-07-14T21:59:14Z"
  },
  "correlationId": "cid-1234567890-abcd"
}
```

### Data Backward Compatibility

- The existing `/api/installed-apps` response shape is **unchanged**.
- The `InstalledApp` interface extension (FR-008) adds **optional** fields only — no breaking
  change to existing consumers.
- The `getApplicationDetails()` fix (FR-007) changes return shape from raw metadata JSON to
  normalized shape. **Impact**: `GET /api/deployed-apps/:projectName/:environment` currently
  returns raw JSON — any existing consumers of that route will receive a different (but richer
  and more consistent) shape. Verify no external consumers exist before deploying.

### Source Repository

All metadata is sourced from `organization/service-catalog` at path `docs/metadata/`.
Authentication uses the existing Infrastructure GitHub App (`GITHUB_APP_ID` +
`GITHUB_INSTALLATION_ID`). No new credentials are required.

---

## 9. UX and Workflow Impact

### User Journey (Happy Path)

```
1. User navigates to "Custom Infrastructure" page.
2. Step 0 (Project Information) is displayed.
3. An optional collapsible section "Load from Existing App" is visible at the top of Step 0.
4. User expands the section, selects "jobplc" from the app dropdown.
5. Environment dropdown populates with available environments for "jobplc" (e.g., "devsand").
6. User selects "devsand" and clicks "Load".
7. A loading spinner appears on the Load button (≤ 2 s).
8. Form fields are populated: projectName = "jobplc", descriptiveName = "jobplc",
   environment = "devsand", owner = "Example User".
9. A blue banner "📋 Pre-filled from jobplc / devsand" appears.
10. Step 1 (Module Selection): "functionAppSvcWindows" is already checked.
11. User fills in projectAge (new value) and approvalNumber (new JIRA ticket).
12. User proceeds through the wizard as normal.
```

### Status and Error Handling

| Scenario | User-Visible Behaviour |
|---|---|
| App list load fails | Selector shows "Unable to load apps. Retry?" with a retry button. Form is still usable. |
| Metadata fetch returns 404 | Error banner: "App 'jobplc / devsand' not found in service-catalog." |
| Metadata fetch returns 500 | Error banner: "Could not load metadata. Please fill in manually." |
| Metadata fetch times out (> 5 s) | Request is aborted; error banner shown. |
| User overrides a pre-filled value | Pre-fill banner remains; no warning (user is in control). |
| User loads a second app after loading first | Confirmation dialog: "This will replace the current pre-filled data. Continue?" |

---

## 10. Risks, Assumptions, and Open Questions

### Known Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| GitHub API rate limits slow down app list or metadata fetch | Low | Medium | `GET /api/installed-apps` already caches per request; add server-side TTL cache (5 min) for `getInstalledApps()` results |
| `getApplicationDetails()` fix breaks `/api/deployed-apps` consumers | Low | Medium | Audit API consumers (internal only); document breaking change; align with backend team before deploy |
| `appName` or `environment` parameter injection via URL | Low | High | Mitigated by FR-005 / NFR-005 input validation |
| Stale data: metadata file lags behind actual deployed state | Medium | Low | This is read-only pre-fill; user can override any field. Add note in UI: "Values are from last deployment." |
| Multiple files per app (e.g., `jobplc-devsand.json` AND `jobplc-sand.json`) | Known/expected | None | Environment dropdown scoped per app handles this naturally |

### Explicit Assumptions

1. The canonical file naming convention `{appName}-{environment}.json` is enforced for **all**
   files in `docs/metadata/`. Legacy files using `{appName}.json` (no environment suffix) are
   edge cases that the fallback scan in `getApplicationDetails()` (FR-007) handles.
2. The Infrastructure GitHub App installation already covers read access to
   `organization/service-catalog`. No new credential setup is required.
3. `projectName` in the form maps 1:1 to the `project` (or `projectName`) field in the metadata
   JSON. There is no separate "display name" vs "identifier" distinction in the selector.
4. The `AppSelector.vue` component does not need to support multi-select (one app at a time).
5. `approvalNumber` and `projectAge` must always be freshly entered by the user, even on
   pre-fill, because they represent intent for the **new** workflow run, not the historical one.

### Open Questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| OQ-1 | Should `GET /api/deployed-apps/:projectName/:environment` be deprecated or kept as-is after the FR-007 fix? | Backend Lead | No — can be addressed post-launch |
| OQ-2 | Should the pre-fill banner persist across wizard steps or only on Step 0? | UX Designer / Stakeholder | No — default: Step 0 only |
| OQ-3 | Is there a product requirement to also pre-fill the `ExistingInfraChangePage.vue` (agent flow)? | Product Owner | No — explicitly out of scope for this phase |
| OQ-4 | Should a server-side response cache be added for `GET /api/app-metadata` to avoid GitHub rate limits? | Backend Lead | No — add in Phase 2 if needed |
| OQ-5 | Should the `lifecycle` field from metadata be displayed as read-only info in the selector section (even though it's not pre-filled into the form)? | UX Designer | No — nice-to-have, can be added post-launch |

---

## 11. Delivery Plan

### Phase 1 — Backend Foundation (Sprint 1)

- [ ] FR-007: Fix `getApplicationDetails()` file naming in `infrastructureService.js`
- [ ] FR-002: Implement `GET /api/app-metadata/:appName/:environment` route
- [ ] FR-008: Extend `InstalledApp` TypeScript interface + add `AppMetadata` type

**Definition of Done**: New endpoint passes all unit and integration tests.
`GET /api/app-metadata/jobplc/devsand` returns correct normalized JSON.

### Phase 2 — Frontend Components (Sprint 1–2)

- [ ] FR-005: Build `AppSelector.vue` reusable component
- [ ] FR-006: Add `apiService.getAppMetadata()` to `srcV2/services/api.ts`
- [ ] FR-003: Wire pre-fill into `CustomInfrastructurePage.vue` (Step 0 + Step 1)

**Definition of Done**: Selecting an app on Custom Infrastructure form pre-fills all mapped
fields and modules. Confirmation banner visible. Error states handled.

### Phase 3 — ~~Template Deploy Extension~~ — **Removed from this release**

~~FR-004: Wire `AppSelector.vue` and pre-fill into `TemplateDeployPage.vue`~~

> Template Deploy pre-fill is deferred. Only Custom Infrastructure is in scope.

### Rollout Notes

- Feature can be deployed behind an environment variable flag
  (e.g., `VITE_ENABLE_CATALOG_PREFILL=true`) during initial rollout.
- Rollback: removing `AppSelector` from pages does not affect any existing functionality;
  backend endpoints are additive and do not change existing routes.

---

## 12. Test and Validation Strategy

### Backend Unit Tests

| Test | Assertion |
|---|---|
| `GET /api/app-metadata/jobplc/devsand` (happy path) | Returns HTTP 200, `data.name === "jobplc"`, `data.environment === "devsand"` |
| `GET /api/app-metadata/notexist/devsand` | Returns HTTP 404 |
| `GET /api/app-metadata/../../etc/passwd/devsand` | Returns HTTP 400 |
| `GET /api/app-metadata/jobplc/invalid-env` | Returns HTTP 400 |
| Unauthenticated `GET /api/app-metadata/jobplc/devsand` | Returns HTTP 401 |
| `getApplicationDetails("jobplc", "devsand")` | GitHub API called with path `docs/metadata/jobplc-devsand.json` (assert call args) |
| GitHub 404 during metadata fetch | Returns `null` (no throw), service layer returns null, route returns HTTP 404 |

### Frontend Component Tests (Vitest + Vue Test Utils)

| Test | Assertion |
|---|---|
| `AppSelector.vue` mounts | App list loaded via `apiService.getInstalledApps()` on mount |
| Select app → environment dropdown | Environment options scoped to selected app |
| Click "Load" | `apiService.getAppMetadata()` called with correct args |
| API returns 200 | `@prefill` event emitted with metadata object |
| API returns 404 | `@error` event emitted; selector shows error message |
| `CustomInfrastructurePage.vue` with pre-fill | `projectName`, `owner`, `modules` fields set correctly after `@prefill` event |

### E2E Validation (Playwright)

| Test | Steps |
|---|---|
| Full pre-fill flow — Custom Infrastructure | Navigate → expand selector → pick app → pick env → Load → verify form values → complete wizard |
| Form remains usable if selector fails | Mock API failure → verify fields are editable → complete wizard without pre-fill |

### NFR Validation

| NFR | How Validated |
|---|---|
| NFR-001 (latency ≤ 2 000 ms) | `api_request_completed` telemetry in staging; assert p95 from log aggregation |
| NFR-004 (auth enforcement) | Integration test — unauthenticated request returns 401 |
| NFR-005 (input validation) | Unit tests for each invalid input class |
| NFR-007 (accessibility) | Manual keyboard test + automated axe-core scan |
| NFR-008 (no N+1 calls) | Unit test mocking GitHub API; assert `getContent` called exactly once per pre-fill |

---

## 13. Summary Table

| Metric | Count |
|---|---|
| Total Functional Requirements (FR) | 7 (FR-004 removed — out of scope) |
| Total Non-Functional Requirements (NFR) | 9 |
| `existing-refine` | 1 |
| `existing-extend` | 3 |
| `new-feature` | 4 (FR-004 removed) |
| `removed` | 1 (FR-004: Template Deploy pre-fill deferred) |

---

## 14. Next Decisions Needed

1. **OQ-1**: Decide whether to deprecate `GET /api/deployed-apps/:projectName/:environment`
   after FR-007 lands to avoid two similar single-app endpoints.
2. **OQ-3**: Confirm whether pre-fill on `ExistingInfraChangePage.vue` (agent flow) is in scope
   for a follow-on phase.
3. **OQ-4**: Decide if a server-side TTL cache (e.g., 5-minute in-memory cache for
   `getInstalledApps()`) should be added to prevent GitHub rate-limit exposure at scale.
4. **Design sign-off** on `AppSelector.vue` visual placement (collapsible vs. always-visible),
   confirmation dialog copy, and pre-fill banner design.
5. **Test environment**: Confirm that a `docs/metadata/` folder exists in the staging
   `service-catalog` repo with ≥ 1 file to enable E2E tests.

---

<!-- ORCHESTRATOR-READY
feature: service-catalog-prefill
prd_path: docs/prd/service-catalog-prefill.md
status: approved
fr_count: 7
nfr_count: 9
scope_note: FR-004 (Template Deploy pre-fill) removed — Custom Infrastructure only
-->
