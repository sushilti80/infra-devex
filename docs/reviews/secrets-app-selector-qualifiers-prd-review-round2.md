# PRD Challenger Review: secrets-app-selector-qualifiers (Round 2)
Date: 2026-08-12
PRD: docs/prd/secrets-app-selector-qualifiers.md

## Verdict
approved

## Blocking Findings
None.

## Advisory Findings
None (delta-only round; Round 1 advisory items were not re-reviewed per scope).

## Round Context

All 4 Round 1 Blocking items resolved:

1. **FR-003 AC3/AC4 contradiction** — Resolved. PRD now defines three explicit qualifier states (`unresolved`, `root-only`, `qualified`) in FR-002. FR-003 AC3 applies only to an explicit `root-only` selection (`isRootOnlySelected === true`); AC4 explicitly ties the Bug-3-fix fixture to the `unresolved` (auto-selected) state, which keeps the old union-filter behavior. Verified against [SecretsPage.vue](../../srcV2/pages/SecretsPage.vue#L176-L177): `loadApps()` sets only `selectedAppName`, never a qualifier, so the fixture is provably only ever reached via `unresolved`, not `root-only`. No contradiction remains.

2. **No composite-value mechanism for the selector** — Resolved. FR-001 now specifies a concrete encoding: a local `selectorValue` ref bound to the `<select>`, composite option values `"{name}::{qualifier}"` (delimiter `::`), a flat `value="{name}"` for unqualified roots, and a `"{name}::"` root-only value where applicable (AC5). FR-002 describes the `@change` handler splitting on `::` to set `selectedAppName`/`selectedQualifier`/`isRootOnlySelected`. This is implementable as literally stated.

3. **`loadApps()` auto-select left unaddressed** — Resolved. FR-002 AC4 and FR-005 AC4 now explicitly state `loadApps()` sets `selectedAppName` only (unchanged) and must leave `isRootOnlySelected = false`, `selectedQualifier = ''` (the `unresolved` state) — with FR-002 AC4 requiring a spec assertion for this. Confirmed against current code ([SecretsPage.vue L176-L177](../../srcV2/pages/SecretsPage.vue#L176-L177)): `loadApps()` indeed only touches `selectedAppName.value`, so this requirement is consistent with, not a rewrite of, existing behavior.

4. **R2 regression risk hedged, not resolved** — Resolved. FR-001 AC2 now makes the flat-value guarantee an explicit, tested acceptance criterion (unqualified roots always render `value="{name}"` verbatim), and section 10's R2 is restated as "resolved rather than merely hedged" with that AC cited. This directly protects the existing `option[value="mlops"]`/`option[value="webapp01"]` assertions.

**New defects check:** Spot-checked the revised PRD's three-state model against actual fixture data in [SecretsPage.spec.ts](../../srcV2/pages/SecretsPage.spec.ts#L484-L502) (`idm` entries: two qualified `cint` rows + one unqualified `dev` row) and against `loadApps()`'s real implementation. The mixed-entry case is explicitly covered by FR-001 AC5 (root-only option rendered when a root has both qualified and unqualified entries), and the auto-selected/unresolved path matches current code exactly. No new contradiction or unimplementable requirement was introduced by the revision.

<!-- CHALLENGER-VERDICT
feature: secrets-app-selector-qualifiers
round: 2
verdict: approved
blocking_count: 0
advisory_count: 0
-->
