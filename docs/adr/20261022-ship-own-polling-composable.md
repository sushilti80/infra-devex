# ADR: Ship From Repo Uses Its Own Polling Composable (Departure From the Status-Modal Pattern)

**Date**: 2026-10-22 | **Status**: Accepted pending PM confirmation (**H-8**) | **Feature**: `ship-from-repo`

## Context

`CLAUDE.md` states: "Long-running operations (provision, delete, AKS deploy) always go through the status-modal + polling
pattern — never block the UI waiting on a GitHub Actions run", implemented by `composables/useWorkflowPolling.ts` over the shared
`workflow` store (10 s default interval, `type='aks'` parses the legacy `{success,status}` shape via `api.getAKSStatus`).
PRD AC-013-2 says the page "uses `useWorkflowPolling` and the status modal pattern; the UI polls every 15 s".

Ship needs a different contract: 15 s cadence with exponential backoff (NFR-011 call budget), the typed `ShipStatus`
envelope (AC-003-2 forbids the legacy parser), a seven-stage view inline in a page (not a modal), Recent-ships rows refreshed
independently, and deep-link resume.

## Decision

Add `srcV2/composables/useShipPolling.ts` with the **same lifecycle contract** as `useWorkflowPolling` (interval registered
with the navigation store so it is cleaned up on navigation/unmount, stops on `terminal`) but its own cadence/backoff/types.
The pattern's *intent* — never block the UI on a run; poll to terminal; clean up on navigation — is preserved; only the shared
implementation and the modal presentation are not reused. The shared store and every other page are untouched.

## What is recorded as a deviation

- `CLAUDE.md` rule: "always go through the status-modal + polling pattern" → Ship satisfies "polling pattern", not "status modal" and not the shared composable.
- PRD AC-013-2 wording ("uses `useWorkflowPolling`") is not met literally. Traceability row AC-013-2 notes this.

## If H-8 is rejected by PM

Extend `useWorkflowPolling` with a typed strategy (interval, backoff, response adapter) and migrate `useShipPolling` onto it.
Impact: modifies a shared composable used by every existing page → full regression of FT for custom/template/AKS/delete pages;
estimated +1 sprint in Phase 3. The ship backend contract does not change.

## Consequences
Positive: no regression risk for existing pages. Negative: two polling implementations to maintain; mitigated by shared cleanup contract tests (FT-08).

## References
spec DD-6, §3.10.3, H-8, FT-08, AC-013-2 traceability row.
