# PRD Challenger Review: ship-from-repo (Round 1)
Date: 2026-10-21
PRD: docs/prd/ship-from-repo.md

Scope note: the product-owner decisions (GitHub Actions on self-hosted `ubuntu-latest`, any enterprise-org repo the
GitHub App can access, auto-PATCH plain `X.Y.Z`, `devsand` only, promotion via flux-config PR CODEOWNERS, build logs
only, preview URL in scope) are treated as fixed. Findings challenge only how well the PRD specifies them.

Deterministic check: `node scripts/validate-delivery-contract.mjs prd --feature ship-from-repo ...` → `PRD_VALID`
(15 FR / 12 NFR). Structure is complete; the defects below are substantive.

Severity legend: **Blocking** = must be fixed before the Architect starts. **Major** and **Minor** are both
non-blocking (counted as `advisory` in the machine marker); Major = strongly recommended before Architect, Minor = polish.

Citation spot-checks (all real): `routes/api.js:1611/1753/1785`, `config.js:110/116/129`, `services/aksService.js`,
`useWorkflowPolling.ts`, `AKSDeployPage.vue`, `AKSInstalledAppsPage.vue`, `data/environments.json` (`devsand.features.aks: true`).
No false classification evidence found, but see M-6 (FR-008 is understated as `existing-refine`).

## Verdict
changes_requested

## Blocking Findings

- [ ] **B-1 Untrusted-code isolation on a shared self-hosted runner is asserted, not specified** — FR-004 (AC-004-6, AC-004-8), NFR-005, R2 —
  AC-004-6 only requires that "platform secrets" are not exposed to buildpack execution, and NFR-005's test is "build attempts to read
  environment secrets and finds none". That leaves the real attack surface unspecified and untestable: (a) `pack` needs a Docker/containerd
  socket on the runner (A1) — build-time code (npm `postinstall`, Maven/Gradle plugins, Go `generate`, .NET MSBuild tasks) can reach it, which is
  host-equivalent access; (b) the same job that runs untrusted build steps also holds ACR push, Wiz and GitHub App credentials
  (clone → build → scan → push is one pipeline), and the checkout token can persist in `.git/config`; (c) AC-004-8 "cleanup" is not an
  ephemeral runner — a persistent runner permits cross-ship cache/daemon/image poisoning and a malicious build can plant artifacts for the next
  tenant's ship; (d) no egress/metadata-endpoint/internal-network restriction for build containers; (e) builder cache shared across users.
  **Fix:** add ACs requiring (1) build job and push/scan job to be separate jobs/identities — the build job receives *no* credential beyond a
  read-only, single-repo, short-lived clone token with `persist-credentials: false`, and ACR/Wiz credentials exist only in the post-build job
  operating on an exported image tarball; (2) ephemeral/JIT runner or dedicated runner group+rootless daemon (no host docker.sock shared across
  ships), fresh workspace and builder-cache per ship or an explicit cache-poisoning decision; (3) network egress policy for build containers
  (no IMDS/internal ranges); (4) replace the NFR-005 measurement with a named negative-test matrix (read env, read files outside workspace,
  reach docker socket, reach IMDS/internal host, read a previous ship's workspace, read the clone token) that must all fail.

- [ ] **B-2 Authorization model is missing: any authenticated user can build any App-visible private repo and overwrite any app** —
  FR-001 (AC-001-2, AC-001-6), FR-002 (AC-002-7), FR-003, R9, NFR-003 —
  FR-001 lists "repositories visible to the GitHub App", i.e. the *App's* access, never the *requesting user's*. The platform user therefore
  gets a confused-deputy path: a user with no access to org-X private repo can ship it, receive the source baked into an image, and view the running app at the
  preview URL. Separately, AC-002-7 handles "app name already exists and was not shipped from the same repo" with a *warning + confirm* — a confirmation is
  not authorization. Because after merge Flux auto-rolls any higher `X.Y.Z` in the same image repository (FR-012 AC-012-2), a user can push
  an arbitrary repo's image into another team's running app with no review (the CODEOWNERS gate only covers the initial config PR). AC-011-4 hints at
  "what the user's own access permits" but no AC enforces it. OQ-2 (which orgs, which App) is also open and blocking, and `config.js:114` shows the code-deployment App is
  scoped to the organization org, so "any enterprise org" is unverified against the App's installation scope.
  **Fix:** add FR-level ACs that (1) the requester must have at least read permission on the repo, verified server-side via a
  user-identity-based check (or a documented repo→team mapping) at both list time and ship time; (2) the repo list is filtered to that user; (3) an existing app
  can only be shipped to by its recorded owner/team or the platform team — replace "warn and confirm" with a hard 403 `APP_OWNED_BY_OTHER` (override only by platform team);
  (4) image-repository ↔ source-repo binding is recorded and a different source repo cannot push into an existing image repo; (5) close OQ-2 with the allowlist and App choice before Architect.

- [ ] **B-3 Concurrency/race invariants are stated but not achievable or testable as written** — AC-003-5, AC-005-7, AC-007-5, FR-012, NFR-008, §12 concurrency test —
  (a) AC-003-5/NFR-008 require "409 if a ship for the same app/env is already in progress" with no database and (per Gap/§8) no stated shared store; a
  check-then-dispatch against GitHub is racy across backend replicas and two near-simultaneous POSTs will both pass. The PRD never says what the
  authoritative "in progress" signal is nor how it is made atomic (e.g., Actions `concurrency` group keyed `app/env` with `cancel-in-progress: false`, or a
  dispatch lock). (b) "An existing tag is never overwritten" (AC-005-7, AC-007-5, NFR-008) is not enforceable by compute-then-push: ACR tags are mutable and there is no
  atomic conditional push; no ACR tag-lock/immutability requirement is stated and OQ-9 is unresolved. (c) Same-app ordering is unspecified: the flux-config dispatch for ship A
  and ship B writes the same fixed branch `auto/gen-<env>-<app>` — if A's dispatch lands after B's, the PR regresses to the older `image_tag`; nothing says "never downgrade the PR tag".
  (d) The §12 test "two simultaneous ships (409 / retry)" is ambiguous about which behaviour is expected (AC-003-5 says 409; AC-005-7 says retry) — two different requirements for the same race.
  **Fix:** specify the serialization mechanism as a requirement (per app/env mutual exclusion enforced in the workflow, not only in the API), require ACR tag immutability or an atomic
  create-if-absent push, require the config dispatch to be ordered after (and carry a version ≥) the current PR tag with a "no downgrade" AC, and rewrite the concurrency test with one
  expected outcome per scenario (same app/env → exactly one run, other gets 409; same app, different env n/a for MVP; different apps same image repo → rejected).

- [ ] **B-4 Stateless orchestration, correlation lookup and ownership/audit records are unspecified and contradict the platform's existing mechanism** —
  FR-003 ("subsequent stages are chained from build completion"), AC-009-6, AC-013-3, AC-013-6, FR-014 (AC-014-3), NFR-007, OQ-4 —
  (a) The platform has no DB and no worker. Nothing says what triggers the flux-config dispatch (FR-008) when the build finishes — if it is the browser poll, closing the tab breaks the chain (contradicts AC-013-5 "navigate away without cancelling");
  if it is the backend, the PRD does not say how it survives restarts/multiple replicas. (b) The "existing pattern" cited as reuse (`aks-status-by-correlation`) only searches the 10 most recent
  `workflow_dispatch` runs younger than 60 minutes in flux-config (`services/aksService.js` `searchWorkflowByCorrelationId`), and the route at `routes/api.js:1753` has **no `requireAuth`/owner check**.
  It cannot satisfy "works after browser refresh/reopen" for a ship that can legitimately queue 10 min + build 30 min, nor "retrievable by correlation ID and app name" for 90 days (AC-014-3), nor
  owner-only access (AC-009-6/013-6). The build-workflow repo (OQ-4) is still unknown, so even *where* to search is undefined. (c) NFR-007 requires "100% of ships (success and failure)" to have a record and reconciles
  "dispatched vs. recorded", yet ships rejected before dispatch (400, 409, `REPO_NOT_ACCESSIBLE`) never create a run — so either they are out of the audit scope (say so) or the requirement is unmeetable.
  **Fix:** add an AC that fixes the durable state machine: which component advances build→config PR (recommended: a workflow job/chained workflow, not the browser) and that it is restart-safe; require correlation lookup that is not
  bounded by the 10-run/60-min window (e.g., run-name/`run_id` lookup in the known build repo); require ownership (`triggered_by`) to be read from server-set workflow inputs, never client-supplied; state that the new status route is
  authenticated and that the legacy unauthenticated route is not reused; define audit scope (dispatched ships only vs. all attempts) and fix NFR-007's measurement accordingly; resolve OQ-4 before Architect.

- [ ] **B-5 FR-010 contradicts itself and the verified flux-config behavior; core FRs rest on unresolved "Blocking = Yes" open questions while the PRD declares itself `approved`** —
  FR-010 Description vs AC-010-2, R4, OQ-1/2/3/4/6/7/8/9, ORCHESTRATOR-READY `status: approved` —
  The FR-010 description hardcodes `http://pr-<N>-<app>.<env>.k8s.com`, while AC-010-2 and the verified flux-config fact say `pr-<N>-<app>.${CLUSTER_DNS_SUFFIX}`; scheme (http vs https) is also open. These are contradictory acceptance targets for the stated
  deliverable ("the preview URL was the original ask"). More broadly eight open questions are marked **Blocking = Yes** (OQ-1, 2, 3, 4, 6, 7, 8, 9) and directly parameterize ACs (AC-001-6 allowlist, AC-004-3 arch, AC-006-1 "fails the policy gate" — no severity threshold defined,
  AC-007-2 image naming, AC-012-2 post-merge behavior). Several ACs literally embed "[OQ-8 confirms…]"/"[OQ-5 confirms…]" — they are not testable until closed. Status was set to `approved` (and the handoff marker emitted) before any challenger review with these open.
  **Fix:** (1) make FR-010's description match AC-010-2 (host = `pr-<N>-<app>.${CLUSTER_DNS_SUFFIX}`, suffix/scheme from config) and delete the hardcoded `.k8s.com`; (2) for each Blocking-Yes OQ either record the decision with owner and date, or state a concrete default
  assumption that the ACs use (e.g., "Wiz fails on CRITICAL/HIGH with fix available", "ACR repo `<env>/<app>`", "`linux/amd64`") so the AC is testable now; (3) Round 1 should leave the status as `review` — reset the marker once OQs are decided or defaulted.

- [ ] **B-6 NFR-011 is arithmetically self-contradictory and unrealistic for the stated polling rules** — NFR-011, AC-009-1, AC-013-2, R7 —
  "≤ 100 GitHub API calls per ship" × "50 ships/hour" = 5 000 calls/h, which is ≈100% of a GitHub App installation's baseline 5 000/h REST limit — not "under 50%". The PRD's own polling ACs also blow the per-ship budget: build-log refresh ≥ every 10 s (AC-009-1)
  over a 15–30 min build is 90–180 calls, status polling every ≤10 s (AC-013-2) another 90–180, plus listing jobs/runs per poll (the existing correlation search lists runs and jobs per call), repo/branch listing, and PR capture. The same installation also serves
  flux-config dispatches and every other platform feature. The limit is therefore unverifiable and will be breached by design.
  **Fix:** restate NFR-011 with a consistent budget (e.g., per-ship call ceiling that satisfies the 50%-of-limit target at the stated ship rate, counted including polling by N concurrent viewers), require server-side caching/coalescing so N viewers of one ship cost one GitHub poll, define the log
  polling floor (e.g., 10 s while running, ETag/conditional requests), and say which App's installation limit is being measured.

## Major Findings (non-blocking, strongly recommended before Architect)

- **M-1 Secret exposure paths beyond log redaction** — AC-009-3, NFR-012, FR-006 — Pattern-based redaction of "known patterns" cannot support "0 secrets visible" (unprovable negative). Also unaddressed: secrets committed in the user's repo (`.env`, keys) get baked into the image and exposed on the public-ish preview; Wiz secret-scanning is not stated as part of the gate; logs of a *shared* build repo are readable by platform-team/anyone with repo access.
  Suggested: require Wiz secrets detection in the gate policy; restate NFR-012 as "known-pattern redaction + sampled review" and disable `ACTIONS_STEP_DEBUG`; limit build-repo log access.
- **M-2 Preview exposure/auth is silent** — FR-010, §9 — The preview is an auto-merged, immediately-routable deployment of arbitrary user-built code at a predictable hostname (`pr-<N>-<app>…`). PRD does not say who can reach it (VPN/internal only? SSO?), nor that the workload runs with no workload-identity grants/KV access. Suggested: add an AC stating preview ingress is internal-only/authenticated per flux-config behavior and that AC-008-1 never passes `workload_identity_grants`/`kv_secrets` (currently "left at defaults" — define the default as empty).
- **M-3 Post-merge re-ship silently bypasses review** — FR-012 AC-012-2, Persona Priya — After merge every ship auto-rolls via Flux with no CODEOWNERS review, which sits uneasily with "promoted only through the existing flux-config PR review" (Persona/Pain). Within the fixed `devsand` scope this may be acceptable, but the PRD must state it as an accepted, owner-signed trade-off, and also how the UI decides "PR merged and app exists" (AC-012-2/-4), not leave it as OQ-3.
- **M-4 Failure UX gaps** — FR-011, FR-008, FR-013 — Missing categories/paths: ACR push/auth/quota failure (falls into `UNKNOWN`), GitHub API rate-limit/outage, clone failure (private submodules, oversize repo, LFS), cancelled run, flux-config workflow succeeded but PR number not found within the 2-min capture (AC-008-3 — mechanism for capturing the PR number is unspecified; `generate-webapp-config.yaml` dispatch returns none), preview deploy failure after PR creation. Orphan images in ACR after a failed `CONFIG_PR_FAILED`/cancel have no retention/GC statement. AC-013-5 priority is stated three ways (`could-have`, `should`, "must" under the FR header). Suggested: add the missing codes, a retry matrix (which categories are safely retryable), and a cancel-during-push rule (no partial tag).
- **M-5 Measurability of success metrics without a datastore** — G1, G3, G4, NFR-001, NFR-007 — "≥90% reach PR opened without platform-team help", "support tickets reduced ≥50% vs. current Dockerfile tickets" (no baseline) and "0 images without a recorded requester" have no defined data source/owner; "warm builder cache" and "typical app ≤200 MB" are undefined for the p50/p95 targets. Suggested: name the measurement source (run query / telemetry event) or downgrade to qualitative pilot goals; record the ticket baseline.
- **M-6 Classification understated for FR-008 and FR-009** — §5 — FR-008 is marked `existing-refine` but requires new capability (PR-number capture, retry-without-rebuild, skip-dispatch after merge); FR-009 is `new-feature` but the existing correlation search already parses Actions job logs (`aksService.searchWorkflowByCorrelationId`) — cite and reuse that. Suggested: reclassify FR-008 `existing-extend` and reference the existing log reading code.
- **M-7 Environment gating wording is ambiguous** — AC-001-1, AC-002-1, §8 — Gating by `features.aks` (existing) vs a new `shipFromRepo` flag is left to the Architect, yet AC-002-1 says "requires an explicit ship-from-repo flag decision". Rollback (§11) says the flag rejects `POST /api/ship`. Pick one: the new flag is required (otherwise enabling `aks` elsewhere would expose the feature).
- **M-8 Build-time private dependencies** — Non-Goals/FR-004 — Many real repos need private npm/NuGet/Maven feeds or build-time env vars; neither supported nor listed as a non-goal, so implementers may drift (e.g., injecting secrets into the untrusted build). Suggested: explicit non-goal and a `BUILD_FAILED` hint.

## Minor Findings

- m-1 NFR-002 measurement uses `trackEvent('api_request_completed')`, which is the frontend composable (`srcV2/composables/useTelemetry.ts`); backend latency elsewhere uses `logger.logMetric`. Specify backend metric.
- m-2 AC-002-3 allows ports 1–65535 including privileged ports; restrict to ≥1024 or state that Paketo runs non-root.
- m-3 AC-003-2 `{ success, data | error, correlationId }` differs from the existing `aks-status-by-correlation` shape (`{ success, status }`); state the new contract is authoritative and the frontend does not reuse the old parser.
- m-4 AC-001-2 "supports keyboard navigation" and NFR-010 "color not sole indicator" are checkable but should name the pattern (combobox ARIA) for the QA assertion.
- m-5 AC-006-2 "link/ID to the Wiz scan result" — specify who can open it (Wiz tenant access) so non-Wiz users are not shown a dead link.
- m-6 AC-004-1 "builds successfully into an image in the runner's local daemon/registry" — pick one; they imply different isolation properties (see B-1).
- m-7 `0.1.0` first version (AC-005-4): confirm against existing apps sharing the image repo whose highest tag may exceed it; Flux picks highest overall.
- m-8 §13 priority split says "`must` = 14 … `should` = 1" but FR-013 contains a `should` AC; fine, but state AC-level priority consistently.

## Round Context
Round 1 — not applicable (no prior review). Per Round Discipline, a Round 2 delta-only re-check (verifying only B-1…B-6) happens only if the PM revises and the Orchestrator re-dispatches; this review does not start Round 2.

<!-- CHALLENGER-VERDICT
feature: ship-from-repo
round: 1
verdict: changes_requested
blocking_count: 6
advisory_count: 16
-->
