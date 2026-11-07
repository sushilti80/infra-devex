# PRD: Edit Existing Infrastructure — UI Entry Point & Deep-Link Prefill

## 1. Title and Metadata

| Field        | Value                                                                  |
|--------------|------------------------------------------------------------------------|
| Feature Name | Edit Existing Infrastructure UI Path                                   |
| Author       | Product Manager Agent                                                  |
| Date         | 2026-06-03                                                             |
| Status       | `draft`                                                                |
| Stakeholders | Platform Engineering, DevOps Team, App Owners (Self-Service consumers) |
| Repository   | `Aya-DevOpsTeam/self-service-infra`                                    |

---

## 2. Problem Statement

### Current Pain

The `service-catalog-prefill` feature (v2.1.0 / PR #64) implemented the full data pipeline for
restoring an existing app's metadata into the Custom Infrastructure wizard:
`AppSelector.vue` → `getApplicationDetails()` → `handlePrefill()` → form populated.

However, **there is no UI path by which a user can discover or trigger this flow**.

The gap is two-fold:

1. **From Installed Apps**: The `InstalledAppsPage.vue` action toolbar per app row contains
   Promote, Label, Add Code Repo, and Delete — but **no "Edit" / "Modify Modules" button**.
   A user looking at their app has no affordance to update its infrastructure configuration.

2. **From Custom Infrastructure**: `AppSelector.vue` renders as a collapsible section labelled
   "Load from Existing App (optional)" at the top of Step 0. A user intending to **create new**
   infrastructure will not naturally expand this panel. A user intending to **edit existing** has
   no indication this page is the right place.

Additionally, `navigateToPage(pageId)` in `srcV2/stores/navigation.ts` accepts only a `PageId`
string — there is no mechanism to carry context (e.g., `appName`, `environment`) when navigating
to the Custom Infrastructure page from another page.

### Why Now

The prefill back-end is complete and tested (437 tests passing). Without a UI entry point,
the entire pipeline is invisible to end users. Shipping back-end capability without a discoverable
UI path delivers zero user value and creates technical debt (feature exists but no one uses it).

### Expected Business Value

- Users can self-serve infrastructure changes without raising a manual ticket.
- Reduces support load on the platform team for "can you add a module to my app?" requests.
- Completes the self-service loop: create → view → modify → delete, all within the catalog UI.

---

## 3. Goals and Non-Goals

### Goals

1. Add an **"Edit Infrastructure"** action button to each app row on `InstalledAppsPage.vue`.
2. When clicked, navigate to `CustomInfrastructurePage.vue` with the selected app **already
   pre-filled** — no manual selection required in `AppSelector`.
3. Extend the navigation store to carry a prefill context (appName + environment) when navigating
   to the `custom` page.
4. `CustomInfrastructurePage.vue` reads the navigation context on mount and auto-loads the app.
5. Clearly indicate to the user they are **editing existing** infrastructure, not creating new.

### Non-Goals

- Changes to the Terraform workflow or GitHub PR creation process (out of scope).
- In-place editing directly from the `InstalledAppsPage.vue` table (out of scope — use the
  existing wizard flow).
- Module deletion / removal from existing infrastructure (separate concern; deferred).
- Deep-linking via URL parameters / query strings (navigation store pattern is the existing
  convention; URL-based routing is a separate architectural decision).

---

## 4. Current State Assessment

| Area | What Exists Today | Gap |
|---|---|---|
| `InstalledAppsPage.vue` actions | Promote, Label, Add Code Repo, Delete | No "Edit" / "Modify" button |
| `navigation.ts` `navigateToPage()` | Accepts `PageId` only | Cannot carry `appName`/`environment` context |
| `CustomInfrastructurePage.vue` init | Blank wizard on mount | Does not read navigation context to auto-trigger AppSelector |
| `AppSelector.vue` | Collapsible "Load from Existing App" in Step 0 | Works correctly when triggered manually; not auto-triggered |
| `AppSelector` controlled expand | `isExpanded = ref(true)` — starts open | Needs programmatic load, not just open |
| `handlePrefill()` in Custom Infra | Populates form from `AppMetadata` | Correct; no changes needed |
| `prefillEnabled` feature flag | `VITE_ENABLE_CATALOG_PREFILL !== 'false'` | Works; must remain |

**File references:**
- `srcV2/pages/InstalledAppsPage.vue` — action buttons at lines ~420–440
- `srcV2/stores/navigation.ts` — `navigateToPage()` at line 15
- `srcV2/pages/CustomInfrastructurePage.vue` — `prefillEnabled`, `handlePrefill()` at lines 259–280
- `srcV2/components/infrastructure/AppSelector.vue` — `handleLoad()`, `isExpanded`

---

## 5. Requirement Classification Matrix

| Capability | Classification | Evidence | Proposed Action |
|---|---|---|---|
| "Edit" button on InstalledAppsPage | `new-feature` | No such button exists in lines 420–440 of InstalledAppsPage.vue | Add edit button to app row action toolbar |
| Navigation context passing | `existing-extend` | `navigateToPage(pageId)` exists; no context param | Add optional `context` param to `navigateToPage` and store `prefillContext` in navigation store |
| Auto-trigger AppSelector on mount | `existing-extend` | `AppSelector` present but never auto-loaded | Read navigation `prefillContext` in `onMounted` and call `handleLoad` programmatically |
| "Editing mode" banner / indicator | `new-feature` | No such indicator exists | Show a banner or page subtitle when the wizard is in edit mode (prefillContext present) |
| Auto-dismiss AppSelector after prefill | `existing-refine` | `isExpanded` stays open after prefill | Collapse `AppSelector` after successful auto-load to reduce visual noise |

---

## 6. Functional Requirements (FR)

### FR-001 — Edit Infrastructure Action Button
- **Description**: Each app row on `InstalledAppsPage.vue` MUST have an "Edit Infrastructure"
  action button in the existing action toolbar.
- **Priority**: `must`
- **Rationale**: Without this, no user can discover the edit flow from the most logical
  starting point.
- **Acceptance Criteria**:
  - [ ] An edit icon button (e.g., `fa-pencil-alt`) appears in the action column for every app row.
  - [ ] The button is labelled `title="Edit Infrastructure"` for accessibility.
  - [ ] Clicking the button navigates to the Custom Infrastructure page (page `'custom'`) AND
        passes `{ appName: app.name, environment: app.environment }` as prefill context.
  - [ ] The button is only visible when `prefillEnabled` resolves to `true`
        (i.e., `VITE_ENABLE_CATALOG_PREFILL !== 'false'`).
- **Dependencies**: FR-002 (navigation store context)

### FR-002 — Navigation Store Prefill Context
- **Description**: `navigateToPage()` in `srcV2/stores/navigation.ts` MUST accept an optional
  `prefillContext` object and store it for consumption by the target page.
- **Priority**: `must`
- **Rationale**: The navigation store is the established pattern for inter-page communication
  in this SPA. No alternative mechanism exists without adding URL routing.
- **Acceptance Criteria**:
  - [ ] `navigateToPage(page: PageId, context?: { appName: string; environment: string })` signature.
  - [ ] `prefillContext` ref is added to the store state.
  - [ ] Calling `navigateToPage('custom', { appName: 'myapp', environment: 'sand' })` sets
        `prefillContext.value = { appName: 'myapp', environment: 'sand' }`.
  - [ ] Calling `navigateToPage` without a context clears `prefillContext` to `null`.
  - [ ] `prefillContext` is exposed in the store's return object.
- **Dependencies**: None

### FR-003 — Auto-Load Prefill Context on Custom Infra Mount
- **Description**: `CustomInfrastructurePage.vue` MUST read `navigationStore.prefillContext` on
  `onMounted` and, if present, automatically trigger the AppSelector to load that app without
  requiring the user to manually select app/environment and click "Load".
- **Priority**: `must`
- **Rationale**: The value of the "Edit" button flow is zero if the user still has to manually
  interact with the AppSelector dropdown.
- **Acceptance Criteria**:
  - [ ] On mount, if `navigationStore.prefillContext` is non-null and `prefillEnabled` is `true`,
        `CustomInfrastructurePage` calls `getAppMetadata(appName, environment)` directly and
        invokes `handlePrefill(metadata)` with the result.
  - [ ] A loading indicator is shown during the auto-load.
  - [ ] If the auto-load fails (API error), an error banner is shown at the top of Step 0
        (reuse existing `step0Error` ref).
  - [ ] After consuming the context, `navigationStore.prefillContext` is cleared to `null` so
        navigating away and back does not re-trigger the auto-load.
  - [ ] The `AppSelector` collapsible panel is **collapsed** (not expanded) when auto-load
        completes successfully, since the data is already loaded.
- **Dependencies**: FR-002

### FR-004 — "Editing Existing App" Mode Indicator
- **Description**: When `CustomInfrastructurePage.vue` is entered via the edit path (prefill
  context present), the page MUST visually indicate to the user that they are modifying an
  existing app, not creating a new one.
- **Priority**: `must`
- **Rationale**: Without a mode indicator, users cannot distinguish "create new" from "edit
  existing", leading to confusion about whether clicking Deploy will overwrite or create.
- **Acceptance Criteria**:
  - [ ] A banner or subtitle is rendered below the page header reading:
        "Editing existing app: **{appName}** / **{environment}**".
  - [ ] The banner is only shown when `prefillContext` was present at mount time.
  - [ ] The banner includes a "Clear and start fresh" link/button that resets all form state and
        removes the editing-mode indicator.
- **Dependencies**: FR-003

### FR-005 — Prefill Feature-Flag Gate on Edit Button
- **Description**: The "Edit Infrastructure" button in `InstalledAppsPage.vue` MUST respect the
  same `VITE_ENABLE_CATALOG_PREFILL` feature flag as the `AppSelector`.
- **Priority**: `must`
- **Rationale**: Feature flag consistency — if prefill is disabled, the edit path must also be
  disabled to prevent a broken experience.
- **Acceptance Criteria**:
  - [ ] If `VITE_ENABLE_CATALOG_PREFILL === 'false'`, the Edit button does not render.
  - [ ] This is implemented as a computed prop in `InstalledAppsPage.vue` mirroring the
        pattern in `CustomInfrastructurePage.vue`.
- **Dependencies**: FR-001

### FR-006 — Accessibility and Keyboard Navigation
- **Description**: All new UI elements (Edit button, mode indicator banner, Clear link) MUST
  be accessible.
- **Priority**: `should`
- **Rationale**: Accessibility is a platform standard and part of WCAG 2.1 AA compliance.
- **Acceptance Criteria**:
  - [ ] Edit button has `aria-label="Edit infrastructure for {appName} in {environment}"`.
  - [ ] Mode indicator banner has `role="status"`.
  - [ ] "Clear and start fresh" is a focusable, keyboard-operable element.
  - [ ] All new elements pass axe-core accessibility checks in tests.
- **Dependencies**: FR-001, FR-004

---

## 7. Non-Functional Requirements (NFR)

### NFR-001 — Auto-Load Latency
- **Category**: Performance
- **Target**: The auto-load triggered by navigation context MUST complete (or show an error)
  within **5 seconds** of `CustomInfrastructurePage` mounting, matching the existing
  AppSelector manual load SLA.
- **Measurement**: Vitest mock timing; E2E test with Playwright `waitForSelector`.

### NFR-002 — No Regression on Manual AppSelector Flow
- **Category**: Reliability
- **Target**: The existing manual "Load from Existing App" flow (user opens collapsible,
  selects app/env, clicks Load) MUST continue to work without modification.
  Zero regression in existing AppSelector tests.
- **Measurement**: All existing `AppSelector.spec.ts` tests pass (green) after this change.

### NFR-003 — Navigation Store Backward Compatibility
- **Category**: Reliability
- **Target**: All existing callers of `navigateToPage(pageId)` (currently 8 call sites across
  `App.vue`, `InstalledAppsPage.vue`, `SharedHeader.spec.ts`) MUST continue to work without
  modification. The `context` param is strictly optional.
- **Measurement**: `npm test` passes; `npm run type-check` passes.

### NFR-004 — No Context Leak Between Sessions
- **Category**: Reliability
- **Target**: `prefillContext` in the navigation store MUST be cleared after it is consumed by
  `CustomInfrastructurePage` so that a subsequent manual navigation to `custom` does not
  accidentally re-trigger a prefill.
- **Measurement**: Test: navigate to custom with context → navigate away → navigate back
  manually → wizard starts blank.

### NFR-005 — Security: Input Validation on Auto-Load
- **Category**: Security / Compliance
- **Target**: `appName` and `environment` values carried in `prefillContext` MUST be validated
  before being sent to the API (alphanumeric, hyphens, underscores only; max 64 chars each).
  Reject and show error if invalid. Prevents injection of malformed values via the store.
- **Measurement**: Unit tests for validation function; invalid inputs produce `step0Error`,
  not an API call.

### NFR-006 — Feature Flag Propagation Consistency
- **Category**: Usability
- **Target**: `VITE_ENABLE_CATALOG_PREFILL` flag evaluation MUST produce identical results in
  both `InstalledAppsPage.vue` and `CustomInfrastructurePage.vue`. The edit button MUST NOT
  appear if the AppSelector would be hidden.
- **Measurement**: Test both components with flag set to `'false'`; neither the button nor
  the AppSelector render.

### NFR-007 — Correlation ID for Auto-Load API Call
- **Category**: Observability
- **Target**: The auto-load `getAppMetadata` call from navigation context MUST include a
  correlation ID in the request, consistent with platform logging standards.
- **Measurement**: Inspect network request in integration test; correlationId header present.

### NFR-008 — TypeScript Type Safety
- **Category**: Maintainability
- **Target**: `prefillContext` store state and `navigateToPage` signature MUST be fully typed
  in TypeScript. No `any` types introduced. `npm run type-check` returns 0 errors.
- **Measurement**: `npm run type-check` exit code 0.

---

## 8. API and Data Impact

| Concern | Detail |
|---|---|
| New API endpoint | None. Reuses existing `GET /api/app-metadata/:appName/:env` (implemented in v2.1.0). |
| Data contract | No changes. `AppMetadata` type is already complete. |
| Backward compatibility | Full. Only UI layer changes; no backend modifications. |
| Feature flag | `VITE_ENABLE_CATALOG_PREFILL` already in use; no new env vars required. |

---

## 9. UX and Workflow Impact

### User Journey: Edit Existing Infrastructure

```
[Installed Apps page]
  User sees their app row
  → Clicks "Edit Infrastructure" (pencil icon) button   ← NEW
  → Navigates to Custom Infrastructure page
  → Banner: "Editing existing app: myapp / sand"        ← NEW
  → Form auto-populated with existing modules + RBAC    ← auto-trigger (NEW)
  → User modifies configuration (adds/removes modules)
  → Clicks "Deploy"
  → Status modal shows workflow progress
  → Metadata in service-catalog updated
```

### Before / After Summary

| Touchpoint | Before | After |
|---|---|---|
| InstalledAppsPage app row | No edit affordance | Edit button (pencil) visible |
| Custom Infra page entry | Always blank wizard | Shows editing banner + pre-filled when entered via Edit |
| AppSelector | Requires manual app+env select + "Load" click | Auto-loads when entered via Edit button |
| Mode clarity | None | "Editing existing app: X / Y" banner |

### Error Handling

- Auto-load API failure → `step0Error` banner in Step 0: "Failed to load app data for {appName}/{environment}. You can select it manually below."
- AppSelector remains expanded and functional as fallback.
- Invalid `prefillContext` values → error banner, no API call, AppSelector available for manual use.

---

## 10. Risks, Assumptions, Open Questions

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| User accidentally overwrites prod config | Medium | High | FR-004 editing mode banner makes intent explicit; existing Deploy step confirmation remains |
| `prefillContext` persists unexpectedly | Low | Medium | NFR-004: context cleared immediately after consumption in `onMounted` |
| Feature flag inconsistency between pages | Low | Medium | NFR-006: shared computed pattern; covered by tests |

### Assumptions

- A1: The navigation store (Pinia) is the correct inter-page communication mechanism (consistent
  with existing `navigateToPage` usage pattern; URL routing not yet adopted).
- A2: `VITE_ENABLE_CATALOG_PREFILL` is `true` in all non-production environments by default.
- A3: The "Edit" button should not appear for apps that are in a terminal lifecycle state
  (e.g., `deleted`). Current `InstalledAppsPage` only shows active apps; no extra guard needed.

### Open Questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| OQ-1 | Should clicking "Edit" for a production app (`lifecycle === 'production'`) require an additional confirmation or CR number (similar to Promote)? | Product / Platform Engineering | No — defer; start with uniform behavior |
| OQ-2 | Should the wizard skip Step 0 entirely and jump straight to Step 1 (Module Selection) when entered via edit path? | UX / Engineering | No — Step 0 with the editing banner provides context and the "Clear" escape hatch |
| OQ-3 | Should `prefillContext` be added to browser history / URL so back-button works? | Engineering | No — out of scope; existing SPA has no URL routing |

---

## 11. Delivery Plan

### Phase 1 — Navigation Store Extension (FR-002)
- Extend `navigateToPage()` with optional `context` parameter.
- Add `prefillContext` state to navigation store.
- Update TypeScript types.
- Tests: update existing `navigateToPage` tests; add context tests.

### Phase 2 — Installed Apps Edit Button (FR-001, FR-005)
- Add edit button to `InstalledAppsPage.vue` action toolbar.
- Wire to `navigateToPage('custom', { appName, environment })`.
- Respect `prefillEnabled` feature flag.
- Tests: render test; click test; feature-flag-off test.

### Phase 3 — Auto-Load on Mount (FR-003, NFR-001, NFR-004, NFR-005, NFR-007)
- `CustomInfrastructurePage.vue`: read `prefillContext` in `onMounted`.
- Validate `appName`/`environment` before API call.
- Call `getAppMetadata()` directly; invoke `handlePrefill()` on success.
- Clear `prefillContext` after consumption.
- Collapse `AppSelector` after successful auto-load.
- Tests: auto-load success; auto-load failure; context-cleared-after-load; invalid-context.

### Phase 4 — Editing Mode Indicator (FR-004, FR-006)
- Render "Editing existing app: X / Y" banner when editing.
- "Clear and start fresh" resets all form state.
- Accessibility attributes on all new elements.
- Tests: banner renders; banner absent in create mode; clear resets state.

### Definition of Done
- All FRs implemented and tested.
- `npm test` passes (no regression in existing 437 tests).
- `npm run type-check` passes (0 errors).
- Manual walkthrough: Installed Apps → Edit → wizard pre-filled → modify → Deploy confirmed.
- No `unknown-needs-discovery` items unresolved.

### Rollout
- Feature remains behind `VITE_ENABLE_CATALOG_PREFILL` flag (same as AppSelector).
- No database or API migrations required.
- Rollback: disable feature flag.

---

## 12. Test and Validation Strategy

| Area | Test Type | Target File |
|---|---|---|
| Navigation store context | Unit (Vitest) | `srcV2/stores/navigation.spec.ts` |
| Edit button renders | Component (vue-test-utils) | `srcV2/pages/InstalledAppsPage.spec.ts` |
| Edit button hidden when flag off | Component | `srcV2/pages/InstalledAppsPage.spec.ts` |
| Edit button click fires `navigateToPage` with context | Component | `srcV2/pages/InstalledAppsPage.spec.ts` |
| Auto-load on mount (success path) | Component | `srcV2/pages/CustomInfrastructurePage.prefill.spec.ts` |
| Auto-load on mount (failure path) | Component | `srcV2/pages/CustomInfrastructurePage.prefill.spec.ts` |
| Context cleared after mount | Component | `srcV2/pages/CustomInfrastructurePage.prefill.spec.ts` |
| Invalid prefill context rejected | Unit | `srcV2/pages/CustomInfrastructurePage.prefill.spec.ts` |
| Editing mode banner visible | Component | `srcV2/pages/CustomInfrastructurePage.prefill.spec.ts` |
| Editing mode banner absent (create path) | Component | `srcV2/pages/CustomInfrastructurePage.prefill.spec.ts` |
| Clear resets all form state | Component | `srcV2/pages/CustomInfrastructurePage.prefill.spec.ts` |
| Existing AppSelector manual flow (no regression) | Component | `srcV2/components/infrastructure/AppSelector.spec.ts` |
| Full E2E edit flow | E2E (Playwright) | `tests/e2e/edit-existing-infra.spec.ts` |

---

## 13. Summary Table

| Metric | Count |
|---|---|
| Total FRs | 6 |
| Total NFRs | 8 |
| `existing-refine` | 1 (AppSelector collapse after auto-load) |
| `existing-extend` | 2 (navigation store, auto-trigger AppSelector) |
| `new-feature` | 2 (Edit button, editing mode banner) |
| `unknown-needs-discovery` | 0 |

---

## 14. Next Decisions Needed

1. **OQ-1**: Should editing a production-lifecycle app require a CR number? Recommend deferring — document as a follow-up FR.
2. **Phase ordering**: Confirm Phase 1 (navigation store) must ship before Phase 2+3 or if all phases can be developed in parallel against a feature branch.
3. **Edit button label**: "Edit Infrastructure" (text) vs icon-only (`fa-pencil-alt` + tooltip) — confirm with UX/design preference. Recommend icon-only to match the existing action toolbar style (Promote, Delete are icon-only).

---

<!-- ORCHESTRATOR-READY
feature: edit-existing-infra-ui-path
prd_path: docs/prd/edit-existing-infra-ui-path.md
status: approved
fr_count: 6
nfr_count: 8
-->
