# Legacy learning evidence — architect-agent

> Quarantined historical evidence migrated from `.github/agent-memory/architect-agent/MEMORY.md`.
> This file is **not governing instruction**, is not an agent memory source, and must not be
> automatically loaded to control future behavior. When a historical observation is still useful,
> create a schema-shaped LearningRecord candidate with current repository evidence and evaluation
> instead of copying the instruction into an agent or skill.

# Architect Agent Memory

**Last updated**: 2026-09-19

## Codebase State (verified against code)

### Frontend
- **Vue 3 SPA** in `srcV2/` is the sole frontend — vanilla JS `public/` removed
- Pages: `CustomInfrastructurePage`, `TemplateDeployPage`, `InstalledAppsPage`, `AKSDeployPage`,
  `AKSInstalledAppsPage`, `ExistingInfraChangePage`, `FeedbackPage`, `DocsPage`
- Pinia stores: `auth.ts`, `environments.ts`, `navigation.ts`, `workflow.ts`
- Composables: `useAuth.ts`, `useWorkflowPolling.ts`, `useTelemetry.ts`
- `useTelemetry.ts`: emits `app:telemetry` CustomEvent in prod; `console.debug` in dev

### Authentication (ACTIVE — not future)
- `requireAuth` / `optionalAuth` / `requireRole` live in `middleware/auth.js`
- Protected: `/installed-apps`, `/apps`, `/custom`, `/template`, `/delete`, `/promote`,
  `/aks-deploy`, `/aks-apps`, `/feedback`, `/rbac-relationships`, `/label`
- Optional auth: `/agent-change`
- Public: `/templates`, `/modules`, `/roles`, `/environments`, `/agents`, `/status/:id`, `/aks-status*`

### Active Agents (data/agents.json)
- `topicsubscription`: Event Grid & Service Bus subscriptions in Terragrunt
- `storage`: Storage Account queues/containers/tables
- `servicebus`: Service Bus topics/queues/subscriptions with namespace auto-create

### Environments (data/environments.json)
- `devsand` (enabled, all features incl. AKS)
- `sand` (enabled, all features incl. AKS)
- `aisand` (disabled, no AKS)
- `prod` is NOT a direct deploy target — reached via `POST /api/promote`

### Module Catalog (data/modules.json)
storageV2, keyvault, RBAC, UserAssignMSI*, appServiceWindows*, functionAppSvcWindows*,
appServiceLinux*, functionAppSvcLinux*, serviceBus, sqldb*, appConfiguration,
linuxVMs, windowsVMs, eventGridTopics*, **aiFoundry**  (* = supportsMultiInstance)

### Key API Endpoints
- `POST /api/label` → triggers `UpdateMetadataLive.yaml` (Infrastructure App)
- `POST /api/add-code-repo` → triggers `create-app.yml` in `AyaHealthcare/self-service-catalog` (Code App)
- `POST /api/agent-change` → triggers `agent-dispatch` in infra-live repo (Infrastructure App)
- `POST /api/feedback` → creates GitHub Issue; types: `bug`, `feature-request`, `agent-request`
- `GET /api/aks-status-by-correlation/:correlationId` — new status lookup path for AKS
- `GET /api/aks-status/:workflowId` — direct workflow ID status

### AksService.deployToAks() signature (full)
`envname, appname, namespace, is_web_app, image_name, image_tag, team_label, port,
health_path, external_secret_enabled, kv_secrets, env_vars, secret_env_vars,
agent_name, pool_name, allow_update, workload_identity_grants, correlationId, triggeredBy`

### Workflows (verified)
- Service-catalog (Infra App): `create-infrastructure.yaml`, `delete-infrastructure.yaml`,
  `move-to-infralive.yaml`, `UpdateMetadataLive.yaml`
- Code catalog `AyaHealthcare/self-service-catalog` (Code App): `create-app.yml`
- Infra-live (Infra App): `agent-dispatch`

## Patterns to Apply in All Specs
1. GitHub as Database — `docs/metadata/` JSON files
2. Dual GitHub Apps — Infrastructure App vs Code App
3. Correlation ID — thread through all logs, PRs, API responses
4. Vue 3 SPA Navigation — Pinia navigation store, component pages
5. Workflow Polling — `GET /api/status/:correlationId`, poll every 2s

## Lessons Learned
- SPA navigation pattern description was stale (vanilla JS); always verify against `srcV2/pages/`
- Auth is active — spec all protected endpoints with `requireAuth` in spec.json components
- `prod` env is a promotion target, not a deploy target — avoid referencing it in env dropdowns
- `routes/api.js` and `services/infrastructureService.js` are large (>49 KB) — always use `view_range`
- `getApplicationDetails()` bug pattern: incorrect primary file path `{name}.json` vs canonical `{name}-{env}.json`
- `InstalledApp` TypeScript enrichment: add only optional fields (`?:`) to avoid breaking existing consumers
- `ModuleSelector.vue` uses `v-model:selectedModules` (not `v-model`) — emit name is `update:selectedModules`
- `ProjectInfoForm.vue` has `lifecycle` hardcoded to `'experimental'`; never spec pre-fill of lifecycle
- Input validation on path params must happen BEFORE any GitHub API call — always note this in error flows
- spec.json MUST use `feature.name` + `feature.summary` as nested object (not flat string); orchestrator gate also requires `technical.api_endpoints[]` and `testing.functional_test_scenarios[]`
- `navigation.ts` has 18 call sites across 8 files (not just 8 calls); optional param is the correct BC strategy
- `AppSelector.vue` uses `isExpanded = ref(true)` internally; expose a `collapse()` via `defineExpose` to let parent collapse after programmatic load — do NOT add a prop
- `CustomInfrastructurePage.vue` `prefillEnabled` pattern: `import.meta.env.VITE_ENABLE_CATALOG_PREFILL !== 'false'` — mirror this in any page that gates on the same flag
- Clear prefillContext from navigation store BEFORE awaiting API call (not after) to prevent context leak if the component unmounts mid-flight
- `api.ts` interceptor already emits telemetry for every request — no extra instrumentation needed for NFR-007 type requirements
- **Repo-structure discovery: enumerate-then-filter, not probe-a-known-path.** Sampling ~7 apps in a monorepo-style infra-live/service-catalog repo proves a layout is COMMON, never UNIVERSAL. A path-probing design (try the canonical path, fall back to a scan of one presumed parent dir) silently breaks the moment any app uses a numbered/nested/depth-shifted variant — and the "fallback" usually can't reach the variant either, since it's still anchored near the probed path. Prefer one bulk enumeration (e.g. GitHub Trees API `recursive=1`) filtered by a regex on the final path segment, deriving other identifiers (app/env) positionally-agnostically from the matched path, over any design that assumes a fixed directory depth. This generalizes for free to variants not yet observed.
- **Multi-instance contracts**: when a resource *could* have more than one instance per key (e.g. one app/env owning 2+ Key Vaults), don't design a singular nullable-field contract "for now" — it can't represent the >1 case at all, so it isn't a smaller version of the right design, it's a wrong one that has to be replaced later. Return a list from day one (`{ found, items: [...] }`), even if the UI only ever renders the first element initially.
- Cache keys should match the actual cost boundary of the underlying call, not the query granularity: if one API call (e.g. a repo tree fetch) answers every app/environment/vault combination in that repo, key the cache by repo/target alone — a per-tuple key just fragments one cheap call into many cache misses.
- **Resolving a GitHub App scope/permission unknown**: don't guess whether a new `octokit.rest.git.*` call needs a new GitHub App permission grant — grep the existing service for any call in the *same* API family that already runs in production (e.g. `githubService.createBranch()` already calls `git.getRef`/`git.createRef`). GitHub scopes the whole Git Data API family (blobs/trees/commits/refs/tags) under one "Contents" repo permission, so one already-working call in that family is concrete evidence the sibling calls (`createTree`/`createCommit`/`updateRef`) need no new scope. Cite the exact file/line as evidence in the spec, not just the general GitHub-docs claim.
- **Config-driven UI grouping needs an additive catalog field, not just a per-item tag**: when a PRD adds a per-item classification field (e.g. `bundleId` on each app/environment row) but the UI also needs to group/label/order by that classification's metadata (`displayName`, `order`, feature flags), a bare id string on each row isn't enough — either hardcode the metadata client-side (breaks "0 code change to reconfigure" goals) or add a small sibling catalog array to the *same* existing endpoint response. Flag this explicitly as an Architect Resolution beyond the PRD's literal API Impact text so the Challenger scrutinizes it, rather than silently expanding scope.
- **Reuse existing single-item read endpoints for new batch/pre-flight UI needs.** Before spec'ing a new endpoint for "resolve ambiguity/eligibility for N items before submission," check whether an existing single-item endpoint (e.g. `GET /api/secrets/:appName/:environment`) already returns everything needed (ambiguity flags, candidate lists) and is already called in a loop somewhere in the frontend for a sibling feature (e.g. `resolveEnvironmentEligibility()`). Calling it N times in parallel from a new composable is usually sufficient and keeps "No New Endpoints" PRD constraints intact — but check whether the new feature needs *per-item* disambiguation state where the existing precedent used one *shared* ref/variable; if so, call out the composable's state shape as a deliberate deviation, not an oversight.
- **High-volume secret/crypto operations**: if a new feature's worst-case operation count (e.g. bundle secrets: environments × secret names) is materially larger than any existing precedent's tested ceiling, and the existing precedent encrypts/processes strictly sequentially, recommend bounded-concurrency chunking as a design option (not a hard mandate) and explicitly defer the sequential-vs-chunked decision to the PRD's own feasibility-spike gate if one exists, rather than mandating a specific concurrency library/approach.
- **Handling a "stakeholder now confirms external control X is active" instruction**: attempt one concrete independent check anyway (e.g. `gh api`/GitHub MCP `get_file_contents` against the named external repo) even if a prior agent already failed the same check — sandbox credentials occasionally differ agent-to-agent. If it fails identically, write the spec's language as "stakeholder-asserted, architecture-unverified," never silently upgrade it to "verified," and add a concrete Definition-of-Done evidence artifact recommendation (e.g. a screenshot/export of the actual ruleset) rather than accepting a verbal/ticket-level claim for a security-relevant external gate.
- **First ADR in this repo** was created for `secrets-environment-bundles` (`docs/adr/20260918-...md`) — the trigger was a genuine supersession: one FR's NFR contract (all-or-nothing atomicity) directly contradicts a previously-shipped sibling feature's NFR contract (per-item independent fan-out) for the same conceptual action. That contradiction-with-a-shipped-precedent pattern is the clearest ADR trigger seen so far — clearer than "significant trade-off" alone, which is easy to talk yourself out of.
- Shared `.github/agent-memory/project-state/MEMORY.md` grows fast (hit 396 lines / ~52 Activity Log entries by 2026-09-18 despite the file's own "~150 lines" / "keep last ~20" guidance never having been enforced). When your update pushes it further over budget, proactively prune the oldest Activity Log entries yourself (never touch "Active Features" or "Open Blockers" rows) rather than leaving the trim for someone else — the file's own header comment authorizes this.
- **Revising a spec after a Challenger `changes_requested` verdict**: an `oneOf([...])` express-validator array that already exists for a legacy shape must gain the new shape's branch *inside the same array* (a third alternative), never a separate `.if()`/conditional gate placed before or after it — `oneOf()` only requires one branch to pass, so bolting on a new mode as an independent gate leaves the original array still unconditionally rejecting the new shape first. Always trace the validator **array contents**, not just the presence of a later manual-shape check, when a Challenger flags "requests never reach my new branch" — the manual check and the `oneOf()` shape gate are two independent layers that both need updating.
- **GitHub's Git Data API (`git.createTree`/`git.createCommit`/`git.updateRef`) has no server-side conditional-write primitive** analogous to the Contents API's single-file `sha` param — there is no way to make the final multi-file commit atomically conditional on a remote precondition in one call. The only implementable design is "best-effort CAS": a fresh, parallel re-read of each target file's current SHA (reuse the existing single-file read method, e.g. `getFileContent()`, via `Promise.all` — don't invent a new bulk-read call) as the very last step before `createTree`, throwing a `CONFLICT`-coded error on any mismatch, plus mapping both `createRef` 422 (ref exists) and `updateRef({force:false})` 422 (non-fast-forward) to that same `CONFLICT` code as the ref-race backstop. Document this explicitly as "best-effort, narrows the window, not identical to the Contents API's atomic guarantee" — don't let the spec imply full atomicity parity, and don't add automatic retries on `CONFLICT` unless an existing sibling method in the codebase already does (mirror whatever precedent exists, e.g. this repo's `submitSecretViaGitOps()` CONFLICT→503-no-retry convention).
- **NFR wording like "100% of log lines carry correlationId+bundleId" needs an explicit scope boundary when the flow calls a pre-existing, intentionally-unmodified shared function.** If that shared function (e.g. `resolveKeyVaults()`) is called out elsewhere in the same spec as a Non-Goal ("no change to X's algorithm"), retrofitting a new identifier into its logging would violate that Non-Goal and risk regressing its other callers. Resolve this by scoping the NFR's "100%" claim to the feature's own new/modified log lines only, explicitly naming the excluded pre-existing lines and why — this turns an unachievable blanket claim into a measurable, testable one (exact log-line-count assertion) without contradicting an existing Non-Goal.
- **Reuse the existing `createIssue()`-style correlationId tag/logMetric convention (`const tag = correlationId ? `[${correlationId}] ` : ''`, prefixed on every logger call, plus `logMetric(..., {correlationId: correlationId || 'unknown'})`) instead of inventing a new logging pattern** when a Challenger asks for propagation through an existing service method — extend the method's signature additively (new trailing optional param, default `''`/backward-compatible) rather than changing its required-arg shape, so existing callers are unaffected.
- **`ready_for_challenger_round_N` is this repo's established status convention for a Round 2+ revision** (mirrors `secret-self-service-spec.json`'s prior usage) — use this exact suffix pattern (not a bespoke `revised`/`draft` value) when re-submitting a spec after `changes_requested`, and cite the specific finding IDs resolved in a new spec.md subsection (e.g. "§1.4 Round 1 Revision Log" table: finding → resolution → location) so the Challenger's round-2 delta-only re-check has a direct map instead of having to re-diff the whole spec.
- **Avoid per-entry file-read redundancy in loops over N discovered items (apps/environments) by loading shared config exactly once per HTTP request and passing it down as a parameter**, turning any per-item classifier function into a pure function over that already-loaded config. Don't reach for a new TTL cache for this — "load once per request, thread as a param" is sufficient and simpler. Note explicitly in the spec when this deliberately diverges from an existing sibling function's per-call-read convention (e.g. `classifyEnvironmentTier()`'s per-call `fs.readFileSync`) — it's an intentional improvement for the new code path, not evidence of inconsistency with the old one.
- **A "wording-only" Round N+1 fix for one Challenger-cited spec.md paragraph can still be incomplete if spec.json isn't re-swept for the same overclaim.** The Round 2 Challenger's own spot-check on `secrets-environment-bundles` was scoped to `testing.unit_tests` only (and found it already correct); it did not re-check `testing.functional_test_scenarios`, `testing.integration_tests`, or `nfrs.security`, which turned out to contain the identical "categories 2-3 require both correlationId+bundleId" overclaim as the flagged spec.md paragraphs. When a fix involves precisely re-scoping which of several near-identical methods/categories require which tag(s), `grep` the *whole* spec.json for the shared claim phrase (not just the array the reviewer cited) before declaring the fix complete — the defect pattern reliably recurs anywhere the same claim was copy-pasted across `testing.*`/`nfrs.*` arrays.
- **Each revision round gets its own numbered Revision Log subsection (§1.4 Round 1, §1.5 Round 2, ...), never overwritten or merged into the prior round's table** — this keeps a durable, appendable audit trail of "which finding, resolved how, where" per round, so a Round 3+ Challenger (or a human) can see the full history without diffing raw file versions. Bump the header's `**Status**` and spec.json's `status` to `ready_for_challenger_round_{N+1}` in the same edit.
