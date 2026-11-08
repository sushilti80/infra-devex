# Architecture Challenger Review: vault-resolution-override (Round 1)
Date: 2026-08-12
Spec: docs/architecture/vault-resolution-override-spec.json
PRD:  docs/prd/vault-resolution-override.md

## Verdict
changes_requested

## Blocking Findings

- [ ] **FR-003 write flow omits the required `branch` argument and silently invents an unprecedented direct-to-default-branch commit pattern** — reference: FR-003 AC3/AC4, spec.md §2.2 sequence diagram (`API->>GH: createOrUpdateFile(serviceRepo, ..., sha)`), spec.json `technical.flows[1]` ("Override submission") and `data_contracts.keyvault_override_sidecar`. Code-verified: `githubService.createOrUpdateFile(repo, branch, path, content, message, sha = null)` (`services/githubService.js:267`) takes a **required** `branch` positional argument with no default, and its **only existing call site in the entire codebase** (`services/secretsService.js:707`, inside `submitSecretViaGitOps`) always writes to a freshly created feature branch (`branchName`) and then opens a PR — never to the repo's default branch. The spec's sequence diagram and FR-003 AC3/AC4 describe a bare read-`sha`-modify-write with no branch creation and no PR step at all, which (a) cannot be implemented against the actual function signature without the Architect deciding *which* branch to pass, and (b) if that branch is the default branch (as the "retry on sha conflict" framing implies — a single mutable location, not a fresh branch per submission), it commits directly to `main` in `organization/service-catalog`, bypassing the PR/CODEOWNERS review this platform's own established GitOps pattern relies on for every other write to that repo. This isn't a minor omission — it's a new, unreviewed persistence pattern for this codebase. **Fix**: either (1) explicitly design and document a per-submission branch+PR flow consistent with `submitSecretViaGitOps` (accepting slower UX/no immediate reflection until merge, which would also contradict FR "immediately visible" — needs resolving), or (2) explicitly decide and document "direct commit to default branch, no PR" as a deliberate, justified deviation (naming which branch, whether `docs/overrides/` needs its own CODEOWNERS entry in the service-catalog repo, and updating FR-002 AC2/FR-003 AC4's sha-conflict language to make clear there is exactly one mutable target, not a branch-per-write). Either way, spell out the actual `createOrUpdateFile(repo, branch, path, content, message, sha)` call with a real `branch` value in both spec.md and spec.json before Vue.js Dev/SRE DevOps start.

## Advisory Findings

- `verifiedBy`/`verifiedAt` provenance is unspecified — reference: FR-003 request_schema (spec.json `technical.api_endpoints[0].request_schema`) does not include `verifiedBy`, and no flow step states it is derived from `req.user.email` (populated by `requireAuth`, per `middleware/auth.js:37`). Correct not to accept it from client input, but the spec should say explicitly where it comes from so QA can assert it and the backend dev doesn't guess or accidentally trust a client-supplied value.
- `NFR performance.api_response_time: "<500ms p95"` is an Architect-added target with no corresponding PRD NFR (PRD's NFR-001 only covers the 60s cache TTL/read frequency). Given the write path is a sequential `resolveKeyVaults()` allow-list check → `getFileContent()` → `createOrUpdateFile()` (at least 2 sequential live GitHub API calls even on a cache hit), a 500ms p95 is optimistic and unverified against real GitHub API latency. Either drop this invented target or mark it as provisional/to-be-measured rather than a hard NFR QA must gate on.
- The malformed-JSON error scenario ("Warning logged with correlationId noting the parse failure") assumes `loadVaultOverrides()` has access to a request's `correlationId`, but FR-002's own description and stampede-protection design (one shared in-flight promise across concurrent callers) implies the cache-population path is decoupled from any single caller's correlationId. Clarify whether `loadVaultOverrides()` takes an optional `correlationId` param for the caller that happens to trigger the miss, or whether this log line is emitted without one.
- No ADR or architecture deep-dive doc exists for this feature (repo has no `docs/adr/` at all), yet the write-pattern deviation flagged above is exactly the kind of "new architectural pattern/significant trade-off" the Architect's own escalation rules call out. Given this repo doesn't currently use ADRs, this is Advisory rather than Blocking — but the Blocking finding above should at minimum be resolved in the spec itself.

## Round Context
N/A — this is Round 1.

<!-- ARCH-CHALLENGER-VERDICT
feature: vault-resolution-override
round: 1
verdict: changes_requested
blocking_count: 1
advisory_count: 3
-->
