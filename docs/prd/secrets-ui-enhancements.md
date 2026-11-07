# PRD: Secrets UI Enhancements — Platform-Filtered Apps, Bulk Secrets, Jira Tracking

## 1. Title and Metadata

| Field        | Value                                                                               |
|--------------|--------------------------------------------------------------------------------------|
| Feature Name | Secrets UI Enhancements v2                                                           |
| Slug         | `secrets-ui-enhancements`                                                            |
| Author       | Product Manager Agent                                                                |
| Date         | 2026-08-01                                                                           |
| Status       | `approved` (Challenger R2 passed)                                                   |
| Stakeholders | Platform Engineering, Application Developers, Security/Compliance Team               |
| Repository   | `Aya-DevOpsTeam/self-service-infra`                                                  |

---

## 2. Problem Statement

### Current Pain

The Secrets self-service page (`srcV2/pages/SecretsPage.vue`) was delivered in v1 with three
usability gaps that developers have reported:

1. **Application list is not filtered by infrastructure target**: When a developer selects
   `live` or `sand` as the infrastructure target, the application dropdown still shows **all**
   installed apps from `docs/metadata/` in the service-catalog repo. Applications that only
   exist in `infrastructure-live` (and vice versa) appear in the list, leading to confusion
   and failed vault discovery calls. Developers expect the app list to reflect only applications
   that actually exist in the selected target repository.

2. **Single-secret-at-a-time submission**: The current form allows submitting only one secret
   per interaction. Developers provisioning a new application often need to create 5–15 secrets
   at once (database connection strings, API keys, feature flags). Each submission requires
   filling the form, waiting for the PR, then repeating — a tedious and error-prone workflow.

3. **No Jira ticket tracking**: Unlike every other mutation flow in the portal (custom infra,
   template deploy, agent changes, AKS deploy, code repo bootstrap), the secrets submission
   does not capture a Jira/CR ticket number. This breaks the audit trail convention and makes
   it harder for platform engineers to correlate secret changes back to approved change requests.

### Why Now

The secrets feature was approved and shipped (PRD status: `approved`, 2026-07-31). These three
gaps were identified during the first week of production use and represent the highest-priority
feedback items. Addressing them before broader rollout (enabling `secrets: true` for more
environments) will prevent the same friction from scaling.

### Expected Business Value

| Outcome | Measurable Indicator |
|---|---|
| Reduce developer confusion from mismatched app lists | Support tickets for "vault not found" errors drop >80% |
| Faster bulk secret provisioning | Time to provision 10 secrets drops from ~15 min to <3 min |
| Complete audit trail for secret changes | 100% of secret PRs include a Jira/CR reference |

### User Personas

| Persona | Goal |
|---|---|
| **Application Developer** | See only relevant apps for the selected target; submit multiple secrets in one action; attach a Jira ticket for traceability |
| **Platform Engineer** | Correlate every secret PR to an approved Jira ticket; review bulk secret PRs efficiently |
| **Security/Compliance Reviewer** | Verify every secret change has a change-request reference in the PR description |

---

## 3. Goals, Success Metrics, and Non-Goals

### Goals

1. Filter the application dropdown on the Secrets page to show only applications that exist
   in the selected infrastructure target repository (`live` or `sand`).
2. Allow developers to add multiple secrets in a single submission, creating one PR with all
   secrets encrypted and committed together.
3. Require a Jira/CR ticket number on every secret submission, threaded into the PR description,
   commit message, and structured logs.

### Success Metrics

| Goal | Metric | Target |
|---|---|---|
| Platform-filtered apps | % of vault discovery calls returning `found: true` after app selection | >95% (up from ~70%) |
| Bulk secret submission | Average secrets per PR | >3 (up from 1.0) |
| Jira tracking coverage | % of secret PRs with a valid Jira reference | 100% |

### Non-Goals

- **Cross-target bulk submission** (submitting secrets to both `live` and `sand` in one action)
  — out of scope; each submission targets exactly one repository.
- **Jira API integration** (validating ticket existence, syncing status) — the Jira field is
  a free-text reference, consistent with all other portal flows. No Jira REST client.
- **Bulk secret deletion** — deletion remains out of scope per the v1 PRD.
- **Bulk secret import from file** (CSV/JSON upload) — out of scope for this iteration.
- **Changing the SOPS encryption model** — the existing single-secret-at-a-time SOPS encryption
  in `secretsService.js` is extended to handle multiple secrets per call, but the encryption
  architecture (wrapKey-only, per-vault `secrets.enc.yaml`) is unchanged.

---

## 4. Current State Assessment

### What Exists Today

| Capability | File | Notes |
|---|---|---|
| Secrets page with target selector, app/env dropdowns, single-secret form | `srcV2/pages/SecretsPage.vue:1-250` | Target selector (`live`/`sand`) exists but app list is not filtered by target |
| App list loaded from `GET /api/installed-apps` | `srcV2/pages/SecretsPage.vue:78-90` (`loadApps()`) | Fetches all apps from service-catalog `docs/metadata/`; no target parameter |
| `getInstalledApps()` reads from service-catalog only | `services/infrastructureService.js:143-221` | Hardcoded to `config.github.serviceRepo`; does not support `infrastructure-live` |
| Single secret submission form | `srcV2/pages/SecretsPage.vue:131-170` (`validateForm()`, `submitSecret()`) | One `secretName` + `secretValue` + `secretConfirmation` per submission |
| `POST /api/secrets` accepts single secret | `routes/api.js:260` | Validates single `secretName`/`secretValue` pair |
| `submitSecretViaGitOps()` encrypts and commits one secret | `services/secretsService.js` | Upserts one key into `secrets.enc.yaml` per call |
| Jira field on other flows | `srcV2/components/infrastructure/ProjectInfoForm.vue:113-124` | `approvalNumber` field with `/^[A-Za-z]+-\d+$/` validation; pattern reusable |
| Jira threading in agent-change flow | `routes/api.js:1532`, `services/githubService.js:1405-1434` | `jiraTicket` threaded into workflow dispatch inputs and PR description |
| Key Vault discovery by target | `services/secretsService.js` (`resolveKeyVaults`) | Already target-aware; tree enumeration works for both repos |
| HCL parser for infra-live apps | `services/hclParser.js:147-197` (`getApplicationsFromRepo()`) | Can scan `infrastructure-live` for app directories; not yet used by secrets page |

### Gaps and Limitations

- **App list not target-aware**: `loadApps()` in `SecretsPage.vue` calls `GET /api/installed-apps`
  which reads from `service-catalog` only. When `target=live` is selected, the app list should
  show applications from `infrastructure-live` instead. The `hclParser.getApplicationsFromRepo()`
  method can discover apps from either repo but is not wired to the secrets page.
- **No bulk secret form**: The form has single `secretName`/`secretValue` refs. No array-based
  state, no "add another" button, no batch validation.
- **No Jira field on secrets form**: Unlike `ProjectInfoForm.vue`, `ExistingInfraChangePage.vue`,
  `TemplateDeployPage.vue`, and `InstalledAppsPage.vue`, the secrets page has no Jira input.
- **`POST /api/secrets` accepts only one secret**: The request body schema is
  `{ target, appName, environment, vaultDir, secretName, secretValue }` — singular.
- **`submitSecretViaGitOps` processes one secret per call**: The service method upserts one key
  into `secrets.enc.yaml`. Calling it N times for N secrets would create N branches and N PRs.

---

## 5. Requirement Classification Matrix

| Capability | Classification | Evidence | Proposed Action |
|---|---|---|---|
| Filter app list by infrastructure target | `existing-extend` | `SecretsPage.vue:78-90` loads all apps; `hclParser.getApplicationsFromRepo()` exists but unused | Add target-aware app discovery endpoint or parameter; wire to secrets page |
| Bulk secret submission (UI) | `existing-extend` | Single-secret form exists at `SecretsPage.vue:131-170` | Extend form to array-based state with add/remove rows |
| Bulk secret submission (API) | `existing-extend` | `POST /api/secrets` accepts single secret; `submitSecretViaGitOps` upserts one key | Accept `secrets[]` array; upsert all keys into one `secrets.enc.yaml` commit |
| Jira ticket field (UI) | `existing-extend` | Pattern exists in `ProjectInfoForm.vue:113-124`; absent from `SecretsPage.vue` | Add Jira input field with same validation pattern |
| Jira ticket in PR description | `existing-extend` | Pattern exists in `githubService.triggerAgentDispatch:1405-1434` | Thread `jiraTicket` into secret PR description and commit message |
| Jira ticket in structured logs | `existing-extend` | `logMetric('secret_create_submitted')` exists but has no `jiraTicket` field | Add `jiraTicket` to metric payload |

---

## 6. Functional Requirements (FR)

### FR-001 — Platform-Filtered Application List

**Description**: When a developer selects an infrastructure target (`live` or `sand`) on the
Secrets page, the application dropdown must show only applications that exist in that target
repository. Applications from the other target must not appear.

**Priority**: must

**Rationale**: Showing all apps regardless of target leads to failed vault discovery calls and
developer confusion. The app list must reflect reality for the selected infrastructure scope.

**Acceptance Criteria**:

- (a) A new API endpoint `GET /api/secrets/apps?target=live|sand` returns a deduplicated list
  of application names discovered from the selected target repository. For `sand`, this reads
  from `docs/metadata/` in `config.github.serviceRepo` (existing `getInstalledApps()` path).
  For `live`, this discovers application directories under `infrastructure/` in
  `config.github.infrastructureLiveRepo` (using `hclParser.getApplicationsFromRepo()` or
  equivalent tree enumeration from `secretsService.resolveKeyVaults`).
- (b) Alternatively, the existing `GET /api/installed-apps` endpoint may be extended with an
  optional `?target=live|sand` query parameter. When `target=live`, it returns apps discovered
  from `infrastructure-live`. When `target=sand` or omitted, it returns apps from
  `service-catalog` (backward-compatible default).
- (c) `SecretsPage.vue` re-fetches the app list whenever the `target` selector changes. The
  `watch([selectedAppName, selectedEnvironment, target], loadSecrets)` watcher already exists;
  `loadApps()` must also react to `target` changes.
- (d) The app list response includes at minimum `{ name, environment }` pairs so the existing
  `appNames` and `filteredEnvironments` computed properties continue to work.
- (e) For `target=live`, environments are derived from the repository directory structure
  (e.g., `infrastructure/{appName}/{environment}/`), not from `data/environments.json`.
  This is consistent with FR-001(d) of the v1 secrets PRD which states environments are
  "not restricted to `data/environments.json`" for secrets operations.
- (f) The endpoint is protected by `requireAuth` middleware.
- (g) Results are cached in-process for 5 minutes (same TTL as `resolveKeyVaults` cache) to
  avoid repeated tree fetches on rapid target toggling.
- (h) `correlationId` is present in every response and log line.

**Dependencies**: Existing `hclParser.getApplicationsFromRepo()`, `secretsService.resolveKeyVaults`
tree cache, `requireAuth` middleware.

---

### FR-002 — Bulk Secret Submission (UI)

**Description**: The Secrets page form must allow developers to add multiple secret name/value
pairs in a single submission. Each row has its own name, value, and confirmation fields. The
developer can add and remove rows before submitting all secrets as one batch.

**Priority**: must

**Rationale**: Developers provisioning new applications typically need 5–15 secrets. Submitting
them one at a time is tedious and creates unnecessary PR review overhead.

**Acceptance Criteria**:

- (a) The form state changes from single refs (`secretName`, `secretValue`,
  `secretConfirmation`) to an array of secret entries:
  ```typescript
  interface SecretFormEntry {
    name: string
    value: string
    confirmation: string
  }
  const secretEntries = ref<SecretFormEntry[]>([{ name: '', value: '', confirmation: '' }])
  ```
- (b) An "Add Secret" button appends a new empty entry to the array. The button is disabled
  when the array reaches a configurable maximum (default: 20 secrets per submission).
- (c) Each row has a "Remove" button (disabled when only one row remains) that removes that
  entry from the array.
- (d) Validation (`validateForm()`) iterates all entries: each `name` must match
  `/^[a-zA-Z0-9-]{1,127}$/`, each `value` must be non-empty, each `confirmation` must match
  its `value`. Duplicate names within the same submission are rejected with a clear error
  message. Field errors are keyed by row index + field name.
- (e) The "Submit" button is disabled when any row has validation errors or when the array
  is empty.
- (f) All `value` and `confirmation` fields use `type="password"` and are never logged to
  the browser console.
- (g) On successful submission, all rows are cleared and reset to a single empty entry.
- (h) The `StatusModal` shows the count of secrets submitted (e.g., "3 secrets encrypted and
  PR #456 opened for review").
- (i) If the batch submission fails (e.g., SOPS encryption error on any entry, SHA conflict),
  the `StatusModal` shows a failure state with the error message. The form retains all entered
  data (secret rows and Jira ticket) so the developer can fix and retry without re-entering.
  No partial submission occurs — the batch is all-or-nothing.

**Dependencies**: Existing `StatusModal.vue`, existing form validation pattern.

---

### FR-003 — Bulk Secret Submission (API)

**Description**: `POST /api/secrets` must accept an array of secrets in a single request and
commit all of them to one branch/PR, rather than requiring one API call per secret.

**Priority**: must

**Rationale**: One PR per batch is easier to review, reduces GitHub API calls, and avoids the
concurrent-submission conflict (v1 FR-002(k)) that would occur if N individual calls raced
against the same `secrets.enc.yaml`.

**Acceptance Criteria**:

- (a) `POST /api/secrets` accepts a new request body shape:
  ```json
  {
    "target": "live|sand",
    "appName": "string",
    "environment": "string",
    "vaultDir": "string (optional when single vault)",
    "jiraTicket": "string (required, see FR-004)",
    "secrets": [
      { "secretName": "string", "secretValue": "string" },
      { "secretName": "string", "secretValue": "string" }
    ]
  }
  ```
- (b) **Backward compatibility**: If the request body contains `secretName` and `secretValue`
  (singular, the v1 shape), the backend wraps them into a single-element `secrets[]` array
  internally. This ensures any existing integrations or scripts continue to work.
- (c) The `secrets` array is validated: minimum 1 entry, maximum 20 entries. Each entry's
  `secretName` must match `/^[a-zA-Z0-9-]{1,127}$/` and `secretValue` must be non-empty.
  Duplicate `secretName` values within the array are rejected with HTTP 400.
- (d) `secretValue` fields are never logged. The log line for bulk submission includes
  `{ secretCount: N, secretNames: [...], appName, environment, jiraTicket, correlationId }`
  but never any value.
- (e) All secrets are upserted into the same `{vaultDir}/secrets.enc.yaml` in a single commit
  on a single branch. The branch name uses the format
  `secrets/{appName}-{environment}-{vaultSlug}-bulk-{shortHash}` where `shortHash` is the first
  8 characters of a SHA-256 of the sorted secret names. This keeps branches short and
  deterministic — the same set of secret names produces the same branch, enabling
  retry-idempotency. Requests using the legacy singular `{ secretName, secretValue }` shape
  (FR-003(b) backward compatibility) retain the v1 branch format
  `secrets/{appName}-{environment}-{vaultSlug}-{secretName}` unchanged, so existing tooling
  and `githubService.findOpenPullRequest()` dedup behavior is preserved.
- (f) One PR is opened for the batch. The PR description includes: target, appName,
  environment, jiraTicket, list of secret names (not values), correlationId, and user email.
- (g) The SHA-based conflict detection from v1 FR-002(k) still applies: if `secrets.enc.yaml`
  changed since the branch was based, return HTTP 503 with retry guidance.
- (h) The endpoint returns `{ success: true, correlationId, prNumber, prUrl, secretCount }`.
- (i) `logMetric('secret_create_submitted', { secretCount, jiraTicket, ... })` is emitted once
  per batch, not once per secret.
- (j) **Atomicity**: all `secrets[]` entries are encrypted in memory first; the GitHub commit
  and PR are only created if every entry encrypts successfully. If any single entry fails
  encryption, the request aborts with HTTP 400, the response lists only the failing
  `secretName` values (never any `secretValue`), and zero GitHub writes occur (no partial
  commit, no branch).

**Dependencies**: Existing `secretsService.submitSecretViaGitOps()` (extended for batch),
FR-004 (Jira field), existing conflict detection logic.

---

### FR-004 — Jira Ticket Required Field

**Description**: The Secrets page must include a mandatory Jira/CR ticket number field. The
value is threaded into the API request, PR description, commit message, and structured logs.

**Priority**: must

**Rationale**: Every other mutation flow in the portal captures a Jira/CR reference for audit
traceability. The secrets flow is the only exception, breaking the convention and making it
harder for platform engineers to correlate changes to approved requests.

**Acceptance Criteria**:

- (a) A `Jira/CR Number` input field is added to the secrets form, positioned above the
  secret name/value rows. The field uses the same placeholder text as `ProjectInfoForm.vue`:
  `"e.g., JIRA-1234 or CR-5678"`.
- (b) The field is **required** — the submit button is disabled when it is empty.
- (c) The field is validated with the pattern `/^[A-Za-z]+-\d+$/` (same as
  `ProjectInfoForm.vue:219-221`), matching standard Jira ticket formats like `DSO-1234`,
  `CR-5678`, `INFRA-42`.
- (d) The `jiraTicket` value is included in the `POST /api/secrets` request body.
- (e) The backend validates `jiraTicket` with `check('jiraTicket').notEmpty().matches(/^[A-Za-z]+-\d+$/)`.
- (f) The PR description created by `submitSecretViaGitOps` includes `Jira: {jiraTicket}` as
  a line item, consistent with how `triggerAgentDispatch` includes `jira_ticket` in workflow
  inputs (`services/githubService.js:1405-1434`).
- (g) The commit message includes the Jira ticket: e.g.,
  `"chore(secrets): add 3 secrets for {appName}/{environment} [{jiraTicket}]"`.
- (h) `logMetric('secret_create_submitted')` includes `jiraTicket` in the metric payload.
- (i) The Jira field value persists across "Add Secret" row additions (it is form-level, not
  per-secret-row).

**Dependencies**: Existing Jira validation pattern from `ProjectInfoForm.vue`, existing
`logMetric` pattern.

---

## 7. Non-Functional Requirements (NFR)

### NFR-PERF-001 — App Discovery Latency

**Description**: `GET /api/secrets/apps?target=live` must respond within 3000 ms at p95.
The `infrastructure-live` tree fetch may be larger than `service-catalog` metadata reads.

**Measurable Target**: p95 latency ≤ 3000 ms. `latency_ms` emitted via `logMetric`.

---

### NFR-PERF-002 — Bulk Submission Latency

**Description**: `POST /api/secrets` with up to 20 secrets must complete within a reasonable
latency budget. SOPS encryption shells out to the `sops` binary via `execFileAsync` once per
secret value (sequential), so latency scales linearly with count.

**Measurable Target**: Provisional — p95 latency ≤ 5000 ms for 20 secrets, pending validation
by OQ-003. If benchmarking shows `sops` invocation cost exceeds ~200 ms per secret (process
spawn + key-material fetch), the cap or target must be adjusted before implementation.
`latency_ms` emitted via `logMetric` on every response for SLO tracking.

---

### NFR-SEC-001 — No Plaintext Values in Logs (Extended)

**Description**: The existing NFR-SEC-001 from v1 extends to bulk submissions. No `secretValue`
from any entry in the `secrets[]` array may appear in any log line, PR description, metric
payload, or error response.

**Measurable Target**: 0 occurrences. CI grep enforcement unchanged.

---

### NFR-UX-001 — Bulk Form Usability

**Description**: The bulk secret form must be keyboard-navigable. Tab order flows through
name → value → confirmation → next row. The "Add Secret" button is reachable via Tab after
the last row's confirmation field.

**Measurable Target**: Full form completable via keyboard only (no mouse required).

---

## 8. Open Questions (OQ)

### OQ-001 — App Discovery Source for `target=live`

**Question**: Should `GET /api/secrets/apps?target=live` use the existing `hclParser.getApplicationsFromRepo()`
(which scans `infrastructure/` for `env.hcl` files) or the `resolveKeyVaults` tree cache
(which already fetches the full tree and could extract app names as a side effect)?

**Proposed Resolution**: Use the `resolveKeyVaults` tree cache. It already fetches the full
`infrastructure-live` tree with 5-minute caching and stampede protection. Extracting unique
app names (first segment after `infrastructure/`) from the cached tree avoids a second GitHub
API call. The `hclParser` approach requires separate per-directory listing calls.

**Status**: Open — Architect to decide.

---

### OQ-002 — Bulk Branch Naming and Idempotency

**Question**: The v1 branch naming convention is
`secrets/{appName}-{environment}-{vaultSlug}-{secretName}`. For bulk submissions, should the
branch name include all secret names (potentially very long) or use a timestamp/hash?

**Resolution**: Use `secrets/{appName}-{environment}-{vaultSlug}-bulk-{shortHash}`
where `shortHash` is the first 8 characters of a SHA-256 of the sorted secret names. This
keeps branches short and deterministic (same set of names = same branch = idempotent).
Legacy single-secret requests (backward-compat path) retain the v1 branch format unchanged.
FR-003(e) has been updated to match this resolution.

**Status**: Resolved.

---

### OQ-003 — Maximum Secrets Per Submission

**Question**: What is the right cap for `secrets[]` array size? 20 is proposed but may need
adjustment based on SOPS encryption time and GitHub API rate limits.

**Proposed Resolution**: Start with 20. Monitor `latency_ms` metrics and adjust if p95
exceeds the 5000 ms budget.

**Status**: Open — to be validated during implementation.

---

## 9. API and Data Impact

### Modified Endpoints

| Endpoint | Change | Breaking? |
|---|---|---|
| `POST /api/secrets` | Accept `secrets[]` array and `jiraTicket` field; backward-compatible with singular `secretName`/`secretValue` shape | No — v1 shape still accepted via FR-003(b) |
| `GET /api/secrets/:appName/:environment` | No change | No |

### New Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/secrets/apps?target=live\|sand` | GET | Returns deduplicated app/environment list from the selected target repository. Protected by `requireAuth`. |

### Data Model Changes

- `POST /api/secrets` request body gains: `secrets[]` array (new), `jiraTicket` string (new)
- `POST /api/secrets` response body gains: `secretCount` integer (new)
- No changes to `data/environments.json` schema (no new feature flags)
- No changes to `docs/metadata/` JSON schema
- PR descriptions gain `Jira: {jiraTicket}` line and `Secrets: {name1}, {name2}, ...` list

---

## 10. UX and Workflow Impact

### User Workflow Changes

1. **Target selection now filters apps**: Switching between `live` and `sand` reloads the
   application dropdown with only apps from that target. Previously all apps showed regardless.
2. **Bulk secret form**: The single name/value/confirmation row is replaced by a dynamic list
   with "Add Secret" and per-row "Remove" buttons. Minimum 1 row, maximum 20.
3. **Jira field**: A new required `Jira/CR Number` field appears above the secret rows. Submit
   is disabled until a valid Jira ticket is entered.
4. **StatusModal message**: Shows count of secrets submitted (e.g., "3 secrets encrypted and
   PR #456 opened for review") instead of singular message.
5. **Batch error handling**: If any secret in the batch fails encryption, the entire batch is
   rejected. The StatusModal shows a failure state with the error message. The form retains
   all entered data so the developer can fix and retry without re-entering everything.

### No Workflow Changes

- Target selector position and behavior unchanged
- Environment selector behavior unchanged
- Vault filter/selector behavior unchanged

### Removed

- **Secret metadata list (read-only table)**: The read-only list of existing secret names (name +
  vault + last updated) is removed from `SecretsPage.vue`. The bulk-submission form is now the sole
  surface on the page. Existing secret **names** are no longer displayed; Key Vault discovery (`vaults`)
  is still fetched and used only to populate the vault selector when more than one vault exists.
  Rationale: secret names can leak sensitive context (e.g., `DB-PROD-CONNECTION-STRING`, `PAYMENT-API-KEY`),
  and the bulk workflow makes a long static table a poor fit. The v1 FR-001 metadata-list requirement is
  superseded by this change; `GET /api/secrets` still returns the data, only the UI no longer renders it.

---

## 11. Risks and Assumptions

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `infrastructure-live` tree fetch times out or returns truncated for large repos | App list for `target=live` is incomplete or empty | Fall back to a paginated `GET /repos/{repo}/contents/infrastructure` non-recursive directory listing to recover top-level app names. If even that fails, surface a warning banner in the UI ("App list may be incomplete — try again or contact platform team") rather than silently showing a partial list |
| Bulk SOPS encryption of 20 secrets exceeds 5s latency budget | Poor UX; potential HTTP timeout | Start with cap of 20; monitor `latency_ms` metric; reduce cap if p95 > 5000 ms |
| Concurrent bulk submissions to same `secrets.enc.yaml` cause SHA conflict | HTTP 503 returned; developer must retry | Existing v1 SHA-based conflict detection handles this; bulk reduces frequency since fewer PRs are created |
| Jira ticket format validation rejects non-standard ticket IDs | Developers with non-Jira trackers blocked | Use the same permissive regex as `ProjectInfoForm.vue` (`/^[A-Za-z]+-\d+$/`) which covers most issue tracker formats |

### Assumptions

- The Infrastructure GitHub App (`githubService.octokit`) has read access to `infrastructure-live` repository tree (confirmed by v1 OQ-003 resolution).
- Application names in `infrastructure-live` are unique at the first segment after `infrastructure/` (same assumption as `resolveKeyVaults` tree enumeration).
- The `hclParser.getApplicationsFromRepo()` or tree-cache-derived app list returns `{ name, environment }` pairs sufficient for the existing `appNames`/`filteredEnvironments` computed properties.
- SOPS encryption time scales linearly with secret count (each value encrypted independently).
- The existing `StatusModal.vue` component can display batch-level messages without modification.

---

## 12. Out-of-Scope

- Jira API integration (ticket validation, status sync, auto-creation)
- Bulk secret import from file (CSV/JSON upload)
- Cross-target bulk submission (secrets to both `live` and `sand` in one action)
- Secret deletion (remains manual per v1 PRD)
- Changes to SOPS encryption architecture or key management
- Changes to the `secrets` feature flag rollout (remains opt-in per environment)

---

## 13. Dependencies on Existing v1 Secrets PRD

This PRD extends the approved `secret-self-service` PRD (2026-07-31). All v1 FRs, NFRs, and
architectural decisions remain in effect. This PRD does not modify or supersede any v1
requirement — it adds three new capabilities on top of the shipped v1 implementation.

| v1 FR | Relationship |
|---|---|
| FR-001 (Secret Metadata List) | **Changed** — the read-only secret-name table is removed from the Secrets page; see "Removed" under §10. The `GET /api/secrets` data contract is retained, only the UI render is dropped |
| FR-002 (Create/Update Secret) | Extended by this PRD's FR-003 (bulk) and FR-004 (Jira) |
| FR-003 (Key Vault Discovery) | Unchanged; tree cache reused for FR-001 app discovery |
| FR-004 (Secrets Page) | Extended by this PRD's FR-001 (filtered apps), FR-002 (bulk form), FR-004 (Jira field) |
| FR-005 (Feature Flag) | Unchanged |
| FR-006 (Correlation ID) | Extended to include `jiraTicket` in all log events |
| FR-007 (Target Selection) | Unchanged; now also drives app list filtering |

---

## 14. Delivery Plan

### Delivery Strategy

All three FRs ship together in a single release. They are tightly coupled:
- FR-001 (filtered apps) changes the data source for the app dropdown
- FR-002/FR-003 (bulk) restructures the form and API contract
- FR-004 (Jira) adds a required field to the same form and API

Shipping them incrementally would require maintaining two form layouts and two API schemas
simultaneously, adding complexity without reducing risk.

### Rollout

- **Phase 1**: Deploy behind existing `secrets: true` feature flag (currently enabled only
  for `devsand`). No new feature flag needed — the enhancements are part of the secrets page.
- **Phase 2**: After 1 week of `devsand` validation, enable `secrets: true` for `sand`.
- **Phase 3**: Enable for remaining environments per platform team schedule.

### Rollback

- Revert the deployment to the previous container image. The v1 `POST /api/secrets` singular
  shape remains backward-compatible (FR-003(b)), so any PRs created by the bulk flow are
  valid Git artifacts regardless of portal version.

---

## 15. Test and Validation Strategy

### Unit Tests

| Scenario | File | Coverage |
|---|---|---|
| Bulk form validation — all entries valid | `srcV2/pages/SecretsPage.spec.ts` | FR-002(d) |
| Bulk form validation — duplicate names rejected | `srcV2/pages/SecretsPage.spec.ts` | FR-002(d) |
| Bulk form validation — max 20 entries enforced | `srcV2/pages/SecretsPage.spec.ts` | FR-002(b), FR-003(c) |
| Jira field required and regex-validated | `srcV2/pages/SecretsPage.spec.ts` | FR-004(b)(c) |
| Add/remove secret rows | `srcV2/pages/SecretsPage.spec.ts` | FR-002(b)(c) |
| Backward-compat single-secret wrapping | `services/secretsService.spec.ts` | FR-003(b) |
| Bulk upsert into secrets.enc.yaml | `services/secretsService.spec.ts` | FR-003(e) |
| Bulk branch naming with shortHash | `services/secretsService.spec.ts` | FR-003(e), OQ-002 |
| SHA conflict detection on bulk | `services/secretsService.spec.ts` | FR-003(g) |

### Integration Tests

| Scenario | File | Coverage |
|---|---|---|
| `GET /api/secrets/apps?target=live` returns filtered apps | `tests/integration/api/secrets.spec.ts` | FR-001(a) |
| `GET /api/secrets/apps?target=sand` returns service-catalog apps | `tests/integration/api/secrets.spec.ts` | FR-001(a) |
| `POST /api/secrets` with `secrets[]` array creates single PR | `tests/integration/api/secrets.spec.ts` | FR-003(e)(f) |
| `POST /api/secrets` with singular shape (backward compat) | `tests/integration/api/secrets.spec.ts` | FR-003(b) |
| `POST /api/secrets` rejects missing `jiraTicket` | `tests/integration/api/secrets.spec.ts` | FR-004(e) |
| `POST /api/secrets` rejects duplicate secret names | `tests/integration/api/secrets.spec.ts` | FR-003(c) |

### Manual Validation

| Scenario | Owner |
|---|---|
| Switch target live→sand and verify app list changes | QA Engineer |
| Submit 10 secrets in one batch and verify single PR | QA Engineer |
| Verify Jira ticket appears in PR description and commit message | QA Engineer |
| Verify no `secretValue` in any log line (grep server logs) | QA Engineer |
| Verify StatusModal shows correct count message | QA Engineer |
| Keyboard-only form completion (Tab through all rows) | QA Engineer |
| Batch error: simulate SOPS failure on entry 5 of 10, verify full batch rejected | QA Engineer |

<!-- ORCHESTRATOR-READY
feature: secrets-ui-enhancements
prd_path: docs/prd/secrets-ui-enhancements.md
status: approved
fr_count: 4
nfr_count: 4
-->
