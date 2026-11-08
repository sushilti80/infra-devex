# PRD: Vault Resolution Override

## 1. Title and Metadata

- **Feature name**: `vault-resolution-override`
- **Author/date**: Product Manager Agent, 2026-08-12
- **Status**: Reviewed — PRD Challenger round 2 complete, pending Architect handoff
- **Stakeholders**: Self-Service Infra platform team, Secrets Page users (app owners resolving Key Vault names for IDM/azureDatabricks/exampleApplications and other apps with unresolved vault names)

## 2. Problem Statement

The Secrets page resolves a Key Vault's display name via a live Terragrunt-parsing resolver
(`terragruntLocalsResolver.resolveName()`/`resolveResourceGroup()`) at request time. For a known
set of apps — IDM sub-apps under `_idmapplications`, `azureDatabricks`, and `exampleApplications`'s
`shared` vault — this resolver cannot always parse the vault's name (e.g. Terragrunt `include`
blocks with deep merge, per [secrets-keyvault-pattern-analysis.md](../../.github/skills/service-catalog-metadata/SKILL.md)
prior findings), so the UI shows "Key Vault name unavailable" with no way for a user to correct it.
Today the only fix is a code change to the resolver itself, which does not scale to every
Terragrunt authoring pattern in the estate.

**Why now**: this is blocking usable secret-listing for IDM and other nested/legacy app layouts
today, and the long-term parser-following fix (Phase B, out of scope here) requires cross-repo
coordination that has not shipped yet.

**Expected business value**: unblocks Secrets-page usability for the affected apps immediately,
without waiting on Terragrunt-parser or CI-metadata work, via a human-correctable override that
takes permanent priority once set.

## 3. Goals, Success Metrics, and Non-Goals

### Goals
1. Let a user manually correct an unresolved (or wrong) Key Vault name/resource group directly
   from the Secrets page, with the correction persisted and immediately visible.
   - **Success metric**: 100% of override submissions round-trip (persist across a page reload)
     and are reflected in the next `resolveKeyVaults()` call within one cache TTL window (≤ 60s).
2. Make the resolution chain observable, so it's possible to tell which tier (override vs. live
   resolver) produced a given vault name without ad-hoc debugging.
   - **Success metric**: 100% of `resolveKeyVaults()` calls emit exactly one correlationId-prefixed
     debug log line per vault stating the resolution source.
3. Ship without requiring any change to the external service-catalog CI workflow or Terraform
   modules.
   - **Success metric**: zero changes to `self-service-custom-infra.yml` or `terraform-modules`
     required to ship this feature.

### Non-Goals
- Automatic detection of stale overrides (vault renamed/recreated after an override is set) —
  explicitly deferred per the roadmap's Further Considerations point 1.
- Metadata write-back at provision time (`keyvaults[]` array from CI, Phase B) — out of scope,
  tracked as a dependency/risk only (Section 10).
- Any change to `terragruntLocalsResolver.js`'s parsing capability itself — frozen per the
  roadmap's "stop extending the parser" decision.
- Application-selector qualifier/nested-sub-app UX grouping (roadmap Phase D) — a separate,
  independent UI concern not covered by this PRD.
- New auth/role model for the override endpoint — reuses existing `requireAuth`.

## 4. Current State Assessment

### What exists today (evidence)
| Component | File | Current behavior |
|---|---|---|
| Vault discovery + resolution | [services/secretsService.js](../../services/secretsService.js) `resolveKeyVaults()` (line 236) | Walks the GitHub repo tree, then for each matched vault calls `terragruntLocalsResolver.resolveName()`/`resolveResourceGroup()` (lines 257-258) — single-tier, live-only resolution today. No override or metadata tier exists. |
| Live name/RG resolver | [services/terragruntLocalsResolver.js](../../services/terragruntLocalsResolver.js) | Parses Terragrunt HCL; known to return `null` for some layouts (e.g. ITG's `include`-block pattern per repo memory). |
| Secrets API | [routes/api.js](../../routes/api.js) `GET /api/secrets/:appName/:environment` (line 205), `POST /api/secrets` (line 313) | Both are `requireAuth`-protected, `express-validator`-validated, correlationId-logged, `{ success, data, correlationId }` response shape. No `POST /api/secrets/vault-name-override` endpoint exists. |
| Secrets UI | [srcV2/pages/SecretsPage.vue](../../srcV2/pages/SecretsPage.vue) (line 590) | Renders `vault.vaultName || 'Key Vault name unavailable'` in the vault `<select>`. No inline correction control exists. |
| GitHub file read/write pattern | [services/githubService.js](../../services/githubService.js) `createOrUpdateFile()` (line 267, sha-based optimistic concurrency), `getFileContent()` (line 297, returns `{ content, sha }`, 404→`null`) | Established read-modify-write pattern already used elsewhere; this feature reuses it for the new sidecar file rather than inventing a new one. |

### Gaps and limitations
- No override tier exists; an unresolved vault name has no recovery path short of a code change.
- `resolveKeyVaults()` has no metadata-tier plumbing either (confirmed by code read per the source
  roadmap) — today's resolution is single-tier (live only). This PRD wires the override tier and
  a pass-through slot for a future metadata tier, without requiring the metadata tier to exist.
- No per-vault observability into which resolution path produced a value.

## 5. Requirement Classification Matrix

| Capability | Classification | Evidence | Proposed action |
|---|---|---|---|
| Override sidecar file (`docs/overrides/keyvault-overrides.json`) + schema | `new-feature` | No such file/schema referenced anywhere in `services/` or `docs/` | Create schema; write via existing `createOrUpdateFile()` pattern |
| `loadVaultOverrides()` in `secretsService.js` | `new-feature` | Not present in `secretsService.js` (grep confirmed) | Add function with 60s in-process cache |
| `POST /api/secrets/vault-name-override` endpoint | `new-feature` | No matching route in `routes/api.js` (grep confirmed) | Add route following existing `/api/secrets/*` validation/response conventions |
| "Set name manually" inline self-heal control | `existing-extend` | `SecretsPage.vue` already renders the vault `<select>` and the "Key Vault name unavailable" fallback text (line 590); this adds a control alongside it | Extend existing vault-list rendering, no new page/component |
| Consolidated `resolveVaultNameWithFallback()` helper + tier priority | `existing-extend` | `resolveKeyVaults()` already performs live (tier 3) resolution (lines 257-258); this wraps it with an override-first check, preserving current behavior when no override exists | Refactor call site inside `resolveKeyVaults()`, add helper function |
| correlationId-prefixed per-vault resolution-source logging | `existing-extend` | correlationId-prefixed logging is an established convention throughout `secretsService.js` and `routes/api.js` | Add one `logger.debug` call per vault in the existing resolution loop |
| Test coverage (override/metadata/live/IDM cases) | `existing-extend` | `secretsService`/`terragruntLocalsResolver` spec files already exist and are actively maintained (per repo memory: 407/407 passing) | Add new test cases to existing spec files |

## 6. Functional Requirements (FR)

### FR-001: Override sidecar schema and storage
- **Description**: Define and persist a JSON sidecar file at `docs/overrides/keyvault-overrides.json`
  in the service-catalog repo, keyed by `vaultDir` (the exact internal identifier already used by
  `secretsService`/`terragruntLocalsResolver`), with `name`, `resourceGroup` (optional),
  `appName`, `environment`, `qualifier` (optional), `verifiedBy`, `verifiedAt` per entry.
- **Priority**: must
- **Rationale**: gives a durable, auditable, human-correctable source for vault names that the
  live resolver cannot parse.
- **Acceptance criteria**:
  1. The file is created lazily (does not need to pre-exist) on the first override write.
  2. Each entry is keyed by the exact `vaultDir` string used elsewhere in the codebase — no new
     derivation/normalization logic is introduced for the key.
  3. `appName`/`environment`/`qualifier` are stored for display/audit only and are never used as
     part of the lookup key.
  4. A malformed or missing sidecar file causes `loadVaultOverrides()` to return an empty override
     set (not an error), so resolution silently falls through to tier 3.
- **Dependencies**: none (independent of Phase B).

### FR-002: `loadVaultOverrides()` in `secretsService.js`
- **Description**: Add a function that reads and JSON-parses the sidecar file via
  `githubService`'s existing `getFileContent()`/Octokit `getContent()` pattern, with an
  in-process cache (~60s TTL, matching the roadmap's stated tiny-file/low-staleness-risk rationale).
- **Priority**: must
- **Rationale**: avoids a GitHub API round-trip on every vault resolution while keeping override
  edits visible within roughly one minute.
- **Acceptance criteria**:
  1. Cache TTL is ≤ 60 seconds; a cache miss triggers exactly one GitHub read.
  2. Concurrent calls during a cache miss share one in-flight request (stampede protection),
     matching the existing `treeCache` pattern in the same file.
  3. `resolveKeyVaults()` checks `overrides[vaultDir]` before calling
     `terragruntLocalsResolver.resolveName()`/`resolveResourceGroup()`; when present, the live
     resolver is not invoked for that vault.
  4. Only `githubService.octokit` (Infrastructure App) is used — never `codeOctokit`.
  5. The sidecar is always read from `config.github.serviceRepo` (`organization/service-catalog`),
     regardless of the `target` value (`'sand'`/`'live'`) passed into `resolveKeyVaults()`. Unlike
     `resolveKeyVaults()`, `getSecretsList()`, and `submitSecretViaGitOps()`, `loadVaultOverrides()`
     must NOT call `mapRepo(target)` — the override store is one central location independent of
     which repo (`service-catalog` vs `infrastructure-live`) a given vault was discovered in, so an
     override set while resolving a `target='live'` vault (e.g. `exampleApplications`, `azureDatabricks`)
     is still found on the next read.
- **Dependencies**: FR-001 (schema).

### FR-003: `POST /api/secrets/vault-name-override` endpoint
- **Description**: New authenticated endpoint accepting
  `{ vaultDir, name, resourceGroup?, appName, environment, target, qualifier? }`, validated via
  `express-validator`, that performs a read-modify-write of the sidecar JSON using the file's
  current `sha` (optimistic concurrency), and returns `{ success, data, correlationId }`.
- **Priority**: must
- **Rationale**: gives the frontend a single call to persist a correction, consistent with every
  other mutating endpoint's contract in this codebase.
- **Acceptance criteria**:
  1. Route is protected by `requireAuth` (same as the rest of `/api/secrets/*`) — no new role
     model introduced.
  2. `vaultDir`, `appName`, `environment`, `target` are required; `resourceGroup`, `qualifier` are
     optional; all fields pass through `express-validator` with the same allow-list regex
     conventions used elsewhere in `routes/api.js` (e.g. `QUALIFIER_RE`-equivalent for `qualifier`);
     `target` is restricted to the same enum (`'sand'`/`'live'`) accepted by `resolveKeyVaults()`.
  3. Before writing, the endpoint calls `resolveKeyVaults(appName, environment, target,
     correlationId, qualifier)` (or `matchVaultsFromEntries` directly) and rejects the write with a
     4xx response (including `correlationId`) if the submitted `vaultDir` is not among the vaults it
     discovers — mirroring `submitSecretViaGitOps`'s existing allow-list-against-live-resolution
     convention (`services/secretsService.js` ~line 620) rather than trusting client-supplied
     `vaultDir` directly. `target` is used only for this discovery check, never to select the
     sidecar repo (see FR-002 AC5 — the sidecar write always targets `config.github.serviceRepo`).
  4. On a `sha` conflict (the sidecar changed between read and write), the endpoint returns a
     non-2xx response with `correlationId` and the client can retry; the write is never silently
     lost or overwritten without a fresh read.
  5. A repeat submission for an existing `vaultDir` key overwrites that entry (supports
     correcting a previously-set override), rather than erroring or duplicating.
  6. Every request/response is logged with `req.correlationId`, matching the codebase convention.
  7. Response body shape matches the standard contract: `{ success: boolean, data, correlationId }`.
- **Dependencies**: FR-001, FR-002.

### FR-004: "Set name manually" inline self-heal control in `SecretsPage.vue`
- **Description**: When a vault's `vaultName` is `null`, show the existing "Key Vault name
  unavailable" text plus a small inline form (name input, optional resource-group input) that
  calls FR-003's endpoint, then refetches the vault list so the corrected value displays
  immediately — no new component library or page.
- **Priority**: must
- **Rationale**: closes the loop for the user without requiring them to know the internal
  `vaultDir` value or file a support request.
- **Acceptance criteria**:
  1. The control appears only for vaults whose `vaultName` is `null`/falsy; resolved vaults are
     unaffected.
  2. The `vaultDir`, `appName`, `environment`, and `target` required by the endpoint (FR-003 AC2)
     are carried as hidden/internal fields alongside the existing vault selector — not surfaced as
     user-typed fields.
  3. On successful submission, the vault list is refetched and the corrected name appears without
     a full page reload.
  4. On submission failure, an inline error is shown; the form remains editable (no silent
     failure).
  5. The control is keyboard-operable and its input(s) have accessible labels (name, not just a
     placeholder).
- **Dependencies**: FR-003.

### FR-005: Consolidated `resolveVaultNameWithFallback()` helper
- **Description**: Introduce one helper, e.g. `resolveVaultNameWithFallback(vaultEntry, overrides,
  metadata)`, returning `{ name, resourceGroup, source: 'override'|'metadata'|'live'|'unresolved' }`,
  and use it as the single resolution call site inside `resolveKeyVaults()` in place of the current
  direct calls to the live resolver.
- **Priority**: must
- **Rationale**: gives one place that encodes the override > metadata > live priority rule (per
  the roadmap's locked decision), instead of scattering tier checks across the resolution loop.
- **Acceptance criteria**:
  1. Priority order is override > metadata > live, matching the roadmap's locked decision ("a
     human correction always wins, even over a CI-recorded value").
  2. When an override exists for a `vaultDir`, the helper returns it and does not invoke the live
     resolver.
  3. In this PRD's scope, `resolveKeyVaults()` always calls the helper with `metadata: undefined` —
     it does NOT call `infrastructureService.getApplicationDetails()` or otherwise fetch
     `docs/metadata/<app>-<env>.json` per resolution. The `metadata` parameter exists only as a
     pass-through slot for Phase B (out of scope, Section 10); wiring a real metadata fetch,
     including its caching/error-handling, is explicitly deferred and not budgeted in NFR-001.
  4. With `metadata` always `undefined`, the helper falls through to today's live-resolver
     behavior unchanged whenever no override exists — a missing/absent `metadata` argument is
     treated as a normal no-op, not an error.
  5. When neither override nor live resolution produce a name, `source` is `'unresolved'` and the
     caller's existing "Key Vault name unavailable" UI path is preserved.
  6. Existing callers of `resolveKeyVaults()` observe no behavior change for vaults that have no
     override.
- **Dependencies**: FR-002.

### FR-006: correlationId-prefixed resolution-source debug logging
- **Description**: Add one `logger.debug` call per vault, prefixed with `[${correlationId}]`,
  recording which tier (`source`) resolved the vault's name/resource group.
- **Priority**: should
- **Rationale**: cheap observability into the override/metadata/live split without a new endpoint
  or dashboard, per the roadmap.
- **Acceptance criteria**:
  1. Exactly one debug log line is emitted per vault per `resolveKeyVaults()` call, including
     `vaultDir` and `source`.
  2. The log line is prefixed with the request's `correlationId`, matching the rest of the file's
     logging convention.
  3. Logging failures (e.g. logger unavailable) never interrupt or fail the resolution call.
- **Dependencies**: FR-005.

### FR-007: Test coverage for the resolution chain
- **Description**: Extend existing `secretsService`/`terragruntLocalsResolver` spec files with
  cases for: (a) override present (short-circuits resolver), (b) metadata field present
  (short-circuits resolver — treated as optional/may-be-absent), (c) both absent (falls through to
  live resolver, current behavior unchanged), (d) an IDM-style nested-qualifier case resolved
  purely via override.
- **Priority**: must
- **Rationale**: the roadmap explicitly calls out these four cases as the minimum regression bar
  for the consolidated resolver.
- **Acceptance criteria**:
  1. A test exists asserting that when `overrides[vaultDir]` is present, `resolveVaultNameWithFallback()`
     returns that value with `source: 'override'` and the live resolver mock is not called.
  2. A test exists calling `resolveVaultNameWithFallback()` directly (in isolation, not through
     `resolveKeyVaults()`) with a `metadata.keyvaults[]` entry matching `vaultDir` and no override,
     asserting it returns that value with `source: 'metadata'` and the live resolver mock is not
     called — this exercises the helper's future Phase B path per FR-005 AC3; it is not reachable
     through `resolveKeyVaults()` in this PRD's scope, since that call site always passes
     `metadata: undefined`.
  3. A test exists asserting that when override is absent (and `resolveKeyVaults()` calls the
     helper with its default `metadata: undefined`), behavior is unchanged from today (live
     resolver mock is called, `source: 'live'` or `'unresolved'`).
  4. A test exists reproducing an IDM-style nested-qualifier `vaultDir`
     (`infrastructure/idm/_idmapplications/notif/dev/keyvault`) resolved purely via override, with
     no dependency on the live resolver succeeding.
  5. A regression test exists asserting that an override set while resolving a `target='live'`
     vault (e.g. `exampleApplications`/`azureDatabricks`, discovered against
     `config.github.infrastructureLiveRepo`) round-trips correctly through `loadVaultOverrides()`,
     which always reads/writes `config.github.serviceRepo` regardless of `target` (FR-002 AC5).
  6. All new and existing tests in the touched spec files pass (`npx vitest run --project jsdom
     srcV2/services/terragruntLocalsResolver.spec.ts` and the `secretsService` specs).
- **Dependencies**: FR-001 through FR-006.

## 7. Non-Functional Requirements (NFR)

### NFR-001 (Performance)
Override lookups must not add a per-vault GitHub API round-trip in the common case. **Target**:
the sidecar file is fetched at most once per 60-second window per process (cache hit rate ≥
99% of `resolveKeyVaults()` calls within a TTL window, assuming no concurrent stampede).

### NFR-002 (Reliability)
Concurrent override writes must not silently lose data. **Target**: 100% of write conflicts
(stale `sha`) are surfaced to the caller as a non-2xx response rather than overwriting a
concurrent edit; zero data-loss incidents in the override file across concurrent submissions.

### NFR-003 (Security/Compliance)
The override endpoint must not widen the current attack surface. **Target**: `POST
/api/secrets/vault-name-override` uses `requireAuth` (same policy as all other `/api/secrets/*`
routes, zero new role/permission model introduced) and 100% of its inputs are validated via
`express-validator` before any GitHub write; no new Octokit client/credential is introduced (reuses
`githubService.octokit`, the Infrastructure App).

### NFR-004 (Observability)
Every vault resolution must be traceable to its source tier. **Target**: 100% of
`resolveKeyVaults()` invocations produce one correlationId-prefixed debug log line per vault
naming the resolution `source`, queryable by correlationId per the codebase's existing tracing
convention.

### NFR-005 (Usability/Accessibility)
The self-heal control must be usable without leaving the Secrets page or knowing internal
identifiers. **Target**: correcting an unresolved vault name takes ≤ 2 user actions (open inline
form, submit) with zero required knowledge of `vaultDir`; all form inputs have accessible labels
(not placeholder-only) and are operable via keyboard.

### NFR-006 (Backward Compatibility / Data Integrity)
Introducing the override tier must not change behavior for any vault that has no override.
**Target**: 100% of existing `resolveKeyVaults()` test cases (pre-feature baseline) continue to
pass unmodified after this feature ships; the override file is additive-only relative to the
existing `docs/metadata/<app>-<env>.json` schema (zero fields removed or renamed there).

## 8. API and Data Impact

### API endpoints
| Endpoint | Change | Notes |
|---|---|---|
| `POST /api/secrets/vault-name-override` | **New** | Request: `{ vaultDir, name, resourceGroup?, appName, environment, target, qualifier? }`. Response: `{ success, data, correlationId }`. Auth: `requireAuth`. Sidecar read/write always targets `config.github.serviceRepo`; `target` is used only to validate `vaultDir` against `resolveKeyVaults()` (FR-003 AC3), never to select the sidecar repo. |
| `GET /api/secrets/:appName/:environment` | **Unchanged contract** | Internally now resolves via `resolveVaultNameWithFallback()` instead of calling the live resolver directly; response shape (`vaultName`, `resourceGroup` per vault) is unchanged. |

### Data contracts
- **New**: `docs/overrides/keyvault-overrides.json` (service-catalog repo) — sidecar keyed by
  `vaultDir`; see FR-001 schema.
- **Unchanged**: `docs/metadata/<app>-<env>.json` — no schema change in this PRD's scope; any
  future `keyvaults[]` array is Phase B's concern (Section 10) and this feature's helper treats
  its absence as a normal no-op.

### Backward compatibility
- Additive-only: no existing field is removed, renamed, or reinterpreted.
- A vault with no override and no metadata entry resolves exactly as it does today (tier 3, live
  resolver) — verified via FR-007's regression tests.

## 9. UX and Workflow Impact

**User journey**: An app owner opens the Secrets page, selects an app/environment whose vault
shows "Key Vault name unavailable," fills in the correct name (and optionally resource group) in
the inline "Set name manually" control, submits, and immediately sees the corrected name in the
vault selector without a page reload. The correction persists across future visits and future
users viewing the same app/environment.

**Status and error handling**: submission failures (validation error, write conflict) show an
inline error message and keep the form open for retry; no full-page error state or navigation
away from the Secrets page is required.

## 10. Risks, Assumptions, Open Questions

### Risks
- **Override staleness** (roadmap Further Considerations #1): if a vault is renamed/recreated
  after an override is set, the override will silently keep serving the old name indefinitely.
  Mitigation in this pass: none automatic; `verifiedAt` is stored in the schema (FR-001) so a
  future pass can surface it in a tooltip. Flagged as a known gap, not built here.
- **Auth scope for the override endpoint** (roadmap Further Considerations #2): this PRD adopts
  the roadmap's recommendation to reuse `requireAuth` with no additional role check, since this is
  a display correction rather than a security-sensitive write, and the endpoint requires knowing
  the internal `vaultDir` value (not currently user-facing without the FR-004 UI). If broader
  access-control concerns are raised in review, this is the section to revisit.
- **Per-directory Terragrunt `dependency` alias naming is not guaranteed uniform** (roadmap
  Further Considerations #4): this affects only Phase B's future CI-workflow scripting (out of
  scope here), not this PRD's override-tier code, since the override tier never invokes Terragrunt
  itself. Recorded here only so the dependency is visible if Phase B follow-on work references
  this PRD.

### Assumptions / Dependencies (out of scope, tracked here only)
- **Roadmap Phase B (tier 2 metadata write-back) is explicitly out of scope for this PRD.** It
  ships later, if at all, via a manual, out-of-pipeline change to the external service-catalog
  repo's `self-service-custom-infra.yml` CI workflow, and would add a `keyvaults[]` array to
  `docs/metadata/<app>-<env>.json`. This PRD's resolver-chain wiring (FR-005) must treat a
  missing/absent `metadata.keyvaults` array as a normal no-op fall-through to tier 3 (live
  resolver), not an error — this is already captured as an explicit acceptance criterion in
  FR-005 and a regression test in FR-007, so no engineering work here is blocked on Phase B
  landing.
- This PRD assumes `githubService.octokit` (Infrastructure App) has write access to the
  service-catalog repo path `docs/overrides/` — same repo/app already used for
  `docs/metadata/*` writes, so no new credential is assumed.

### Open Questions
- None blocking; the one open decision point flagged by the roadmap (auth scope, see Risks above)
  has an explicit recommended default that this PRD adopts.

## 11. Delivery Plan

### Milestones
1. FR-001/FR-002: sidecar schema + `loadVaultOverrides()` with cache.
2. FR-003: override endpoint.
3. FR-005/FR-006: consolidated resolver helper + logging, wired into `resolveKeyVaults()`.
4. FR-004: Secrets page inline self-heal control.
5. FR-007: test coverage across all four cases.

### Definition of done
- All FR acceptance criteria met; `npm test` full suite green; `npm run type-check` clean.
- Manual E2E per the roadmap's verification steps: set an override, confirm it persists across a
  page reload and wins over any live-resolver result.

### Rollout and rollback
- Additive-only change (new file, new endpoint, new UI control) — rollback is a straightforward
  revert with no data migration, since the sidecar file is new and optional (absence is a no-op).

## 12. Test and Validation Strategy

- **Unit/integration**: FR-007's four cases in `secretsService`/`terragruntLocalsResolver` spec
  files (Vitest, `jsdom`/`node` projects as applicable).
- **API contract**: request validation and `sha`-conflict handling for
  `POST /api/secrets/vault-name-override` (NFR-002, NFR-003).
- **Manual/E2E**: set an override for an unresolved vault via the Secrets page UI, confirm
  immediate reflection and persistence across reload (FR-004, NFR-005).
- **Regression**: full `npm test` run to confirm FR-005/FR-006 introduce zero behavior change for
  vaults without an override (NFR-006).

---

## Summary

| Metric | Count |
|---|---|
| Total FR count | 7 |
| Total NFR count | 6 |
| `existing-refine` | 0 |
| `existing-extend` | 4 |
| `new-feature` | 3 |
| `unknown-needs-discovery` | 0 |

## Next Decisions Needed
- Confirm the recommended auth default (reuse `requireAuth`, no new role check) for the override
  endpoint is acceptable, or whether a stricter permission model is required (Section 10).
- Confirm no automatic staleness detection is needed in this pass (Section 10, Risk 1).

<!-- ORCHESTRATOR-READY
feature: vault-resolution-override
prd_path: docs/prd/vault-resolution-override.md
status: approved
fr_count: 7
nfr_count: 6
-->
