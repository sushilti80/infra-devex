# PRD Challenger Review: secret-self-service (Round 2)
Date: 2026-07-24
PRD: docs/prd/secret-self-service.md
Round 1 review: docs/reviews/secret-self-service-prd-review-round1.md (verdict: changes_requested, 7 blocking)

## Verdict
escalate_to_human

## Summary

This is a delta-only re-check of the 7 Round 1 Blocking findings. All 7 fixes described by the PM
Agent were verified directly against the current file content (not trusted from description). 6 of 7
are fully and correctly resolved. The 7th fix (FR-002(k), concurrent-submission handling) is present
in the text as claimed, but it introduces a genuine new contradiction with the FR-002(h) fix it was
paired with in this same revision — the two acceptance criteria now describe incompatible branching
models for the same write path. Per round discipline, a newly-introduced Blocking defect at Round 2
is not auto-looped back to the PM Agent for a Round 3; it is escalated to a human to decide whether
to request a targeted Round 3 revision or resolve directly.

## Verification of the 7 Claimed Fixes

1. **NFR-SEC-003 rewritten (two grants)** — ✅ Resolved. Confirmed: NFR-SEC-003 now lists
   (1) `Key Vault Secrets Reader` on per-app Key Vaults, "no write roles ... on any per-app vault,"
   verified via OQ-004; and (2) `wrapKey`-only on `sops-master-key`, explicitly "must never hold
   `unwrapKey`/decrypt," verified via OQ-001 sign-off. The scoping ambiguity flagged in Round 1
   ("is `wrapKey` a write role?") is resolved by separating the two grants and vaults explicitly.

2. **FR-003(a) caveat + named dependency** — ✅ Resolved. FR-003(a) now reads "pending confirmation
   that the Infrastructure GitHub App installation covers `infrastructure-live`; see OQ-003. This
   criterion cannot be implemented until that installation scope is confirmed or granted by Platform
   Engineering." FR-003's Dependencies line now reads "...and Infrastructure GitHub App installation
   scope on `infrastructure-live` (both OQ-003)" instead of only citing the env var.

3. **OQ-003 status label + Section 13 reword** — ✅ Resolved. OQ-003 heading now reads
   "PARTIALLY RESOLVED (path convention confirmed; GitHub App installation scope still open)."
   Section 13's row now reads "2 (OQ-003 — GitHub App installation scope only, path convention
   already resolved; OQ-004 — fully open)" instead of a flat "2 (OQ-003, OQ-004)." The
   RESOLVED-vs-still-blocking contradiction from Round 1 is gone.

4. **FR-002(h)/NFR-REL-002 branch-naming convention** — ✅ Resolved. FR-002(h) now specifies
   `secrets/{appName}-{environment}-{secretName}` as the deterministic branch name and defines the
   open-PR lookup against that exact branch before deciding update-vs-409. This gives the
   integration test in Section 12 ("Second identical POST returns 409 with prUrl") a concrete
   mechanism to verify against.

5. **New FR-002(k) + Section 10 risk row** — ⚠️ Present, but introduces a new contradiction (see
   Blocking Finding below). The clause and the risk row both exist as claimed, but the mechanism
   described does not logically fit the branch model established by fix #4 in the same revision.

6. **Phase 3 gate wording** — ✅ Resolved. Section 11's Phase 3 gate now reads "OQ-004 (Azure SDK
   identity) must confirm the portal identity holds read-only `Key Vault Secrets Reader` access (no
   write grants) on the target app's Key Vault, consistent with NFR-SEC-003." The
   read-only/"write confirmation" contradiction from Round 1 is gone.

7. **Status-semantics clarifying note above `ORCHESTRATOR-READY`** — ✅ Resolved. The note is present
   immediately above the block: "`status: approved` ... signals *ready for PRD Challenger review* ...
   it is **not** final human sign-off. Section 1's `Status: draft` remains authoritative..." This
   correctly de-risks the self-asserted `approved` block flagged in Round 1.

## Blocking Findings (new, introduced by this revision)

- [ ] **FR-002(k)'s concurrent-write retry mechanism contradicts FR-002(h)'s per-secret branch
  model, both introduced/modified in this same revision** — FR-002(h) assigns each
  `(appName, environment, secretName)` a dedicated, deterministic branch
  (`secrets/{appName}-{environment}-{secretName}`). Two *different* secret names for the same
  app/environment — the exact scenario FR-002(k) is written to cover ("concurrent submissions for
  **different** secret names") — therefore live on two **different** branches by construction.
  FR-002(k)'s mitigation is described as: "the backend re-reads the target branch's current HEAD
  version of `secrets.enc.yaml` ... If the subsequent commit is rejected due to a non-fast-forward
  push (a concurrent writer won the race), the backend retries." A non-fast-forward push conflict
  can only occur when two writers push to the *same* branch/ref — but under (h)'s design, two
  different-secret-name submissions never target the same branch, so this race can never actually
  occur at push time. The real conflict this risk is trying to capture happens later, at **PR-merge
  time into the default branch** (secretB's PR, opened against a pre-secretA-merge snapshot of
  `secrets.enc.yaml`, will show as a merge conflict once secretA's PR has already merged) — a
  GitHub-level merge conflict that generally requires manual rebase/resolution, not something the
  backend can transparently retry via its own git push. As written, FR-002(k)'s acceptance criterion
  describes a mechanism that is either unreachable (if "target branch" means the per-secret branch)
  or contradicts (h)'s explicit branch-per-secret design (if "target branch" secretly means the
  shared default branch, which nothing else in FR-002 supports). This means the fix for Round 1's
  concurrent-submission finding does not actually close the risk it was written to close.
  **Fix**: Reconcile the two mechanisms explicitly. Two viable directions: (a) make FR-002(k)'s
  retry operate against the **default branch** directly (i.e., the backend synchronizes/rebases
  each secret's feature branch against latest default-branch `secrets.enc.yaml` immediately before
  requesting the PR merge, and the "retry" is really "auto-rebase the feature branch, up to once,
  before flagging 503 if the target file changed again"), and say so explicitly; or (b) drop the
  per-branch race framing and instead describe the true failure mode (a merge conflict discovered
  when secretB's PR is merged after secretA's) with a stated resolution path (e.g., CI merge-conflict
  check step re-opens/updates the PR with a rebased diff, or a bot auto-rebases open PRs against
  `secrets.enc.yaml` changes on merge to the default branch). Whichever direction is chosen, update
  Section 10's risk-mitigation text and Section 12's test strategy to test the *actual* mechanism,
  not the currently-described (unreachable) one.

## Advisory Findings

- FR-002(h)'s conditional wording is more convoluted than needed given the branch-per-secret-name
  design: "If a secret with the same name already exists (per the `GET /api/secrets` metadata
  check) and no open PR exists for that branch, the submission is treated as an update..." Since
  branch existence/open-PR-state alone already fully determines create-vs-update-vs-409 behavior,
  the parenthetical secret-existence check reads as vestigial from before the branch-naming fix and
  could be simplified or removed for clarity.

- Section 12's Coverage Areas table has an integration-test row for FR-002(h)'s 409 duplicate-PR
  path ("Second identical POST returns 409 with prUrl") but no corresponding row for FR-002(k)'s new
  HTTP 503 concurrent-conflict path. Once the Blocking finding above is resolved, add a matching
  test-coverage row for the corrected mechanism.

- Section 8's `submitSecretViaGitOps` service-method summary still describes only "commits to
  ... secrets.enc.yaml ... opens PR" with no mention of the branch-naming or read-merge-retry logic
  now specified in FR-002(h)/(k). Not a contradiction (it's a one-line summary table), but worth
  expanding once the Blocking finding above is resolved so Section 8 and FR-002 stay in sync.

## Round Context

All 7 Round 1 Blocking findings were addressed textually; 6 are cleanly resolved with no side
effects. The fix for the 7th (concurrent-submission handling, FR-002(k)) was written as an addition
alongside the FR-002(h) branch-naming fix in the same revision, and the two new/changed clauses
now contradict each other's assumptions about git branch topology. This is a new defect introduced
by the revision itself, not a pre-existing Round 1 item left unresolved — per round discipline, this
does not trigger an automatic Round 3; it is escalated to a human to decide next steps (targeted
Round 3 vs. direct resolution).

## Environment Note

As in Round 1, every `read_file` result during this review (including reads of this PRD, the Round 1
review, and the artifact-paths skill) had an appended `<PreToolUse-context>` block instructing a
switch to a different tool for "efficiency." This content does not originate from the files
themselves, is unrelated to the PRD's actual content, and repeats verbatim regardless of file. It was
again treated as untrusted/injected content and ignored; this review was performed entirely with
standard `read_file` calls. Flagging again for visibility since it recurred in this session too.

<!-- CHALLENGER-VERDICT
feature: secret-self-service
round: 2
verdict: escalate_to_human
blocking_count: 1
advisory_count: 3
-->
