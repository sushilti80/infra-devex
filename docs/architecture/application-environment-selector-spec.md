# Scoped UX Spec: application-environment-selector

Status: implemented (scoped change, no PRD/architecture pipeline required — pure UI decomposition of an
existing control, no API/data contract change).

## Problem
`SecretsPage.vue` rendered application and environment as one combined `<select>` with options
labeled `"{name} / {environment}"` under a single "Application and environment" label — hard to scan
and not consistent with the already-correct two-select pattern in `AppSelector.vue`.

## Acceptance criteria
- AC1: Application and environment are presented as two distinct labeled `<select>` controls.
- AC2: Environment select is disabled until an application is chosen, and its options are filtered to
  that application's environments only.
- AC3: Changing the application resets the environment selection (no stale app/env pairing).
- AC4: Changing either selection re-fetches secrets/vaults for the resulting app+environment pair
  (existing `watch` contract preserved).
- AC5: Initial page load auto-selects the first application and its environment and loads secrets,
  matching prior UX (no regression).
- AC6: No API contract change — same `getInstalledApps`/`getSecrets`/`submitSecret` signatures.
- AC7: Loading/empty/error states and accessible labels/ids are preserved.
- AC8: Layout does not increase vertical scroll on desktop (three fields fit the existing
  `md:grid-cols-3` row instead of a spanning combined field).

## Self-challenge (quick pass)
- Risk: mobile now stacks 3 fields instead of 2 → accepted, unavoidable for a genuine two-step
  selector and explicitly requested by the user; desktop height is unchanged.
- Risk: resetting environment on every app change could feel like extra clicks → mitigated by keeping
  the reset only on user-driven change (`@change` handler), not on the initial programmatic autoselect.
- No architecture/API impact → Architect/Challenger/QA/DevOps parallel phases are not required for this
  change; scope stays within Vue UI + tests per user's scope discipline.

## Implementation
- `srcV2/pages/SecretsPage.vue`: replaced `selectedAppKey` (combined `name::environment` string) with
  `selectedAppName` + `selectedEnvironment` refs, `appNames`/`filteredEnvironments` computeds, and an
  `onAppNameChange` reset handler. Template renders `#secret-app-name` and `#secret-app-env` selects.
- `srcV2/pages/SecretsPage.spec.ts`: added a test covering app-scoped environment options, the reset
  on app change, and the deferred fetch until both values are chosen.
- `srcV2/components/infrastructure/AppSelector.vue`: no change needed — already implements the
  two-select pattern this change now mirrors.
