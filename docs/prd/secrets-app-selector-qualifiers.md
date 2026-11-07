# PRD: Secrets Page — Application Selector Nested Qualifiers

## 1. Title and Metadata
- **Feature name:** `secrets-app-selector-qualifiers`
- **Author/date:** Product Manager Agent, 2026-08-12
- **Status:** draft
- **Stakeholders:** Secrets-page users provisioning/rotating secrets for IDM (`autobk`, `notif`, `idmprtl`, `allctmpr`) and `ayaApplications` (`ayaCoreServices`); Vue.js Developer (implementation); QA Engineer (verification)
- **Source:** `docs/roadmaps/plan-layeredKeyVaultResolution.md`, section "Phase D — Application selector: surface nested qualifiers as first-class entries" (cited section only; rest of roadmap out of scope for this PRD)

## 2. Problem Statement

**Current pain:** The Secrets page's Application `<select>` is built from `apps.value.map(app => app.name)`, which discards the `qualifier` field that `secretsService.js`'s `extractAppEnvPairs()` already emits. As a result, a nested sub-app (e.g. IDM's `autobk`) has no direct entry in the dropdown — a user must pick "idm", pick an environment, wait for vault resolution to come back ambiguous, and only then does a second "Sub-application" selector appear. There is no way to go straight to "idm / autobk".

A second, related bug: `filteredEnvironmentOptions` filters by `app.name` alone, so it shows the **union** of every sub-app's environments under a root app. An environment that only `notif` has (not `autobk`) still appears as valid when "idm" is selected, regardless of which sub-app the user actually wants.

**Why now:** This is a parallel, independent UI/UX track (per the source plan, "no dependency on A/B/C") that can ship without waiting on the Key Vault name-resolution work. It directly reduces the friction users hit today reaching IDM/`ayaApplications` sub-apps.

**Expected business value:** Fewer clicks and round-trips to reach a known sub-app; elimination of a class of user error where an environment is selected that doesn't actually apply to the intended sub-app.

## 3. Goals, Success Metrics, and Non-Goals

**Goals:**
- G1: Every distinct `{appName, qualifier}` pair discoverable by `extractAppEnvPairs()` is directly selectable in the Application dropdown, without a disambiguation round-trip.
  - *Success metric:* 100% of known qualifier pairs (IDM's 4 sub-apps, `ayaApplications`/`ayaCoreServices`) appear as distinct, directly selectable options in `SecretsPage.spec.ts` coverage.
- G2: Selecting a grouped option resolves both app name and qualifier in a single interaction (no dependency on a vault-resolution response to learn the qualifier).
  - *Success metric:* `selectedQualifier` is non-empty immediately after the `@change` handler runs, verified by a synchronous assertion in a new spec test (no `await flushPromises()` for an API round-trip required to see the qualifier set).
- G3: The Environment selector never shows an environment that does not belong to the selected app+qualifier combination, once the user has made an explicit choice (see FR-003's `unresolved` vs `root-only` states).
  - *Success metric:* 0 environment-leakage cases across the existing IDM test fixtures (an environment unique to `notif` must not appear when `autobk`, or an explicitly-chosen bare `idm` root-only option, is selected). The initial/auto-selected `unresolved` state is explicitly exempt from this metric (see FR-003) to keep the existing "Bug 3 fix" test passing unchanged.

**Non-goals:**
- No change to Key Vault name resolution, override sidecar, or metadata write-back (Phases A/B/C of the source plan) — out of scope here.
- No new backend endpoint or `secretsService.js`/`routes/api.js` change — `extractAppEnvPairs()` already emits the qualifier field and `api.getSecrets()` already accepts a `qualifier` parameter.
- No redesign of the "Sub-application" selector's visual style — it stays as-is, used only as a fallback.
- No change to how vaults are resolved once an app+qualifier+environment combination is chosen (`resolveSecretMetadata()` internals are unchanged, only called with an earlier-known qualifier).

## 4. Current State Assessment

**What exists today (with file references):**
- [srcV2/pages/SecretsPage.vue](../../srcV2/pages/SecretsPage.vue#L84) — `appNames` computed collapses `apps.value` to deduplicated `app.name` only, discarding `qualifier`.
- [srcV2/pages/SecretsPage.vue](../../srcV2/pages/SecretsPage.vue#L87-L96) — `filteredEnvironmentOptions` filters by `app.name !== selectedAppName.value` alone; does not consider `app.qualifier`.
- [srcV2/pages/SecretsPage.vue](../../srcV2/pages/SecretsPage.vue#L270-L276) — `onAppNameChange()` resets environments/vault/qualifier state when the Application selector changes; does not currently set a qualifier from the selector itself.
- [srcV2/pages/SecretsPage.vue](../../srcV2/pages/SecretsPage.vue#L309-L316) — `watch(selectedQualifier, ...)` re-resolves vault metadata reactively, but only fires after `selectedQualifier` is set from a vault-resolution response (see `resolveSecretMetadata`, lines ~196-215), not from the Application selector directly.
- [srcV2/pages/SecretsPage.vue](../../srcV2/pages/SecretsPage.vue#L597-L603) — existing "Sub-application" `<select>` renders only when `qualifiers.length > 1`, populated from the `resolveSecretMetadata()` API response — this is the current (sole) path to reach a qualifier.
- [services/secretsService.js](../../services/secretsService.js#L289) — `extractAppEnvPairs()` already emits `{name, environment, qualifier}` tuples for every recognized vault path, including IDM sub-apps under `_idmapplications` and `ayaApplications`/`ayaCoreServices`. No backend change needed to obtain this data — it is already returned by `GET /api/secrets/apps` and stored in `apps.value`.
- [srcV2/services/api.ts](../../srcV2/services/api.ts#L120) — `api.getSecrets(appName, environment, target, vaultDir?, qualifier?)` already accepts and forwards `qualifier` in its query string. No signature change needed.
- [srcV2/pages/SecretsPage.spec.ts](../../srcV2/pages/SecretsPage.spec.ts#L484-L502) — existing "Bug 3 fix" test confirms environment dedup across multiple qualifiers for the same environment already works; this PRD's environment-scoping fix must not regress that test.

**Gaps and limitations:**
- The qualifier data is already present client-side (in `apps.value`) but is unused for both the Application selector's option list and the Environment selector's scoping filter.
- Reaching a sub-app requires an extra "unavailable/ambiguous vault" round-trip that today's tests (e.g. [srcV2/pages/SecretsPage.spec.ts](../../srcV2/pages/SecretsPage.spec.ts#L505-L530), "keeps a shared parent vault selectable beside a nested application vault") exercise as the *only* path — this PRD adds a faster path without removing that fallback.

## 5. Requirement Classification Matrix

| Capability | Classification | Evidence | Proposed action |
|---|---|---|---|
| Grouped Application dropdown (root app + qualifier options via `<optgroup>`) | `new-feature` | `appNames` computed today only emits flat `app.name` ([SecretsPage.vue L84](../../srcV2/pages/SecretsPage.vue#L84)); no grouping UI exists | Rebuild `appNames`/selector markup to group by root app, one option per qualifier (FR-001) |
| Immediate qualifier set on Application-selector choice | `existing-extend` | `selectedQualifier` state and its reactive `watch` already exist ([SecretsPage.vue L51](../../srcV2/pages/SecretsPage.vue#L51), [L309-L316](../../srcV2/pages/SecretsPage.vue#L309-L316)), but are only ever populated from a vault-resolution API response, never from the Application selector itself | Extend the Application selector's change handler to set `selectedQualifier` directly (FR-002) |
| Environment list scoped by app **and** qualifier | `existing-refine` | `filteredEnvironmentOptions` exists today and correctly scopes by `app.name`; the qualifier dimension is simply missing from its filter predicate ([SecretsPage.vue L87-L96](../../srcV2/pages/SecretsPage.vue#L87-L96)) | Add a qualifier-equality (or no-qualifier) condition to the existing filter (FR-003) |
| "Sub-application" fallback selector | `existing-refine` | Selector already implemented and gated on `qualifiers.length > 1` ([SecretsPage.vue L597-L603](../../srcV2/pages/SecretsPage.vue#L597-L603)) | Keep unchanged as a fallback; verify it still triggers correctly for any residual ambiguity (FR-004) |
| Downstream state reset on Application/qualifier change | `existing-refine` | `onAppNameChange()` already resets environments/vaults/qualifier ([SecretsPage.vue L270-L276](../../srcV2/pages/SecretsPage.vue#L270-L276)); needs to also account for a qualifier being set by the same interaction | Extend reset logic so a new grouped-option selection clears prior environment/vault selections consistently (FR-005) |

## 6. Functional Requirements (FR)

### FR-001: Grouped Application selector by root app and qualifier
- **Priority:** must
- **Rationale:** Directly exposes every known sub-app as a first-class, selectable entry instead of requiring a disambiguation round-trip.
- **Description:** The Application `<select>` is rebuilt from `apps.value` preserving the `qualifier` field, using a composite option-value encoding so a single native `@change` event can synchronously resolve both `selectedAppName` and `selectedQualifier` (no `v-model="selectedAppName"` direct binding). Rules:
  - For a root app name where **no** entry in `apps.value` has a `qualifier` (e.g. `mlops`, `webapp01`), render exactly one option with `value="{name}"` — byte-for-byte identical to today's flat value. This guarantees `option[value="{name}"]` queries in existing tests keep matching verbatim (resolves R2).
  - For a root app name with **at least one** qualified entry (e.g. `idm`), render one option per distinct qualifier using a composite value `"{name}::{qualifier}"` (delimiter `::`, not valid in app/qualifier names today), grouped under `<optgroup :label="name">`. If at least one entry for that root name also has no `qualifier` (e.g. the Bug-3-fix fixture's unqualified `idm`/`dev` entry), additionally render one root-only option with value `"{name}::"` inside the same optgroup. If every entry for that root name is qualified (no unqualified entry exists), no root-only option is rendered — only qualifier options.
  - The `<select>` binds to a local `selectorValue` ref (not `selectedAppName` directly); its `@change` handler splits on `::` to set `selectedAppName` and `selectedQualifier` (see FR-002 for the exact state transitions, including the `unresolved` vs `root-only` distinction).
- **Acceptance criteria:**
  - AC1: Given `apps.value` contains `idm` entries with qualifiers `autobk`, `notif`, `idmprtl`, `allctmpr`, the rendered `<select>` contains 4 distinct qualifier options under one `<optgroup label="idm">`.
  - AC2: Given `apps.value` contains a root app with no qualifier entries at all (e.g. `webapp01`), it renders as a single selectable option with `value="webapp01"` (flat, non-composite), and `option[value="webapp01"]` matches exactly once.
  - AC3: Given `ayaApplications`/`ayaCoreServices`, the qualifier option is directly selectable without first triggering an ambiguous-vault response.
  - AC4: No duplicate options are rendered for the same `{name, qualifier}` pair even if multiple environments share that pair (dedup preserved, consistent with existing "Bug 3 fix" test intent).
  - AC5: For a root name with a mix of qualified and unqualified entries (e.g. `idm`), a root-only option with value `"idm::"` is rendered in addition to the qualifier options. For a root name with only qualified entries, no root-only option is rendered.

### FR-002: Immediate app+qualifier resolution on selection
- **Priority:** must
- **Rationale:** Eliminates the round-trip through `resolveSecretMetadata()` before a user can proceed with a known sub-app.
- **Description:** The selector recognizes three distinct qualifier states, tracked via `selectedQualifier` (existing ref) plus a new `isRootOnlySelected` boolean ref:
  - **`unresolved`** (default/auto-selected state, `selectedQualifier = ''`, `isRootOnlySelected = false`): no explicit user choice has been made yet. This is exactly today's behavior and is what `loadApps()`'s auto-select-first-app logic produces (see FR-005) — it must NOT be treated as "root-only" by FR-003's filter.
  - **`root-only`** (`selectedQualifier = ''`, `isRootOnlySelected = true`): the user explicitly chose the composite `"{name}::"` option from FR-001.
  - **`qualified`** (`selectedQualifier = '<qualifier>'`, `isRootOnlySelected = false`): the user chose a `"{name}::{qualifier}"` option.
  Choosing a qualifier option sets `selectedAppName` and `selectedQualifier` synchronously in the selector's `@change` handler, without waiting for any API response. Choosing a root-only option sets `selectedQualifier = ''` and `isRootOnlySelected = true`. Choosing a flat (non-composite) option sets `selectedAppName` only, leaving both in their `unresolved` defaults.
- **Acceptance criteria:**
  - AC1: Immediately after the `<select>` `@change` event fires for a qualifier option, `selectedQualifier` reflects the chosen qualifier before any awaited API call resolves.
  - AC2: Selecting a root-only (`"{name}::"`) option sets `selectedQualifier = ''` and `isRootOnlySelected = true`.
  - AC3: The existing `watch(selectedQualifier, ...)` re-resolution behavior ([SecretsPage.vue L309-L316](../../srcV2/pages/SecretsPage.vue#L309-L316)) continues to fire correctly when the qualifier is set this way, for the single-environment case.
  - AC4: `loadApps()`'s auto-select-first-app logic (unchanged, sets `selectedAppName` only) leaves the selector in the `unresolved` state (`selectedQualifier = ''`, `isRootOnlySelected = false`), not `root-only` — verified by a spec assertion that after mount with the Bug-3-fix fixture, `isRootOnlySelected` is `false`.

### FR-003: Environment options scoped by app and qualifier
- **Priority:** must
- **Rationale:** Fixes environment leakage where an environment unique to one sub-app appears as valid for a sibling sub-app or an explicitly-chosen bare root, without breaking the auto-selected default state that the existing "Bug 3 fix" test exercises.
- **Description:** `filteredEnvironmentOptions` filters `apps.value` entries by `selectedAppName.value` plus the FR-002 qualifier state:
  - `qualified` state: `app.name === selectedAppName.value && app.qualifier === selectedQualifier.value`.
  - `root-only` state (`isRootOnlySelected === true`): `app.name === selectedAppName.value && !app.qualifier`.
  - `unresolved` state (`isRootOnlySelected === false && !selectedQualifier`, i.e. today's default/auto-selected state): filter by `app.name === selectedAppName.value` alone, unchanged from today — this is a deliberate exemption so the auto-selected state (before any explicit user choice) keeps showing the union of environments, exactly as it does today.
- **Acceptance criteria:**
  - AC1: Given IDM has an environment that only `notif` has (not `autobk`), selecting `idm / autobk` does not show that environment in the Environment selector.
  - AC2: Given IDM has an environment that only `notif` has, selecting `idm / notif` does show it.
  - AC3: Explicitly selecting the `"idm::"` root-only option shows only environments from entries with no `qualifier` field, not the union of all sub-apps' environments.
  - AC4: Existing "Bug 3 fix" dedup test ([SecretsPage.spec.ts L484-L502](../../srcV2/pages/SecretsPage.spec.ts#L484-L502)) continues to pass unchanged, because its fixture is only ever reached via `loadApps()`'s auto-select (the `unresolved` state per FR-002 AC4), never via an explicit root-only selection.

### FR-004: Sub-application fallback selector retained
- **Priority:** should
- **Rationale:** Some ambiguity may still surface post-selection (e.g. a qualifier resolving to more than one vault); the existing safety net must not be removed.
- **Description:** The "Sub-application" `<select>` (rendered when `qualifiers.length > 1`, per [SecretsPage.vue L597-L603](../../srcV2/pages/SecretsPage.vue#L597-L603)) remains in the template unchanged, continuing to function for any environment where `resolveSecretMetadata()` still returns multiple qualifiers after a qualifier was pre-selected via FR-002.
- **Acceptance criteria:**
  - AC1: The existing "keeps a shared parent vault selectable beside a nested application vault" test ([SecretsPage.spec.ts L505-L530](../../srcV2/pages/SecretsPage.spec.ts#L505-L530)) continues to pass unchanged.
  - AC2: No template or logic changes remove or disable the `qualifiers.length > 1` fallback path.

### FR-005: Downstream state reset on Application/qualifier selection change
- **Priority:** must
- **Rationale:** Prevents stale environment/vault/qualifier selections from a previous app from leaking into a newly selected app+qualifier pair.
- **Description:** Selecting a new grouped Application option (any change in `selectedAppName` or `selectedQualifier` triggered by the selector) resets `selectedEnvironments`, vault state (`vaults`, `selectedVaultDir`), and `qualifiers`/`selectedQualifier` (except for the qualifier just chosen by FR-002), matching the existing `onAppNameChange()` reset behavior.
- **Acceptance criteria:**
  - AC1: Switching from `idm / autobk` to `idm / notif` clears any previously selected environments that don't apply to `notif`.
  - AC2: Switching from `idm / autobk` to the bare `webapp01` root clears `selectedQualifier`, resets `isRootOnlySelected` to `false`, and clears any IDM-specific environment selections.
  - AC3: No regression in the existing `onAppNameChange` reset test coverage for target/app switching.
  - AC4: `loadApps()`'s auto-select-first-app logic sets `selectedAppName` only (unchanged) and does not set `isRootOnlySelected` or `selectedQualifier` from `apps.value[0].qualifier`, leaving the page in the `unresolved` state described in FR-002.

## 7. Non-Functional Requirements (NFR)

### NFR-001: Performance
- **Target:** The grouped selector introduces zero additional network requests. `api.getSecretApps()` call count per target load remains 1 (unchanged); `api.getSecrets()` is not called earlier or more often as a result of FR-001/FR-002 (it is only called once per selected environment, exactly as today).
- **Validation:** Assert mock call counts in `SecretsPage.spec.ts` before/after the change for an app-selection-only interaction (no environment selected yet).

### NFR-002: Reliability/Availability
- **Target:** 100% pass rate on the full existing `SecretsPage.spec.ts` suite plus new tests after the change; zero regressions in any other Vitest spec file.
- **Validation:** `npx vitest run --project jsdom srcV2/pages/SecretsPage.spec.ts` and `npm test` both green; `npm run type-check` clean.

### NFR-003: Security/Compliance
- **Target:** No new client-to-server attack surface introduced — the qualifier value sent via `api.getSecrets(..., qualifier)` continues to be one of the values already present in `apps.value` (server-sourced), never free-text user input. No new endpoint, no new input validation surface added.
- **Validation:** Code review confirms `selectedQualifier` is only ever set from `apps.value`-derived option values or existing API response fields, never a free-text field.

### NFR-004: Usability/Accessibility
- **Target:** Every `<optgroup>`/`<option>` pair remains reachable and selectable via keyboard-only navigation (native `<select>` semantics), consistent with WCAG 2.1 AA 2.1.1 (Keyboard). No qualifier option requires more than one selector interaction to choose (down from today's multi-step: pick app → pick environment → wait for ambiguity → pick sub-application).
- **Validation:** Manual keyboard-only pass on the rendered selector; spec assertion that a qualifier option's `value`/label is present and selectable via a single `setValue()`/`trigger('change')` call.

### NFR-005: Scalability
- **Target:** The grouped-option approach scales linearly with the number of distinct `{name, qualifier}` pairs returned by `GET /api/secrets/apps` (currently on the order of tens of entries); no pagination or virtualization is required at current or foreseeable data volumes (IDM's 4 sub-apps + `ayaApplications`'s 1 qualifier + flat root apps).
- **Validation:** Existing `apps.value` data volume observed in production is within native `<select>` rendering limits; no perceptible render delay in manual testing.

## 8. API and Data Impact

- **API endpoints impacted:** None. `GET /api/secrets/apps` and `GET /api/secrets/:appName/:environment` (via `api.getSecretApps()`/`api.getSecrets()`) are unchanged — both already return/accept `qualifier`.
- **Data contracts:** No change to the `AppOption` interface ([SecretsPage.vue L9-L14](../../srcV2/pages/SecretsPage.vue#L9-L14)) — `qualifier?: string` already exists; this feature only changes how existing data is consumed on the frontend.
- **Backward compatibility:** Fully backward compatible. Apps with no qualifier entries render identically to today (single flat option). No stored state, cache, or persisted format changes.

## 9. UX and Workflow Impact

- **User journey summary (before):** Select app "idm" → select environment → vault resolution returns ambiguous → "Sub-application" selector appears → select qualifier → vault re-resolves.
- **User journey summary (after):** Select "idm / autobk" directly from the grouped Application selector (qualifier known immediately) → select environment (already scoped to only environments valid for `autobk`) → vault resolves without a second disambiguation round-trip in the common case. The "Sub-application" selector still appears as a fallback only if ambiguity remains after the qualifier is known.
- **Status and error handling:** No change — existing `pageError`, `fieldErrors.selectedQualifier`, and vault-resolution error paths are unchanged; they simply trigger less often because the qualifier is known earlier.

## 10. Risks, Assumptions, Open Questions

**Risks:**
- R1: If two root apps happen to share an identical qualifier string (e.g. two different apps both had a `"shared"` qualifier), grouping by root app name in the `<optgroup>` label must still disambiguate correctly since the group is keyed by root name, not qualifier alone — low risk given `<optgroup>` scoping is per-root already.
- R2: Existing tests that assert on flat option values (e.g. `option[value="mlops"]`, `option[value="webapp01"]` in the "separates application and environment selection" test) depend on unqualified apps keeping a non-composite `value="{name}"`. FR-001 AC2 makes this an explicit, tested guarantee (only root names with at least one qualified entry get composite `"{name}::{qualifier}"` values), so this risk is resolved rather than merely hedged.

**Assumptions:**
- A1: `apps.value` (from `GET /api/secrets/apps`) already contains every qualifier pair needed; no backend enrichment is required (confirmed via [services/secretsService.js L289](../../services/secretsService.js#L289) code read).
- A2: The visual `<optgroup>` grouping is acceptable UX without a dedicated design review, since it uses native HTML5 select semantics already used elsewhere on this page.

**Open questions:**
- None blocking — this PRD is scoped entirely to code already read and confirmed in the source plan's "Confirmed gap (code read, 2026-08-12)" note.

## 11. Delivery Plan

- **Milestones:** Single-phase delivery — no sub-phases needed given the small, frontend-only surface area (`srcV2/pages/SecretsPage.vue` + `srcV2/pages/SecretsPage.spec.ts` only).
- **Definition of done:** All FR-001 through FR-005 acceptance criteria pass in `SecretsPage.spec.ts`; `npm test`, `npm run type-check` clean; no backend files touched.
- **Rollout:** Ships as part of the normal Vue SPA build (`npm run build:client`); no feature flag needed since behavior is strictly additive/corrective for existing users of the Secrets page.
- **Rollback:** Revert the single-file frontend change; no data migration or backend state to unwind.

## 12. Test and Validation Strategy

- **FR-001/FR-002:** New `SecretsPage.spec.ts` cases asserting grouped `<optgroup>` rendering for a fixture with multiple qualifiers per root, and that `selectedQualifier` is set synchronously on selection (per source plan step 7).
- **FR-003:** New test asserting an environment unique to one qualifier does not appear under a sibling qualifier or the bare root (per source plan step 7's "environment-list scoping fix" case).
- **FR-004:** Re-run existing "keeps a shared parent vault selectable beside a nested application vault" test unchanged — must still pass.
- **FR-005:** New/extended test asserting environment/vault state resets when switching between qualifier options and between qualifier and root-only options.
- **Required coverage areas:** `srcV2/pages/SecretsPage.spec.ts` (jsdom project) only; no smoke/integration/e2e test changes required since no backend or API contract changed.

---

## Summary

| Metric | Count |
|---|---|
| Total FR count | 5 |
| Total NFR count | 5 |
| `existing-refine` | 3 |
| `existing-extend` | 1 |
| `new-feature` | 1 |
| `unknown-needs-discovery` | 0 |

## Next Decisions Needed
- None blocking implementation start — proceed to PRD Challenger review.

<!-- ORCHESTRATOR-READY
feature: secrets-app-selector-qualifiers
prd_path: docs/prd/secrets-app-selector-qualifiers.md
status: approved
fr_count: 5
nfr_count: 5
-->
<!-- Revision note: Round 1 challenger blocking findings (unresolved/root-only qualifier state, composite selector value mechanism, loadApps() auto-select coverage, flat-value regression guarantee) resolved in FR-001, FR-002, FR-003, FR-005, and Risk R2. FR/NFR counts unchanged (5/5). -->
