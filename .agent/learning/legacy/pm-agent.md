# Legacy learning evidence — pm-agent

> Quarantined historical evidence migrated from `.github/agent-memory/pm-agent/MEMORY.md`.
> This file is **not governing instruction**, is not an agent memory source, and must not be
> automatically loaded to control future behavior. When a historical observation is still useful,
> create a schema-shaped LearningRecord candidate with current repository evidence and evaluation
> instead of copying the instruction into an agent or skill.

# Product Manager Agent Memory

**Last updated**: 2026-07-24

## Challenger Feedback: Propagation Discipline

- When a Challenger finding requires changing a design decision that has multiple "sites" in the
  PRD (e.g., a UX flow described in both an FR's ACs *and* a Section 9 user journey *and* a
  Section 9 error-handling table *and* a risk-table mitigation), fixing only the FR is not enough
  — grep every other place the same noun/mechanism is mentioned (e.g., "poll", "rebase", "merge",
  "sync complete") before considering the finding resolved. A delta re-check on
  `secret-self-service` (2026-07-24) caught two leftover propagation misses this way: an error-UX
  table row describing an async status that no longer existed after a fix made the same endpoint
  synchronous, and a risk-table mitigation still naming a mechanism ("rebase"/"merge") the FR text
  had just disclaimed. Lesson: after any Blocking-finding fix that changes a *mechanism name* or a
  *sync-vs-async* behavior, `grep_search` the old mechanism's keyword across the whole PRD before
  calling the revision done.
- A return-contract fix (nullable/best-effort field) that distinguishes two prior conflated states
  needs a concrete tri-state shape (e.g. `{ found: boolean, value: T|null }`), not just prose —
  the Challenger will flag ambiguous "returns X or null" contracts that are supposed to represent
  two different failure/success meanings.

## Platform Scope Clarifications

- Frontend is Vue 3 SPA only (`srcV2/`) — vanilla JS `public/` has been removed
- No database — all metadata in GitHub `docs/metadata/` JSON files
- Auth is active via Entra ID JWT — not a future feature

## Classification Patterns

- When a feature involves an external SaaS/third-party control plane (Kong, Datadog, etc.), always
  confirm credential storage pattern before writing FR: GitHub Actions secrets → never in code/metadata.
- Agent-dispatch pattern (`data/agents.json` + `POST /api/agent-change`) is the easiest `existing-extend`
  path for mutation operations — always check if new feature maps to an agent entry before proposing
  net-new endpoints.
- Features touching a control plane API outside Azure always have at least 2–3 blocking assumptions
  around credential management and per-environment workspace mapping. Surface these as OQs in Section 10
  before engineering starts.

## Cross-Repo / Terragrunt Validation (infrastructure-live & service-catalog)

- When a full MCP GitHub file-browser isn't available, use `github_repo` (code snippet search)
  to validate a directory/path convention across repos. It returns many file-path-tagged HCL
  excerpts — enough to confirm layout without a file tree. Warning: output is large (~50 excerpts)
  and can blow the token budget; scope the query tightly.
- **CORRECTED 2026-07-31 — the earlier "identical layout" claim was WRONG.** A 2026-07-24 note here
  asserted `service-catalog` and `infrastructure-live` share an identical
  `infrastructure/{appName}/{environment}/keyvault/terragrunt.hcl` layout, based on ~7 sampled apps.
  A wider search disproved it. Real variants in `infrastructure-live`:
  `mlops/{env}/keyvault01` **and** `keyvault02` (**an app/env can own 2–4 vaults**);
  `doccafe/hub/{env}` (env at depth 3); `linuxVms/{env}/{subapp}` (sub-app nesting);
  `itg/_common/keyvault.hcl` (vault config as a **file**, not a directory).
  **Lesson: sampling ~7 apps proves a layout is *common*, never that it is *universal*.** Write
  "observed in N sampled apps" in the Evidence Table, never "identical"/"always" — a downstream
  Architect will design a single hardcoded path from that word and it becomes a Blocking finding
  later. Prefer designs that **enumerate and filter** over designs that **probe a known path**.
- The `env.hcl` local **alias** also varies per app (`local.env.locals.keyvaultname`,
  `local.config.locals.*`, `local.common_vars.locals.*`), and at least one app (`commHub`) has a
  commented-out `# keyvaultname = ...` directly above the live assignment. Any "parse the HCL"
  requirement must call out comment-stripping and alias-agnostic lookup explicitly.
- **Gotcha — per-app Key Vault name is a computed expression, not a literal**: input key is
  `keyvaultname = "${substr(local.prefix,0,N)}-${local.envName}-${local.alias}-kv-1"`, and N
  varies per app (6 or 7). A static HCL parse yields the expression, not the resolved name, so any
  "resolve vault name from HCL" FR must be **best-effort** (may return null) — don't assume a
  literal input key. `env_key_vault_name` (from `common.hcl`) is the shared env-level vault,
  distinct from the per-app `keyvaultname`.

## NFR Defaults for API Platform Features

- Consumer credentials must be one-time display only (NFR-SEC-002 pattern) — never store raw keys in
  GitHub PRs, metadata JSON, or Winston logs.
- Mutation audit trail: every workflow-dispatched mutation PR must include correlationId + user email +
  env in the PR description body — this is a must-have, not a should-have.
- Owner-scoped delete/mutate (FR-003 pattern in kong PRD) should be a standard NFR for any feature
  that creates per-team resources.

## Common FR Gaps (add to every PRD involving workflows)

- Idempotency (duplicate submission → 409, not a second workflow dispatch) is always needed and often
  forgotten — add as an explicit FR or NFR.
- Feature flag in `data/environments.json` should be the rollout/rollback mechanism for new portal
  features — document it in the Delivery Plan.

## NFR Defaults (always include in PRDs)

- API response time: <500ms p95
- Correlation ID in all API responses and logs
- Input validation via `express-validator` on all POST endpoints
- No secrets in code; use env vars

## Architecture Quick Reference

- **Key pages**: `CustomInfrastructurePage.vue` (multi-step wizard), `TemplateDeployPage.vue`,
  `ExistingInfraChangePage.vue` (agent-based), `InstalledAppsPage.vue`.
- **API service**: All frontend API calls via `srcV2/services/api.ts` `apiService` object.
- **Metadata**: `Aya-DevOpsTeam/service-catalog` repo, `docs/metadata/{appName}-{env}.json`.
  Auth via existing GitHub App — no new credentials needed.
- **`GET /api/installed-apps`**: Returns normalized list. `GET /api/deployed-apps/:name/:env`:
  exists but has a file-naming bug (uses `{name}.json` not `{name}-{env}.json`).

## Known Bugs

- `getApplicationDetails()` (`infrastructureService.js:617`): uses wrong primary lookup path
  (`{projectName}.json` instead of `{projectName}-{environment}.json`). Flag in any PRD
  touching single-app metadata retrieval.

## NFR Patterns (always include)

- N+1 GitHub API calls: require direct-path lookup, not full directory scan for single records.
- URL path-param injection: `appName` and `environment` must be validated (regex + whitelist).
- Auth on every new endpoint: `requireAuth` middleware. Document public-route exceptions.
- Correlation ID in every log line and JSON response body.

## Field Rules — Never Pre-fill These

- `approvalNumber`: always fresh JIRA/CR number per workflow run.
- `projectAge`: always entered fresh per request.
- `lifecycle`: always reset to `experimental` on new provisioning.

## Domain Glossary

- `lifecycle` enum mismatch: metadata uses `Live|experiment|deprecated`; TypeScript type uses
  `experimental|development|production`. Always verify which scope is meant.
- `projectName`: max 8 alphanumeric chars. Typos cause silent catalog mismatches.
- `environment`: dynamic whitelist from `data/environments.json`. Never hardcode.
- `correlationId`: format `cid-{timestamp}-{random4}`.

## Lessons Learned

- When a "select from list + pre-fill" feature is requested, always check: (a) does a list
  endpoint exist? (b) does a single-item detail endpoint exist? (c) are they wired to the frontend?
  All three are usually separate classification items.
- Classification: list = existing-refine; detail endpoint with bug = existing-extend;
  UI selector component = new-feature; form wiring = new-feature.
- Shared reusable components (e.g., `AppSelector.vue`) needed by 2+ pages should be classified
  as new-feature once; each page integration is a separate FR.
- For secret/credentials features: the `secretValue` field must be explicitly called out as
  never-logged in FR acceptance criteria AND in NFR. The Challenger will flag missing "no-log" ACs.
- For features touching secrets or credentials, always add a dedicated NFR for "no plaintext in
  logs or Git" — not just an FR acceptance criterion. The security NFR makes it measurable/testable.
- SOPS features always have 2+ blocking OQs before Phase 2 can start: (1) SOPS master key
  location, (2) secrets repository name + PR policy. Flag both as explicit OQs in Section 10
  rather than assuming they are known.
- When a feature requires reading from a different GitHub repository than the service-catalog
  (e.g., infra-live), always check: (a) which GitHub App covers that repo, (b) what the exact
  directory/file path pattern is. Add both as OQs if unknown; never assume the existing App
  covers all repos.
- Azure SDK identity (managed identity vs service principal vs workload identity) for direct
  Azure API calls is always an OQ if not previously established. List it explicitly — it's a
  Phase 1 blocker for any feature calling Azure APIs from the portal backend.
- Before leaving an infra-live/Terragrunt path pattern as a blocking OQ, check for a matching
  skill (e.g. `terragrunt-new-env`) and grep `config.js` for an existing repo/env-var config —
  these often already answer "what's the path convention" and "is there already a config value
  for this repo", turning a blocking OQ into an evidence-based resolution (or narrowing it to a
  single remaining confirmation, like GitHub App repo scope).
- SOPS + Azure Key Vault features: prefer SOPS's native `azure_keyvault` creation rule over
  age/PGP keys — no private key material to manage. Always design the encrypt/decrypt role
  split explicitly (e.g. portal backend gets `wrapKey` only, CI gets `unwrapKey` scoped to the
  target vault only) as a concrete requirement, not left as an open question.
- When a PRD draft proposes a brand-new repo to host GitOps artifacts (e.g. a "secrets-catalog"
  repo), check whether an existing repo the platform already reads from (matching directory
  conventions already in use) can host the new artifact instead. Reduces OQ count and avoids a
  new credential/repo-onboarding step for Platform Engineering.
- Idempotency ACs ("if a PR already exists, return 409") are not testable/implementable without a
  named, deterministic identification scheme (branch name, PR title convention). Always spell out
  the exact naming pattern in the same FR, not just the behavior — the Challenger will flag it as
  a Blocking gap otherwise.
- Any GitOps write path where multiple unrelated submissions can land in the *same* file (e.g. one
  encrypted secrets document per app/environment covering many secret names) needs an explicit
  concurrency-conflict story (read-merge-retry, serialization, or per-secret files) as its own AC
  and Section 10 risk row — same-key idempotency alone does not cover different-key concurrent
  writes.
- When an NFR references "verified via OQ-00X," double-check that OQ number still matches after any
  later OQ renumbering/resolution pass — easy to leave a stale cross-reference when OQs are revised.
- Two fixes made in the same revision can individually look correct but contradict each other:
  giving each entity its own dedicated branch (to fix idempotency) silently invalidates a
  "non-fast-forward push retry" concurrency mechanism written for a shared-branch model. When
  revising multiple ACs that touch the same underlying git workflow in one pass, explicitly trace
  through the combined branch/merge model once at the end, not just each AC in isolation.
- Dual-repo "target selector" pattern: when the same self-service flow must apply to two repos
  that share an identical directory layout (e.g. `infrastructure-live` = live, `service-catalog` =
  sand), model it as one required `target` enum param (`live`/`sand`) validated by
  express-validator and threaded through every FR (list/create/discover/UI), mapping to existing
  `config.github.*Repo` values — not two parallel endpoints. Both used the same
  `githubService.octokit`. Note the one real evidence gap: `hclParser` reads
  `infrastructure/{appName}/env.hcl` in service-catalog (flat), so service-catalog's exact
  per-environment `keyvault/` subpath needs a one-time verification — record it as a verification
  item, not a blocking OQ, when the user asserts the patterns are identical.
- Removing a "reveal plaintext value" feature can eliminate an entire Azure-SDK-identity OQ: SOPS
  keeps document *keys* in plaintext (only values are encrypted), so a secret-name **list** can be
  read straight from the encrypted YAML in Git with the existing GitHub App — no Key Vault read
  role, no managed-identity question. Prefer git-based listing over Azure KV SDK listing whenever
  only names (not values) are needed.
- Always recompute FR/NFR counts from the actual `### FR-`/`### NFR-` header count before writing
  the Summary Table and ORCHESTRATOR-READY block. A stale count (this PRD carried nfr_count 9 while
  11 NFR headers existed) can survive multiple Challenger rounds unnoticed — grep the headers,
  don't trust the prior number.
- A human-directed material scope change (features removed/added, OQs resolved) should reset the
  Challenger to a fresh Round 1 full review, not resume a prior round-2 delta thread — a delta
  check assumes stable IDs/scope, which no longer holds.

## Environment-Concept Collisions (secrets-environment-scope, 2026-08-08)

- A portal codebase can have **two unrelated things both called "environment"**: the portal-scoped
  `data/environments.json` (feature-flag gate, 3 entries) and live Terragrunt folder names discovered
  by walking a target repo tree (`discoverAppsForTarget`/`resolveKeyVaults` in `secretsService.js`,
  unbounded real names like `prod`/`nonprod`/`hub`/`shared-services`). Never assume a "tier" or
  "grouping" requirement for the latter can reuse the former's data — grep for whether the discovery
  is filesystem/tree-driven vs. config-driven before writing the Evidence Table.
- When a problem statement introduces a new classification axis (e.g., prod vs non-prod tier) and no
  metadata field for it exists anywhere (`data/*.json`, TS types, code), don't invent a default rule
  in the FR — write the FR to accept *any* resolved classification source and push the actual rule to
  an Open Question. Ship the FR's data contract (e.g., an additive `tier` field) so engineering isn't
  blocked, without the PM agent guessing the business rule.
- Multi-select / fan-out requests (submit to N of something instead of 1) always need three explicit
  FRs, not one: (1) the resolution/discovery step run per-item, (2) the request/response contract
  change (array field + partial-result array), (3) the HTTP-status convention for partial failure
  (all-succeed / some-fail / all-fail). Bundling partial-failure semantics into the fan-out FR as an
  afterthought is exactly the gap a Challenger will flag — give it its own FR with a concrete JSON
  shape and status-code table.
- Before proposing a new UX safeguard (e.g., a confirmation step) for a sensitive action, grep
  `srcV2/components/` for an existing reusable confirm/modal component. If none exists (as here —
  only a bare `window.confirm()` in `InstalledAppsPage.vue`), classify the safeguard FR as
  `new-feature` even though it's small, and keep it `should`-priority/provisional in the PRD when the
  underlying policy question (whether it's wanted at all) is still an open stakeholder decision.
- **A Non-Goal is a factual claim about the world and must be evidence-checked like any other
  claim.** `secret-self-service` carried the Non-Goal "v1 supports exactly one Key Vault per
  app/environment pair", which read as a scope *choice* but was actually a false *assertion* about
  the repo (`mlops` has 2–4). Scope-limiting Non-Goals are safe ("we won't build rotation");
  reality-asserting Non-Goals are load-bearing and silently propagate into every downstream
  contract. Grep for a counter-example before writing any Non-Goal that constrains cardinality
  ("exactly one X per Y"); if it can't be verified, phrase it as a rejection requirement ("v1
  rejects >1 X with a clear error") rather than an assumption.
- **When a Challenger finding is a PRD defect and not just a spec defect, the PM must amend the
  PRD even if it is already human-`approved`.** Sending the Architect back to fix a spec that
  faithfully implements a wrong PRD just re-derives the same bug. Amend in place, keep all
  requirement IDs stable (so the Challenger's delta re-check stays valid), and add a dated
  amendment note above the `ORCHESTRATOR-READY` block explaining what changed after sign-off.
- **Prefer enumerate-then-filter over probe-a-known-path for repo-structure discovery.** It is
  usually *fewer* API calls (one `git/trees?recursive=1` vs N probes plus fallbacks), degrades
  gracefully across layout variants, and the resulting list natively supports 0/1/many without a
  contract change. Two follow-ons it always needs as ACs: a repo-level cache key (the whole-repo
  tree serves every app, so keying by app/env discards most of the benefit) and a `truncated: true`
  fallback (GitHub truncates trees above ~100k entries / 7 MB).
- **When a fix turns a singular contract into a list, every derived identifier must change too.**
  Cascading `vaultName` → `vaults[]` also forced the PR branch name to include a vault slug —
  otherwise two sibling vaults submitting the same secret name collide on one branch. After any
  singular→list change, re-check branch names, file paths, cache keys, idempotency keys, and every
  "unique per app/env" assumption.
- **A caller-supplied path fragment is an arbitrary-write vulnerability unless allow-listed.**
  Adding `vaultDir` to a request body made the commit path partly caller-controlled. The AC must
  require membership-checking the value against the discovery result before path construction —
  not merely regex-validating it. Applies to any FR where a request field is concatenated into a
  repo path, file path, or URL.
- **When the user challenges a design on instinct, gather repo evidence before agreeing or
  defending.** The user's "look for keyvault folders and build patterns instead of reading
  top-to-bottom" hunch was correct and overturned an already-approved Round 2 architecture. Fastest
  resolution path: collect concrete counter-examples first, then dispatch a scoped, human-directed
  Challenger round citing them — rather than debating the design in the abstract.
- A Challenger `approved` verdict is not proof of correctness — it means no blocking issue was
  found *within the scope reviewed*. Round 2 approved this spec; a later human-directed Round 3
  scoped narrowly to one mechanism found 3 blocking issues. Narrow, targeted re-reviews are cheap
  and worth running when a human voices doubt about a specific mechanism.
- **A prior PRD's explicit, deferred Open Question is the first place to look when a new
  stakeholder request arrives on the same feature area.** `secrets-environment-scope` OQ-004
  ("are there more than two tiers?") was left open with "revisit only if Platform Engineering
  later requests a richer taxonomy" — the `secrets-environment-bundles` request was exactly that
  richer taxonomy. Always grep prior PRDs' OQ sections for the new request's keywords before
  assuming it's untouched territory; citing "this resolves OQ-00X" is stronger evidence than
  re-deriving the gap from scratch.
- **A hard NFR/FR contract in a shipped PRD ("each environment's branch/PR is a fully independent
  Git artifact") can be directly *contradicted*, not just extended, by a new stakeholder
  requirement ("exactly one commit and one PR for the whole batch").** When this happens, don't
  bury the reversal inside an FR's prose — name the specific superseded FR/NFR ID in the Title
  Metadata ("Supersedes"), the Evidence Table, and the Classification Matrix, and add an explicit
  Risk entry, so the Architect/Challenger don't mistake it for a drop-in extension of the existing
  mechanism (e.g., assuming a loop over the existing single-file-commit function still works when
  the new requirement needs a multi-file atomic commit — a materially different git operation).
- **When a target repo (e.g. `infrastructure-live`) is unreachable from this workspace's
  GitHub App/token (`404` on `gh api repos/...` or the MCP `get_file_contents` equivalent),
  don't guess at its branch-protection/CODEOWNERS state — classify that specific capability
  `unknown-needs-discovery` with a named owner (e.g. Platform/DevSecOps) and cite the exact
  failed call as evidence.** This is different from "no evidence exists" (→ `new-feature`): there
  IS a real external state, it's just unverifiable from here. Ship the in-repo half of the
  requirement (e.g., a machine-readable flag/marker) as a normal `existing-extend` FR, and track
  only the *external enforcement* as the unknown-needs-discovery item — don't let one unverifiable
  external fact block classifying the entire capability.
- **`docs/roadmaps/*.md` (not just `docs/prd/*` and `docs/architecture/*`) can contain load-bearing
  live-probe evidence** (e.g., `plan-layeredKeyVaultResolution.md`'s "Validated test case:
  ayaApplications" section lists 11 real environment folder names from a live `gh api` probe of
  `infrastructure-live`). Always check `docs/roadmaps/` when a new PRD's environment/naming claims
  need real-world confirmation — it's frequently faster and more concrete than a fresh live probe,
  and roadmap docs tend to record exact folder-name enumerations that PRDs don't.
- **Config-driven bundle PRDs need both invalid-reload and cold-start behavior, plus backend completeness
  enforcement.** A UI that displays every currently eligible environment is not sufficient: the API
  must reject a bundle payload that omits an eligible environment or has no secret rows for it, while
  allowing environments that become unavailable between pre-flight and submission to be excluded.

**Last updated**: 2026-09-18
