# PRD Challenger Review: ship-from-repo (Round 4)
Date: 2026-10-21
PRD: docs/prd/ship-from-repo.md

Round 4 is a human-authorized, delta-only check of Round 3 Blocking items B-1..B-5 against the uncommitted
working-tree changes (`git diff -- docs/prd/ship-from-repo.md`). Product-owner decisions (remove "Update settings";
replace "My shipped apps" with browser-local "Recent ships"; fixed jargon label set) are accepted and not re-litigated.
Deterministic validator: `validate-delivery-contract.mjs prd` → `PRD_VALID` (FR 16, NFR 12).

## Verdict
escalate_to_human

## Blocking Findings
- [ ] **B-5 (residual) — AC-001-8 closed label set still contradicts AC-013-1 and AC-011-8** — AC-001-8 vs AC-013-1, AC-011-8 —
  AC-001-8 now says the main flow "uses only these user-facing labels: Build, Security check, Publish, Review PR, Preview, Version" and
  that "correlation ID" may appear only in Advanced / Details / Technical details, and is "testable by asserting the rendered text of the
  default (collapsed) views". But (1) AC-013-1 (unchanged) mandates the stage list "Queued → Prepare → Build → Scan → Publish → Config PR → Preview URL";
  **Prepare, Scan, Config PR, Queued** are not in the label set, so the AC-001-8 assertion fails against AC-013-1 as written; (2) AC-011-8 (unchanged)
  requires "every failure panel shows the correlation ID and a 'copy details' action", i.e. the correlation ID in the default failure view, which AC-001-8
  forbids. This is the same stage-name mapping and correlation-ID contradiction that Round 3 B-5 (1) called out; the rest of B-5 (Flux text in AC-012-2,
  AC-013-4 digest/image, AC-011-2 buildpack id, team label/environment placement, closed term location rule) is fixed.
  **Fix (two one-line edits):** in AC-013-1 add the mapping "Queued/Prepare → shown as part of **Build**'s pending state; Build → **Build**; Scan → **Security check**;
  Publish → **Publish**; Config PR → **Review PR**; Preview URL → **Preview**; the seven backend stage names appear only in **Details**", and in AC-011-8 change to
  "every failure panel has a **Details** toggle containing the correlation ID, and a 'copy details' action whose payload includes it".

## Advisory Findings
- **Round 3 "empty/loading/disabled page states"** — AC-001-7/-8 — Empty Recent ships list is covered (AC-015-3); a state for "no ship-enabled environment" (AC-002-1 yields zero environments) and page-loading is still unspecified. Add one line.
- **localStorage hygiene** — AC-015-1 — Key scoped to the Entra object ID and no tokens stored: acceptable. Entries contain repo and branch names (potentially private-repo names) that persist on a shared browser profile after sign-out; consider clearing on sign-out or stating this in Risks. Rendering of stored values must be escaped (treat as untrusted; localStorage can be edited) — and AC-015-2's status refresh relies on server-side AC-013-6 authorization, which correctly prevents tampered entries from leaking other users' ships.
- **Post-merge settings enforcement** — AC-012-3 — "Read-only" Advanced fields are UI-only; state that the server ignores port/health-path inputs for a post-merge re-ship (consistent with AC-012-2) so a crafted API call cannot imply a change.
- **Test coverage** — §11/§12 — No explicit test for Recent ships (cap 20, terminal status not re-fetched, 403/404 → "No longer available") or the AC-001-8 rendered-text assertion; add to the test strategy.
- **Stale revision-log row** — §15 — The "Product owner (post Round 2)" row still names "Update settings"/"My shipped apps"; harmless history, but annotate "superseded by Round 3".

## Round Context
Round 3 Blocking items:
- **B-1 (Update settings vs AC-008-6/AC-012-2/OQ-3): RESOLVED.** Feature removed; no "Update settings" text remains in the body (only the §15 history rows). AC-012-3 states settings are ship inputs; pre-merge changes go through the serialized **Ship new version** (FR-008, AC-008-6, `ship-<app>` concurrency); post-merge a re-ship keeps merged config, consistent with AC-012-2. Non-Goals records the exclusion.
- **B-2 (Update settings authorization/audit/failure/tests): RESOLVED.** Moot — there is no separate action; Ship new version passes through the existing FR-016/FR-013/FR-014/FR-011 paths.
- **B-3 (My shipped apps data source / identification): RESOLVED.** FR-015 rewritten as browser-local Recent ships (AC-015-1..-5) with a defined stored shape, no server-side listing or "created by this feature" predicate needed; per-entry status uses the authorized status endpoint (AC-013-6); cross-device list deferred to OQ-22. No contradiction with FR-016/AC-013-6; AC-015-1..-3 are objectively testable.
- **B-4 (list outside NFR-011/NFR-002 budget): RESOLVED.** NFR-011 now states 0 GitHub list calls and ≤ 1 cached status refresh per non-terminal entry (≤ 20) on page load; terminal entries are not re-fetched.
- **B-5 (AC-001-8 jargon/testability): PARTIALLY RESOLVED → still Blocking** — see finding above (AC-013-1 stage names, AC-011-8 correlation ID).

New defects introduced by the fixes: none beyond the B-5 residual and the advisories above.

Escalation: one Blocking item remains after Round 4 → `escalate_to_human`. The remaining fix is two small wording edits; the product owner may accept the PRD after PM applies them (no further automatic round).

<!-- CHALLENGER-VERDICT
feature: ship-from-repo
round: 4
verdict: escalate_to_human
blocking_count: 1
advisory_count: 5
-->
