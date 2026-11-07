# PRD Challenger Review: secrets-app-selector-qualifiers (Round 1)
Date: 2026-08-12
PRD: docs/prd/secrets-app-selector-qualifiers.md

## Verdict
changes_requested

## Blocking Findings

- [ ] **FR-003 AC3 directly contradicts FR-003 AC4 against the actual test fixture** — FR-003 AC3 requires that selecting the bare `idm` root (no qualifier) show "only environments from entries with no `qualifier` field, not the union of all sub-apps' environments." But the cited "Bug 3 fix" test ([srcV2/pages/SecretsPage.spec.ts](../../srcV2/pages/SecretsPage.spec.ts#L483-L500)) uses a fixture where `cint` exists **only** via two qualified entries (`{name:'idm', environment:'cint', qualifier:'notif'}` and `{...qualifier:'autobk'}`) — there is no unqualified `idm`/`cint` entry. Under AC3's own filter rule, selecting bare `idm` (which is exactly the state this test is in, since `selectedQualifier` is never set and `loadApps()` auto-selects `apps.value[0].name` = `'idm'` with no qualifier) would make the `cint` checkbox disappear, breaking AC4's requirement that this exact test "continues to pass unchanged." Verified directly against the current component code (`filteredEnvironmentOptions`, `loadApps()`) and the live test file — this is not speculative. **Fix:** decide and state explicitly whether "no qualifier selected yet" (the initial/auto-selected state) and "explicitly root-only, no-qualifier" are the same filter state or two different ones. If they must differ, FR-002/FR-005 need an explicit third selector state (`unresolved` vs `root-only`) and AC3 must be reworded; if they're the same, the Bug-3-fix fixture/test needs a deliberate, called-out update (contradicting AC4's "unchanged" as currently written).

- [ ] **FR-001/FR-002 never specify how one native `<select v-model="selectedAppName">` can set two independent pieces of state (`selectedAppName` **and** `selectedQualifier`) synchronously from a single `@change` event** — the current template ([SecretsPage.vue L510-L512](../../srcV2/pages/SecretsPage.vue#L510-L512)) binds `v-model="selectedAppName"` directly, with `<option :value="name">` carrying only the flat app name string. FR-002's entire "single interaction" success metric (G2) depends on the change handler being able to recover *both* the root name and the qualifier from whatever the user picked, but no composite-value encoding, delimiter, or `v-model` rework is described anywhere in FR-001 or FR-002. Without this decided, "immediate qualifier set on Application-selector choice" (FR-002) cannot be implemented as literally stated. **Fix:** add a concrete mechanism to FR-001 (e.g., a composite option value such as `${name}::${qualifier ?? ''}`, or replace the direct `v-model` with a local selector ref plus a computed/watcher that splits the choice into `selectedAppName`/`selectedQualifier`), and reference that exact mechanism from FR-002.

- [ ] **`loadApps()`'s auto-select-first-app logic is untouched by FR-002/FR-005, and silently reintroduces the exact bug this PRD is meant to fix** — `loadApps()` ([SecretsPage.vue L176](../../srcV2/pages/SecretsPage.vue#L176)) runs `selectedAppName.value = apps.value[0].name` whenever no app is currently selected, but never reads or sets `apps.value[0].qualifier`. After FR-001 ships, `apps.value[0]` can easily be a qualified entry (as in the Bug-3-fix fixture, where the first entry has `qualifier: 'notif'`), leaving the page in an inconsistent state: `selectedAppName='idm'`, `selectedQualifier=''`, which is indistinguishable from "bare root selected" under FR-003's filter and reproduces environment leakage in the default/auto-selected state — the same class of bug this PRD sets out to close. This is directly entangled with the first finding above. **Fix:** FR-002 or FR-005 must explicitly state whether/how `loadApps()`'s auto-select also sets `selectedQualifier` from `apps.value[0].qualifier`, with an acceptance criterion covering the auto-selected (not just user-clicked) case.

- [ ] **Regression risk R2 is hedged, not resolved, and a concrete break exists that this review found** — R2 says existing tests asserting `appNames` as a flat array "if any beyond those already reviewed" may need updating, but only names two tests (Bug 3 fix, shared parent vault) as protected. The existing test "separates application and environment selection, scoped per app" ([SecretsPage.spec.ts](../../srcV2/pages/SecretsPage.spec.ts), asserting `appSelect.findAll('option[value="mlops"]')).toHaveLength(1)`) depends on the rendered `<option>`'s `value` attribute being the literal flat app-name string. If FR-001 requires a composite value to carry the qualifier (see finding above), this exact query breaks for every app, not just qualifier-bearing ones, unless FR-001 guarantees the no-qualifier case keeps `value="{name}"` verbatim. **Fix:** either add an explicit FR-001 acceptance criterion guaranteeing `option[value="{name}"]` stays queryable when an entry has no qualifier, or call out this test as a deliberate, listed change (not left to an implementer to discover).

## Advisory Findings

- NFR-005's validation ("no perceptible render delay in manual testing") is not objectively measurable — low risk given the small, bounded option count, but worth tightening if this PRD is reused as a template for future selector work.
- The codebase already has two different things both called "qualifier" in this file: `apps.value[].qualifier` (a per-entry field, this PRD's focus) and the `qualifiers` ref (an array populated from `resolveSecretMetadata()`'s API response, driving the existing FR-004 fallback selector). The PRD doesn't call out this naming collision; a short note distinguishing them would reduce implementer confusion, though FR-004 correctly states the fallback selector is unchanged.
- The Current State Assessment never mentions that environment selection is already a multi-select checkbox group (`selectedEnvironments: string[]`, from the already-shipped `secrets-environment-scope` feature), even though FR-005's ACs implicitly rely on "any previously selected environments" (plural). Stating this explicitly would make FR-005's scope clearer to an implementer encountering the file cold.

## Round Context
N/A — this is Round 1.

<!-- CHALLENGER-VERDICT
feature: secrets-app-selector-qualifiers
round: 1
verdict: changes_requested
blocking_count: 4
advisory_count: 3
-->
