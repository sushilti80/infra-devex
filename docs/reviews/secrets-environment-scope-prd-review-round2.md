# PRD Challenger Review: secrets-environment-scope (Round 2)
Date: 2026-08-08
PRD: docs/prd/secrets-environment-scope.md

## Verdict
approved

## Round Context

Delta-only re-check of the 4 Round 1 Blocking findings. All 4 are resolved; no new blocking defect
was introduced by the PM's revisions.

### 1. FR-005(c) error-code enumeration — **Resolved**
FR-005(c) (lines ~399–403) now lists the full 9-code set — `FOUND_FALSE`, `VAULT_AMBIGUOUS`,
`VAULT_INVALID`, `PR_EXISTS`, `CONFLICT`, `ENCRYPTION_FAILED`, `SOPS_NOT_CONFIGURED`,
`QUALIFIER_AMBIGUOUS`, `QUALIFIER_MISMATCH` — with a citation to `routes/api.js` lines 424–433 and an
explicit note on `SOPS_NOT_CONFIGURED`'s batch-wide (not per-environment) behavior. Verified against
the live `statusByCode` map in [routes/api.js](../../routes/api.js) (lines 424–433): all 9 codes and
their status values match exactly. (Minor, non-blocking: the map's closing `};` is actually on line
434, one past the cited range — not worth a finding on its own.)

### 2. NFR-PERF-001 self-contradiction — **Resolved**
The NFR (line ~492) now states plainly that concurrent execution is a hard requirement and the
15000 ms p95 target "is a Definition-of-Done gate (§11); it is not provisional or subject to
revisiting after a feasibility spike." The former escape-hatch sentence is reframed as a
scope/architecture escalation back to Product (potentially lowering the 10-environment cap) rather
than a relaxation of the target itself. This is consistent with the Risks table entry ("NFR-PERF-001
requires concurrent execution as a hard target; if a rate-limit constraint makes it infeasible... that
is an escalation to Product to lower the 10-environment cap... not a relaxation of the 15000 ms
target") and with §11's "All NFR measurable targets validated by QA" Definition of Done line — no
remaining contradiction.

### 3. OQ-005 status vs. Non-Goals/FR-004(e) — **Resolved**
OQ-005 (line ~738) now reads **Status: Resolved — manual resubmission confirmed as the v1 retry
model**, consistent with the Non-Goals bullet and FR-004(e). The Open Questions summary list (line
838) also reflects `~~OQ-005~~ — Resolved`. No remaining tension between a "settled" Non-Goal and an
"open" question.

### 4. FR-007 classification evidence — **Resolved**
The Evidence Table (row 9) and Classification Matrix now cite
[srcV2/components/infrastructure/AppSelector.vue](../../srcV2/components/infrastructure/AppSelector.vue)'s
existing `showConfirmDialog` ref / dialog markup (lines 144–172, 202) as the closest precedent,
verified present in the file at those lines (`showConfirmDialog` ref at line 202, dialog markup with
`data-testid="confirm-overwrite-dialog"` and `aria-modal="true"` at lines 146–150). FR-007(a) directs
the Architect to adapt this pattern rather than build one from scratch. The classification remains
`new-feature` (justified: `AppSelector.vue`'s dialog is inline/non-extracted, not a shared component
`SecretsPage.vue` can import as-is) rather than being reclassified to `existing-extend` — this was one
of the two acceptable fixes offered in Round 1 ("or explicitly justify why that pattern isn't reused"),
and the justification given is accurate and specific, not hand-waved. Resolved.

## Blocking Findings
None.

## Advisory Findings
None new. The Round 1 Advisory findings (Test Strategy file-path citations, Success Metrics
detection mechanism, OQ-004, FR-004 validator `.optional()` callout) were out of scope for this
delta-only round and were not blocking; carry them forward for the PM/Architect to address
opportunistically, but they do not affect this verdict.

<!-- CHALLENGER-VERDICT
feature: secrets-environment-scope
round: 2
verdict: approved
blocking_count: 0
advisory_count: 0
-->
