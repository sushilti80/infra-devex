# PRD Challenger Review: secrets-environment-scope (Round 1)
Date: 2026-08-08
PRD: docs/prd/secrets-environment-scope.md

## Verdict
changes_requested

## Blocking Findings

- [ ] **FR-005(c) error-code enumeration is not exhaustive against its own cited source** —
  FR-005(c) states the fan-out `results[].errorCode` "reuses the existing single-environment error
  codes unchanged" and lists 8 codes (`FOUND_FALSE`, `VAULT_AMBIGUOUS`, `VAULT_INVALID`,
  `QUALIFIER_AMBIGUOUS`, `QUALIFIER_MISMATCH`, `PR_EXISTS`, `CONFLICT`, `ENCRYPTION_FAILED`). The
  actual `statusByCode` map in [routes/api.js](../../routes/api.js) (`POST /api/secrets` handler)
  has 9 entries — it also includes `SOPS_NOT_CONFIGURED: 503`, which the PRD omits. An Architect
  building the per-environment result-assembly logic from this list verbatim will under-handle a
  real, already-shipped failure mode (SOPS misconfiguration) in the new fan-out path. **Fix**: add
  `SOPS_NOT_CONFIGURED` to the FR-005(c) list (and to the FR-005(b) "all fail" status-selection
  example if relevant), or state explicitly why it's excluded from the fan-out contract.

- [ ] **NFR-PERF-001 is not a fixed, testable target as written — it self-contradicts on whether
  concurrency is decided** — The NFR states "this concurrency requirement is an explicit part of
  this NFR, not an implementation detail left open," then in the same paragraph adds "If concurrent
  execution is infeasible (e.g., GitHub secondary rate limits), the confirmed 10-environment cap...
  would need to be revisited as a follow-up decision **before this NFR's target is finalized**."
  That is precisely an implementation detail left open: QA cannot validate "p95 ≤ 15000 ms" as a
  Definition-of-Done gate (§11) when the paragraph itself says the target isn't finalized pending an
  architecture decision. **Fix**: either (a) commit now to concurrent per-environment execution as a
  hard requirement and drop the escape-hatch sentence, or (b) mark the specific p95 number as
  provisional/pending-Architect-spike and remove it from "Definition of Done — all NFR measurable
  targets validated by QA" until it's confirmed feasible.

- [ ] **OQ-005 status contradicts the Non-Goals section and FR-004(e)** — The Non-Goals section
  states as a settled decision: "Automatic retry of failed environments within a fan-out batch... A
  failed environment surfaces its error to the developer, who resubmits manually... See OQ-005."
  FR-004(e) is written consistently with that (each environment's outcome is just captured and
  returned). But OQ-005 itself is listed under "Open Questions" with status **Open** and says
  "confirm before Architect phase locks the UI's error-recovery flow" — i.e., undecided, and the
  Architect phase is the very next step after this review. The PRD cannot simultaneously treat
  manual-resubmission-only as a shipped Non-Goal decision and as a question still awaiting
  stakeholder sign-off. **Fix**: either mark OQ-005 "Resolved — manual resubmission confirmed for
  v1" (consistent with the Non-Goals wording) so the Architect has a firm mandate, or, if it's
  genuinely still undecided, soften the Non-Goals bullet to "tentative default, pending OQ-005" and
  flag FR-004(e)/FR-005(d)'s UI implications as provisional too.

- [ ] **FR-007's "new-feature" classification evidence omits the closest existing precedent** —
  Evidence Table row 9 and the Classification Matrix justify FR-007 as `new-feature` by asserting
  "No reusable confirmation-dialog component exists in `srcV2/components/` today," citing only the
  native browser `confirm()` in `InstalledAppsPage.vue` (line 99). That's true narrowly (no
  *extracted, reusable* component), but it omits a much closer precedent already in the codebase:
  [srcV2/components/infrastructure/AppSelector.vue](../../srcV2/components/infrastructure/AppSelector.vue)
  already implements a working confirm/cancel modal pattern (`showConfirmDialog` ref,
  `data-testid="confirm-overwrite-dialog"`, `aria-modal="true"`, explicit Yes/Cancel actions) for its
  own "overwrite existing form data" safeguard — functionally the same shape FR-007 needs. This
  affects both the classification (arguably `existing-extend` — adapt `AppSelector.vue`'s dialog
  pattern — rather than `new-feature` built from scratch) and the effort/complexity the Architect
  will estimate for FR-007. **Fix**: cite `AppSelector.vue`'s existing confirm-dialog pattern in the
  Evidence Table and either reclassify FR-007 or explicitly justify why that pattern isn't reused
  (e.g., it's inline/non-extracted, different trigger conditions, etc.).

## Advisory Findings

- Test Strategy file-path citations don't match the repo for two entries: `services/secretsService.spec.ts`
  (cited in the Unit Tests table and referenced implicitly by FR-001/003/005/006 coverage rows) does
  not exist — the real files are `srcV2/services/secretsService.spec.ts` and
  `tests/integration/service/secretsService.spec.ts`. Likewise `tests/integration/api/secrets.spec.ts`
  (cited in the Integration Tests table and in FR-006(d)) does not exist — the only `secrets.spec.ts`
  in the repo is `tests/e2e/secrets.spec.ts` (Playwright E2E, not an integration-test suite). This
  won't block Architecture but will misdirect whoever picks up the Test and Validation Strategy
  during implementation. Fix the paths before dev/QA handoff.
- Success Metrics: "0 reported incidents of unintended prod-tier secret writes within 90 days" has
  no defined detection/reporting mechanism (who reports an "unintended" write, and how is intent
  distinguished from a deliberate one after the fact?). Consider tying this to a concrete signal
  (e.g., `confirmedProductionWrite: false` writes reaching a production tier — which per FR-007(b)
  can't happen anyway since the tier is derived from the same source) or drop it as unmeasurable.
- OQ-004 (richer tier taxonomy) is safe to leave open: FR-001(b)/(c)'s `unclassified`/"Other" bucket
  is a complete, self-consistent fallback design on its own, and the PRD already scopes OQ-004 as a
  future revisit, not a blocker for this release's FR-001 implementation. No action needed before
  Architect phase.
- FR-004(a)/(b): the existing `POST /api/secrets` validator chain uses `check('environment')` without
  `.optional()`, i.e., it's currently unconditionally required. FR-004(a)'s "exactly one of
  `environment` or `environments` must be present" implies this validator must become conditional,
  but the PRD doesn't call this out as an explicit implementation note for the Architect. Minor — the
  Architect will likely catch this when touching the route, but worth a one-line callout given how
  central this validator chain is to FR-006's backward-compatibility guarantee.

## Round Context
N/A — this is Round 1.

<!-- CHALLENGER-VERDICT
feature: secrets-environment-scope
round: 1
verdict: changes_requested
blocking_count: 4
advisory_count: 4
-->
