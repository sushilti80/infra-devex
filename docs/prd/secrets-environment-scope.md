# PRD: Secrets Environment Scope — Tiered Grouping & Multi-Environment Fan-Out

## 1. Title and Metadata

| Field        | Value                                                                               |
|--------------|--------------------------------------------------------------------------------------|
| Feature Name | Secrets Environment Scope (tiered grouping + multi-select fan-out)                   |
| Slug         | `secrets-environment-scope`                                                          |
| Author       | Product Manager Agent                                                                |
| Date         | 2026-08-08                                                                           |
| Status       | `draft`                                                                              |
| Stakeholders | Platform Engineering, Application Developers, Security/Compliance Team               |
| Repository   | `organization/self-service-infra`                                                  |
| Extends      | `secret-self-service` (2026-07-31, approved), `secrets-ui-enhancements` (2026-08-01, approved) |

---

## 2. Problem Statement

### Current Pain

The Secrets page's environment selector is **not** the same concept as the portal's global
`data/environments.json` list (which only defines `devsand`/`sand`/`aisand` and gates unrelated
features like `customInfra`/`templates`/`aks` — source: [data/environments.json](../../data/environments.json)).
Instead, `discoverAppsForTarget()` and `resolveKeyVaults()` in
[services/secretsService.js](../../services/secretsService.js) (lines 261–420, 232–260) enumerate the
**actual Terragrunt directory tree** of the selected target repository (`infrastructure-live` for
`target=live`, `service-catalog` for `target=sand`) and return every environment-folder segment they
find, verbatim, with no filtering or grouping. This is confirmed by repo evidence: the
`azureDatabricks/<env>/keyvault` root alone contains real folder names `prod`, `nonprod`,
`shared-services`, `int`, `dev`, `devsand`, and `sand`
(`.github/agent-memory/repo/secrets-keyvault-pattern-analysis.md` — no equivalent naming survey exists
for the general `infrastructure/<app>/<env>` layout, and `data/agents.json:125` independently confirms
`prod` is a real environment folder name developers reference elsewhere in the portal). Two gaps result:

1. **No environment grouping/tiering.** [SecretsPage.vue](../../srcV2/pages/SecretsPage.vue) renders
   `filteredEnvironments` (a flat, alphabetically sorted array — see the computed at line ~76) in one
   `<select>` with zero visual or functional distinction between a production folder (e.g. `prod`) and a
   sandbox/dev folder (e.g. `dev`, `devsand`). There is no metadata anywhere in this repository that
   marks any given environment folder name as production-tier or not — confirmed by inspection of
   [data/environments.json](../../data/environments.json) (3 portal-scoped environments only, unrelated
   to infra-live folder names) and [data/modules.json](../../data/modules.json) (module catalog, no
   per-environment tier field). The platform currently has no way to curate, distinguish, or gate
   which environment tiers are exposed for self-service secret writes.
2. **No multi-select / fan-out submission.** `selectedEnvironment` in `SecretsPage.vue` is a single
   `ref('')` bound to one `<select>` (see the `secret-app-env` select element and the
   `filteredEnvironments` computed it's populated from), and `resolveSecretMetadata()` /
   `submitSecret()` (lines ~125–180) call `api.getSecrets(...)` and `api.submitSecret(...)` with exactly
   one `environment` value per invocation. `POST /api/secrets`
   ([routes/api.js](../../routes/api.js), line 310) accepts a single `environment` field in its request
   body, and `submitSecretViaGitOps()` ([services/secretsService.js](../../services/secretsService.js),
   line 560) resolves and commits to exactly one environment's vault per call. A developer who needs to
   push the same secret name/value pair(s) to `dev` + `qa` + `staging` for one app must repeat the
   entire select-app → select-environment → resolve-vault → fill-rows → submit flow three times.

### Why Now

Both prior secrets iterations (`secret-self-service`, `secrets-ui-enhancements`) are shipped and in
production use (`secret-self-service`: `pass_with_gaps`, sandbox-cleared; `secrets-ui-enhancements`:
QA `pass`, per `.github/agent-memory/project-state/MEMORY.md`). Developers provisioning multi-tier
applications (the common case — every app in `infrastructure-live` has at least a non-prod and a prod
folder) have reported that the current single-environment flow does not scale to that reality, and
that an unfiltered flat environment list makes it easy to accidentally target a production folder
without realizing it. Both issues compound the more environments an app has.

### Expected Business Value

| Outcome | Measurable Indicator |
|---|---|
| Reduce risk of accidental production-tier secret submission | 100% of `secret_create_submitted` log entries touching a `tier: 'production'` environment carry `confirmedProductionWrite: true` (per NFR-SEC-002); 0 entries with a production-tier environment and `confirmedProductionWrite: false` within 90 days of launch |
| Reduce developer time to provision secrets across multiple environments | Median time to submit the same secret(s) to 3 environments drops from ~3x single-environment time to <1.5x |
| Increase visibility into which environment tier a submission targets | 100% of Secrets page environment options are visually grouped by tier at launch |

### User Personas

| Persona | Goal |
|---|---|
| **Application Developer** | See environments grouped by tier so they know at a glance which options are production; select multiple non-prod environments and submit once instead of repeating the flow |
| **Platform Engineer** | Curate/confirm which environment tiers are exposed and whether production writes need an extra safeguard |
| **Security/Compliance Reviewer** | Confirm production-tier secret writes remain deliberate, auditable, and distinguishable from non-prod writes in logs and PRs |

---

## 3. Goals, Success Metrics, and Non-Goals

### Goals

1. Group the discovered environment options on the Secrets page into a "Production" tier and a
   "Non-Production" tier (or an "Unclassified" fallback bucket — see OQ-001), instead of one flat list.
2. Replace the current single-select environment `<select>` with a multi-select control that lets a
   developer choose one or more environments for the same app in one session.
3. Extend `POST /api/secrets` to accept multiple target environments in a single request and fan out
   the same secret(s) to each selected environment's independently resolved vault(s), reusing the
   existing `resolveKeyVaults()` / `submitSecretViaGitOps()` / SOPS-encrypt / branch-per-submission
   GitOps pattern per environment — not a new write mechanism.
4. Define concrete, testable partial-failure semantics for the fan-out submission (e.g., 2 of 3
   environment writes succeed, 1 fails) so the API contract and UI feedback are unambiguous.
5. Record the stakeholder-confirmed decisions for two previously open governance questions (the
   environment tier-detection rule — OQ-001; the production-tier write confirmation safeguard —
   OQ-002), while continuing to surface the remaining genuinely open questions (OQ-004, OQ-005) rather
   than guessing at them.

### Success Metrics

| Goal | Metric | Target |
|---|---|---|
| Tiered grouping | % of Secrets page environment options rendered under a tier heading (not a flat list) | 100% at launch |
| Multi-select adoption | % of secret submissions targeting >1 environment, 30 days post-launch | >20% (baseline: 0%, since it's not currently possible) |
| Fan-out time savings | Median time to submit identical secret(s) to 3 environments | <1.5x the time for 1 environment (down from ~3x) |
| Partial-failure clarity | % of QA partial-failure test scenarios where the API response unambiguously identifies which environment(s) succeeded/failed | 100% |

### Non-Goals

- **Designing a new tier-detection algorithm beyond the resolved OQ-001 mechanism.** The classification
  approach itself is now fixed (curated `data/environmentTiers.json` groups); ongoing curation of which
  environment names belong to which group is Platform Engineering's operational responsibility, not
  something this PRD prescribes.
- **Building a stricter (typed) confirmation pattern.** OQ-002 is resolved in favor of the one-click
  "Confirm production write" modal; a typed-confirmation variant is out of scope for this release.
- **Cross-target fan-out** (submitting to both `live` and `sand` in one action) — each submission
  still targets exactly one `target` (`live` or `sand`), consistent with the existing Non-Goal in
  `secrets-ui-enhancements` (§3).
- **Multi-vault disambiguation within a fan-out submission.** If a selected environment resolves to
  more than one candidate Key Vault (per `resolveKeyVaults()`'s existing `VAULT_AMBIGUOUS` case), that
  environment is excluded from the fan-out batch in v1 — the developer submits it individually via the
  existing single-environment flow. See FR-003(f).
- **Changing the SOPS encryption model, vault discovery algorithm, or GitOps branch/PR mechanism.**
  This PRD is strictly a UI + request-contract extension that loops the existing per-environment logic;
  it does not modify `resolveKeyVaults()`'s classification rules or `submitSecretViaGitOps()`'s
  encryption/commit internals.
- **Automatic retry of failed environments within a fan-out batch.** A failed environment surfaces its
  error to the developer, who resubmits manually (same retry model as the existing single-environment
  `CONFLICT` 503 case). See OQ-005.
- **Environment tier changes to `data/environments.json`.** That file remains scoped to portal feature
  flags (`customInfra`/`templates`/`aks`/`secrets`) for the 3 portal-known environments; it is not
  extended to catalog every infra-live/service-catalog environment folder name.

---

## 4. Current State Assessment

### What Exists Today (Evidence Table)

| Capability | File | Notes |
|---|---|---|
| Flat, unfiltered environment discovery per app | [services/secretsService.js](../../services/secretsService.js) `discoverAppsForTarget()` (lines 261–420, esp. 337–420) | Enumerates every environment-folder segment under the two recognised vault roots (`infrastructure/`, `azureDatabricks/`) for the selected `target`; returns `{ name, environment, qualifier? }` tuples with no tier field and no filtering |
| Per-app environment list (single-select) | [srcV2/pages/SecretsPage.vue](../../srcV2/pages/SecretsPage.vue) `filteredEnvironments` computed (~line 76) | `Array.from(new Set(...)).sort()` — flat, alphabetically sorted, no grouping |
| Single-select environment binding | `srcV2/pages/SecretsPage.vue` `selectedEnvironment = ref('')` (~line 19), `secret-app-env` `<select>` element (single value, not multi) | One environment per `resolveSecretMetadata()`/`submitSecret()` call |
| Per-environment vault resolution | `services/secretsService.js` `resolveKeyVaults(appName, environment, target, correlationId, qualifier)` (lines 232–260) | Already scoped to exactly one `environment` argument; reusable per-environment inside a loop without modification |
| Per-environment GitOps submission | `services/secretsService.js` `submitSecretViaGitOps({ target, appName, environment, vaultDir, secrets, jiraTicket, ... })` (lines 560–695) | Resolves one vault, encrypts N secrets, opens one branch/PR for that single environment; the branch-naming and SHA-conflict-detection pattern (FR-002(k)/(h) of `secret-self-service`) is exactly the mechanism this PRD's fan-out reuses per environment, unchanged |
| Single-environment request contract | [routes/api.js](../../routes/api.js) `POST /api/secrets` (line 310) | Body validated as `{ target, appName, environment, vaultDir?, qualifier?, jiraTicket, secrets[] }` — `environment` is a single string, not an array |
| Portal-scoped environment/feature-flag list | [data/environments.json](../../data/environments.json) | Only `devsand`, `sand`, `aisand`; gates `customInfra`/`templates`/`aks`/`secrets` flags; **not** the same concept as infra-live/service-catalog environment folder names (confirmed: FR-001(d)/(e) of `secret-self-service` and `secrets-ui-enhancements` PRDs both explicitly state Secrets-page environments are not restricted to this file) |
| Module catalog | [data/modules.json](../../data/modules.json) | No per-environment tier/classification field of any kind |
| Environment tier classification source | `data/environmentTiers.json` (does not exist yet — new, this PRD) | Resolved via OQ-001: a new hand-maintained config file mapping named groups (e.g., `production`, `nonProduction`, `other`) to environment folder names, following the same catalog convention as `data/environments.json`/`data/modules.json`/`data/roles.json`; to be created as part of FR-001 implementation, owned by Platform Engineering |
| Evidence that "prod"-named folders are real and unfiltered today | `.github/agent-memory/repo/secrets-keyvault-pattern-analysis.md` (lines 3–4) | `azureDatabricks/<env>/keyvault` root has 7 real environment folders: `prod`, `shared-services`, `nonprod`, `int`, `dev`, `devsand`, `sand` — `nonprod` and `shared-services` show the real folder-naming convention is inconsistent, not a clean binary prod/non-prod split |
| Related-but-different "production" concept | [srcV2/types/infrastructure.types.ts](../../srcV2/types/infrastructure.types.ts) `Lifecycle` type (`'experimental' \| 'development' \| 'production'`) | This is a **per-application lifecycle field** in installed-app metadata (`docs/metadata/*.json`), unrelated to the per-environment-folder tiering this PRD needs. Must not be conflated — see OQ-001. |
| No confirmation-step UI pattern exists for destructive/sensitive actions | `srcV2/pages/InstalledAppsPage.vue` (line 99); closest precedent: [srcV2/components/infrastructure/AppSelector.vue](../../srcV2/components/infrastructure/AppSelector.vue) (lines 144–172, 202, 270–286) | `InstalledAppsPage.vue` uses only a native browser `confirm()` for delete. `AppSelector.vue` has a closer, working precedent: an inline confirm/cancel dialog (`showConfirmDialog` ref, `data-testid="confirm-overwrite-dialog"`, `role="dialog"`, `aria-modal="true"`, explicit "Yes"/"Cancel" buttons) gating its own "overwrite existing form data" action. It is **not** an extracted, reusable component — the markup, state, and handlers (`confirmOverwrite`/`cancelOverwrite`) live inline in `AppSelector.vue` and are not exported for reuse elsewhere. |
| Bulk secret submission response shape (single environment) | `routes/api.js` `POST /api/secrets` handler (lines ~390–430) | Returns `{ success: true, correlationId, prNumber, prUrl, secretCount }` — a single PR reference, no per-environment result array |

### Gaps and Limitations

- No source of truth exists anywhere in this repository (`data/*.json`, `docs/*`, or code) that
  classifies an infra-live/service-catalog environment folder name as production vs non-production.
- The Secrets page environment selector is architecturally single-value end-to-end: the Vue `ref`, the
  `GET /api/secrets` call, and the `POST /api/secrets` request body all carry exactly one `environment`.
- `POST /api/secrets` has no concept of a partial-success response; its current contract assumes
  exactly one PR is always the outcome of a call that succeeds.
- No reusable confirmation-dialog component exists to gate a sensitive submission before it fires.

---

## 5. Requirement Classification Matrix

| Capability | Classification | Evidence | Proposed Action |
|---|---|---|---|
| Environment tier grouping/display in UI | `existing-extend` | `filteredEnvironments` computed and its flat `<select>` already exist in `SecretsPage.vue`; no tier data source exists anywhere (Evidence Table row 8) | Extend `GET /api/secrets/apps` response with a computed `tier` field per `{name, environment}` pair, sourced from the new `data/environmentTiers.json` curated-groups config (resolved per OQ-001); group the existing select's options under tier headings |
| Multi-select environment picker (UI) | `existing-extend` | Single-select `ref`/`<select>` already exists at the exact call sites this PRD must change (`selectedEnvironment`, `filteredEnvironments`, `secret-app-env` element) | Replace single-select binding with a multi-select-capable control bound to a `selectedEnvironments: string[]` ref |
| Fan-out submission (backend loop over environments) | `existing-extend` | `resolveKeyVaults()` and `submitSecretViaGitOps()` are already single-environment-scoped, reusable functions — no new encryption/GitOps mechanism is needed, only a caller-side loop | Add a thin orchestration layer in `secretsService.js` that calls the existing per-environment functions once per selected environment and aggregates results |
| Partial-failure response contract | `existing-extend` | `POST /api/secrets` already returns a structured JSON body (`{ success, correlationId, prNumber, prUrl, secretCount }`) for the single-environment case; this PRD extends that shape, it does not invent a new response mechanism | Define `results: []` array and HTTP status semantics (FR-005) |
| Production-tier write safeguard (confirmation step) | `new-feature` | `AppSelector.vue` has a working inline confirm/cancel dialog pattern (Evidence Table row 9) that is functionally close to what FR-007 needs, but it is not an extracted, reusable component — it is scoped inline to `AppSelector.vue`'s own overwrite-confirmation use case, with no shared component, composable, or prop contract that `SecretsPage.vue` could import as-is. Resolved via OQ-002 as a committed requirement. | Build FR-007's modal by adapting `AppSelector.vue`'s existing dialog markup/state pattern (dialog structure, `aria-modal`, explicit Yes/Cancel actions) rather than designing one from scratch — this is new code in `SecretsPage.vue` (hence `new-feature`), but the Architect should extract or mirror `AppSelector.vue`'s pattern instead of inventing a new confirmation UX, which should reduce estimated effort |
| Backward compatibility for existing single-environment callers | `existing-extend` | The current `POST /api/secrets` singular `environment` field is live and must keep working, mirroring the exact precedent set by `secrets-ui-enhancements` FR-003(b) for the singular `secretName`/`secretValue` shape | Accept both `environment` (legacy, singular) and `environments` (new, array); wrap legacy singular into a one-element array internally |

---

## 6. Functional Requirements (FR)

### FR-001 — Environment Tier Grouping (Data + UI)

**Description**: The Secrets page must present discovered environment options grouped under tier
headings (e.g., "Production" and "Non-Production") rather than as one flat alphabetical list. Each
`{name, environment}` pair returned by the existing app-discovery endpoint gains a computed `tier`
classification.

**Priority**: must

**Rationale**: Developers currently cannot visually distinguish a production environment folder from a
sandbox one in the selector, which is the root cause of the "no way to distinguish prod" gap in the
Problem Statement.

**Acceptance Criteria**:

- (a) `GET /api/secrets/apps?target=live|sand` ([routes/api.js](../../routes/api.js) line 175) response
  entries gain a `tier` field: `{ name, environment, qualifier?, tier: 'production' | 'non-production' | 'unclassified' }`.
  **Resolved via OQ-001** (Option 2): classification is driven by a new curated config file,
  `data/environmentTiers.json`, structured as named groups (e.g., `production`, `nonProduction`,
  `other`) mapping each group to the environment folder names it contains — not a regex heuristic and
  not a hybrid. This follows the same hand-maintained catalog convention as
  `data/environments.json`/`data/modules.json`/`data/roles.json`, owned and edited by Platform
  Engineering as environments are onboarded.
- (b) `unclassified` is the safe-default outcome for any environment folder name not present in any
  group in `data/environmentTiers.json` (e.g., `hub`, `int`, `shared-services` until Platform
  Engineering adds them to a group — see Evidence Table). The rule never silently defaults an unknown
  name to `non-production`. The UI must render an "Other" group for `unclassified` entries rather than
  hiding or erroring on them.
- (c) `SecretsPage.vue`'s environment `<select>` (or its multi-select replacement, FR-002) renders
  `<optgroup>`-equivalent groupings labeled "Production", "Non-Production", and "Other" (only rendered
  when at least one entry exists in that tier), sorted alphabetically within each group.
- (d) The tier classification is computed server-side (not duplicated client-side), so the Vue
  component only renders whatever `tier` value the API returns — consistent with the platform
  convention of environment/feature logic living in `data/*.json`-backed services, not hardcoded in
  Vue components.
- (e) Existing consumers of `GET /api/secrets/apps` that do not read the new `tier` field continue to
  work unmodified (additive-only response change).
- (f) `correlationId` continues to be present on every response, unchanged from the existing endpoint.

**Dependencies**: `data/environmentTiers.json` (new config file introducing the resolved OQ-001
mechanism), existing `discoverAppsForTarget()` (`services/secretsService.js`).

---

### FR-002 — Multi-Select Environment Picker (UI)

**Description**: The single-select environment `<select>` on the Secrets page is replaced by a
multi-select control that lets a developer choose one or more environments for the selected
application in one interaction.

**Priority**: must

**Rationale**: This is the primary UX change that eliminates the repeat-the-whole-flow-per-environment
pain point described in the Problem Statement.

**Acceptance Criteria**:

- (a) `selectedEnvironment: Ref<string>` is replaced with `selectedEnvironments: Ref<string[]>` in
  `SecretsPage.vue`. All downstream computed properties and watchers that currently key off
  `selectedEnvironment` (`filteredEnvironments` usage, the `watch(selectedEnvironment, ...)` at ~line
  178, `resolveSecretMetadata()`) are updated to iterate `selectedEnvironments`.
- (b) The control renders as a set of checkboxes (one per environment option, grouped per FR-001(c)),
  not a native multi-`<select>` — native multi-select has poor discoverability and requires
  Ctrl/Cmd-click, which fails the existing keyboard-accessibility bar this page already meets
  (`secrets-ui-enhancements` NFR-UX-001). Checkboxes are tab-navigable and their checked state is
  independently togglable via keyboard.
- (c) At least one environment must be selected for the submit button to enable; this mirrors the
  existing `isFormValid` computed's role (`SecretsPage.vue` ~line 84) — the multi-select selection
  becomes one more condition it evaluates.
- (d) Selecting or deselecting an environment does not require re-selecting the application; only the
  environment-scoped vault resolution (FR-003) re-runs for the changed selection.
- (e) A maximum of 10 environments may be selected per submission (see OQ-003 for the numeric cap
  rationale). The 11th checkbox attempt is disabled with a visible reason
  ("Maximum 10 environments per submission").
- (f) When exactly one environment is selected, the page's existing single-environment vault/qualifier
  selector behavior (FR-004 of `secret-self-service`, sub-app qualifier selector of `secrets-ui-enhancements`)
  is preserved unchanged — this FR only adds the ability to select more than one.

**Dependencies**: FR-001 (tier grouping, for rendering groups), FR-003 (per-environment vault
resolution).

---

### FR-003 — Multi-Environment Vault Resolution

**Description**: When multiple environments are selected, the backend resolves the Key Vault(s) for
each selected environment independently, reusing the existing `resolveKeyVaults()` function unchanged,
and reports per-environment resolution outcomes before submission.

**Priority**: must

**Rationale**: Reuses the existing, already-hardened vault-discovery logic (dual-root enumeration,
qualifier disambiguation, truncated-tree fallback) rather than reimplementing it for a multi-environment
case.

**Acceptance Criteria**:

- (a) For each environment in `selectedEnvironments`, the frontend (or a new lightweight batch endpoint,
  implementation detail for the Architect) calls the equivalent of
  `resolveKeyVaults(appName, environment, target, correlationId, qualifier)` once, unmodified.
- (b) If an environment resolves `found: false` (no vault), that environment is flagged as
  unresolvable in the UI (e.g., a warning icon next to its checkbox) but does **not** block resolution
  or selection of the other selected environments.
- (c) If an environment resolves more than one candidate vault (`VAULT_AMBIGUOUS`) and the app has no
  single default, that environment cannot be included in a multi-environment fan-out submission in v1
  (see Non-Goals). The UI must disable that environment's checkbox with a tooltip/message directing the
  developer to submit it individually via the single-environment flow (i.e., select only that one
  environment).
- (d) If an environment resolves multiple sub-app qualifiers (`QUALIFIER_AMBIGUOUS`) and the developer
  has not yet chosen a qualifier, that environment is likewise excluded from the batch until qualifier
  ambiguity is resolved for it individually — the existing qualifier selector (FR-004 of
  `secret-self-service`) is not extended to a per-environment-array shape in this PRD.
- (e) Resolution results are cached using the existing 5-minute repo-level tree cache
  (`services/secretsService.js` `treeCache`/`getCachedTree`) — no new caching mechanism is introduced;
  N environment lookups against the same `target` share the same cached tree fetch.
- (f) The set of environments eligible for fan-out submission (i.e., excluding any per (c)/(d)) is
  computed before the submit button is enabled, so the developer sees which of their selections will
  actually be submitted.

**Dependencies**: FR-002 (selection surface), unchanged `resolveKeyVaults()`.

---

### FR-004 — Fan-Out Secret Submission (API Contract Change)

**Description**: `POST /api/secrets` accepts multiple target environments in a single request and
commits the same secret(s) independently to each environment's resolved vault, reusing
`submitSecretViaGitOps()` once per environment — one branch and one PR per environment, exactly as the
existing single-environment flow already produces per call.

**Priority**: must

**Rationale**: This is the backend half of the fan-out requirement; it must not reinvent the GitOps
mechanism, only loop it.

**Acceptance Criteria**:

- (a) The request body gains a new `environments: string[]` field (1–10 entries, matching FR-002(e)'s
  cap) as an alternative to the existing singular `environment: string` field. Exactly one of
  `environment` or `environments` must be present; supplying both returns HTTP 400. **Implementation
  note**: the existing `POST /api/secrets` validator chain currently declares
  `check('environment').matches(/^[a-zA-Z0-9_-]{1,32}$/)` ([routes/api.js](../../routes/api.js) line 313)
  as unconditionally required (no `.optional()`). This validator must become conditional (e.g.,
  `.optional()` combined with a custom cross-field check that exactly one of `environment`/`environments`
  is present) — it cannot simply stay required once `environments` becomes a valid alternative.
- (b) `environments` entries are validated with the same regex already used for the singular
  `environment` field (`/^[a-zA-Z0-9_-]{1,32}$/`, [routes/api.js](../../routes/api.js) line 210).
  Duplicate entries within `environments` are rejected with HTTP 400.
- (c) For each entry in `environments`, the backend calls the existing `resolveKeyVaults()` then
  `submitSecretViaGitOps()` logic **exactly as it runs today for a single `environment`** — same
  vaultDir allow-list validation, same SOPS encryption, same SHA-based conflict detection, same branch
  naming pattern (`secrets/{appName}-{environment}-{qualifierPrefix}{vaultSlug}-{secretName|bulk-hash}`),
  same PR body fields. No new encryption or branch-naming scheme is introduced — the loop body is the
  unmodified existing function.
- (d) `vaultDir`/`qualifier`, if supplied, apply identically across every environment in the batch (the
  developer is not asked to pick a different vault per environment in v1 — see FR-003(c)/(d) for the
  environments this excludes from the batch entirely).
- (e) Each environment's submission is independent: a failure resolving or committing for one
  environment does not prevent, roll back, or delay the others. Each environment's outcome (success or
  a specific failure code) is captured and returned together (see FR-005).
- (f) Environments excluded by FR-003(c)/(d) (ambiguous vault or qualifier) must not be silently
  dropped from the request — if the client still includes such an environment in `environments`, the
  backend re-runs the same ambiguity check and returns that environment's specific `VAULT_AMBIGUOUS` /
  `QUALIFIER_AMBIGUOUS` code in its per-environment result (FR-005), not a blanket request-level error.
- (g) The legacy singular `environment` field continues to work exactly as today (see FR-006);
  internally it is treated as `environments: [environment]`.

**Dependencies**: FR-003 (resolution), FR-005 (response contract), FR-006 (backward compatibility),
unchanged `submitSecretViaGitOps()`.

---

### FR-005 — Partial-Failure Response Semantics

**Description**: The API response for a multi-environment submission must unambiguously report which
environments succeeded, which failed, and why — with a defined HTTP status code convention — so the
UI and any programmatic caller can render or act on partial success without guessing.

**Priority**: must

**Rationale**: The Problem Statement explicitly calls this out as a requirement, not an afterthought:
"if 2 of 3 environment writes succeed and 1 fails, what HTTP status/response shape applies" must have a
concrete answer.

**Acceptance Criteria**:

- (a) The response body always includes a `results` array, one entry per requested environment, in the
  order submitted:
  ```json
  {
    "success": true,
    "correlationId": "...",
    "secretCount": 3,
    "results": [
      { "environment": "dev", "success": true, "prNumber": 101, "prUrl": "https://...", "secretCount": 3 },
      { "environment": "qa", "success": true, "prNumber": 102, "prUrl": "https://...", "secretCount": 3 },
      { "environment": "staging", "success": false, "errorCode": "CONFLICT", "error": "Concurrent secret submission detected, please retry" }
    ]
  }
  ```
- (b) HTTP status code convention:
  - **All environments succeed** → HTTP 201, top-level `success: true`.
  - **Some succeed, some fail** (partial success) → HTTP 207 (Multi-Status), top-level `success: false`.
    The client must inspect `results[]` to determine per-environment outcome; a 207 response is never
    treated as a full failure by the UI (FR-005(d)).
  - **All environments fail** → the top-level HTTP status matches the existing single-environment error
    convention for the *first* failing environment's error code (e.g., 422 if every environment failed
    `FOUND_FALSE`, 503 if every environment hit `CONFLICT`), with `success: false` and the full
    `results[]` array still present so each environment's specific reason is retrievable. If failures
    have mixed error codes across environments, the top-level status is 500 with `results[]` carrying
    the per-environment detail (the caller should read `results[]`, not rely on the top-level code, for
    the authoritative per-environment reason).
- (c) Each failing entry's `errorCode` reuses the existing single-environment error codes unchanged —
  the full, exhaustive set of 9 codes handled by `POST /api/secrets`'s `statusByCode` map
  ([routes/api.js](../../routes/api.js), lines 424–433): `FOUND_FALSE`, `VAULT_AMBIGUOUS`,
  `VAULT_INVALID`, `PR_EXISTS`, `CONFLICT`, `ENCRYPTION_FAILED`, `SOPS_NOT_CONFIGURED`,
  `QUALIFIER_AMBIGUOUS`, `QUALIFIER_MISMATCH` — no new error taxonomy is introduced. `SOPS_NOT_CONFIGURED`
  (503) applies uniformly across the batch since SOPS configuration is a server-wide precondition, not
  a per-environment one — if it fires, it will typically fire identically for every environment in the
  same request.
- (d) The `StatusModal` on the Secrets page renders a per-environment outcome list (environment name +
  success/failure + PR link or error message) rather than a single message, for any submission covering
  more than one environment. The single-environment case (`environments.length === 1` or legacy
  `environment` field) continues to show the existing single-message success/failure UI unchanged.
- (e) `logMetric('secret_create_submitted', ...)` gains an `environments` array and a `partialFailure:
  boolean` field; it is emitted once per batch (not once per environment), consistent with the existing
  bulk-secret metric emission pattern (`secrets-ui-enhancements` FR-003(i)).
- (f) `secretValue` is never present in any `results[]` entry, matching the existing no-plaintext-in-logs
  invariant (NFR-SEC-001).

**Dependencies**: FR-004 (fan-out submission), existing per-environment error codes in
`submitSecretViaGitOps()`.

---

### FR-006 — Backward-Compatible Request Shape

**Description**: Existing callers sending the legacy singular `environment: string` field to
`POST /api/secrets` continue to work unmodified after this feature ships.

**Priority**: must

**Rationale**: `POST /api/secrets` is already live in production for `secret-self-service` and
`secrets-ui-enhancements`; this PRD must not break existing integrations, mirroring the exact
precedent already set for the singular `secretName`/`secretValue` shape in `secrets-ui-enhancements`
FR-003(b).

**Acceptance Criteria**:

- (a) If the request body contains `environment` (singular, string) and no `environments` field, the
  backend treats it as `environments: [environment]` internally and processes it through the same
  fan-out code path as a one-element array.
- (b) The response for a legacy single-`environment` request is **not** wrapped in the new
  `results: []` array shape by default at the top level for existing fields — `prNumber`, `prUrl`, and
  `secretCount` remain present at the top level exactly as today, in addition to (not instead of) the
  new `results` array (which will contain that same single entry). This ensures any script or test
  parsing the current top-level fields continues to work unchanged while new callers can adopt
  `results[]`.
- (c) If both `environment` and `environments` are supplied in the same request, return HTTP 400 with
  `{ success: false, error: 'Provide either environment or environments, not both', correlationId }`.
- (d) All existing single-environment integration tests (`tests/integration/service/secretsRouteValidation.spec.ts`)
  continue to pass unmodified.

**Dependencies**: FR-004.

---

### FR-007 — Production-Tier Submission Safeguard

**Description**: Before a submission that includes at least one environment classified `tier:
'production'` (per FR-001) is sent, the developer sees an explicit confirmation step distinguishing it
from a routine non-production submission.

**Priority**: must

**Rationale**: The Problem Statement explicitly asks for this to be raised, not assumed: "propose one
but mark it as an Open Question for stakeholder sign-off given this touches production write
governance."

**Acceptance Criteria**:

- (a) When `submitSecret()` is invoked and at least one entry in the eligible-for-submission environment
  set (FR-003(f)) has `tier: 'production'`, a confirmation step is shown before the existing
  `POST /api/secrets` call fires. **Resolved via OQ-002**: the shipped mechanism is a lightweight modal
  listing the affected production environment name(s) and requiring the developer to click an explicit
  "Confirm production write" action (not simply re-clicking the original Submit button) before the
  request proceeds. No typed-confirmation text box — the one-click modal is the final design, not a
  provisional default. Implementation should adapt the existing inline confirm/cancel dialog pattern in
  [srcV2/components/infrastructure/AppSelector.vue](../../srcV2/components/infrastructure/AppSelector.vue)
  (`showConfirmDialog` ref + dialog markup, lines 144–172/202) rather than building a new dialog pattern
  from scratch (see Evidence Table / Classification Matrix).
- (b) The confirmation step is skipped entirely when every eligible environment in the submission is
  non-production or unclassified.
- (c) If the confirmation is dismissed/cancelled, no API call is made and no partial state is created.
- (d) The fact that a production-tier confirmation occurred is included in the `secret_create_submitted`
  metric payload (`confirmedProductionWrite: boolean`) for audit purposes.
- (e) This safeguard applies uniformly regardless of how many non-production environments are bundled in
  the same submission — one production entry in the batch is enough to trigger it.

**Dependencies**: FR-001 (tier classification).

---

## 7. Non-Functional Requirements (NFR)

### NFR-PERF-001 — Fan-Out Submission Latency

**Description**: A submission covering the maximum 10 environments × 20 secrets must complete within a
bounded latency budget. `submitSecretViaGitOps()` already shells out to SOPS once per secret value
sequentially (per `secrets-ui-enhancements` NFR-PERF-002); a 10-environment fan-out multiplies that
cost by up to 10x if executed serially.

**Measurable Target**: p95 latency ≤ 15000 ms for a 10-environment × 20-secret submission.
Per-environment submissions **must** execute concurrently (not serially) — this is a hard requirement
of this NFR, not an implementation detail left to the Architect's discretion. `latency_ms` (total) and
`per_environment_latency_ms` (array) are emitted via `logMetric` for SLO tracking. This target is a
Definition-of-Done gate (§11); it is not provisional or subject to revisiting after a feasibility spike.
If a GitHub secondary-rate-limit constraint is discovered during implementation that makes concurrent
execution infeasible, that is a scope/architecture escalation back to Product (potentially lowering the
10-environment cap in FR-002(e)/FR-004(a)) — it does not relax this NFR's 15000 ms target for whatever
cap ships.

---

### NFR-REL-001 — Per-Environment Atomicity, No Cross-Environment Rollback

**Description**: A failure in one environment's resolution or GitOps commit must never roll back,
block, or corrupt another environment's already-completed (or independently in-flight) submission.
Each environment's branch/PR is a fully independent Git artifact.

**Measurable Target**: 0 observed instances, across QA partial-failure test scenarios, of one
environment's failure affecting another environment's successful PR/branch state.

---

### NFR-SEC-001 — No Plaintext Secret Values in Logs or Responses (Extended)

**Description**: The existing no-plaintext invariant (`secret-self-service` NFR, `secrets-ui-enhancements`
NFR-SEC-001) extends to every entry in the new `results[]` array and to the `environments` field in
`logMetric` payloads.

**Measurable Target**: 0 occurrences of any `secretValue` in logs, PR descriptions, or API responses
across the fan-out code path. Enforced by the existing CI grep check.

---

### NFR-SEC-002 — Production-Tier Write Audit Trail

**Description**: When FR-007 ships, every submission touching a production-tier environment must be
distinguishably auditable from a non-production submission in structured logs, independent of whether
the confirmation-step design in FR-007 is the typed or one-click variant.

**Measurable Target**: 100% of `secret_create_submitted` log entries where any `results[].environment`
resolves to `tier: 'production'` include `confirmedProductionWrite: true` and the list of affected
production environment names.

---

### NFR-OBS-001 — Correlation ID and Per-Environment Result Threading

**Description**: The single `correlationId` for a fan-out submission threads through every
per-environment sub-operation's log lines, matching the platform-wide correlation ID convention. Each
`results[]` entry is traceable back to the same correlationId.

**Measurable Target**: 100% of log lines emitted during a fan-out submission (across all
per-environment resolutions and commits) carry the request's single `correlationId`.

---

### NFR-USA-001 — Multi-Select Keyboard Accessibility

**Description**: The multi-select environment picker (checkboxes grouped by tier, FR-002(b)) must be
fully operable via keyboard alone, consistent with the existing accessibility bar this page already
meets (`secrets-ui-enhancements` NFR-UX-001).

**Measurable Target**: Every environment checkbox, tier group, and the submit button is reachable and
togglable via Tab/Space alone, with no mouse interaction required, verified by manual QA.

---

### NFR-SCALE-001 — Bounded GitHub API Call Volume Per Submission

**Description**: A fan-out submission's GitHub API call volume (branch creates, file reads/writes, PR
creates) scales linearly with the number of selected environments. The environment cap (FR-002(e),
10) exists specifically to bound this worst case and avoid tripping GitHub secondary rate limits within
a single request.

**Measurable Target**: A 10-environment fan-out submission issues no more GitHub API calls than
10× the existing single-environment call count (no additional N² or redundant calls introduced by the
orchestration layer).

---

## 8. API and Data Impact

### Modified Endpoints

| Endpoint | Change | Breaking? |
|---|---|---|
| `GET /api/secrets/apps?target=live\|sand` | Each `{name, environment, qualifier?}` entry gains a `tier: 'production' \| 'non-production' \| 'unclassified'` field | No — additive field only |
| `POST /api/secrets` | Accepts new `environments: string[]` (1–10 entries) as an alternative to the legacy singular `environment` field; response gains `results: []` array | No — legacy singular `environment` field and legacy top-level response fields (`prNumber`, `prUrl`, `secretCount`) remain fully supported per FR-006 |

### No New Endpoints

This PRD intentionally does not introduce a new endpoint — both required behavior changes (tiered
grouping data, fan-out submission) are additive extensions of the two existing Secrets endpoints.

### Data Model Changes

- `GET /api/secrets/apps` response entries gain `tier` (new, additive).
- `POST /api/secrets` request body gains `environments: string[]` (new, mutually exclusive with legacy
  `environment`).
- `POST /api/secrets` response body gains `results: []` (new, additive alongside legacy top-level
  fields).
- No changes to `data/environments.json` schema (see Non-Goals).
- No changes to `docs/metadata/*.json` schema.
- No changes to the `secrets.enc.yaml` file format or its location convention — each environment's
  vault file is written exactly as today, once per environment in the fan-out loop.
- **New data file**: `data/environmentTiers.json` is introduced (resolved per OQ-001) — a
  hand-maintained config mapping named groups (e.g., `production`, `nonProduction`, `other`) to
  environment folder names, following the same catalog convention as
  `data/environments.json`/`data/modules.json`/`data/roles.json`. Owned and edited by Platform
  Engineering; read server-side by the tier-classification logic backing FR-001(a).

### Backward Compatibility

Fully backward-compatible per FR-006: existing scripts/tests sending the legacy singular `environment`
field and reading the legacy top-level response fields require no changes.

---

## 9. UX and Workflow Impact

### User Journey Summary

1. Developer selects target (`live`/`sand`) and application, as today.
2. The environment picker now renders checkboxes grouped under "Production" / "Non-Production" /
   "Other" headings (FR-001, FR-002) instead of one flat `<select>`.
3. Developer checks one or more non-production environments (or a production environment, triggering
   FR-007's confirmation if approved) for the same application.
4. Vault resolution runs per selected environment (FR-003); any environment needing individual
   disambiguation (ambiguous vault/qualifier) is flagged and excluded from the batch with guidance to
   submit it separately.
5. Developer fills the same secret name/value rows as today (unchanged from `secrets-ui-enhancements`
   FR-002) and clicks Submit once.
6. If any selected environment is production-tier, the developer confirms the production-tier write
   (FR-007's one-click "Confirm production write" modal, resolved per OQ-002).
7. `StatusModal` shows a per-environment result list — success (with PR link) or failure (with reason)
   for each environment — instead of a single message (FR-005(d)).

### Status and Error Handling Expectations

- Partial success is a first-class, clearly-labeled outcome, not treated as a page-level error.
- A developer can identify, from the `StatusModal` alone, exactly which environment(s) need a
  resubmission after a partial failure.
- Environments excluded from the batch due to ambiguity (FR-003(c)/(d)) are visually distinguished
  *before* submission, not discovered only after a failed attempt.

---

## 10. Risks, Assumptions, Open Questions

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| An environment folder name is missing from `data/environmentTiers.json` (not yet added by Platform Engineering to any group) | Developer sees "Other"/`unclassified` for what may actually be a production environment, until the config file is updated | Resolved per OQ-001: default to `unclassified` (never silently to `non-production`) for any name absent from every group; Platform Engineering keeps `data/environmentTiers.json` current as new environments are onboarded |
| Serial per-environment GitOps calls make a 10-environment submission slow enough to feel broken | Developer perceives the fan-out feature as unreliable/hung | NFR-PERF-001 requires concurrent execution as a hard target; if a rate-limit constraint makes it infeasible during implementation, that is an escalation to Product to lower the 10-environment cap, not a relaxation of the 15000 ms target |
| FR-007's confirmation step adds friction developers weren't expecting, or a stricter typed-confirmation pattern turns out to be needed after all | Developer friction complaints, or a governance gap if the one-click modal proves insufficient | Resolved per OQ-002 as a one-click modal for this release; revisit via a follow-up decision if Security/Compliance later requires a stricter pattern |
| A per-environment partial failure is misread by the UI as a full failure (or vice versa), hiding successful PRs from the developer | Developer resubmits an already-successful environment, creating a duplicate PR attempt (mitigated by existing `PR_EXISTS` 409 idempotency, but still confusing) | FR-005(d) requires the per-environment result list to be the primary UI signal, not a single pass/fail message |

### Assumptions

- `resolveKeyVaults()` and `submitSecretViaGitOps()` require no internal modification — this PRD is
  additive orchestration around them, per the explicit reuse directive in the Problem Statement.
- GitHub API rate limits (secondary rate limiting on rapid sequential branch/PR creation) are the
  binding constraint on the environment cap and/or required concurrency, not GitHub API quota
  exhaustion under normal developer usage volume.
- Existing `secrets` feature flag rollout (`data/environments.json`) remains the portal-level gate for
  the Secrets page as a whole; this feature does not introduce a separate flag.

### Open Questions (OQ)

#### OQ-001 — Environment Tier-Detection Rule

**Question**: How should an environment folder name be classified as `production`, `non-production`,
or `unclassified`? No existing convention exists anywhere in this repository — `data/environments.json`
only covers 3 portal-level environments unrelated to infra-live folder names, and the real folder names
observed (`prod`, `nonprod`, `shared-services`, `int`, `hub`, `devsand`) do not follow one consistent
pattern (Evidence Table row 8).

**Candidate options for stakeholders to choose from**:
1. A simple heuristic regex (e.g., folder name is exactly `prod` or matches `/^prod/i` while excluding
   `nonprod`/`preprod`) — fast to ship, but will misclassify or under-classify uncommon names like
   `hub`, `shared-services`.
2. A curated allow-list config file (e.g., `data/environmentTiers.json` mapping known environment
   folder names to a tier), maintained by Platform Engineering as new apps/environments are onboarded —
   more accurate, but requires ongoing manual upkeep.
3. A hybrid: heuristic as the default, with the allow-list as an override for names the heuristic gets
   wrong.

**Status**: **Resolved** — Option 2 (curated allow-list config file). Platform Engineering confirmed
`data/environmentTiers.json`, structured as named groups (e.g., `production`, `nonProduction`,
`other`) rather than a flat name→tier map, so groups can be added to or renamed without changing the
schema. Any environment name absent from every group classifies as `unclassified` — the existing
safe-default behavior in FR-001(b) is unchanged. See FR-001(a) for the resolved acceptance criteria.

---

#### OQ-002 — Production-Tier Confirmation Safeguard: Required, and What Form?

**Question**: Should a submission touching a production-tier environment require an extra confirmation
step at all? If so, is a one-click "Confirm production write" modal (FR-007's proposed default)
sufficient, or does Security/Compliance require a stricter typed-confirmation pattern (e.g., typing the
environment name)?

**Status**: **Resolved** — Yes, ships as the one-click "Confirm production write" modal (FR-007), not
a typed-confirmation variant. Rationale: this matches the existing lower-friction UX patterns in this
codebase (no typed-confirm component precedent — Evidence Table row 9), and production writes already
flow through a required Jira ticket plus a human-reviewed PR/merge gate downstream, so the
portal-level step's job is preventing *accidental* selection, not serving as the sole control.

---

#### OQ-003 — Maximum Environments Per Fan-Out Submission

**Question**: Is 10 the right cap (FR-002(e)/FR-004(a))? It mirrors the existing 20-secrets-per-batch
precedent (`secrets-ui-enhancements` OQ-003) but multiplies GitHub API call volume differently (branch +
PR per environment vs. one commit per batch of secrets).

**Status**: **Resolved: 10 confirmed as the cap.** No changes needed to FR-002(e)/FR-004(a)/
NFR-SCALE-001 — they already specify 10; this question is closed with the existing value confirmed.

---

#### OQ-004 — Are There More Than Two Tiers?

**Question**: Real environment folder names include ambiguous cases that don't cleanly map to a binary
production/non-production split — e.g., `shared-services` (env-agnostic, per repo memory), `int`
(integration — arguably neither), `hub` (a grouping concept in some app layouts, not itself an
environment). Should the UI support a third tier bucket beyond "Production"/"Non-Production" (this PRD
proposes "Other"/`unclassified` as a safe default), or does Platform Engineering want a richer taxonomy
(e.g., "Shared", "Integration")?

**Status**: Open — safe to leave open for this release. FR-001(b)'s `unclassified`/"Other" bucket is a
complete, self-consistent fallback on its own (no environment name is ever hidden or errors), so this
question does not block FR-001 implementation or the Architect phase; revisit only if Platform
Engineering later requests a richer taxonomy.

---

#### OQ-005 — Retry Model for Partially-Failed Fan-Out Submissions

**Question**: Should a partially-failed fan-out submission support one-click "retry only the failed
environments," or is full manual resubmission (re-filling the form for just the failed environments)
acceptable, consistent with the existing single-environment `CONFLICT` retry model?

**Status**: **Resolved** — manual resubmission confirmed as the v1 retry model, consistent with the
existing single-environment `CONFLICT` retry pattern. No one-click "retry failed only" action ships in
this release (see Non-Goals and FR-004(e)). A one-click retry action may be revisited as a future
enhancement if partial-failure rates in production warrant it.

---

## 11. Delivery Plan

### Milestones / Phases

Ship as a single release — FR-001 through FR-007 are tightly coupled (the multi-select control depends
on the tiered grouping data; the fan-out API depends on the multi-select surface; the production-write
confirmation depends on tier classification). FR-007 is now a committed part of this release (resolved
per OQ-002), not conditional on further stakeholder sign-off.

### Definition of Done

- All `must`-priority FRs (FR-001–FR-007) implemented and passing their acceptance criteria.
- FR-001 implements the resolved OQ-001 mechanism (`data/environmentTiers.json`) before merge.
- FR-007 implements the resolved OQ-002 one-click confirmation design before merge.
- All NFR measurable targets validated by QA.

### Rollout

- Ships behind the existing `secrets: true` feature flag (`data/environments.json`) — no new flag
  introduced, consistent with `secrets-ui-enhancements`'s rollout approach.
- Phase 1: `devsand` validation.
- Phase 2: `sand` after 1 week of clean `devsand` operation.

### Rollback

- Revert to the previous container image. FR-006 guarantees the legacy singular `environment` request
  shape remains valid Git-producing input regardless of portal version, so any in-flight or historical
  single-environment submissions are unaffected by a rollback.

---

## 12. Test and Validation Strategy

### Unit Tests

| Scenario | File | Coverage |
|---|---|---|
| Tier classification function — production/non-production/unclassified cases | `srcV2/services/secretsService.spec.ts` | FR-001(a)(b) |
| Multi-select state management — add/remove environment selection | `srcV2/pages/SecretsPage.spec.ts` | FR-002(a)(c) |
| Environment cap enforcement (10 max) | `srcV2/pages/SecretsPage.spec.ts` | FR-002(e) |
| Fan-out orchestration — independent per-environment resolution | `tests/integration/service/secretsService.spec.ts` | FR-003(a)(b)(e) |
| Ambiguous-vault/qualifier environment exclusion from batch | `tests/integration/service/secretsService.spec.ts` | FR-003(c)(d) |
| Backward-compat legacy singular `environment` wrapping | `tests/integration/service/secretsService.spec.ts` | FR-006(a) |
| Mutually-exclusive `environment`/`environments` validation | `tests/integration/service/secretsRouteValidation.spec.ts` | FR-006(c) |
| Partial-failure `results[]` assembly and HTTP status selection | `tests/integration/service/secretsService.spec.ts` | FR-005(a)(b)(c) |

### Integration Tests

| Scenario | File | Coverage |
|---|---|---|
| `POST /api/secrets` with `environments[]`, all succeed → 201 | `tests/integration/service/secretsRouteValidation.spec.ts` (new cases) | FR-004, FR-005(b) |
| `POST /api/secrets` with `environments[]`, partial success → 207 with per-environment `results[]` | `tests/integration/service/secretsRouteValidation.spec.ts` (new cases) | FR-005(a)(b) |
| `POST /api/secrets` with `environments[]`, all fail → matching status with `results[]` | `tests/integration/service/secretsRouteValidation.spec.ts` (new cases) | FR-005(b) |
| `GET /api/secrets/apps` returns `tier` field per entry | `tests/integration/service/secretsRouteValidation.spec.ts` (new cases) | FR-001(a) |
| Legacy singular `environment` request/response shape unchanged | `tests/integration/service/secretsRouteValidation.spec.ts` (new cases) | FR-006 |
| `environments` exceeding 10 entries rejected | `tests/integration/service/secretsRouteValidation.spec.ts` (new cases) | FR-004(a) |
| End-to-end fan-out submission through the Secrets UI | `tests/e2e/secrets.spec.ts` (new cases) | FR-002, FR-004, FR-005(d), FR-007 |

### Manual Validation

| Scenario | Owner |
|---|---|
| Environment checkboxes render grouped by tier with an "Other" bucket for unclassified names | QA Engineer |
| Submit secrets to 3 environments in one action; verify 3 independent PRs and a per-environment result list in `StatusModal` | QA Engineer |
| Force one of three environments to fail (simulate `CONFLICT`); verify the other two still succeed and the failure is clearly attributed | QA Engineer |
| Keyboard-only completion of the multi-select picker | QA Engineer |
| If FR-007 ships: verify the production-tier confirmation step appears only when a production environment is selected | QA Engineer |
| Verify no `secretValue` appears in any log line across a multi-environment submission (grep server logs) | QA Engineer |

---

## Summary Table

| Metric | Count |
|---|---|
| Total FR count | 7 |
| Total NFR count | 7 |
| `existing-refine` | 0 |
| `existing-extend` | 5 |
| `new-feature` | 1 (FR-007, must — resolved via OQ-002, no longer provisional) |
| `unknown-needs-discovery` | 0 (all classification uncertainty is captured as Open Questions, not left as an unresolved classification) |

## Next Decisions Needed

1. ~~**OQ-001**~~ — **Resolved**: curated `data/environmentTiers.json` groups (Option 2).
2. ~~**OQ-002**~~ — **Resolved**: FR-007 ships as a one-click "Confirm production write" modal.
3. ~~**OQ-003**~~ — **Resolved**: 10 confirmed as the environment cap.
4. ~~**OQ-005**~~ — **Resolved**: manual resubmission confirmed as the v1 retry model.
5. **OQ-004** — Platform Engineering: confirm whether a third tier bucket beyond Production/Non-Production/Other
   is needed, or the "Other" fallback is sufficient (not a blocker for FR-001; safe to leave open per
   the FR-001(b) `unclassified` fallback).

<!-- ORCHESTRATOR-READY
feature: secrets-environment-scope
prd_path: docs/prd/secrets-environment-scope.md
status: draft
fr_count: 7
nfr_count: 7
-->
