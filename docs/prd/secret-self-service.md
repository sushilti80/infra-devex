# PRD: Developer Self-Service Secret Management

## 1. Title and Metadata

| Field        | Value                                                                               |
|--------------|-------------------------------------------------------------------------------------|
| Feature Name | Developer Self-Service Secret Management                                            |
| Slug         | `secret-self-service`                                                               |
| Author       | Product Manager Agent                                                               |
| Date         | 2026-07-23                                                                          |
| Status       | `approved` (human sign-off 2026-07-31, after PRD Challenger rounds 1–4)             |
| Stakeholders | Platform Engineering, Application Developers, Security/Compliance Team              |
| Repository   | `Aya-DevOpsTeam/self-service-infra`                                                 |

---

## 2. Problem Statement

### Current Pain

Application developers who need to create or update secrets in Azure Key Vault must either:
(a) request access to the Azure Portal directly (a manual, RBAC-heavy process), or
(b) raise a ticket with the platform team to perform the mutation on their behalf.

Neither path is auditable end-to-end, developer-friendly, or aligned with the GitOps model
the rest of the self-service infrastructure catalog follows. The AKS deployment flow
(`POST /api/aks-deploy`) already accepts `kv_secrets` and `external_secret_enabled` parameters
(source: `routes/api.js:992-996`, `services/aksService.js:45-46`), but these are deployment
configuration references, not a lifecycle management API. There is no UI, no API, and no Git
workflow today for developers to create, update, or inspect secrets independently.

### Why Now

The Self-Service Infrastructure Catalog provisions Key Vault instances automatically via the
`keyvault` Terraform module (source: `data/modules.json`). Once a Key Vault exists, developers
immediately need to populate it with secrets for their applications — but no self-service path
exists for that next step. The gap between "Key Vault created" and "secrets populated" is
filled today by manual tickets, creating bottlenecks and inconsistency.

An existing HCL parser service (`services/hclParser.js`) reads Terragrunt
`infrastructure/.../env.hcl` files from the infra-live repository, providing the foundation
to programmatically discover which Key Vault belongs to which application and environment.

### Expected Business Value

| Outcome | Measurable Indicator |
|---|---|
| Eliminate secret management tickets | Ops tickets for secret create/update drop >70% within 90 days of launch |
| Full GitOps audit trail for every secret change | 100% of secret mutations traceable to a GitHub PR + correlationId |
| Reduced developer lead time for secret changes | P50 time from request to Key Vault sync drops from days to <30 min |
| No developer Azure Portal access required | Zero direct Key Vault RBAC grants required for covered applications |

### User Personas

| Persona | Goal |
|---|---|
| **Application Developer** | Create or update secrets for their application without Azure Portal access; see secret names and last-updated timestamps for their app/environment |
| **Platform Engineer** | Review, approve, and audit all secret mutations; manage SOPS encryption keys and sync pipelines |
| **Security/Compliance Reviewer** | Confirm audit trail completeness; verify no plain-text secret values are stored in Git or logs |

---

## 3. Goals, Success Metrics, and Non-Goals

### Goals

1. Provide a self-service portal page where developers can create and update secrets
   associated with a specific application/environment pair.
2. Let developers choose the infrastructure target — `live` (infrastructure-live) or `sand`
   (service-catalog) — and apply the same secret self-service flow to either, since both repos
   share the same `infrastructure/` root and Terragrunt conventions.
3. Auto-discover the correct Azure Key Vault for an app/environment by reading the selected
   target repo's Terragrunt definitions — developers do not manually enter vault names.
4. Use SOPS as the write path: secrets are encrypted in-pipeline and committed to Git,
   maintaining Git as the single source of truth.
5. Surface secret metadata (name, application, environment, vault, last-updated) in a
   read-only view without ever displaying plaintext values in the UI.
6. Thread correlationId through every request, PR description, and log event to enable
   end-to-end traceability identical to existing infrastructure workflows.

### Success Metrics

| Goal | Metric | Target |
|---|---|---|
| Reduce tickets | Count of secret-related ops tickets per month | Down >70% within 90 days |
| GitOps coverage | % of secret changes with a GitHub PR | 100% |
| Lead time | Median time from portal submission to Key Vault sync | <30 min |
| Discovery accuracy | % of submissions where portal auto-selects correct vault | >95% |
| No value leakage | Audit log review: plaintext secret values in logs or PRs | 0 occurrences |

### Non-Goals

- **Bulk import** of existing secrets from other vaults or secret stores — out of scope for v1.
- **Direct Azure Key Vault write** as the developer path — SOPS/GitOps is the required path;
  the Azure Key Vault API is used only by the pipeline to sync committed secrets into the vault.
- **Reading or revealing plaintext secret values** in the portal — values are write-only from the
  UI; the portal never decrypts or displays a stored secret value.
- **Automated secret rotation** — rotation remains a manual platform-team/pipeline action in v1.
- **Secret deletion** — deliberately excluded from v1; deletion requires a manual platform team
  action until a separate hardened deletion workflow is approved.
- **Cross-environment secret promotion** (e.g., promote a secret from `devsand` to `sand`)
  — out of scope for v1.
- **Cross-vault secret copy** — where an app/environment has more than one Key Vault, v1 targets
  exactly one vault per submission (selected by the developer, see FR-003(f)); copying a secret
  across sibling vaults in one action is out of scope.
- **Key Vault infrastructure provisioning** — Key Vault creation remains handled by the existing
  custom infrastructure wizard (`keyvault` module).

---

## 4. Current State Assessment

### What Exists Today

| Capability | File | Notes |
|---|---|---|
| App/environment discovery | `services/infrastructureService.js:143-221` (`getInstalledApps()`), `routes/api.js:50-114` | Returns normalized list from `docs/metadata/` in service-catalog; already auth-protected |
| Single-app metadata lookup | `services/infrastructureService.js:625-701` (`getApplicationDetails()`), `routes/api.js:540-648` | Direct-path lookup; `keyvault` module listed in `modules[]` when present |
| HCL/Terragrunt file scanning | `services/hclParser.js:42-139` (`findEnvHclFiles()`), `hclParser.js:147-197` (`getApplicationsFromRepo()`) | Scans `infrastructure/.../env.hcl`; extracts basic `name`/`source`/`version`; does **not** resolve app→Key Vault name |
| Auth middleware | `middleware/auth.js:18-53` (`requireAuth`), `middleware/auth.js:62-99` (`requireRole`) | Entra ID JWT; `req.user.email` and `req.user.roles` available on every protected route |
| Async workflow dispatch | `services/githubService.js:triggerWorkflow()`, `services/aksService.js:11-125` | Standard pattern: dispatch → return correlationId → poll `/api/status/:correlationId` |
| Secret-adjacent AKS fields | `routes/api.js:992-1021`, `services/aksService.js:45-50` | `kv_secrets`, `external_secret_enabled`, `secret_env_vars` exist as deployment references only; not secret lifecycle management |
| Feature flags per environment | `data/environments.json` | Drives `customInfra`, `templates`, `aks` flags; extensible for `secrets` flag |

### Gaps and Limitations

- **Key Vault name not exposed**: `getInstalledApps()` and `getApplicationDetails()` normalise
  `modules[]` from metadata but do not resolve the actual Azure Key Vault resource name for
  an app. No API endpoint returns the vault name.
- **HCL parser does not extract vault name**: `hclParser.js:parseHclContent()` only extracts
  `name`/`source`/`version` from the first `module {}` block. The vault resource name lives in
  Terragrunt variable values, not parsed today.
- **No secret CRUD endpoints**: No `POST /api/secrets`, `GET /api/secrets`, or related endpoints
  exist anywhere in `routes/api.js`.
- **No SOPS integration**: Zero references to SOPS exist in the codebase. Encryption key
  management, SOPS binary invocation, and `.sops.yaml` config are all absent.
- **No secrets page in Vue SPA**: No page, component, or Pinia store for secret management
  exists in `srcV2/`.
- **No `secrets` feature flag**: `data/environments.json` has `customInfra`, `templates`, `aks`
  flags but no `secrets` flag for phased rollout.

---

## 5. Requirement Classification Matrix

| Capability | Classification | Evidence | Proposed Action |
|---|---|---|---|
| List secret metadata (names, app, env, vault, last-updated) | `new-feature` | No endpoint or UI exists today | New `GET /api/secrets/:appName/:environment` + `SecretsPage.vue` |
| Create/update secret via GitOps/SOPS | `new-feature` | No SOPS code, no secret mutation API | New `POST /api/secrets` + workflow dispatch |
| Auto-discover Key Vault from the selected repo (live/sand) | `existing-extend` (discovery) + `new-feature` (name reconstruction) | HCL parser exists (`hclParser.js`) and already reads `service-catalog`; it does **not** resolve vault names and is not yet pointed at `infrastructure-live`. Verified 2026-07-31: `hclParser.js` extracts only `module{}.source`/`version` from a single file — it has no cross-file locals resolution, no expression evaluation, and no comment stripping, so the reconstruction logic in FR-003(d) is genuinely new code with no existing equivalent | Add `resolveKeyVaults(appName, environment, target)` (tree enumeration) to the service layer, plus a **new** `services/terragruntLocalsResolver.js` for name reconstruction; reuse `hclParser.js` only for its Octokit/auth pattern |
| Choose infrastructure target (live vs sand) | `new-feature` | No secrets UI/API exists; both repos already share the `infrastructure/{appName}/...` layout | New `target` parameter mapping `live` → `infrastructure-live`, `sand` → `service-catalog` |
| `secrets` feature flag in environments.json | `existing-extend` | `data/environments.json` already has feature flags per env | Add `secrets: true/false` to each environment entry |
| Secrets navigation entry in Vue SPA | `new-feature` | `srcV2/stores/navigation.ts` drives page routing; no `secrets` page entry | Add navigation store entry + route |
| Correlation ID tracking for secret workflows | `existing-refine` | Pattern exists across all mutation flows; just apply it | Thread correlationId through all new endpoints/logs |
| SOPS encryption key management | `new-feature` | Zero SOPS infrastructure exists | Implement per the resolved OQ-001 design: SOPS native Azure Key Vault `azure_keyvault` creation rule, single `sops-master-key` in a common platform Key Vault, `wrapKey`/`unwrapKey` role split (see Section 10, OQ-001 — resolved) |

---

## 6. Functional Requirements (FR)

### FR-001 — Secret Metadata List

**Description**: The portal must provide a read-only list of all secret names for a given
application and environment, showing each secret's name, Key Vault source, and last-updated
timestamp. Plaintext secret values must never be returned.

**Priority**: must

**Rationale**: Developers need to know which secrets already exist before creating new ones to
avoid duplicates and to understand the current state of an app's secret inventory.

**Acceptance Criteria**:

- (a) `GET /api/secrets/:appName/:environment?target=live|sand[&vaultDir=...]` returns
  `{ success, data: [{ name, vaultDir, vaultName, lastUpdated }], correlationId }`.
- (b) Endpoint is protected by `requireAuth` middleware; unauthenticated requests receive HTTP 401.
- (c) `appName` is validated with the same `/^[a-zA-Z0-9]{1,8}$/` regex used in `/api/app-metadata`
  (source: `routes/api.js:543-545`).
- (d) `target` is required and validated against `['live','sand']` (see FR-007). `environment` is
  format-validated (`/^[a-zA-Z0-9]{1,16}$/`) and existence-validated by confirming that FR-003
  reports `found: true` for that app/environment in the selected target repository. The
  environment is intentionally **not** restricted to `data/environments.json` for
  this endpoint, because live environments (e.g. `prod`, `int`) may not appear in that
  portal-scoped file.
- (e) Response never includes a `value` or `plaintext` field.
- (f) Secret names are read from the **plaintext YAML keys** of `secrets.enc.yaml`, located as a
  sibling of each resolved vault directory (`{vaultDir}/secrets.enc.yaml`, per FR-003(e)) in the
  selected repo. SOPS encrypts values but leaves document keys readable. `lastUpdated` derives
  from that file's most recent git commit. No Azure Key Vault SDK call is made — this endpoint is
  purely GitOps/read-only against Git. `vaultName` is the value resolved by FR-003, shown for
  informational context only (best-effort — `null` when it cannot be statically reconstructed,
  see FR-003(d)).
- (g) If FR-003 reports `found: false`, or no `secrets.enc.yaml` exists in any resolved vault
  directory, the endpoint returns HTTP 404 with
  `{ success: false, error: 'No secrets found for app/environment/target', correlationId }`.
- (h) `correlationId` is present in every response body and every log line emitted by the handler.
- (i) p95 latency ≤ 2000 ms measured at the API layer.
- (j) When FR-003 resolves **more than one** vault for the app/environment, the response
  aggregates secrets across all of them, with each entry's `vaultDir` identifying its source.
  An optional `vaultDir` query parameter filters the response to a single vault; if supplied, it
  must exactly match one of the `vaultDir` values FR-003 returned, otherwise the endpoint returns
  HTTP 422. Secret names are **not** assumed unique across sibling vaults — the same name may
  legitimately appear in two vaults and both must be listed.

**Dependencies**: FR-003 (Key Vault discovery), FR-007 (target selection), existing `requireAuth`
middleware.

**Refinement Notes**: SOPS keeps a document's keys in plaintext and encrypts only the values, so
listing secret **names** from Git needs no Key Vault read access. This eliminates any Azure SDK
identity dependency for FR-001 — the previous Azure-KV-list design and its blocking open question
(former OQ-004) are removed. Only `value` fields are ever sensitive.

---

### FR-002 — Create / Update Secret (GitOps Submission)

**Description**: The portal must allow an authenticated developer to submit a new or updated
secret (name + value) for a given application and environment. The value must be encrypted via
SOPS before any persistence. The resulting encrypted file must be committed to a branch in the
secrets repository and a PR opened for pipeline-based sync to Azure Key Vault.

**Priority**: must

**Rationale**: This is the primary write path that replaces manual ticket requests.

**Acceptance Criteria**:

- (a) `POST /api/secrets` accepts `{ target, appName, environment, vaultDir, secretName, secretValue, correlationId }`.
  `vaultDir` is optional when FR-003 resolves exactly one vault, and **required** when it resolves
  more than one (see (l)).
- (b) `target`, `appName`, `environment`, and `secretName` are validated server-side using
  express-validator. `target` must be `live` or `sand` (see FR-007). `secretName` must match
  `/^[a-zA-Z0-9-]{1,127}$/` (Azure Key Vault naming constraint).
- (c) The `secretValue` is never logged. Any log line referencing this request must redact the value
  field: `{ secretName, appName, environment, correlationId }` only.
- (d) The backend encrypts the secret value using SOPS before writing any file. The raw `secretValue`
  string must not be persisted to disk, Git, or any log.
- (e) The encrypted secret is committed to a branch in the **selected target repository**
  (`live` → `config.github.infrastructureLiveRepo`, `sand` → `config.github.serviceRepo` — both
  already-existing config values, no new repo or env var is introduced) at
  `{vaultDir}/secrets.enc.yaml`, sibling to that vault's `terragrunt.hcl`, where `vaultDir` is the
  resolved value from FR-003(e)/(f). There is one such document per **vault**, not per
  app/environment — an app/environment with two vaults has two independent `secrets.enc.yaml`
  files that are never merged.
- (f) A PR is opened against the selected target repository's default branch. The PR description
  must include: `target`, `appName`, `environment`, `secretName`, `correlationId`, and the
  authenticated user's email from `req.user.email`.
- (g) The endpoint returns `{ success: true, correlationId, prNumber, prUrl }`. The PR URL
  is shown in the status modal so the developer can track approval.
- (h) Idempotency uses a deterministic branch name
  `secrets/{appName}-{environment}-{vaultSlug}-{secretName}`, where `vaultSlug` is the final path
  segment of `vaultDir` (e.g. `keyvault`, `keyvault01`). The vault discriminator is required:
  without it, the same secret name submitted to two sibling vaults of one app/environment would
  collide on a single branch. Before opening a PR, the backend
  checks GitHub for an existing **open** PR from that exact
  branch. If a secret with the same name already exists in that same vault (per the
  `GET /api/secrets` metadata check) and no open PR exists for that branch, the submission is
  treated as an update and a new commit is pushed to that branch (creating it if needed) with a
  fresh PR. If an open PR from that branch already exists, return HTTP 409 with
  `{ success: false, error: 'A PR for this secret is already open', prUrl, correlationId }`.
- (i) `POST /api/secrets` is **synchronous** — encryption, commit, and PR creation (e)/(f) all
  happen within the request/response cycle, not via an asynchronous GitHub Actions workflow
  dispatch. The status modal shows a brief in-flight indicator (reusing `StatusModal.vue`) only
  for the duration of the request itself, then transitions immediately to a terminal success
  state showing the PR link once the response in (g) returns. No polling of
  `GET /api/status/:correlationId` is used for this endpoint — there is no bounded timeout to
  reach, since there is nothing asynchronous to poll for. Post-merge CI decrypt-and-sync status
  (human PR review/merge timing is unbounded) is not tracked by the portal; the developer's next
  `GET /api/secrets` call (FR-001) reflects the secret once it is merged to the target repo's
  default branch.
- (j) If FR-003 reports `found: false` (no Key Vault directory resolves for that
  app/environment/target), the endpoint returns HTTP 422 with
  `{ success: false, error: 'Cannot resolve Key Vault for this app/environment', correlationId }`.
  A `found: true` result with `vaultName: null` (directory exists but the name could not be
  statically reconstructed, see FR-003(e)) is **not** an error and does not trigger this path — the
  submission proceeds normally, because the commit path derives from `vaultDir`, not `vaultName`.
- (k) Because all secrets for an app/environment share a single `secrets.enc.yaml` document, and
  the portal backend holds `wrapKey`-only (encrypt) access — never `unwrapKey`/decrypt
  (NFR-SEC-003) — it cannot semantically merge two independently SOPS-encrypted documents: SOPS's
  whole-document MAC changes on every edit, so a git-level text merge of two branches each
  re-encrypted independently would fail SOPS's integrity check on decrypt even when the two
  secret names don't overlap. The backend therefore does not attempt to merge or rebase encrypted
  content. Instead it detects conflicts via plain file-SHA comparison (no decryption needed):
  immediately before opening/updating a branch's PR, it re-reads the target repo's current
  default-branch content SHA for `secrets.enc.yaml` and compares it to the SHA captured when this
  submission's branch was created/last based.
  - If unchanged, proceed to open/update the PR as usual.
  - If changed (another secret's PR merged into that file in the interim), abort this submission
    without attempting any merge and return HTTP 503 with
    `{ success: false, error: 'Concurrent secret submission, please retry', correlationId }`. The
    developer resubmits the same `POST /api/secrets` request, which re-reads the now-current
    `secrets.enc.yaml` and re-encrypts only their own value against that current state, opening a
    fresh commit/branch/PR based on the new HEAD.
  This preserves the `wrapKey`-only invariant (NFR-SEC-003) — the portal never needs `unwrapKey`
  to detect or resolve this conflict. This is independent of the same-secret-name idempotency
  check in (h). The SHA comparison is scoped to the single `{vaultDir}/secrets.enc.yaml` being
  written; a concurrent submission to a **sibling** vault of the same app/environment touches a
  different file and must not trigger this conflict path.
- (l) `vaultDir` handling:
  - If FR-003 resolves exactly one vault, `vaultDir` may be omitted and defaults to that vault.
  - If FR-003 resolves more than one vault and `vaultDir` is omitted, return HTTP 422 with
    `{ success: false, error: 'Multiple Key Vaults found; vaultDir is required', vaults, correlationId }`,
    where `vaults` is the FR-003 list so the client can render a selector without a second call.
  - If `vaultDir` is supplied but does not exactly match one of the FR-003 `vaultDir` values,
    return HTTP 422. `vaultDir` must never be used to construct a commit path without this
    allow-list check — it is client-supplied input and an unvalidated value would permit writing
    to an arbitrary repository path.

**Dependencies**: FR-003 (Key Vault discovery), FR-007 (target selection), SOPS encryption
capability (OQ-001), secrets location and branch policy in both target repos (OQ-002),
existing `StatusModal.vue` component (no `useWorkflowPolling.ts` dependency — this call is
synchronous, see (i)).

---

### FR-003 — Key Vault Auto-Discovery from the Selected Repo

**Description**: The backend must be able to resolve the Azure Key Vault name (and resource
group) for a given application + environment combination by reading Terragrunt HCL definitions
from the **selected target repository** (`infrastructure-live` for `live`, `service-catalog` for
`sand`), without requiring the developer to manually specify vault names. Because real repository
layouts vary, discovery works by **enumerating the repository tree and finding Key Vault
directories**, not by probing a presumed path.

**Priority**: must

**Rationale**: Requiring developers to know or enter vault names would break the zero-knowledge
UX goal and would be brittle as vault names change.

**Acceptance Criteria**:

- (a) A service method `resolveKeyVaults(appName, environment, target)` reads the target
  repository (`live` → `config.github.infrastructureLiveRepo` / `GITHUB_INFRA_LIVE_REPO`;
  `sand` → `config.github.serviceRepo` / `GITHUB_SERVICE_REPO`) via `githubService.octokit`. The
  Infrastructure GitHub App is confirmed to have PR-create access on **both** repositories
  (OQ-003 — resolved), so no additional installation grant is required.
- (b) Discovery is performed by **tree enumeration**, not path probing. The method fetches the
  selected repo's tree once via `GET /repos/{owner}/{repo}/git/trees/{defaultBranchSha}?recursive=1`
  and filters for directory paths under `infrastructure/` whose final segment matches
  `/^keyvault\d*$/i`. `appName` and `environment` are then **derived from the matched path's
  segments**, rather than assumed to occupy fixed depths. Matching against the requested
  `appName`/`environment` must be positional-agnostic: a path qualifies when its first segment
  after `infrastructure/` equals `appName` **and** any subsequent segment equals `environment`.
- (c) The design must correctly handle all of the following layouts, verified to exist in
  `Aya-DevOpsTeam/infrastructure-live`. This list is the acceptance bar for (b):

  | Real path | Variant |
  |---|---|
  | `infrastructure/idm/dev/keyvault/terragrunt.hcl` | canonical, depth 2 environment |
  | `infrastructure/mlops/dev/keyvault01/` + `keyvault02/` | numbered vault dirs; **two vaults in one environment** |
  | `infrastructure/doccafe/hub/int/` | environment at depth 3 (`{app}/hub/{env}`) |
  | `infrastructure/linuxVms/sand/acunetix/` | extra sub-application segment after environment |
  | `infrastructure/itg/dev/keyvault` | Environment-specific Key Vault directory; `_common/keyvault.hcl` is an included Terragrunt config, not a second selectable vault |

  The previously specified fallback ("scan all `*.hcl` under
  `infrastructure/{appName}/{environment}/`") is explicitly **withdrawn** — it is non-recursive and
  depth-2-anchored, and therefore matches none of the non-canonical variants above.
- (d) The per-app `keyvault` module input key is `keyvaultname`, but in both repos it is commonly a
  **computed expression**, not a literal. Observed forms that the resolver must tolerate without
  crashing (returning `vaultName: null` where it cannot resolve):
  `local.env.locals.keyvaultname` and `local.config.locals.keyvaultname` (indirection into a
  sibling/ancestor `env.hcl` under a **varying local alias** — `env`, `config`, and `common_vars`
  all observed); `"${local.prefix}-${local.envName}-${local.alias}-kv-1"`;
  `"${substr(local.prefix, 0, 7)}-..."` (substr length varies per app);
  `"${local.prefix}${local.envName}app-kv-1"` (no separators); `"${local.prefix}prodhubkv-01"`
  (partially hardcoded); and fully literal names such as `"aya-${local.envName}-kv-wus-01"`.
  Observed suffixes include `kv-1`, `kv1`, `kv-01`, `kv-2`, `kv-3`, `kv-4`. The resolver must also
  **ignore commented-out assignments** — `infrastructure/commHub/*/env.hcl` contains a
  `# keyvaultname = ...` line immediately above the live one, which a naive line regex matches
  first. The authoritative vault sync is owned by CI (which resolves the name via Terragrunt at
  apply time), so the portal never depends on the literal name.
- (e) The method returns `{ found: boolean, vaults: Array<{ vaultDir, vaultName, resourceGroup }> }`.
  `found` is `true` when at least one qualifying Key Vault directory exists, and is the
  authoritative existence check for FR-001/FR-002. `vaultDir` is the repo-relative directory path
  of the matched vault (e.g. `infrastructure/mlops/dev/keyvault02`) and is always populated when
  `found` is `true`. `vaultName`/`resourceGroup` are best-effort and may be `null` even when
  `found` is `true` (see (d)). When `found` is `false`, `vaults` is an empty array. Callers must
  branch on `found`, never on whether `vaultName` is `null`, and must never assume `vaults` has
  exactly one element.
- (f) When `vaults` contains more than one entry, the caller must disambiguate by `vaultDir`
  (see FR-001(j) and FR-002(l)). When it contains exactly one entry, `vaultDir` is optional on
  inbound requests and defaults to that single entry.
- (g) Results are cached in-process for 5 minutes keyed by `target` alone (repo-level), not by
  `target+appName+environment`, because a single tree fetch serves every app/environment in that
  repo. The cache stores the in-flight `Promise` so that concurrent callers share one underlying
  GitHub call (stampede protection).
- (h) If the trees API response returns `truncated: true` (GitHub truncates above ~100k entries or
  7 MB), the method must fall back to per-directory listing for the requested `appName` rather
  than silently returning `found: false`. A truncated response must be logged at `warn` with the
  correlation ID.
- (i) Static parsing capability is **new work, not a reuse of existing code**.
  `services/hclParser.js` today only extracts `module{}.source`/`version` from a single file — it
  has no cross-file locals resolution, no expression evaluation, and no comment stripping. A new
  component (working name `services/terragruntLocalsResolver.js`) owns locals resolution and
  best-effort name reconstruction. It uses the same `githubService.octokit` client and GitHub App
  authentication as `hclParser.js` — not a new credential.
- (j) If the selected target repo is not configured, the method returns
  `{ found: false, vaults: [] }` and logs a warning; it does not throw, to avoid crashing
  unrelated flows.

**Dependencies**: `services/hclParser.js` (existing, for the Octokit/auth pattern only),
`services/terragruntLocalsResolver.js` (new, see (i)), FR-007 (target selection),
`config.github.infrastructureLiveRepo` + `config.github.serviceRepo` (both existing config values).

**Refinement Notes**: This requirement was rewritten on 2026-07-31 after Architecture Challenger
Round 3 (`docs/reviews/secret-self-service-arch-review-round3.md`) demonstrated with repository
evidence that the original single-path, single-vault design was factually wrong for several real
applications. Two changes are material: discovery is now tree-driven rather than path-driven, and
the return contract is a list rather than a scalar.

---

### FR-004 — Secrets Navigation and Page in Vue SPA

**Description**: A new "Secrets" navigation entry and page must be added to the Vue 3 SPA. The
page lists secrets for the developer's applications (or any app they select from their installed
apps list) and provides a form to submit new/updated secrets.

**Priority**: must

**Rationale**: The feature must be accessible from the existing portal navigation, consistent with
all other self-service pages.

**Acceptance Criteria**:

- (a) A `secrets` navigation entry is added to the navigation store
  (`srcV2/stores/navigation.ts`) and appears in the sidebar/nav when the `secrets` feature flag
  is `true` for the selected environment.
- (b) The page component is `srcV2/pages/SecretsPage.vue` (TypeScript, Vue 3 Composition API).
- (c) The page renders a **target selector** (`live` / `sand`) above the app/environment selector
  (see FR-007). On load it calls `GET /api/installed-apps` to populate the app/environment
  selector; on selection (and whenever the target changes) it calls
  `GET /api/secrets/:appName/:environment?target=<selected>` to populate the secrets list.
- (d) The secrets list shows: secret name, vault name (auto-discovered), last-updated timestamp.
  No `value` or decrypted content is ever shown. When the selected app/environment resolves to
  more than one Key Vault, the list additionally shows each secret's source vault and offers a
  filter, so identically-named secrets in sibling vaults remain distinguishable (see FR-001(j)).
- (e) A "New Secret" button opens an inline form (or modal) with fields: `Secret Name`, `Secret Value`
  (password-type input), and a confirmation field. The `Secret Value` field uses `type="password"`
  and is never logged in browser console. When FR-003 resolves more than one vault, the form also
  renders a **required** vault selector populated from the `vaults` list, and submit stays
  disabled until a vault is chosen; when exactly one vault resolves, the selector is hidden and
  that vault is used implicitly (see FR-002(l)).
- (f) On submit, the form calls `POST /api/secrets` and shows the standard `StatusModal.vue`
  component: a brief in-flight indicator for the duration of the synchronous request, then a
  terminal success state with the PR link, or a terminal error state (see FR-002(g)/(i)). No
  polling is used for this call.
- (g) The page is only rendered when the authenticated user's Entra ID token is valid (`requireAuth`
  enforced at API level; frontend uses existing `useAuth()` composable).
- (h) The page is only enabled for portal deployment environments where `features.secrets === true`
  in `data/environments.json` (this gates whether the Secrets *page* is shown in that deployment
  of the portal — it is unrelated to which target *application* environment, e.g. `prod`/`int`,
  a developer later selects inside FR-001/FR-007; see FR-001(d)). It is disabled by default for
  all environments (opt-in rollout).

**Dependencies**: FR-001 (list API), FR-002 (create API), existing `StatusModal.vue`,
navigation store, `useAuth()` composable.

---

### FR-005 — `secrets` Feature Flag in Environments Config

**Description**: `data/environments.json` must be extended to include a `secrets` feature flag
per environment, allowing phased rollout of the secrets page.

**Priority**: must

**Rationale**: All new portal capabilities roll out behind feature flags using
`data/environments.json` — the same pattern used for `customInfra`, `templates`, and `aks`
(source: `data/environments.json`). This is the established rollout/rollback mechanism per PM
agent memory.

**Acceptance Criteria**:

- (a) `data/environments.json` is updated to include `"secrets": false` (default off) in
  the `features` object for every existing environment.
- (b) `GET /api/environments` returns the `secrets` flag in each environment's `features`
  object without any schema change to the endpoint; the existing passthrough returns the full
  `features` object.
- (c) The Vue `useEnvironmentsStore` (`srcV2/stores/environments.ts`) exposes a
  `secretsEnabledEnvironments` computed property analogous to the existing
  `aksEnabledEnvironments`.
- (d) Enabling `"secrets": true` for `devsand` in `data/environments.json` is sufficient to
  activate the secrets page for that environment — no code change required.

**Dependencies**: Existing `data/environments.json` and `useEnvironmentsStore`.

---

### FR-006 — Correlation ID and Audit Trail for All Secret Operations

**Description**: Every secret read and write operation must emit a structured log event with
the correlationId, user email, app name, and environment. The secret value must never appear
in any log output.

**Priority**: must

**Rationale**: Per platform convention, every operation is traceable by correlationId. For secret
operations, the audit requirement is stronger: the platform must be able to demonstrate that no
plaintext value was logged.

**Acceptance Criteria**:

- (a) Every handler in the secrets API uses `logger.info(` or `logger.logMetric(` with
  `correlationId`, `user` (email), `target`, `appName`, and `environment` on every code path.
- (b) No log line in `services/secretsService.js` or `routes/api.js` secrets handlers contains
  the word `value` as a logged field key. Automated lint/grep in CI can enforce this.
- (c) PR descriptions created by `POST /api/secrets` (FR-002(f)) include `correlationId` and
  `user email` but never the secret value.
- (d) `logMetric('secret_create_submitted', ...)` and `logMetric('secret_list_fetched', ...)`
  events follow the same structured metric pattern used by `app_list_fetched`
  (source: `routes/api.js:88-93`).

**Dependencies**: Existing `utils/logger.js`, `logMetric` pattern.

---

### FR-007 — Infrastructure Target Selection (Live vs Sand)

**Description**: The portal must let the developer choose which infrastructure scope a secret
operation applies to: `live` (backed by the `infrastructure-live` repository) or `sand` (backed by
the `service-catalog` repository). Both repositories share the same `infrastructure/` root and
Terragrunt conventions, so the same tree-enumeration discovery (FR-003), list, and
submission logic applies to either — only the target repository differs. Note that both repos
exhibit the same layout **variance** (numbered vault directories, extra path depth, varying
`env.hcl` local aliases), so neither can be treated as having a single fixed path shape.

**Priority**: must

**Rationale**: Developers manage secrets for both sandbox infrastructure (in `service-catalog`)
and live/production infrastructure (in `infrastructure-live`). A single self-service surface with
an explicit target selector avoids maintaining two separate tools and keeps the audit trail
uniform across both scopes.

**Acceptance Criteria**:

- (a) All secrets endpoints accept a required `target` parameter with allowed values `live` or
  `sand`, validated by express-validator against that exact enum; any other value returns HTTP 400.
- (b) The backend maps `target` → repository: `live` → `config.github.infrastructureLiveRepo`
  (`GITHUB_INFRA_LIVE_REPO`, default `Aya-DevOpsTeam/infrastructure-live`); `sand` →
  `config.github.serviceRepo` (`GITHUB_SERVICE_REPO`, default `Aya-DevOpsTeam/service-catalog`).
- (c) Both targets are accessed with the same Infrastructure GitHub App client
  (`githubService.octokit`), confirmed to have PR-create access on both repositories (OQ-003 —
  resolved).
- (d) `SecretsPage.vue` renders a `live` / `sand` target selector above the app/environment
  selector; changing it re-runs FR-001 discovery/list against the newly selected target.
- (e) The selected `target` is included in every structured log event (FR-006) and in the PR
  description for FR-002 submissions, so audit records show which infrastructure scope was changed.
- (f) The `target` value determines which repository's default branch a FR-002 PR is opened
  against; no cross-target writes are possible within a single request.

**Dependencies**: FR-001, FR-002, FR-003 (all target-parameterised),
`config.github.serviceRepo` + `config.github.infrastructureLiveRepo` (both existing config values).

---

## 7. Non-Functional Requirements (NFR)

### NFR-PERF-001 — API Latency

**Description**: All secrets API endpoints must respond within 2000 ms at p95 under normal load.
This budget is higher than the platform's typical <500 ms p95 default because `GET`/`POST`
`/api/secrets` require a live GitHub API round trip plus HCL parsing (FR-003) on the request path,
unlike most existing endpoints that read pre-fetched metadata.

**Measurable Target**: p95 latency ≤ 2000 ms. `latency_ms` emitted via `logMetric` on every
response for SLO tracking (same pattern as `catalog_prefill_succeeded` in `routes/api.js:615-621`).

---

### NFR-SEC-001 — No Plaintext Secret Values in Logs or Git

**Description**: The platform must never write plaintext secret values to logs, PR descriptions,
metadata JSON files, or any Git-tracked artifact.

**Measurable Target**: 0 occurrences of plaintext secret values in any log line or committed file,
verified by automated scanning in CI (grep for `secretValue` key in log output; SOPS-decrypt
checks on committed files).

---

### NFR-SEC-003 — Least-Privilege Key Vault Access

**Description**: The portal backend never reads or writes Azure Key Vault secret values directly
for any secrets operation — listing (FR-001) reads secret names from Git, and value writes go
through the pipeline (SOPS + GitHub Actions CI). The portal backend's **only** Azure grant is
`wrapKey`-only (encrypt) on the platform's `sops-master-key`, needed for FR-002 SOPS encryption.
It must never hold `unwrapKey`/decrypt on that key, nor any role on any per-app Key Vault. Only
the CI identity holds `unwrapKey` on `sops-master-key` plus a scoped `Key Vault Secrets Officer`
grant on the target app's Key Vault (see OQ-001).

**Measurable Target**: Azure RBAC audit confirms the portal service principal has `wrapKey` only
(no `unwrapKey`, no `Key Vault Secrets Officer`, no `Key Vault Secrets Reader`) on
`sops-master-key` and **no role assignment on any per-app Key Vault** — verified via OQ-001 sign-off.

---

### NFR-SEC-004 — Input Validation on All Endpoints

**Description**: All new API endpoints must validate path parameters and request bodies via
`express-validator` before any I/O. Invalid inputs return HTTP 400 with structured error details.

**Measurable Target**: 100% of new route handlers use `validationResult(req).isEmpty()` guard
before calling any service. Verified in code review.

---

### NFR-SEC-005 — Authentication on All Endpoints

**Description**: All new secrets API endpoints (`GET /api/secrets/:appName/:environment`,
`POST /api/secrets`) must apply `requireAuth` middleware.

**Measurable Target**: Every new route includes `requireAuth` in its middleware chain. Verified
in code review and confirmed by integration test that an unauthenticated request returns HTTP 401.

---

### NFR-REL-001 — Graceful Degradation When Target Repo Unreachable

**Description**: If the selected target repository (FR-003/FR-007) is unreachable (GitHub API
error or unconfigured repo), the secrets list endpoint must degrade gracefully and return a
structured error, not crash the API server.

**Measurable Target**: Integration test confirms that with the selected target repo unset or
unreachable, the endpoint returns HTTP 404 with `success: false` — not HTTP 500.

---

### NFR-REL-002 — Idempotent Secret Submissions

**Description**: Submitting the same secret create/update twice (same `appName`, `environment`,
`secretName`) within a short window must not create two open PRs. The second submission returns
HTTP 409 with the URL of the existing open PR (see FR-002(h)).

**Measurable Target**: Integration test confirms the 409 path. No duplicate PRs observed in
acceptance testing.

---

### NFR-SCALE-001 — Key Vault Discovery Caching

**Description**: The `resolveKeyVaults()` method (FR-003) must cache results in-process for
5 minutes, keyed by `target` alone (repo-level), to prevent N+1 GitHub API calls when the
secrets list page is opened repeatedly. A single repository tree fetch serves every
app/environment in that repo, so a narrower key would discard most of the benefit. The cache
stores the in-flight `Promise` so concurrent callers share one underlying GitHub call.

**Measurable Target**: Load test (10 concurrent requests for the same target, across differing
app/environment tuples) triggers at most 1 GitHub API tree call to the selected target repo
within the 5-minute window, including when all 10 callers arrive before the first resolves. This
target holds for a single backend replica under test; the cache is in-process, so in a
multi-replica AKS deployment each pod maintains its own cache and the per-pod call count still
holds but the aggregate cross-pod call count scales with replica count.

---

### NFR-OBS-001 — Structured Metric Events

**Description**: All secrets endpoints must emit structured metric events using
`logger.logMetric()` (same pattern as `app_list_fetched`, `catalog_prefill_succeeded`), enabling
Datadog log-based metrics for operational monitoring.

**Measurable Target**: Each endpoint emits at least one `logMetric` event on the success path and
one on the error path. Events include: `correlationId`, `user` (email), `target`, `appName`,
`environment`, `latency_ms`.

---

### NFR-UX-001 — Consistent Status Modal Pattern

**Description**: All async secrets operations (create, update) must use the existing
`StatusModal.vue` component for user feedback. Because `POST /api/secrets` is synchronous
(FR-002(i)), this is a brief in-flight indicator during the request, not a multi-step polling
sequence via `useWorkflowPolling.ts` — there is no asynchronous workflow to poll for.

**Measurable Target**: Code review confirms `SecretsPage.vue` reuses `StatusModal.vue` for the
in-flight/terminal states described in FR-002(i) and does not introduce a custom modal or a
polling loop for this endpoint.

---

### NFR-UX-002 — Feature Flag Gated Rollout

**Description**: The secrets feature must not be visible in the portal until `features.secrets`
is set to `true` for the target environment in `data/environments.json`. The default for all
environments is `false`.

**Measurable Target**: With all environments at `secrets: false`, no secrets navigation entry
or page is rendered. Confirmed by component test and by manual verification in `devsand`.

---

## 8. API and Data Impact

### New API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/secrets/:appName/:environment?target=live\|sand` | `requireAuth` | List secret names for app/env in the selected target repo |
| `POST` | `/api/secrets` | `requireAuth` | Create or update secret via SOPS/GitOps in the selected target repo |

### New Service Methods

| Method | Location | Description |
|---|---|---|
| `resolveKeyVaults(appName, environment, target)` | `services/secretsService.js` | Enumerates the selected target repo's tree once (`git/trees?recursive=1`) via GitHub API and filters for directories matching `/^keyvault\d*$/i`; returns `{ found: boolean, vaults: Array<{ vaultDir, vaultName, resourceGroup }> }` — `found=false` only when no qualifying vault directory exists; `vaultName`/`resourceGroup` may be `null` when `found=true` but the name couldn't be statically reconstructed (see FR-003(d)/(e)). Callers must not assume `vaults.length === 1` |
| `terragruntLocalsResolver.resolveName(vaultDir, target)` | `services/terragruntLocalsResolver.js` (**new**) | Best-effort reconstruction of `keyvaultname` from Terragrunt locals; follows `local.{alias}.locals.*` indirection into `env.hcl`/`common.hcl` under a varying alias (`env`, `config`, `common_vars`), evaluates `substr()`/interpolation, and strips commented-out assignments. Returns `null` when unresolvable. Does **not** exist today — `hclParser.js` only extracts `module{}.source`/`version` from a single file |
| `listSecretNames(target, appName, environment)` | `services/secretsService.js` | Reads the plaintext YAML keys of `secrets.enc.yaml` from the selected target repo via GitHub API (no Azure SDK); returns `[{ name, lastUpdated }]` |
| `submitSecretViaGitOps(target, appName, environment, vaultDir, secretName, encryptedValue, userEmail, correlationId)` | `services/secretsService.js` | SOPS-encrypts value (Azure Key Vault `wrapKey`), commits to `{vaultDir}/secrets.enc.yaml` in the selected target repo (after allow-list validating `vaultDir` against the FR-003 result), opens PR |

### Data Contracts

**`GET /api/secrets/:appName/:environment?target=live|sand` response (vault name resolved):**
```json
{
  "success": true,
  "data": [
    {
      "name": "DATABASE_PASSWORD",
      "vaultName": "jobplc-devsand-kv",
      "lastUpdated": "2026-07-20T10:30:00Z"
    }
  ],
  "correlationId": "cid-1234567890-abcd"
}
```

**`GET /api/secrets/:appName/:environment?target=live|sand` response (`keyvault/` directory found,
vault name not statically resolvable — see FR-003(d)/(e); this is a success response, not an
error):**
```json
{
  "success": true,
  "data": [
    {
      "name": "DATABASE_PASSWORD",
      "vaultName": null,
      "lastUpdated": "2026-07-20T10:30:00Z"
    }
  ],
  "correlationId": "cid-1234567890-abcd"
}
```

**`POST /api/secrets` request body:**
```json
{
  "target": "live",
  "appName": "jobplc",
  "environment": "devsand",
  "secretName": "DATABASE_PASSWORD",
  "secretValue": "<never logged>",
  "correlationId": "cid-optional-client-provided"
}
```

**`POST /api/secrets` success response:**
```json
{
  "success": true,
  "correlationId": "cid-1234567890-abcd",
  "prNumber": 42,
  "prUrl": "https://github.com/Aya-DevOpsTeam/infrastructure-live/pull/42"
}
```

### Metadata/Schema Changes

- `data/environments.json`: add `"secrets": false` to each environment's `features` object.
- No changes to `docs/metadata/` service-catalog schema.
- New SOPS-encrypted secret documents committed to the **selected target repo** —
  `infrastructure-live` for `live`, `service-catalog` for `sand` (both existing repos, see OQ-002)
  — at `{vaultDir}/secrets.enc.yaml`, one document per discovered Key Vault directory. No new
  repository is created.

### Backward Compatibility

- All existing endpoints are unchanged.
- The `features` object in `data/environments.json` is additive; existing consumers ignore
  unknown keys.
- The `useEnvironmentsStore` extension (`secretsEnabledEnvironments`) is additive.

---

## 9. UX and Workflow Impact

### User Journey (Create Secret)

```
1. Developer selects "Secrets" from portal navigation (visible when features.secrets=true for env)
2. Developer chooses the infrastructure target — `live` (infrastructure-live) or `sand` (service-catalog)
3. Portal calls GET /api/installed-apps — developer selects their app + environment
4. Portal calls GET /api/secrets/:appName/:environment?target=<selected> — shows existing secret names
   (no values; Key Vault is auto-resolved; developer never enters a vault name)
5. Developer clicks "New Secret" → enters secret name and value
6. Developer submits form → POST /api/secrets (with target); status modal shows a brief
   "Submitting..." in-flight indicator for the duration of the synchronous request only — no
   polling (see FR-002(i))
7. Backend: encrypts value via SOPS → commits to the selected repo branch → opens PR → returns
   `{ prNumber, prUrl }` synchronously
8. Status modal transitions immediately to a terminal state: "PR opened — awaiting platform
   engineer review" with a link to the PR (FR-002(g)). The modal does not continue polling.
9. Platform engineer reviews and merges the PR (human-timed, unbounded) → GitHub Actions pipeline
   in the target repo decrypts and syncs the value to Key Vault
10. The developer's next visit to the Secrets page reflects the merged secret name (FR-001 reads
   the current default-branch `secrets.enc.yaml`) — there is no separate "sync complete"
   notification; merge to the default branch is the observable completion signal
```

### Status and Error Handling

| Scenario | UX Behavior |
|---|---|
| Key Vault not found for app | Error banner: "No Key Vault found for this app/environment. Ensure keyvault module is provisioned." |
| Duplicate open PR | HTTP 409 returned; modal shows "A PR is already open for this secret" with link |
| SOPS encryption failure | HTTP 500; modal shows "Encryption failed — contact platform team" with correlationId |
| GitHub API error | HTTP 502; modal shows generic error with correlationId for support reference |
| CI decrypt-and-sync failure after merge | Not tracked by the portal (FR-002(i)) — the portal's responsibility ends at PR merge; CI failure diagnostics are surfaced via the target repo's GitHub Actions run, not the status modal |
| Wrong target selected | Target selector defaults are explicit (`live`/`sand`); PR description records the target so a mis-targeted secret is auditable and can be closed before merge |

---

## 10. Risks, Assumptions, Open Questions

### Known Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SOPS key management complexity | Medium | High | RESOLVED: Platform/DevSecOps confirmed a common platform Key Vault hosts the SOPS master key (OQ-001). Azure Key Vault CMK means no separate key-management infrastructure. |
| Target repo vault path pattern varies (esp. service-catalog) | High | Medium | **RE-OPENED then RESOLVED 2026-07-31** by Architecture Challenger Round 3: the earlier "identical layout" claim was wrong. Confirmed variants in `infrastructure-live` include numbered vault dirs (`mlops/*/keyvault01`+`keyvault02`), depth-3 environments (`doccafe/hub/{env}`), sub-application nesting (`linuxVms/{env}/{subapp}`), and vault config as a file (`itg/_common/keyvault.hcl`); `service-catalog` shares the depth-2 shape but the same `env.hcl` alias variance (`config` vs `common_vars`). Mitigated by replacing path-probing with tree enumeration and a `vaults[]` contract (FR-003(b)/(c)/(e)). The old fallback scan is withdrawn as ineffective. |
| Developer submits wrong secret to wrong app/target | Medium | High | FR-004(c)/FR-007 show explicit app + target selectors; PR description records target for audit; pre-fill from navigation context reduces manual entry risk. |
| Secret value exposure in browser dev tools | Low | High | FR-004(e) uses `type="password"` and clears component state post-submit. |
| Concurrent submissions for *different* secrets in the same app/environment conflict on the shared `secrets.enc.yaml` document | Medium | Medium | FR-002(k) detects the conflict via a file-SHA comparison (no decrypt/merge of encrypted content, since the portal never holds `unwrapKey` per NFR-SEC-003) and returns HTTP 503 on a conflicting write so the developer can resubmit against the current HEAD rather than silently losing a change. |

### Explicit Assumptions

1. The existing Infrastructure GitHub App has confirmed read/write (PR-create) access to **both**
   the `infrastructure-live` and `service-catalog` repositories (OQ-003 — resolved by the user).
2. Azure Key Vault directories are discoverable by enumerating the target repo's tree and matching
   `/^keyvault\d*$/i`, but the per-app name is a computed expression (`keyvaultname`), not a
   literal, so portal-side name resolution is best-effort (FR-003(d)); CI owns the authoritative
   sync. An app/environment may own more than one vault (FR-003(e)).
3. SOPS-encrypted secret documents live inside each **target repo** itself (`infrastructure-live`
   for `live`, `service-catalog` for `sand`), as a sibling of each vault's
   `terragrunt.hcl` — no separate `secrets-catalog` repository is created (OQ-002 —
   resolved).
4. The SOPS master key is a single key in a **common platform-owned Key Vault** (confirmed by
   Platform/DevSecOps, OQ-001), referenced via SOPS's native `azure_keyvault` creation rule — not
   age/PGP keys and not a separate key management service. Encrypt (`wrapKey`) and decrypt
   (`unwrapKey`) are granted to different identities.
5. The `keyvault` module in `data/modules.json` corresponds 1:1 to an Azure Key Vault per app/environment.

### Open Questions (Blocking)

> All previously-blocking open questions are now RESOLVED (Platform/DevSecOps sign-off +
> GitHub validation). Remaining items are implementation details, not gates.

**OQ-001 — SOPS encryption key management** — RESOLVED (Platform/DevSecOps confirmed)
Use SOPS's native **Azure Key Vault key encryption** (`sops --azure-kv <key-URL>` /
`.sops.yaml` `azure_keyvault` creation rule) instead of age/PGP keys, so no private key
material is ever generated or held by the portal or CI:

- **Master key**: a single dedicated key (e.g. `sops-master-key`) in a **common platform-owned
  Key Vault** — confirmed by Platform/DevSecOps as the shared master-key vault — distinct from
  the per-app Key Vaults FR-003 discovers, which stay reserved for actual runtime application
  secrets.
- **`.sops.yaml`** at the root of **each target repo** (`infrastructure-live` and
  `service-catalog`):
  ```yaml
  creation_rules:
    - path_regex: infrastructure/.*/keyvault/secrets\.enc\.yaml$
      azure_keyvault: https://<common-platform-kv>.vault.azure.net/keys/sops-master-key/<version>
  ```
- **Least-privilege role split** (directly supports NFR-SEC-003):
  - Portal backend identity: `wrapKey` only on `sops-master-key` — can encrypt new/updated
    values via `POST /api/secrets`, can never decrypt existing ones.
  - CI identity in each repo: `unwrapKey` on `sops-master-key` plus `Key Vault Secrets Officer`
    scoped to the *target app's* Key Vault only (resolved per-run via Terragrunt) — never a
    platform-wide secrets-write role.
  - Both identities use Azure Workload Identity Federation (OIDC); no long-lived client
    secrets in the pod or the GitHub Actions workflow.
- **CI responsibility**: a workflow **built in both `service-catalog` and `infrastructure-live`**
  (per Platform/DevSecOps), triggered on merge to
  `infrastructure/**/keyvault*/secrets.enc.yaml`, runs `sops -d` on the changed file in the
  runner's memory, then `az keyvault secret set` per key into the Key Vault provisioned by that
  file's **sibling** `terragrunt.hcl` — not a vault inferred from the app/environment path, since
  an app/environment may own more than one vault. Plaintext is never written to disk or logged.
*Implementation follow-ups (not blockers): the exact common-platform Key Vault resource name and
the OIDC federated-credential subject claims for each identity are set at build time.*

**OQ-002 — Secrets storage location and branch policy** — RESOLVED (Platform/DevSecOps confirmed)
SOPS-encrypted secret values live inside the **existing target repos** — **no new repository is
created** (confirmed). This keeps the Terragrunt config that provisions a Key Vault and the
encrypted values destined for it in the same app/environment directory:

- **Path**: `{vaultDir}/secrets.enc.yaml`, sibling to each vault's `terragrunt.hcl` — one
  SOPS-encrypted YAML document **per Key Vault** (not per-secret files, and not per
  app/environment: an app/environment owning two vaults has two independent documents that are
  never merged). A single PR diff shows every secret-name change for that vault (values stay
  encrypted in the diff). The same convention applies in both target repos
  (`infrastructure-live` and `service-catalog`).
- **Branch/PR policy**: confirmed — encrypted files are pushed on a **branch** and merged via PR
  against the target repo's default branch (same GitOps convention as other infra changes); a
  CI workflow in each repo performs the decrypt-and-sync on merge (OQ-001).
- This removes the previously-assumed `GITHUB_SECRETS_REPO` env var; FR-002 reuses the
  already-existing `config.github.infrastructureLiveRepo` (`GITHUB_INFRA_LIVE_REPO`) and
  `config.github.serviceRepo` (`GITHUB_SERVICE_REPO`), selected by `target`.
*Implementation follow-up (not a blocker): the CODEOWNERS entry for
`infrastructure/**/keyvault*/secrets.enc.yaml` and whether review is per-app or platform-wide are
set when the CI workflow is added to each repo.*

**OQ-003 — GitHub App access to target repos** — RESOLVED (confirmed by the user)
Confirmed via the `terragrunt-new-env` skill (which documents the actual `infrastructure-live`
directory layout) and `config.js:123` (`config.github.infrastructureLiveRepo`, already
defaulting to `Aya-DevOpsTeam/infrastructure-live`):

- Path convention is **`infrastructure/{appName}/{environment}/{resourceDir}/terragrunt.hcl`**
  — app name first, then environment, then resource directory — the same convention as the
  service-catalog repo's own `infrastructure/{appName}/env.hcl`. This rules out both the
  `{env}/{appName}/...` and `live/{env}/{appName}/...` guesses in the original PRD draft.
- The `keyvault` directory's `terragrunt.hcl` sets `source =
  "git::ssh://git@github.com/Aya-DevOpsTeam/terraform-modules.git//keyvault?ref=<tag>"`; the
  vault-name input key is confirmed (via GitHub) as `keyvaultname`, a computed expression rather
  than a literal (see FR-003(d)) — no open question remains.
- **GitHub App installation**: the user has confirmed the Infrastructure GitHub App already has
  PR-create access on **both** `infrastructure-live` and `service-catalog`, so no additional
  installation grant is required for either target. This unblocks Phase 1.

---

## 11. Delivery Plan

### Phase 1 — Discovery and Read-Only Foundation

Deliverables:
- FR-003: `resolveKeyVaults()` service method in a new `secretsService.js` (tree enumeration),
  plus a new `services/terragruntLocalsResolver.js` for best-effort name reconstruction
- FR-007: `live`/`sand` target selection threaded through the list/discovery path
- FR-001: `GET /api/secrets/:appName/:environment?target=` (names from Git, no values)
- FR-005: `secrets` feature flag in `data/environments.json`
- FR-004(a)(b)(c)(d)(g)(h): SecretsPage with target selector, app/env selector and read-only secret list
- FR-006: Correlation ID and structured metrics for list endpoints
- NFR-PERF-001, NFR-SEC-001, NFR-SEC-004, NFR-SEC-005, NFR-OBS-001, NFR-UX-002

Gate: None blocking — OQ-003 (GitHub App installation on both target repos) is resolved and
FR-001 lists names from Git (no Azure SDK identity required). Phase 1 can begin.

### Phase 2 — GitOps Mutation Path

Deliverables:
- FR-002: `POST /api/secrets` (SOPS encrypt → commit → PR into the selected target repo)
- FR-004(e)(f): Create/update form in SecretsPage
- NFR-REL-001, NFR-REL-002, NFR-SEC-001, NFR-SEC-003, NFR-UX-001

Gate: None blocking — OQ-001 and OQ-002 are resolved (Platform/DevSecOps sign-off). Remaining
items (common-platform Key Vault resource name, OIDC subject claims, CODEOWNERS entries, CI
workflow authored in both repos) are implementation tasks, not gates. Phase 2 can begin once
Phase 1 lands.

### Definition of Done

- All must/should FRs in the target phase are implemented.
- All must NFRs pass in Vitest unit tests and manual integration test.
- `logMetric` events confirmed in Datadog (or local log output in CI).
- No plaintext secret values appear in any test fixture, log snapshot, or CI artifact.
- Feature flag tested: `secrets: false` hides page; `secrets: true` shows page.

### Rollout and Rollback

- **Rollout**: Set `"secrets": true` in `data/environments.json` for `devsand` only first.
  Validate for 2 weeks before enabling for `sand`.
- **Rollback**: Set `"secrets": false` in `data/environments.json`. No database or state to
  unwind; the navigation entry disappears and the API endpoints remain but are unreachable from
  the UI.

---

## 12. Test and Validation Strategy

### Coverage Areas

| Area | Test Type | Required Coverage |
|---|---|---|
| `GET /api/secrets/:appName/:environment?target=` | Integration test (mock GitHub App) | 200 success, 401 unauth, 404 not found, 400 invalid params/target, both `live` and `sand` targets |
| `POST /api/secrets` | Integration test (mock SOPS, mock GitHub PR creation) | 201 success, 409 duplicate PR, 422 vault not found, 401 unauth, 400 bad input/target |
| FR-007 target routing | Integration test | `target=live` routes to infrastructure-live, `target=sand` routes to service-catalog, invalid target → 400 |
| `resolveKeyVaults()` | Unit test with fixture repo trees + HCL files | One vault found with a resolvable name (`found: true`, `vaults.length === 1`, `vaultName: <string>`); **multiple vaults in one environment** (`mlops`-style `keyvault01`+`keyvault02` — `vaults.length === 2`, distinct `vaultDir` values); **found directory but vault name unresolvable due to a computed `substr` expression** (`found: true, vaultName: null` — success, not an error); depth-3 environment (`doccafe/hub/{env}`); sub-application nesting (`linuxVms/{env}/{subapp}`); vault config as a file (`itg/_common/keyvault.hcl`); commented-out `# keyvaultname` line must be ignored in favour of the live assignment (`commHub`-style); `env.hcl` bound under each observed alias (`env`, `config`, `common_vars`); not found (`found: false`, `vaults: []` → FR-001(g)/FR-002(j) 404/422); trees API `truncated: true` fallback path; graceful degradation (unconfigured target repo) |
| `SecretsPage.vue` | Vitest + @vue/test-utils | Renders app selector, loads secret list, form validation, status modal shown on submit |
| Feature flag gating | Component test | `secrets: false` → no nav entry; `secrets: true` → entry visible |
| No value in logs | Automated CI check (grep/logMetric assertions) | Zero `value` fields in log events |
| NFR-REL-002 (idempotency) | Integration test | Second identical POST returns 409 with prUrl |

### NFR Validation

- **NFR-PERF-001**: p95 latency measured in CI load test (10 concurrent requests, 30s run).
- **NFR-SEC-001**: Automated grep check in CI pipeline: no `secretValue` key in log output during test runs.
- **NFR-SCALE-001**: Unit test on `resolveKeyVaults()` with mock GitHub API call counter;
  10 calls should trigger ≤1 GitHub API call within 5-minute window.

---

## 13. Summary Table

| Category | Count |
|---|---|
| Total Functional Requirements (FR) | 7 |
| Total Non-Functional Requirements (NFR) | 11 |
| Must-have FR | 7 (FR-001 through FR-007) |
| Classification: new-feature | 5 (FR-001, FR-002, FR-004, FR-006, FR-007) |
| Classification: existing-extend | 2 (FR-003, FR-005) |
| Classification: existing-refine | 0 |
| Open Questions (Blocking Phase 1) | 0 (OQ-003 resolved; former OQ-004 removed — FR-001 lists from Git) |
| Open Questions (Blocking Phase 2) | 0 (OQ-001, OQ-002 resolved by Platform/DevSecOps; only implementation details remain) |

---

## 14. Next Decisions Needed

All previously-blocking open questions are resolved (Platform/DevSecOps sign-off + GitHub
validation). The remaining items are implementation details owned by Engineering/Platform during
build — none block PRD approval or the Architecture phase:

1. **Implementation (Platform)**: Provide the exact common-platform Key Vault resource name that
   hosts `sops-master-key` and the OIDC federated-credential subject claims for the portal-backend
   and CI identities (OQ-001 — resolved; these are build-time values).
2. **Implementation (Platform/Engineering)**: Add the CI decrypt-and-sync workflow and a CODEOWNERS
   entry for `infrastructure/**/keyvault*/secrets.enc.yaml` in **both** `service-catalog` and
   `infrastructure-live`; decide whether review is per-app or platform-wide (OQ-002 — resolved).
3. **Architect (next action)**: Revise `docs/architecture/secret-self-service-spec.json` and
   `-spec.md` to match this amendment — tree-enumeration discovery, the `vaults[]` contract,
   the repo-level cache key, the new `services/terragruntLocalsResolver.js` component, and the
   `truncated: true` fallback — then re-run the Architecture Challenger as a delta-only round 4
   against blocking findings B1–B3 of
   `docs/reviews/secret-self-service-arch-review-round3.md`.
4. **Human (decision recorded, reversible)**: This amendment adopts **Option A** — support
   multiple Key Vaults per app/environment in v1 — rather than Option B (detect multi-vault and
   reject). Rationale: tree enumeration already yields the full list, so returning `vaults[]`
   costs little, whereas Option B would require discarding that information *and* building a
   rejection path. If scope pressure appears, Option B can be reinstated by constraining FR-002
   to reject `vaults.length > 1` without changing the FR-003 contract.

---

> **Note on status semantics**: Section 1 `Status` is `approved` (human sign-off 2026-07-31).
> This document was **amended after that sign-off** on 2026-07-31 to resolve blocking findings
> B1–B3 raised by the human-directed Architecture Challenger round 3 (multi-vault support and
> tree-enumeration discovery). The amendment changed FR-001, FR-002, FR-003, FR-004, FR-007,
> NFR-SCALE-001, and Sections 3/5/8/9/10/12; FR and NFR counts are unchanged (7 / 11), and no
> requirement IDs were renumbered. `status: approved` in the machine-readable block below signals
> the amended PRD is ready to re-enter the pipeline at the Architecture phase.

<!-- ORCHESTRATOR-READY
feature: secret-self-service
prd_path: docs/prd/secret-self-service.md
status: approved
fr_count: 7
nfr_count: 11
-->
