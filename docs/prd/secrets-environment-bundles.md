# PRD: Secrets Environment Bundles — Configurable Bundle Membership & Atomic Bundle Submission

## 1. Title and Metadata

| Field        | Value                                                                               |
|--------------|--------------------------------------------------------------------------------------|
| Feature Name | Secrets Environment Bundles                                                          |
| Slug         | `secrets-environment-bundles`                                                        |
| Author       | Product Manager Agent                                                                |
| Date         | 2026-09-18                                                                           |
| Status       | `draft` (revised; pending PRD Challenger round 2)                                    |
| Stakeholders | Platform Engineering, Application Developers, Security/Compliance Team, DevSecOps    |
| Repository   | `Aya-DevOpsTeam/self-service-infra`                                                  |
| Supersedes (partial) | `secrets-environment-scope` — FR-002 (free multi-select), FR-004 (N-PR-per-environment fan-out), NFR-REL-001 (per-environment independence), for any environment that is a member of a configured bundle. See §4/§5/§10. |
| Extends      | `secret-self-service` (2026-07-31), `secrets-environment-scope` (2026-08-08, resolves its OQ-004), `secrets-ui-enhancements` (2026-08-01) |

---

## 2. Problem Statement

### Current Pain

`secrets-environment-scope` (shipped, `pass_with_gaps`, sandbox-cleared) gave the Secrets page a
binary **tier** concept (`production` / `non-production` / `unclassified`) sourced from
`data/environmentTiers.json`, and a free-form multi-select that fans a submission out to **one
independent commit and one independent PR per selected environment**
(`services/secretsService.js` `submitSecretsFanOut()`, lines 856–876, looping
`submitSecretViaGitOps()` via `Promise.allSettled`; `routes/api.js` lines 454–516). That PRD's own
NFR-REL-001 (line 511) makes this an explicit, hard contract: *"Each environment's branch/PR is a
fully independent Git artifact."* It also left an explicit open question on record — **OQ-004
("Are there more than two tiers?")**, closed as "safe to leave open... revisit only if Platform
Engineering later requests a richer taxonomy" (line 722).

The stakeholder has now confirmed exactly that richer taxonomy, and it does not fit the existing
binary tier model or the N-PR-per-environment mechanism:

1. **Three (extensible) named bundles, not two tiers.** `independent` (`sand`, `devsand`),
   `developer` (`dev`, `int`, `sint`, `stage`), and `release` (`prod`, `cint`, `hot`, `demo`,
   `dr`). This reclassifies environments the current `data/environmentTiers.json` already places
   elsewhere: `stage` is currently `"production"` (line 4 of that file) but the new `developer`
   bundle needs it non-release; `cint`/`hot`/`demo` are currently `"nonProduction"` (lines 6–9)
   but the new `release` bundle needs them release-controlled; `dr` does not appear in
   `data/environmentTiers.json`, `data/environments.json`, or any other config file in this
   repository at all today.
2. **Bundle membership, identifiers, numbering, and bundle count must all be configurable**,
   not hardcoded — Platform Engineering must be able to add, rename, reorder, or introduce a
   fourth/fifth bundle (the stakeholder explicitly flags `cint` as a candidate to later move to
   its own bundle) without an engineering change.
3. **One commit / one PR per bundle submission, not per environment.** This is the direct
   opposite of `secrets-environment-scope`'s shipped FR-004/NFR-REL-001 design, which is
   independent-PR-per-environment by explicit contract, not an accident of implementation.
4. **Backend-enforced bundle membership.** Today, `POST /api/secrets` validates environment
   *format* (regex) and *resolvability* (vault lookup) but never checks that a submitted
   environment is a member of any declared group — `classifyEnvironmentTier()`
   (`services/secretsService.js` lines 552–569) is consulted **only** to decide whether to log
   `confirmedProductionWrite` for FR-007's audit trail, never to reject a request. The
   `secrets-environment-scope` readiness report explicitly flags this as a residual, accepted
   risk: *"FR-007's production-write confirmation is enforced client-side only... the backend
   logs the claim for audit but does not reject an unconfirmed production-tier write from a
   direct API call"* (`docs/readiness/secrets-environment-scope-readiness.md`, Security Gate
   section).
5. **No per-environment secret values.** `SecretsPage.vue`'s `secretEntries` ref (line 82) is one
   flat array of `{ name, value, confirmation }` shared across every environment selected;
   `submitSecretsFanOut()` (line 856) passes the identical `secrets` array to every environment's
   `submitSecretViaGitOps()` call. There is no way today to give `dev` a different value than
   `int` for the same secret key in one submission.
6. **Release-bundle PR-review enforcement is unresolved.** `secret-self-service`'s own PRD
   (lines 908–913, 956) flagged the CODEOWNERS entry for
   `infrastructure/**/keyvault*/secrets.enc.yaml` in `infrastructure-live`/`service-catalog` as an
   *"implementation follow-up... set at build time,"* never confirmed resolved. Verification
   attempted for this PRD (`gh api repos/Aya-DevOpsTeam/infrastructure-live` via the same GitHub
   App this platform uses) returned `404 Not Found` — this workspace's credentials cannot inspect
   branch protection/CODEOWNERS state in either target repo directly (see §10 OQ-001).

### Why Now

`secrets-environment-scope` is live in sandbox and its own PRD flagged the exact gap this feature
closes (OQ-004) as intentionally deferred, not rejected. The stakeholder has now supplied the
concrete bundle taxonomy Platform Engineering was waiting on, plus governance requirements
(backend enforcement, atomic single-PR submission, PR-review-gated release control) that go
beyond what OQ-004 alone anticipated. Shipping now avoids compounding technical debt: every
sprint the binary tier model stays live, more apps onboard against `data/environmentTiers.json`'s
current (about-to-be-wrong) `stage`/`cint`/`hot`/`demo` classifications.

### Expected Business Value

| Outcome | Measurable Indicator |
|---|---|
| Reduce accidental/uncontrolled release-tier secret writes | 100% of release-bundle submissions carry a machine-readable release-control marker in the PR body and audit log at launch (NFR-SEC-002) |
| Reduce Git noise and review burden for multi-environment provisioning | Bundle submissions produce exactly 1 commit + 1 PR (down from N today) in 100% of QA fan-out regression scenarios |
| Let Platform Engineering evolve environment groupings without an engineering request | 0 code changes required to add/rename/reorder a bundle or move an environment (e.g. `cint`) between bundles post-launch |
| Reduce developer friction entering per-environment secret differences | 100% of QA test cases confirm independently-edited per-environment values persist correctly in one bundle submission |

### User Personas

| Persona | Goal |
|---|---|
| **Application Developer** | Pick one bundle (e.g. "Developer"), see only the environments in it that actually exist for their app, enter a possibly-different value per environment, and submit once |
| **Platform Engineer** | Curate bundle identifiers/order/membership/count in one versioned config file, reviewed via the platform's existing PR process, without touching Vue or Express code |
| **Security/Compliance Reviewer** | Trust that release-bundle submissions are always routed through PR review, that bundle membership can never be spoofed client-side, and that no secret value ever appears in a commit message, PR body, log line, or error response |

---

## 3. Goals, Success Metrics, and Non-Goals

### Goals

1. Replace the binary tier model with a versioned, file-driven bundle configuration whose
   identifiers, ordering, membership, and total bundle count are all configurable without code
   changes.
2. Show and accept, in the UI, only environments that are (a) members of a configured bundle and
   (b) actually deployed for the selected application in `infrastructure-live`/`service-catalog`
   — anything else is silently omitted, never shown as an error or empty placeholder.
3. Enforce bundle membership server-side, independent of and never trusting the Vue client, for
   every bundle-mode submission.
4. Replace the per-environment fan-out (N commits/N PRs) with exactly one atomic commit and one
   PR per bundle submission, covering every applicable available environment in that bundle.
5. Let a developer assign a distinct secret value per environment for the same secret key within
   one bundle submission.
6. Make release-bundle submissions machine-discoverable as release-controlled, so that
   external PR-review/CODEOWNERS enforcement (owned by Platform/DevSecOps in the target repos)
   can act on that signal; keep `cint` in the release bundle today with a documented, code-free
   path to relocate it later.
7. Preserve the platform's existing zero-plaintext-secret-value guarantee across every new
   commit/PR/log/error surface this feature introduces.

### Success Metrics

| Goal | Metric | Target |
|---|---|---|
| Configurable bundle model | % of environment groupings on the Secrets page sourced from the new bundle config file (vs. hardcoded Vue/Express logic) | 100% at launch |
| Bundle + existence filtering | % of QA regression cases where a non-bundle-member or non-deployed environment is rendered or accepted | 0% |
| Backend enforcement | % of bundle-mode `POST /api/secrets` requests where server-side membership is independently re-derived (never trusting a client-supplied bundle claim) | 100% |
| Atomic single-PR submission | % of bundle submissions producing exactly 1 commit + 1 PR in QA/integration tests | 100% (down from N today) |
| Per-environment values | % of QA test cases confirming independently-edited per-environment values persist without cross-environment leakage | 100% |
| Release-bundle signal | % of release-bundle submissions carrying a `releaseControlled: true` marker in PR body + audit log | 100% at launch |
| No secret leakage | Occurrences of plaintext `secretValue` in logs, PR bodies, API errors, or CI artifacts across the new bundle code path | 0 |

### Non-Goals

- **Designing or configuring the actual GitHub branch-protection/CODEOWNERS rule in
  `infrastructure-live`/`service-catalog`.** This PRD makes release-bundle submissions
  machine-discoverable (a flag/marker); actually requiring specific reviewers before merge is an
  external repo-administration action owned by Platform/DevSecOps (see OQ-001).
- **Free-form, user-defined bundles.** Bundle definitions are curated by Platform Engineering in
  a versioned config file; end users never create or edit bundles themselves.
- **Changing the SOPS encryption model or per-environment vault-resolution algorithm.** This PRD
  reuses `resolveKeyVaults()` and the encrypt-then-write pattern unmodified per environment; only
  the commit/PR aggregation and membership-checking layers change.
- **Cross-target bundle submission** (submitting to both `live` and `sand` in one bundle action)
  — unchanged from the existing platform-wide Non-Goal (`secrets-environment-scope` §3,
  `secrets-ui-enhancements` §3): one `target` per submission.
- **Automatic retry of partially-applicable bundle submissions.** If some bundle members are
  excluded pre-flight (not deployed, ambiguous vault/qualifier), the developer resubmits after
  resolving the exclusion manually — consistent with the existing single-environment retry model
  (`secrets-environment-scope` OQ-005).
- **Restricting the legacy singular `environment` / existing `environments[]` (secrets-environment-scope)
  request shapes to bundle-member environments only.** Those shapes remain available, unrestricted,
  for backward compatibility (FR-009); bundle membership enforcement (FR-003) applies only to the
  new bundle-mode request shape. Whether to retroactively restrict the legacy shapes is an open
  question (OQ-003), not a decision this release makes.
- **Automatically inferring bundle membership from environment-name heuristics.** Membership is
  always an explicit, hand-curated list per bundle — never a regex or naming-convention guess
  (same principle already established for tier classification in `secrets-environment-scope`
  FR-001(a)).

---

## 4. Current State Assessment

### What Exists Today (Evidence Table)

| Capability | File | Notes |
|---|---|---|
| Binary tier classification (2 tiers + fallback) | [data/environmentTiers.json](../../data/environmentTiers.json) | `production: [prod, stage]`, `nonProduction: [nonprod, dev, int, sint, cint, hot, demo]`, `other: [shared-services, hub, devsand, sand]` (documentation-only bucket). Conflicts with the new bundle taxonomy: `stage` must move to `developer`, `cint`/`hot`/`demo` must move to `release`; `dr` is absent entirely. |
| Server-side tier classifier (read-only, non-enforcing) | [services/secretsService.js](../../services/secretsService.js) `classifyEnvironmentTier()` (lines 552–569) | Reads `data/environmentTiers.json` synchronously per call; used only to compute a `tier` field for UI grouping and for the `confirmedProductionWrite` audit-log claim — **never used to reject a request** |
| Free-form multi-select environment picker | [srcV2/pages/SecretsPage.vue](../../srcV2/pages/SecretsPage.vue) `selectedEnvironments` (line 49), `MAX_ENVIRONMENTS = 10` (line 39), `environmentGroups` computed grouping by tier with an "Other"/`unclassified` bucket rendered whenever non-empty (lines 150–160) | Any environment discovered for the app is selectable, including `unclassified` ones — nothing is hidden by bundle/tier membership today |
| Shared (not per-environment) secret value entry | `srcV2/pages/SecretsPage.vue` `secretEntries` (line 82) | One flat `{ name, value, confirmation }[]` array applied identically to every selected environment — no per-environment value differentiation exists |
| N-PR-per-environment fan-out submission | `services/secretsService.js` `submitSecretsFanOut()` (lines 856–876) | `Promise.allSettled` calls the unmodified single-environment `submitSecretViaGitOps()` once per environment — **N environments produce N branches, N commits, N PRs**, by explicit design (see NFR-REL-001 below) |
| Per-environment atomicity contract (to be superseded for bundles) | `docs/prd/secrets-environment-scope.md` NFR-REL-001 (line 511) | *"Each environment's branch/PR is a fully independent Git artifact."* Directly conflicts with this PRD's "exactly one commit and one PR per bundle submission" requirement — see §10 Risks. |
| Single-file-per-commit GitOps mechanism | `services/secretsService.js` `submitSecretViaGitOps()` (lines 714–849) | Uses `githubService.createOrUpdateFile()` (Contents API, one file per call) to write exactly one vault's `secrets.enc.yaml`, then opens one PR — this mechanism has no existing path for one commit spanning multiple files/vaults across environments |
| Request/response contract (existing, unmodified by this feature except additively) | [routes/api.js](../../routes/api.js) `POST /api/secrets` (lines 313–533) | Validator chain enforces exactly one of `environment` (legacy singular) XOR `environments` (array); response is `results: []` for the fan-out shape. No `bundleId` concept exists. |
| Server never trusts client production-tier confirmation | `routes/api.js` lines 471–474, 486–488 | Re-derives `productionEnvironments` server-side via `classifyEnvironmentTier()` for the audit log, but does not reject an unconfirmed write — confirmed residual risk in `docs/readiness/secrets-environment-scope-readiness.md` Security Gate section |
| Confirmed real environment folder names matching every requested bundle member | `docs/roadmaps/plan-layeredKeyVaultResolution.md` ("Validated test case: ayaApplications", live probe 2026-08-12) | `infrastructure/ayaApplications/ayaCoreServices/keyvaults/<env>/keyvault` in `infrastructure-live` has exactly: `dev`, `devsand`, `int`, `prod`, `sand`, `sint`, `stage`, `hot`, `dr`, `demo`, `cint` — **all 11 requested bundle members already exist as real, deployed environment folders for at least one app.** This confirms `dr` is real infra-live evidence, not a hypothetical. |
| No plaintext secret value in PR body (existing invariant) | `services/secretsService.js` lines 835–845 | `prBody` array includes only Target/App/Environment/Qualifier/Vault/Jira/secret **names**/Submitted-by/Correlation-ID — never `secretValue` |
| No plaintext secret value in validation error responses (existing invariant) | `routes/api.js` lines 340–354 | `redactSecretValues()` recurses `nestedErrors` to strip any submitted `secretValue` from a 400 response body |
| Portal-scoped, unrelated "environment" concept | [data/environments.json](../../data/environments.json) | 3 entries (`devsand`, `sand` ×2, `aisand`) gating unrelated portal feature flags (`customInfra`/`templates`/`aks`/`secrets`) — confirmed distinct from bundle/tier folder-name concepts by both prior secrets PRDs; unaffected by this feature |
| Versioned-config-via-PR precedent (this repo) | [CODEOWNERS](../../CODEOWNERS) (`* @Aya-DevOpsTeam/team-devops-write`) | Every file change in this repository, including any `data/*.json` config, already requires a reviewed PR merge — the same convention this feature's bundle config file will use, no new mechanism needed |
| Unresolved external CODEOWNERS/PR-review gap for target repos | `docs/prd/secret-self-service.md` lines 908–913, 956 | Flagged as an "implementation follow-up... set at build time" for `infrastructure/**/keyvault*/secrets.enc.yaml` in **both** `infrastructure-live` and `service-catalog` — never confirmed resolved by any later PRD/readiness report |
| Confirmed inaccessibility of target repos from this workspace | Verified live during this PRD's authoring: `gh api repos/Aya-DevOpsTeam/infrastructure-live` (and the equivalent MCP GitHub tool call) returned `404 Not Found` | This workspace cannot directly inspect or configure branch protection/CODEOWNERS state in either target repo — the actual PR-review enforcement for release bundles is an external dependency, not something this PRD's engineering phase can verify or ship end-to-end |
| Prior open question this PRD resolves | `docs/prd/secrets-environment-scope.md` OQ-004 (lines 722–734) | *"Should the UI support a third tier bucket... or does Platform Engineering want a richer taxonomy?"* — left open, "revisit only if Platform Engineering later requests a richer taxonomy." That request is this PRD. |

### Gaps and Limitations

- No config file anywhere expresses "bundle" as a first-class, ordered, N-ary concept — only a
  hardcoded two-tier-plus-fallback shape (`data/environmentTiers.json`).
- The backend never rejects a request based on environment/bundle membership — `classifyEnvironmentTier()`
  is read-only/advisory, consulted only for UI grouping and audit logging.
- The GitOps write path (`submitSecretViaGitOps()`) has no mechanism for a single commit spanning
  more than one file/vault/environment; every existing call path is designed around exactly one
  file, one branch, one PR.
- There is no per-environment secret-value data structure anywhere in the frontend or the API
  contract — `secrets[]` is always applied uniformly across every selected environment.
- No in-repo mechanism exists (and none can be verified from this workspace) that confirms a
  release-bundle submission is actually gated by mandatory reviewer approval in the target repo.

---

## 5. Requirement Classification Matrix

| Capability | Classification | Evidence | Proposed Action |
|---|---|---|---|
| Bundle configuration file (versioned, PR-approved, arbitrary id/order/membership/count) | `existing-extend` | `data/environmentTiers.json` already establishes the hand-curated, git-versioned, additive-JSON-file convention (`data/environments.json`/`data/modules.json`/`data/roles.json` share it); this repo's `CODEOWNERS` already gates every file change via PR review | Introduce `data/secretBundles.json` with an array-of-bundle-objects schema (id, displayName, order, environments[], releaseControlled) so bundle count/order/membership are all data, not code (FR-001) |
| Bundle-scoped, existence-filtered environment visibility | `existing-extend` | `filteredEnvironmentOptions`/`environmentGroups` (`SecretsPage.vue` lines 132–160) already filter by discovered app/environment pairs and group by classification; today's grouping renders an "Other"/`unclassified` bucket whenever non-member entries are present rather than omitting non-member entries | Change grouping/filtering so only bundle-member **and** app-deployed environments render; drop the catch-all "Other" bucket for bundle-mode display (FR-002) |
| Backend bundle-membership enforcement | `existing-extend` | `POST /api/secrets`'s validator chain (`routes/api.js` lines 313–333) and `classifyEnvironmentTier()` already exist as the extension points; membership is simply never checked against them today | Add a server-side re-derivation of bundle membership from `data/secretBundles.json` for the new bundle-mode request shape; reject (400) any environment not in the declared bundle (FR-003) |
| Pre-flight per-environment eligibility resolution | `existing-extend` | `resolveKeyVaults()` (unmodified) and the existing `VAULT_AMBIGUOUS`/`QUALIFIER_AMBIGUOUS` exclusion precedent (`secrets-environment-scope` FR-003(c)/(d)) already provide the exclusion mechanics this feature needs to reuse per bundle member | Run existing resolution once per bundle-member environment before building the atomic commit; exclude and report unresolvable/non-deployed members without blocking the rest (FR-004) |
| Atomic single-commit/single-PR bundle submission | `new-feature` | `submitSecretViaGitOps()` (lines 714–849) performs the encrypt → write → PR sequence per environment, but `githubService.js` has no multi-file single-commit Git Data API wrapper; this feature materially changes the sequence's granularity from N independent commits/PRs to one, directly superseding `secrets-environment-scope` FR-004/NFR-REL-001 | Add and test a Git Data API-based commit aggregation path for bundle-mode requests; supersede the existing per-environment fan-out for bundle-mode requests only (FR-005) |
| Per-environment distinct secret values in one submission | `existing-extend` | `secretEntries`/`secrets[]` already model secret name/value rows; the gap is that the same array is applied to every environment instead of one array per environment | Restructure the bundle-mode request/UI to carry one `secrets[]` array per included environment (FR-006) |
| Release-bundle PR-review enforcement (in-repo signal) | `existing-extend` | FR-007 of `secrets-environment-scope` already established a client-observable "production write" concept and its audit-log pattern (`confirmedProductionWrite`); this feature extends that pattern to a bundle-level, server-emitted `releaseControlled` marker | Emit a `releaseControlled: true` marker in the PR body and `logMetric` audit trail for any bundle flagged `releaseControlled` in config (FR-007) |
| Release-bundle PR-review enforcement (actual external gate) | `unknown-needs-discovery` | `infrastructure-live`/`service-catalog` CODEOWNERS/branch-protection state is unverified — flagged unresolved since `secret-self-service` (lines 908–913) and unreachable (`404`) from this workspace during evidence-gathering for this PRD | Not an FR this PRD's engineering phase can close end-to-end; tracked as OQ-001 (owner: Platform/DevSecOps), required before release-bundle production go-live |
| No secret value leakage in bundle artifacts | `existing-refine` | `prBody` construction (lines 835–845) and `redactSecretValues()` (lines 340–354) already prove the zero-plaintext-value invariant for the existing single/fan-out paths | Re-verify (not redesign) the same invariant holds for the new multi-file commit, multi-environment PR body, and bundle audit-log fields (FR-008) |
| Backward compatibility for legacy single/multi-environment callers | `existing-refine` | Legacy singular `environment` (FR-006 of `secret-self-service`) and array `environments[]` (FR-004/FR-006 of `secrets-environment-scope`) shapes are both live in production today and explicitly designed to keep working unmodified | Confirm both legacy shapes continue to function exactly as today, entirely unaffected by the new bundle-mode shape (FR-009) |

---

## 6. Functional Requirements (FR)

### FR-001 — Bundle Configuration Schema & Governance

**Description**: A new, versioned config file (`data/secretBundles.json`) defines an ordered,
arbitrary-length list of bundles, each with an identifier, display order, environment membership
list, and a release-control flag. The file is edited and approved via this repository's existing
GitHub PR process — no new governance mechanism is introduced.

**Priority**: must

**Rationale**: Directly resolves `secrets-environment-scope` OQ-004 and the stakeholder's explicit
requirement that "bundle identifiers, numbering, membership, and number of bundles must be
configurable so bundles can evolve without code changes."

**Acceptance Criteria**:

- (a) Schema shape:
  ```json
  {
    "_comment": "Hand-maintained by Platform Engineering, same convention as data/environmentTiers.json / data/environments.json. Order determines both UI display order and array position; environments are case-insensitive folder names as discovered by discoverAppsForTarget().",
    "version": "1.0",
    "bundles": [
      { "id": "independent", "displayName": "Independent Environments", "order": 1, "releaseControlled": false, "environments": ["sand", "devsand"] },
      { "id": "developer",   "displayName": "Developer Bundle",         "order": 2, "releaseControlled": false, "environments": ["dev", "int", "sint", "stage"] },
      { "id": "release",     "displayName": "Release Bundle",           "order": 3, "releaseControlled": true,  "environments": ["prod", "cint", "hot", "demo", "dr"] }
    ]
  }
  ```
- (b) The number of bundle objects in the `bundles` array is unbounded by code — server and UI
  logic iterates the array generically; adding/removing/reordering a bundle requires only a data
  change and a PR merge, never an application code change.
- (c) `id` is unique (case-insensitive) across all bundles in the file; a duplicate `id` fails
  the candidate config load with a startup/log error, never a silent overwrite. As with every
  schema-validation failure in this requirement, a process that has already loaded a valid
  configuration continues using that last-known-good in-memory config; on cold start, where no
  last-known-good config exists, bundle-aware reads expose no bundle membership and bundle-mode
  submissions fail closed with HTTP 503 while legacy request shapes remain available. The service
  never activates a partially validated config.
- (d) An environment name may appear in **at most one** bundle at a time; the loader fails config
  validation (startup/log error, retaining the last-known-good config when available) if the same
  environment name (case-insensitive) appears in two bundles' `environments[]`. On cold start,
  this uses the fail-closed bundle-mode behavior defined in (c).
- (e) Matching between a bundle's `environments[]` entries and real discovered environment folder
  names is case-insensitive, consistent with the existing `classifyEnvironmentTier()` convention.
- (f) The seed data ships with exactly the stakeholder-confirmed membership: `independent` =
  `[sand, devsand]`; `developer` = `[dev, int, sint, stage]`; `release` = `[prod, cint, hot, demo,
  dr]`, with `release.releaseControlled = true` and the other two `false`.
- (g) `cint` remains in `release` for this release. Moving it to a new or existing bundle later is
  a config-only change (edit `data/secretBundles.json`, no code change) — this AC exists so the
  stakeholder's explicit "may later move" note is a tested, not merely stated, capability: a QA
  test case moves `cint` between bundles in a config fixture and confirms no code change is
  required for the bundle-membership/eligibility/PR-flagging logic to reflect it.
- (h) `data/environmentTiers.json` is not deleted or modified by this feature (no other consumer
  is known to depend on it being removed); it becomes unused input to the Secrets page's bundle
  UI specifically, but remains available for any other consumer until a separate cleanup decision
  is made (see OQ-003).

**Dependencies**: None (new, additive config file).

---

### FR-002 — Bundle-Scoped, Existence-Filtered Environment Visibility

**Description**: The Secrets page and its backing API show, for a selected application, only
environments that are (a) members of a configured bundle and (b) actually discovered as deployed
for that application by the existing `discoverAppsForTarget()`/`resolveKeyVaults()` logic. Any
bundle member with no matching deployed environment for the app is omitted with no error,
warning, or placeholder — exactly as if it were never configured.

**Priority**: must

**Rationale**: Directly implements "UI displays only environments that belong to a configured
bundle and exist for the selected application in `infrastructure-live`... missing environments
are silently omitted."

**Acceptance Criteria**:

- (a) `GET /api/secrets/apps?target=live|sand` response entries gain a `bundleId` field
  (`string | null`) computed server-side from `data/secretBundles.json`; `null` means the
  environment is not a member of any configured bundle.
- (b) The Secrets page groups environment options by bundle (`displayName`, ordered by `order`)
  instead of by tier; an environment whose `bundleId` is `null` is never rendered anywhere in the
  bundle-mode UI — there is no "Other"/`unclassified` catch-all bucket in this feature (contrast
  with `secrets-environment-scope` FR-001(b)'s "Other" bucket rendered whenever non-bundle
  entries are present, which this feature's UI path does not use).
- (c) An environment configured in a bundle (e.g., `dr` in `release`) that has no corresponding
  deployed environment folder for the selected application is never present in the API response
  or the UI for that application — it is indistinguishable from an environment that was never
  configured at all. No "not deployed" placeholder, disabled option, or warning text is shown.
- (d) This filtering re-runs whenever the selected application changes, reusing the existing
  5-minute repo-level tree cache (`treeCache`/`getCachedTree` in `services/secretsService.js`) —
  no new caching mechanism is introduced.
- (e) The developer selects exactly one bundle at a time (not an arbitrary cross-bundle
  multi-select); all bundle-member-and-deployed environments within the selected bundle are
  candidates for inclusion per FR-004, without an additional per-environment checkbox step.
- (f) A bundle with zero bundle-member-and-deployed environments for the selected application is
  omitted from the bundle selector entirely. The UI does not render an empty or disabled bundle,
  placeholder environments, or a reason message; this is the bundle-level application of the
  stakeholder-confirmed silent-omission rule.

**Dependencies**: FR-001 (bundle config), existing `discoverAppsForTarget()`/`resolveKeyVaults()`.

---

### FR-003 — Backend Bundle Membership Enforcement

**Description**: For any bundle-mode submission (FR-005/FR-006's new request shape), the backend
independently re-derives bundle membership from `data/secretBundles.json` and rejects any
requested environment that is not a member of the declared `bundleId` — regardless of what the
Vue client sent or omitted.

**Priority**: must

**Rationale**: Directly implements "Enforce bundle membership and submission rules in the
backend, not only Vue," and closes the exact gap the `secrets-environment-scope` readiness report
flagged as an accepted residual risk for FR-007 (client-only enforcement).

**Acceptance Criteria**:

- (a) `POST /api/secrets` (bundle-mode shape, FR-005) validates that `bundleId` matches a
  configured bundle `id` (case-insensitive); an unknown `bundleId` returns HTTP 400.
- (b) For every `environment` named in the request's per-environment secrets payload (FR-006),
  the backend checks membership in `data/secretBundles.json`'s `bundles[bundleId].environments[]`.
  Any environment not a member returns HTTP 400 with the specific offending environment name(s)
  named in the error (never a blanket, unspecific rejection).
- (c) This check runs even if the request appears to originate from a fully "valid-looking" Vue
  session — the server never trusts a client-supplied bundle/environment pairing without
  independent re-validation, mirroring the existing pattern already used for `vaultDir` allow-list
  validation (`services/secretsService.js` FR-002(l) precedent, lines 743–752) and for
  server-side tier re-derivation (`routes/api.js` lines 471–474).
- (d) This enforcement applies only to the new bundle-mode request shape (FR-005/FR-006); the
  legacy singular `environment` and existing `environments[]` shapes are unaffected (FR-009,
  Non-Goals).
- (e) A rejected request produces zero GitHub writes (no branch, no commit, no PR) — membership
  validation runs entirely before any GitOps side effect.

**Dependencies**: FR-001 (bundle config), FR-005 (bundle-mode request shape).

---

### FR-004 — Pre-Flight Bundle Eligibility Resolution & Exclusion Reporting

**Description**: Before a bundle submission is built, the backend resolves each bundle-member,
app-deployed environment's Key Vault (reusing the unmodified `resolveKeyVaults()`) and reports,
per environment, whether it is eligible for inclusion in the atomic commit or must be excluded
(and why) — consistent with the existing ambiguity-exclusion precedent, extended to the bundle
model.

**Priority**: must

**Rationale**: "All applicable available environments" (from the stakeholder's one-commit/one-PR
requirement) must have a precise, testable definition: bundle member ∩ deployed-for-this-app ∩
unambiguously resolvable. This FR gives that intersection a concrete computation and a
user-visible exclusion report, mirroring `secrets-environment-scope` FR-003(c)/(d)'s existing
ambiguity-exclusion pattern rather than inventing a new one.

**Acceptance Criteria**:

- (a) An environment is **eligible** for the bundle submission when it is (1) a bundle member
  (FR-002), (2) deployed for the app (FR-002), and (3) `resolveKeyVaults()` returns exactly one
  resolvable vault (or a caller-selected `vaultDir`/`qualifier` disambiguates a multi-vault case),
  with no unresolved `QUALIFIER_AMBIGUOUS`.
- (b) An environment is **excluded** (and reported with a reason: `NOT_DEPLOYED` — filtered
  silently per FR-002(c), never surfaced here — `VAULT_AMBIGUOUS`, or `QUALIFIER_AMBIGUOUS`) when
  it is a bundle member and deployed but not uniquely resolvable, mirroring
  `secrets-environment-scope` FR-003(c)/(d)'s existing exclusion codes.
- (c) The UI surfaces excluded (but deployed) environments distinctly from the never-shown,
  not-deployed ones — e.g., a bundle member that exists for the app but has an ambiguous vault is
  shown with a disabled state and a reason, exactly as `secrets-environment-scope` FR-003(c)
  already does for its multi-select today; only truly non-existent environments (FR-002(c)) are
  fully invisible.
- (d) The set of eligible environments is computed and shown to the developer before the submit
  action is enabled, so they know exactly which environments will be included in the one commit.
- (e) Resolution reuses the existing 5-minute tree cache; no new caching mechanism is introduced.
- (f) If zero environments in the selected bundle are eligible (e.g., the app has no deployed
  environments in that bundle at all), the submit action is disabled with a clear message — no
  empty-bundle submission is possible.
- (g) The pre-flight result for each deployed-but-ineligible environment includes
  `{ environment, reason, vaults?, qualifiers? }`, where `reason` is `VAULT_AMBIGUOUS` or
  `QUALIFIER_AMBIGUOUS`; the UI uses the returned `vaults`/`qualifiers` to let the developer
  supply a per-environment `vaultDir`/`qualifier` before submitting. A non-deployed environment
  is omitted per FR-002 and never appears in this result.

**Dependencies**: FR-001, FR-002, unchanged `resolveKeyVaults()`.

---

### FR-005 — Atomic Single-Commit / Single-PR Bundle Submission

**Description**: `POST /api/secrets` gains a new, mutually-exclusive bundle-mode request shape.
When used, the backend builds exactly one Git commit spanning every eligible environment's vault
file (per FR-004) and opens exactly one pull request for the entire bundle submission —
superseding, for this request shape only, the existing per-environment N-commit/N-PR fan-out
(`secrets-environment-scope` FR-004/NFR-REL-001).

**Priority**: must

**Rationale**: This is the core stakeholder requirement: "Each bundle submission creates exactly
one commit and one pull request containing all applicable available environments." It is a
material, explicit supersession of a previously-shipped contract, not an additive tweak — the
Evidence Table and Classification Matrix both call this out so the Architect does not treat it as
a drop-in extension of `submitSecretViaGitOps()`'s existing single-file Contents-API write.

**Acceptance Criteria**:

- (a) Request body gains `bundleId: string` and
  `environmentSecrets: { environment: string, vaultDir?: string, qualifier?: string,
  secrets: { secretName: string, secretValue: string }[] }[]` (1–10 entries, matching the existing
  `MAX_ENVIRONMENTS` cap) as a third mutually-exclusive alternative to the legacy singular
  `environment` field and the existing `environments: string[]` array — exactly one of the three
  shapes may be present per request; supplying more than one returns HTTP 400 (extends the
  existing `environment`/`environments` XOR check, `routes/api.js` lines 369–382, to a 3-way
  check).
- (a.1) The bundle request accepts 1–20 distinct secret-name rows across the entire submission.
  Each `environmentSecrets[].secrets[]` array contains only the rows populated for that
  environment, has no duplicate names, and has at most 20 entries. The union of secret names
  across all environment arrays must not exceed 20; exceeding either limit returns HTTP 400 before
  encryption or any GitHub write.
- (a.2) The submitted `environmentSecrets[]` must contain exactly one entry for every environment
  that is eligible after the backend's current FR-004 re-resolution; the UI does not offer an
  environment-level opt-out. Omitting a currently eligible environment, or submitting an entry
  with no populated secret rows, returns HTTP 400 (`INCOMPLETE_BUNDLE`) before encryption or any
  GitHub write. An environment that was eligible during pre-flight but becomes not deployed or
  unresolved before submission is handled by (b)'s exclusion behavior instead of this
  completeness rejection.
- (b) `environmentSecrets[].environment` must be a member of the declared bundle. The backend
  re-runs FR-004's resolution rather than trusting a possibly-stale client-side eligibility
  snapshot. A requested environment that is no longer deployed or remains unresolved after its
  supplied `vaultDir`/`qualifier` values are checked is excluded from the commit and returned in
  `excludedEnvironments[]`; it is not treated as a bundle-membership violation. A requested
  environment outside the declared bundle is rejected with HTTP 400 before any GitHub write.
- (c) The backend encrypts every secret for every included environment in memory first (reusing
  the unmodified per-secret SOPS encryption), aborting with **zero GitHub writes** on the first
  encryption failure — mirroring the existing single-environment "encrypt everything first, write
  nothing on failure" precedent (`services/secretsService.js` FR-003(j) equivalent, lines
  789–804), now extended across environments as well as secrets.
- (d) After successful encryption, the backend creates exactly one branch, builds one Git commit
  containing the updated `secrets.enc.yaml` content for every included environment's selected
  vault (one file per included environment; distinct environments may resolve to different vault
  paths), and opens exactly one pull request referencing that single
  commit. **Implementation note for the Architect**: this cannot be built from repeated
  `githubService.createOrUpdateFile()` (Contents API, one file per call) without producing
  multiple commits; it requires a multi-file, single-commit mechanism (e.g., the Git Data API's
  create-tree/create-commit/update-ref sequence) — flagged explicitly so this is not
  underestimated as a drop-in loop extension (see §10 Risks, OQ-005).
- (e) The commit message and PR title/body name every included environment and every secret name
  (never a value) — e.g., PR title `Secrets bundle update: {bundleId} ({appName}) — N secrets ×
  M environments`; PR body lists each included environment, its vault, and the secret names
  changed for it.
- (f) If the PR-creation step itself fails after a successful commit, the response reports the
  failure with the commit's branch name so a human can inspect/retry — this is the only point
  where a partial artifact (commit without PR) can exist, and it is surfaced explicitly, never
  silently retried automatically.
- (g) Idempotency: a duplicate bundle submission with the same `target`, `appName`, `bundleId`,
  canonical included-environment set, per-environment `vaultDir`/`qualifier` selections, and
  per-environment secret-name set, with an already-open PR from an unmerged prior submission,
  returns HTTP 409 with the existing open PR's URL. The deterministic branch name includes
  `{appName}-{bundleId}-{bundleContentHash}` where `bundleContentHash` is the first 8 hex
  characters of SHA-256 over a canonical, sorted representation of those non-secret-value inputs.
  Secret values are never included in the branch name or hash. A distinct secret-name set or
  included-environment set therefore creates a distinct branch/PR even when an unrelated PR for
  the same app and bundle remains open. This extends the existing `PR_EXISTS` and `bulkBranchHash`
  precedents (`services/secretsService.js` lines 572–580 and 775–781).
- (h) Response shape:
  ```json
  {
    "success": true,
    "correlationId": "...",
    "bundleId": "release",
    "prNumber": 145,
    "prUrl": "https://...",
    "includedEnvironments": ["prod", "cint", "hot"],
    "excludedEnvironments": [{ "environment": "demo", "reason": "VAULT_AMBIGUOUS" }],
    "secretCount": 3
  }
  ```
  On total failure (e.g., zero eligible environments, or the pre-flight/encryption abort in (c)),
  no commit or PR is created and the response uses the existing single-environment error-code-to-
  HTTP-status mapping (`FOUND_FALSE`→422, `VAULT_AMBIGUOUS`→422, `CONFLICT`→503,
  `ENCRYPTION_FAILED`→400, `SOPS_NOT_CONFIGURED`→503, etc.) unchanged. A successful response
  contains at least one included environment; excluded environments are informational and do not
  create a partial-commit state.

**Dependencies**: FR-001, FR-002, FR-003, FR-004, unchanged per-secret SOPS encryption.

---

### FR-006 — Per-Environment Distinct Secret Values Within One Bundle Submission

**Description**: Within a single bundle submission, the developer can enter and edit a different
value for the same secret key in each included environment, rather than one shared value applied
to every environment.

**Priority**: must

**Rationale**: Directly implements "Users can provide and edit a different secret value for the
same secret key in each environment," which the current shared `secretEntries` model
(`SecretsPage.vue` line 82) and shared `secrets[]` fan-out payload cannot express today.

**Acceptance Criteria**:

- (a) The bundle-submission form presents secret entry as a grid: rows are secret names (shared
  across the bundle, so the same key can be added once and populated per environment), columns
  are the eligible environments (per FR-004) in the selected bundle; each cell holds an
  independently editable value + confirmation input.
- (b) A secret name is still validated once (format, no duplicates within the bundle submission,
  mirroring the existing `SECRET_NAME_RE`/duplicate-detection convention), but its value is
  tracked per `{secretName, environment}` pair, not per `secretName` alone.
- (c) A cell may be left blank only if that secret name is not intended for that specific
  environment — an included environment with at least one populated cell must have every
  populated secret name's value+confirmation match before submit is enabled (reuses the existing
  value/confirmation-match validation per cell, not once globally).
- (d) The request body's `environmentSecrets[].secrets[]` (FR-005(a)) reflects exactly the
  per-environment, per-secret-name values the developer entered — no value is ever silently
  copied from one environment's cell to another's.
- (e) `secretValue` is never logged, echoed in a validation error, or included in the commit
  message/PR body for any cell, matching the existing invariant (FR-008).

**Dependencies**: FR-004 (eligible environment set), FR-005 (request contract).

---

### FR-007 — Release-Bundle Flag & PR-Level Approval Signal

**Description**: A bundle submission for a bundle configured with `releaseControlled: true` (the
`release` bundle today) carries a machine-readable marker through the PR body and the structured
audit log, so that the target repository's external PR-review/CODEOWNERS controls (owned by
Platform/DevSecOps, outside this codebase) can act on it. This PRD does not itself grant, check,
or bypass reviewer approval — it makes the submission's release status discoverable to whatever
external control exists.

**Priority**: must

**Rationale**: Directly implements "Release-bundle approval/release controls are enforced at PR
review level." The Evidence Table (§4) shows the actual external CODEOWNERS/branch-protection
state is unverified and unreachable from this workspace — this FR ships the entirety of what is
achievable and testable from inside this repository; the external control itself is tracked as
OQ-001, not silently assumed to already exist.

**Acceptance Criteria**:

- (a) When `bundleId` resolves to a bundle with `releaseControlled: true`, the generated PR title
  is prefixed (e.g., `[RELEASE]`) and the PR body includes an explicit
  `**Release-controlled**: yes` line plus the list of included release-tier environments —
  extending the existing PR-body field list (Target/App/Environment(s)/Qualifier/Vault(s)/Jira/
  Secrets/Submitted-by/Correlation-ID) with this one additive field.
- (b) `logMetric('secret_create_submitted', ...)` gains a `releaseControlled: boolean` field and,
  when `true`, the list of included release-tier environment names — extending the existing
  `confirmedProductionWrite`/`productionEnvironments` audit-log pattern
  (`secrets-environment-scope` NFR-SEC-002) to the bundle model.
- (c) The `releaseControlled` value is always server-derived from `data/secretBundles.json` for
  the resolved `bundleId` — never accepted as a client-supplied boolean in the request body.
- (d) This FR does not implement, configure, or verify branch protection/CODEOWNERS rules in
  `infrastructure-live`/`service-catalog` — that is explicitly out of scope (Non-Goals) and
  tracked separately (OQ-001). Absence of an external enforcing control is a deployment/rollout
  gate, not a defect in this FR's own acceptance criteria.
- (e) This mechanism generalizes to any future bundle marked `releaseControlled: true` — it is not
  hardcoded to the `release` bundle's `id` string. For bundle-mode requests, the configured
  `releaseControlled` value is the authoritative release-control classification: `stage` in the
  developer bundle does not receive the release marker or bundle-mode release confirmation even
  though the legacy tier-based path may still classify it as production. Legacy singular/array
  requests retain their existing tier-based behavior until the legacy UI is retired or migrated
  under OQ-003.

**Dependencies**: FR-001 (`releaseControlled` config field), FR-005 (PR body/commit path).

---

### FR-008 — No Secret Value Leakage in Bundle Commit/PR Artifacts, Logs, or Errors

**Description**: The existing zero-plaintext-secret-value invariant, already proven for the
single-environment and per-environment-fan-out code paths, is explicitly re-verified (not
redesigned) across every new surface this feature introduces: the multi-file atomic commit, the
multi-environment PR body, the eligibility/exclusion report, and the bundle audit-log fields.

**Priority**: must

**Rationale**: "Secret values must never appear in logs, API errors, PR descriptions, or
generated artifacts" is an explicit, standalone stakeholder requirement, and per this agent's own
recorded lessons, secret-handling features always need a dedicated no-log/no-leak requirement,
not just an incidental mention inside another FR.

**Acceptance Criteria**:

- (a) The multi-file commit message and PR body (FR-005(e)) list only secret **names** per
  environment, never values — verified by the same automated CI grep check already in place for
  the existing single/fan-out paths (`secret-self-service` NFR-SEC-001 precedent).
- (b) The pre-flight eligibility/exclusion report (FR-004) and its UI rendering never include a
  secret value in any excluded-environment reason string.
- (c) `redactSecretValues()`'s existing recursive redaction (`routes/api.js` lines 340–354) is
  extended to cover the new `environmentSecrets[].secrets[].secretValue` path in any
  express-validator error shape — verified with an actual failing request through the new
  bundle-mode validator chain (not merely a code read), consistent with the lesson recorded from
  `secrets-ui-enhancements` QA-1 (a prior redaction gap that only an executable test, not a code
  review, caught).
- (d) `logMetric('secret_create_submitted', ...)` for a bundle submission never includes a
  `secretValue` field at any nesting level, including within `includedEnvironments`/
  `excludedEnvironments` arrays.
- (e) No CI artifact, test fixture, or snapshot introduced by this feature's own test suite
  contains a real-looking plaintext secret value (test fixtures use obviously-fake placeholder
  values, consistent with existing test conventions).

**Dependencies**: FR-005, FR-006, existing `redactSecretValues()`/CI grep check.

---

### FR-009 — Backward Compatibility for Legacy Single/Multi-Environment Callers

**Description**: The existing legacy singular `environment: string` shape (`secret-self-service`)
and the existing `environments: string[]` fan-out shape (`secrets-environment-scope`) continue to
work exactly as today, entirely unaffected by the new bundle-mode shape and by bundle-membership
enforcement.

**Priority**: must

**Rationale**: `POST /api/secrets` is live in production for two prior features; this PRD must
not break either, mirroring the exact backward-compatibility precedent both prior PRDs already
established for each other.

**Acceptance Criteria**:

- (a) A request supplying `environment` (singular) or `environments` (array) is processed exactly
  as it is today — no bundle-membership check (FR-003) applies to either shape.
- (b) A request may not mix `bundleId`/`environmentSecrets` with `environment` or `environments`
  in the same call (extends the existing pairwise XOR to a 3-way exclusive check, FR-005(a)).
- (c) All existing integration tests for the legacy singular and array shapes
  (`tests/integration/service/secretsRouteValidation.spec.ts`,
  `tests/integration/service/secretsFanOutRoute.spec.ts`) continue to pass unmodified.
- (d) `data/environmentTiers.json`-based tier grouping/production-write confirmation
  (`secrets-environment-scope` FR-001/FR-007) remains available for any UI path that still uses
  the legacy `environments[]` shape, unaffected by the new `data/secretBundles.json` file's
  existence.

**Dependencies**: None (preservation of existing, shipped behavior).

---

## 7. Non-Functional Requirements (NFR)

### NFR-PERF-001 — Bundle Resolution and Atomic Commit Latency (Performance)

**Description**: A bundle submission covering the maximum supported request size (10 environments)
× 20 distinct secret names must complete within a bounded latency budget, covering both the
pre-flight per-environment resolution phase (FR-004) and the single-commit build phase (FR-005).

**Measurable Target**: p95 latency ≤ 20000 ms for a 10-environment × 20-distinct-secret-name
bundle submission, end to end (up to 200 encrypt operations). The pre-flight resolution phase
(FR-004) must execute concurrently across
environments (not serially), reusing the existing concurrency requirement precedent
(`secrets-environment-scope` NFR-PERF-001); the single-commit build phase (FR-005(d)) is
inherently sequential (one Git Data API tree/commit sequence) and is budgeted separately within
the same 20000 ms target. `latency_ms` (total), `resolution_latency_ms`, and `commit_latency_ms`
are emitted via `logMetric` for SLO tracking. If a feasibility spike finds the 10×20 case exceeds
this budget, that is an escalation back to Product (e.g., lowering the max secrets-per-bundle
cap), not a silent relaxation of this target.

---

### NFR-REL-001 — Bundle-Submission Atomicity (Reliability/Availability)

**Description**: A bundle submission is all-or-nothing: either the single commit/PR is created
covering every eligible environment, or zero GitHub writes occur. This explicitly **supersedes**
`secrets-environment-scope` NFR-REL-001's per-environment-independence contract for the new
bundle-mode request shape only (that NFR remains true, unchanged, for the legacy `environments[]`
fan-out shape per FR-009).

**Measurable Target**: 0 observed instances, across QA failure-injection test scenarios (encryption
failure, SHA-conflict, PR-creation failure), of a bundle submission leaving a partial commit
without a PR, or a PR referencing fewer environments than were successfully encrypted — except
the single documented exception in FR-005(f) (PR-creation failure after a successful commit),
which must be surfaced explicitly, not silently swallowed, in 100% of that scenario's QA test
cases.

---

### NFR-REL-002 — Bundle Submission Idempotency (Reliability/Availability)

**Description**: A duplicate bundle submission with the same canonical non-secret-value inputs
defined in FR-005(g), with the prior PR still open, must not create a second
commit/branch/PR; a materially different secret-name or included-environment set is not a
duplicate.

**Measurable Target**: 100% of QA duplicate-submission test cases return HTTP 409 with the
existing open PR's URL, and 0 additional GitHub writes occur for the duplicate attempt.

---

### NFR-SEC-001 — No Plaintext Secret Values in Bundle Artifacts (Security/Compliance)

**Description**: Extends the existing no-plaintext-value invariant to every new bundle-mode
surface (see FR-008 for the full acceptance-criteria breakdown).

**Measurable Target**: 0 occurrences of any `secretValue` in logs, commit messages, PR
descriptions, eligibility/exclusion reports, or API responses across the bundle-mode code path,
enforced by the existing CI grep check extended to cover the new code paths.

---

### NFR-SEC-002 — Server-Derived Bundle Membership and Release-Control Status (Security/Compliance)

**Description**: Bundle membership (FR-003) and release-control status (FR-007) are always
computed server-side from `data/secretBundles.json`; the backend never trusts a client-supplied
claim for either value.

**Measurable Target**: 100% of bundle-mode `POST /api/secrets` requests re-derive both values
server-side, verified by an integration test that submits a request with a spoofed/mismatched
client-side claim and confirms the server-derived value (not the client's) governs the outcome
and the audit-log entry.

---

### NFR-SCALE-001 — Bounded GitHub API Call Volume Per Bundle Submission (Scalability)

**Description**: A bundle submission's GitHub API call volume (tree/blob/commit creation, PR
create, pre-flight resolution reads) scales linearly with the number of eligible environments in
the bundle, bounded by the 10-environment request cap in FR-005(a).

**Measurable Target**: A 10-environment bundle submission issues no more GitHub API calls than a
fixed per-environment resolution cost plus one constant-cost commit/PR sequence (i.e., no N²
growth from the single-commit mechanism replacing N independent single-file commits).

---

### NFR-OBS-001 — Correlation ID and Bundle-Scoped Result Threading (Observability)

**Description**: The single `correlationId` for a bundle submission threads through every
per-environment pre-flight resolution step and the final commit/PR creation; every log line and
the final response body carry the same `correlationId`, `bundleId`, `includedEnvironments`, and
`excludedEnvironments`.

**Measurable Target**: 100% of log lines emitted during a bundle submission (pre-flight
resolution through commit/PR creation) carry the request's single `correlationId` and `bundleId`.

---

### NFR-USA-001 — Bundle and Per-Environment Grid Keyboard Accessibility (Usability/Accessibility)

**Description**: The bundle selector and the per-environment secret-value grid (FR-006(a)) are
fully operable via keyboard alone, consistent with the existing accessibility bar this page
already meets (`secrets-ui-enhancements` NFR-UX-001, `secrets-environment-scope` NFR-USA-001).

**Measurable Target**: Every bundle option, environment column, and grid cell (value +
confirmation) is reachable and editable via Tab/Shift+Tab/Space/Enter alone, with no mouse
interaction required, verified by manual QA plus an automated axe-core (or equivalent) scan
reporting 0 critical/serious violations on the bundle-submission form.

---

## 8. API and Data Impact

### New Data File

- **`data/secretBundles.json`** (new): the bundle configuration described in FR-001 — array of
  `{ id, displayName, order, releaseControlled, environments[] }` objects. Hand-maintained by
  Platform Engineering, versioned and approved via this repository's existing PR/CODEOWNERS
  process (no new governance mechanism).

### Modified Endpoints

| Endpoint | Change | Breaking? |
|---|---|---|
| `GET /api/secrets/apps?target=live\|sand` | Each `{name, environment, qualifier?}` entry gains a `bundleId: string \| null` field (additive) | No — additive field only; existing `tier` field (from `secrets-environment-scope`) is unaffected and continues to be returned |
| `POST /api/secrets` | Accepts a new, mutually-exclusive `bundleId` + `environmentSecrets: { environment, vaultDir?, qualifier?, secrets[] }[]` shape (one entry for every currently eligible environment, capped at 10) alongside the existing legacy `environment` and `environments[]` shapes; response gains `bundleId`, `includedEnvironments[]`, `excludedEnvironments[]` (additive) | No — both legacy shapes and their existing top-level response fields remain fully supported per FR-009 |

### No New Endpoints

Both required capabilities (bundle-scoped visibility, atomic bundle submission) are additive
extensions of the two existing Secrets endpoints — consistent with the precedent already set by
`secrets-environment-scope`, which also introduced no new endpoints.

### Data Model Changes

- `GET /api/secrets/apps` response entries gain `bundleId` (new, additive).
- `POST /api/secrets` request body gains `bundleId` + `environmentSecrets[]` with optional
  per-environment `vaultDir`/`qualifier` selections (new, mutually exclusive with the two legacy
  shapes).
- `POST /api/secrets` response body gains `bundleId`, `includedEnvironments[]`,
  `excludedEnvironments[]` (new, additive).
- New file `data/secretBundles.json` (bundle configuration, FR-001).
- `data/environmentTiers.json` is unchanged and not deprecated by this PRD (FR-001(h)); it remains
  available for the legacy `environments[]`/tier-grouping UI path (FR-009(d)).
- No changes to `data/environments.json`'s schema or scope (portal feature-flag concept, unrelated
  — see Evidence Table).
- No changes to `docs/metadata/*.json` schema.
- No changes to the `secrets.enc.yaml` file format or per-vault location convention — each
  included environment's vault file is still written using the existing SOPS-encrypted YAML
  shape; only the Git commit-aggregation mechanism changes (FR-005).

### Backward Compatibility

Fully backward-compatible per FR-009: existing scripts/tests sending the legacy singular
`environment` field or the existing `environments[]` array, and reading the existing top-level
response fields, require no changes.

---

## 9. UX and Workflow Impact

### User Journey Summary

1. Developer selects an application and a `target` (`live`/`sand`), as today.
2. The Secrets page shows bundle groups (ordered per `data/secretBundles.json`'s `order` field) —
   e.g., "Independent Environments," "Developer Bundle," "Release Bundle" — each showing only the
   environments in it that are both configured and actually deployed for the selected app
   (FR-002). A bundle with no available environment for this app is omitted entirely, with no
   empty state, placeholder, or warning, per the stakeholder-confirmed silent-omission rule.
3. Developer picks exactly one bundle. The page shows the bundle's eligible environments (FR-004)
   as columns and lets the developer add secret name rows and enter/edit a value + confirmation
   per environment cell (FR-006).
4. If any bundle member is excluded (ambiguous vault/qualifier), it is shown disabled with a
   reason, same as today's per-environment exclusion UX (FR-004(c)).
5. If the selected bundle is `releaseControlled: true`, the submit flow shows a visible
   "Release Bundle" indicator (extending the existing production-write confirmation modal pattern
   from `secrets-environment-scope` FR-007) before the request fires.
6. On submit, the page shows a single status result: one PR link (or a single failure message),
   listing which environments were included (FR-005(h)) — not a per-environment results list, since
   there is now exactly one outcome per submission, not N.
7. A duplicate submission attempt (already-open PR for the same app+bundle) shows the existing PR
   link instead of creating a second one (FR-005(g)).

### Status and Error Handling Expectations

| Scenario | Expectation |
|---|---|
| Bundle member environment not deployed for the app | Silently absent from the UI and API response — no error, no placeholder (FR-002(c)) |
| Bundle member environment deployed but vault-ambiguous | Shown disabled with a reason in the bundle column list (FR-004(c)) — not silently hidden |
| Zero eligible environments in the selected bundle | Submit disabled with a clear message; no empty-bundle request is possible (FR-004(f)) |
| Eligible environment omitted from a direct/API bundle request or given no secret rows | HTTP 400 `INCOMPLETE_BUNDLE`; no encryption or GitHub write (FR-005(a.2)) |
| Encryption failure for any one environment's secret | Entire submission aborts with zero GitHub writes; developer sees which secret/environment failed (FR-005(c)) |
| Duplicate bundle submission (PR already open) | HTTP 409, existing PR link shown (FR-005(g)) |
| Commit succeeds but PR creation fails | Explicit failure surfaced with the branch name for manual follow-up (FR-005(f)) — never silently retried |
| `bundleId` unknown or environment not a bundle member | HTTP 400, naming the specific invalid `bundleId`/environment (FR-003) |

---

## 10. Risks, Assumptions, Open Questions

### Known Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Building one atomic multi-environment commit is materially more complex than looping the existing single-file Contents-API write; underestimating this could blow the Phase 2 timeline | Architect explicitly spikes the Git Data API tree/commit/ref-update sequence early (OQ-005) rather than assuming it is a drop-in extension of `createOrUpdateFile()` |
| Reclassifying `stage` (currently "production" tier), `cint`/`hot`/`demo` (currently "nonProduction" tier) creates different treatment in bundle-mode versus legacy requests while both paths coexist | Treat `data/secretBundles.json` as authoritative for bundle-mode release control per FR-007(e), retain legacy tier behavior under FR-009(d), and coordinate the eventual legacy-UI cutover under OQ-003; document the reclassification in the release CHANGELOG. `data/environmentTiers.json` itself remains unchanged for legacy consumers. |
| The actual external PR-review/CODEOWNERS enforcement for release-bundle paths in `infrastructure-live`/`service-catalog` is unverified and unreachable from this workspace | Tracked as OQ-001 (owner: Platform/DevSecOps); FR-007 ships the in-repo signal regardless, but production go-live for the `release` bundle should be gated on OQ-001's resolution |
| Silent omission (FR-002(c)) of a misconfigured bundle member (e.g., a typo'd environment name in `data/secretBundles.json` that never matches any real folder) could mask a config error indefinitely, since the user-facing behavior is identical to "correctly not deployed" | Add an internal (Platform-Engineering-facing, not developer-facing) diagnostic log line when a configured bundle member never matches any discovered environment across a full tree scan, so config typos are still detectable without violating the user-facing "silently omitted" requirement |

### Explicit Assumptions

- `data/secretBundles.json` lives in this repository (`self-service-infra`) and is governed by
  the existing CODEOWNERS-gated PR process already in effect here (`* @Aya-DevOpsTeam/team-devops-write`),
  identical to `data/environmentTiers.json`/`data/environments.json`/`data/modules.json`/
  `data/roles.json`.
- The GitHub App installation already used for `secret-self-service`/`secrets-environment-scope`
  (confirmed PR-create access on both `infrastructure-live` and `service-catalog`) is assumed
  sufficient for the Git Data API calls FR-005(d) requires (tree/blob/commit creation); the exact
  scopes should be verified by the Architect (OQ-005), not assumed identical to Contents-API scopes.
- "Release-bundle approval/release controls are enforced at PR review level" is interpreted as:
  this platform's job is to always route the submission through a real PR (already true today)
  and make its release status machine-discoverable (FR-007); actually requiring specific
  reviewers before merge is an external, repo-administration action this PRD does not perform or
  verify (OQ-001).

### Open Questions

#### OQ-001 — External PR-Review/CODEOWNERS Enforcement for Release-Bundle Paths

**Question**: Does `infrastructure-live`/`service-catalog` currently have branch protection and/or
a CODEOWNERS entry requiring human review before merge for `keyvault*/secrets.enc.yaml` paths
under release-bundle environments (`prod`, `cint`, `hot`, `demo`, `dr`)? If not, who configures it,
and which reviewer group should be required?

**Status**: Open, **owner: Platform/DevSecOps**. Not blocking for Phase 1/2 engineering (FR-007
ships the in-repo signal regardless), but **blocking for production go-live of the `release`
bundle** — without this, FR-007's marker has no external control acting on it. This is the same
gap `secret-self-service` flagged (lines 908–913) and left unresolved; this PRD does not assume it
has since been resolved, since `infrastructure-live` returned `404 Not Found` to this workspace's
GitHub App during evidence-gathering.

#### OQ-002 — UI Reachability for Non-Bundle-Member Environments

**Question**: Environments discovered for an app that are not members of any configured bundle
(e.g., a legacy folder name like `nonprod`, `hub`, or `shared-services`) are never shown in this
feature's bundle-based UI (FR-002(b)). Should they remain reachable through some other UI path, or
API-only via the legacy singular/array shapes (FR-009)?

**Status**: Open, **owner: Product/Platform Engineering**. Default assumption for this release:
API-only via the legacy shapes; no new UI path is built for non-bundle environments.

#### OQ-003 — Retire the Free Multi-Select / Tier UI Once Bundles Ship?

**Question**: Should `secrets-environment-scope`'s free-form tier-based multi-select UI (FR-002 of
that PRD) be removed from the Secrets page once bundles ship, or kept as a secondary/fallback path
(e.g., for non-bundle environments per OQ-002, or for a transition period)?

**Status**: Open, **owner: Product/Platform Engineering**. Not blocking Phase 1/2 (this PRD's
bundle UI can ship alongside the existing tier UI); should be resolved before Phase 3 to avoid
shipping two parallel multi-environment submission UX patterns indefinitely.

#### OQ-004 — Maximum Secrets Per Bundle Submission at Maximum Bundle Size (Resolved)

**Question**: The existing single-environment/fan-out cap is 20 secrets; the largest bundle today
(`release`) has 5 environments. Does the existing 20-secret cap apply per environment (worst case
100 encrypt operations in one atomic commit) or per submission (20 secrets total, distributed
across environments)? This directly affects whether NFR-PERF-001's 20000 ms target is achievable.

**Status**: Resolved for this PRD. The existing 20-secret cap applies per bundle submission: the
union of all distinct secret names across all environments in the grid (FR-006(a)) is capped at
20, and each per-environment array is capped at 20 as an input-validation safeguard. This bounds
the largest current release bundle to 20 × 5 = 100 encrypt operations, consistent in order of
magnitude with the existing 10-environment × 20-secret = 200 operation ceiling accepted for the
fan-out model. FR-005(a.1) is the enforcing contract and NFR-PERF-001 is measured against it.

#### OQ-005 — Git Mechanism for the Single Multi-Environment Commit

**Question**: Should the atomic multi-file commit (FR-005(d)) use the GitHub Git Data API's
create-tree/create-commit/update-ref sequence (recommended — a single true commit spanning
multiple files), or some other mechanism? Does the existing GitHub App installation have the
necessary scopes for these lower-level Git Data API calls (as opposed to the higher-level Contents
API `services/githubService.js` currently wraps)?

**Status**: Open, **owner: Architect**. This is the single highest-risk unknown in this PRD's
scope — flagged explicitly (see Risks) so it is spiked early in Phase 2, not discovered mid-
implementation.

---

## 11. Delivery Plan

### Milestones / Phases

**Phase 1 — Bundle Configuration and Read-Side Visibility**
- FR-001: `data/secretBundles.json` schema + seed data
- FR-002: bundle-scoped, existence-filtered environment visibility (UI + `GET /api/secrets/apps`)
- FR-004 (read-side): pre-flight eligibility resolution and exclusion reporting

Gate: None blocking — purely additive read-side changes, no GitOps mutation path touched.

**Phase 2 — Atomic Bundle Submission**
- FR-003: backend bundle-membership enforcement
- FR-005: atomic single-commit/single-PR bundle submission (spike OQ-005 first)
- FR-006: per-environment distinct secret values
- FR-008: no-leakage verification across the new code path
- FR-009: backward-compatibility regression pass

Gate: OQ-005 (Git mechanism/scopes) must be resolved before FR-005 implementation begins; a
feasibility spike confirming NFR-PERF-001's target is achievable is a Definition-of-Done item for
this phase, not a pre-condition to start it.

**Phase 3 — Release-Bundle Signal and Rollout**
- FR-007: release-bundle flag + PR-review signal

Gate: FR-007's in-repo signal can ship regardless of OQ-001, but the `release` bundle should not
be enabled for real developer use (i.e., not rolled out beyond `devsand`/`sand`-mapped testing)
until OQ-001 is resolved by Platform/DevSecOps.

### Definition of Done

- All `must`-priority FRs (FR-001 through FR-009) implemented and passing their acceptance criteria.
- FR-001's seed bundle data (`independent`/`developer`/`release`, exact membership per FR-001(f))
  is present before merge.
- NFR-PERF-001's 20000 ms p95 target is verified via a load test at the Phase 2 gate, not deferred.
- 0 plaintext `secretValue` occurrences confirmed via the extended CI grep check (FR-008).
- OQ-001 (external PR-review enforcement) is confirmed or explicitly waived by Platform/DevSecOps
  before the `release` bundle is enabled outside of test environments.

### Rollout and Rollback

- **Rollout**: Ship Phase 1/2 behind the existing `secrets` feature flag in
  `data/environments.json` (unchanged mechanism); enable the bundle UI first for `devsand`,
  validate, then `sand`, consistent with the existing `secret-self-service` rollout precedent.
  Enable the `release` bundle for real use only after OQ-001 is resolved.
- **Rollback**: Because `data/secretBundles.json` is additive config, reverting is a config or
  code revert with no data migration — no bundle-mode PRs are auto-merged, so an in-flight bundle
  PR simply remains open/unmerged if the feature is rolled back mid-flight. Setting
  `"secrets": false` in `data/environments.json` remains the full page-level kill switch,
  unchanged from today.

---

## 12. Test and Validation Strategy

### Coverage Areas

| Area | Test Type | Required Coverage |
|---|---|---|
| `data/secretBundles.json` loader | Unit test | Valid config loads; duplicate `id` rejected; environment in two bundles rejected; invalid reload retains the last-known-good config; cold-start invalid config disables bundle-aware reads and returns 503 for bundle submissions while legacy shapes remain available; case-insensitive membership matching; moving `cint` between bundles in a fixture requires no code change (FR-001(g)) |
| `GET /api/secrets/apps` `bundleId` field | Integration test | Correct `bundleId` per environment; `null` for non-bundle-member environments; existing `tier` field unaffected |
| Bundle-scoped visibility (FR-002) | Component test (`SecretsPage.vue`) | Non-deployed bundle member never rendered; non-bundle-member environment never rendered; bundle with zero available environments omitted entirely with no placeholder or reason |
| Pre-flight eligibility (FR-004) | Integration test | Eligible/excluded computation matches `VAULT_AMBIGUOUS`/`QUALIFIER_AMBIGUOUS`/not-deployed cases; per-environment `vaultDir`/`qualifier` disambiguation makes a previously ambiguous environment eligible; zero-eligible-environment case disables submit |
| Backend bundle-membership enforcement (FR-003) | Integration test | Unknown `bundleId` → 400; environment outside declared bundle → 400 naming the environment; spoofed client claim never governs outcome (NFR-SEC-002) |
| Atomic single-commit/single-PR submission (FR-005) | Integration test (mock GitHub Git Data API) | Exactly 1 commit + 1 PR for a multi-environment bundle; incomplete eligible-environment payload → `INCOMPLETE_BUNDLE` with zero writes; per-environment vaultDir/qualifier disambiguation; zero writes on encryption failure; explicit surfaced failure on commit-succeeds/PR-fails; 409 only for an identical canonical submission; distinct secret-name/environment sets succeed while an unrelated PR is open |
| Per-environment distinct values (FR-006) | Component + integration test | Two environments' values for the same secret name never cross-contaminate; per-cell validation (value/confirmation match) enforced independently |
| Release-bundle signal (FR-007) | Integration test | `releaseControlled: true` bundle's PR body/audit log carry the marker; non-release bundle never does; marker always server-derived, never client-supplied |
| No secret value leakage (FR-008) | Automated CI grep + executable failing-request test | 0 `secretValue` occurrences in logs, PR body, commit message, or a real failing request through the new bundle-mode validator chain (not just a code read — mirrors the `secrets-ui-enhancements` QA-1 lesson) |
| Backward compatibility (FR-009) | Regression test suite | All existing legacy singular/array-shape integration tests pass unmodified |
| NFR-PERF-001 | Load test | p95 ≤ 20000 ms for a 10-environment × 20-distinct-secret-name bundle submission (up to 200 encrypt operations) |
| NFR-REL-001/002 | Failure-injection integration test | 0 partial-commit-without-PR states except the documented FR-005(f) exception; 0 duplicate PRs on resubmission |
| NFR-USA-001 | Manual QA + automated accessibility scan | 0 critical/serious axe-core violations on the bundle-submission form; full keyboard operability |

### NFR Validation

- **NFR-PERF-001**: p95 latency measured in a CI load test simulating a 10-environment ×
  20-distinct-secret-name bundle submission against a mocked GitHub API.
- **NFR-SEC-001/NFR-SEC-002**: automated CI grep check (existing mechanism, extended file
  coverage) plus a dedicated integration test asserting server-derived (not client-supplied)
  bundle membership/release-control status governs every outcome.
- **NFR-SCALE-001**: unit test on the pre-flight resolution phase with a mock GitHub API call
  counter, confirming linear (not quadratic) growth with bundle size.
- **NFR-OBS-001**: log-line assertion test confirming `correlationId`/`bundleId` presence across
  every phase of a bundle submission.

---

## 13. Summary Table

| Category | Count |
|---|---|
| Total Functional Requirements (FR) | 9 |
| Total Non-Functional Requirements (NFR) | 8 |
| Must-have FR | 9 (FR-001 through FR-009) |
| Classification: new-feature | 1 (atomic single-commit/PR Git Data API mechanism) |
| Classification: existing-extend | 6 (bundle config; bundle-scoped visibility; backend membership enforcement; pre-flight eligibility; per-environment values; release-bundle signal) |
| Classification: existing-refine | 2 (no secret-value leakage; backward compatibility) |
| Classification: unknown-needs-discovery | 1 (external PR-review/CODEOWNERS enforcement in target repos — not mapped to an FR; tracked as OQ-001) |
| Open Questions (blocking production go-live of `release` bundle) | 1 (OQ-001) |
| Open Questions (non-blocking, informing design/scope) | 3 (OQ-002, OQ-003, OQ-005) |

---

## 14. Next Decisions Needed

1. **Platform/DevSecOps**: Resolve OQ-001 — confirm or configure branch protection/CODEOWNERS in
   `infrastructure-live`/`service-catalog` for release-bundle paths before the `release` bundle is
   enabled for real developer use.
2. **Product/Platform Engineering**: Resolve OQ-002 (non-bundle-member environment UI reachability)
   and OQ-003 (whether to retire the existing free multi-select/tier UI) — both non-blocking for
   Phase 1/2 but should be settled before Phase 3.
3. **Engineering/Architect**: Resolve OQ-005 (Git Data API mechanism and GitHub App scope
   confirmation) before Phase 2 implementation begins — it should be spiked first, since FR-005 is
   the highest-complexity, highest-risk requirement in this PRD.
4. **Architect (next action)**: Author `docs/architecture/secrets-environment-bundles-spec.json`/
   `.md`, resolving the atomic-commit mechanism (OQ-005) as a concrete design decision, not left
   for the Vue.js Developer/QA Engineer to improvise during implementation.

<!-- ORCHESTRATOR-READY
feature: secrets-environment-bundles
prd_path: docs/prd/secrets-environment-bundles.md
status: pending_review
fr_count: 9
nfr_count: 8
-->
