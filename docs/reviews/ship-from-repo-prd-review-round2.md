# PRD Challenger Review: ship-from-repo (Round 2)
Date: 2026-10-21
PRD: docs/prd/ship-from-repo.md
Round 1 review: docs/reviews/ship-from-repo-prd-review-round1.md

## Verdict
approved

Delta-only re-check of Round 1 Blocking items B-1..B-6, verified against the PRD body (not only the §15 revision log).
`node scripts/validate-delivery-contract.mjs prd` on the revised PRD returns `CONTINUE / PRD_VALID` (16 FR, 12 NFR).
Product-owner decisions (four-job split and runner placement, requester access check, first-repo ownership, `concurrency: ship-<app>`
plus ACR tag lock, self-chaining workflow with run-name lookup, Wiz policy e8ef1254 fail-closed, 15 s polling with cache) were treated as settled and not re-litigated.

## Blocking Findings
None.

## Advisory Findings
- **OQ-1 (CLUSTER_DNS_SUFFIX/scheme) is still open** — FR-010 / §10 / §14 — Correctly scoped to FR-010 only, and AC-010-2 is now testable because the host
  is config-driven with no `.k8s.com` literal. But the PRD metadata Status is `review` while the `ORCHESTRATOR-READY` marker says `status: approved` (the validator
  requires that value). The Orchestrator must treat OQ-1 closure by the Product Owner as a human gate before FR-010 acceptance and DoD, and must not read the marker as sign-off.
- **OQ-13 (Entra → verified GitHub login) gates FR-016** — AC-016-1 makes ships fail closed until a mapping exists, which is the safe default. The Architect must close
  this first, because without it nothing can ship.
- **OQ-18 / R10 (third simultaneous ship displaced by GitHub's concurrency group)** — AC-003-5 / AC-011-1 `SUPERSEDED` — Accepted and covered by a failure code. The Architect should
  confirm that the status API can distinguish "cancelled by GitHub displacement" from a user cancel; the §12 concurrency tests only cover two ships.
- **AC-013-5 wording** — it is labelled `should` but contains a `must` clause (navigate away without cancelling). Split it into two ACs for clean priority counting.
- **NFR-011 holds only for one replica or sticky routing** (OQ-17, stated in the PRD). Make sure the Architect spec carries the replica model as a test precondition.
- **Artifact channel from `build`** — NFR-005 matrix case (3) names artifacts, but the build VM's runtime artifact token can still write artifacts to its own run. Add a case
  to the hostile-repo test: the `build` job cannot alter the `prepare` source artifact or the `scan` and `publish` inputs, and later jobs consume only the expected artifact name plus the SHA-256.

## Round Context
Round 1 Blocking items:
- **B-1 Untrusted-code isolation — RESOLVED.** FR-004 splits `prepare` (trusted, `ubuntu-latest`) from `build` (GitHub-hosted, `permissions: {}`, no secrets/OIDC/environment, fresh VM,
  no checkout credential, timeouts and size caps) (AC-004-6/-7/-8). `scan` and `publish` run no user code (AC-006-1, AC-007-2). Provenance labels are re-applied by `publish`
  (AC-007-3). NFR-005 now has a named six-case negative-test matrix with a hostile-repo measurement.
- **B-2 Authorization — RESOLVED.** New FR-016: the requester's own GitHub access is checked at list time, ship time and again in `prepare` (AC-016-2). Ownership is bound to the
  first source repo through an ACR label, with a hard `APP_OWNED_BY_OTHER` rejection instead of warn-and-confirm (AC-016-3/-5). AC-001-2 filters the repo list, and AC-011-4 does not leak
  repo existence. OQ-13 and OQ-2 are explicitly non-blocking Architect decisions that fail closed.
- **B-3 Concurrency/races — RESOLVED.** Serialization is a workflow requirement (`concurrency: ship-<app>`, `cancel-in-progress: false`; AC-003-5, AC-007-7, NFR-008). ACR tag lock
  and `VERSION_COLLISION` without retry cover tag immutability (AC-005-7, AC-007-5). AC-008-6 forbids downgrading the PR tag. The §12 tests now have one expected outcome per scenario (no 409).
- **B-4 Orchestration/state/audit — RESOLVED.** The backend dispatches once and the workflow self-chains to `generate-webapp-config`, so it is restart-safe and independent of the browser (FR-003, FR-008). Lookup is by
  run-name/run ID, with no 10-run/60-min window (AC-013-3). Ownership comes from server-set `triggered_by` (AC-003-3, AC-013-6). `requireAuth` is added to the legacy route (AC-013-7).
  Audit scope is dispatched ships only, and retention equals GitHub's (AC-014-5/-6, NFR-007).
- **B-5 FR-010 contradiction / open questions — RESOLVED.** The FR-010 description and AC-010-2 now agree (config-driven `${CLUSTER_DNS_SUFFIX}`, no `.k8s.com`). The former Blocking-Yes OQs 2–9
  are closed or defaulted in A6 and the OQ table. Only OQ-1 remains blocking, scoped to FR-010 (see the first Advisory item). Status is reset to `review`.
- **B-6 NFR-011 arithmetic — RESOLVED.** Re-computed: the per-ship breakdown 15+5+80+10+50+5+35 = 200 calls, and 12 ships/h × 200 = 2 400 calls/h = 48% of 5 000. Single-flight caching means N viewers cost
  one call per refresh (AC-013-2, AC-009-1). Logs are fetched on demand only, the binding installation is named, and a rate-limit guard is defined.

New defects introduced by the revision: none blocking (see Advisory).

<!-- CHALLENGER-VERDICT
feature: ship-from-repo
round: 2
verdict: approved
blocking_count: 0
advisory_count: 6
-->
