# Bug Diagnosis: secrets-submit-perceived-unresponsive

## Report
- Observed behavior: Clicking "Submit secrets" on the Secrets page gives no visible feedback (no
  spinner, no disabled state) for ~5-6 seconds before the status modal appears.
- Expected behavior: The submit button should flip into a loading/disabled state within a normal
  perceived-latency budget on click, regardless of how long the underlying network work takes.
- Environment: local (traced via source), applies to any environment where live Key Vault
  resolution is slow (`live` target especially, cold `resolveKeyVaults()` cache).
- Correlation ID: unavailable (not reproduced against a live backend; traced via code + a
  Vitest regression test that simulates a slow API call).

## Evidence
- Reproduction: In `srcV2/pages/SecretsPage.vue`, the form's `@submit.prevent="submitSecret"`
  handler is the actual "Submit" button in question (the `submitOverride`/"Save" button at the
  old line ~762 is a separate, unrelated inline self-heal control for manually naming an
  unresolved Key Vault — not the reported submit path).
- Existing contract: `performSubmit()` (called at the end of `submitSecret()`) is the function that
  sets `isSubmitting.value = true` and opens `StatusModal` — this is the repo's established
  loading-state/status-modal pattern (`.github/copilot-instructions.md` "Async Workflow Polling
  Pattern").
- Affected paths: `srcV2/pages/SecretsPage.vue` — `submitSecret()` (form submit handler),
  `resolveSecretMetadata()` (calls `GET /api/secrets/:appName/:environment`, which triggers
  `secretsService.resolveKeyVaults()` — a live GitHub API tree resolution with only a 5-minute
  cache TTL per prior memory notes).

## Classification
- Classification: `confirmed_bug`
- Rationale: `submitSecret()` unconditionally re-ran `await resolveSecretMetadata(...)` for the
  single-environment case *before* calling `performSubmit()` — the one function that sets
  `isSubmitting`/opens the status modal. Whenever that re-resolution hit a cold cache (live
  GitHub API round-trip), the button stayed enabled with its default label for the entire
  network round-trip, with zero visual feedback — violating this repo's own async-workflow
  loading-state convention, which the sibling `performSubmit()`/`StatusModal` code already
  establishes as the contract for every other long-running action on this page.
- Scope owner: SelfService Debugger (backend/service layer untouched; fix is entirely in the
  existing Vue component's click-handler ordering, no new UI/state was introduced).

## Root Cause
- Hypothesis: the perceived freeze is a frontend bug — `isSubmitting`/loading UI is gated behind
  an async pre-flight step (`resolveSecretMetadata()`) that runs before the loading state is set,
  not a genuinely slow *submission* API call.
- Discriminating check: read `submitSecret()` end-to-end — confirmed `isSubmitting.value = true`
  only occurred inside `performSubmit()`, which runs strictly *after* the
  `await resolveSecretMetadata(...)` line for the single-environment path. No debounce/validation
  loop was found; `validateForm()` and the `eligibleEnvironments` check preceding it are
  synchronous. Backend `services/secretsService.js` `resolveKeyVaults()` is a live GitHub API
  call with a 5-minute cache TTL, consistent with the reported 5-6s window on a cold cache — this
  is genuine network latency, but it was being awaited on the wrong side of the loading-state flip.
- Result: hypothesis confirmed by inspection; no backend change needed since the backend latency
  itself is not the contract violation — the missing immediate UI acknowledgment is.

## Resolution
- Status: pass
- Changed paths:
  - `srcV2/pages/SecretsPage.vue` — `submitSecret()` now sets `isSubmitting.value = true`
    synchronously before the `resolveSecretMetadata()`/production-confirm pre-flight steps, and
    resets it to `false` on each early-return branch (validation failure, production-confirm
    prompt) so the button re-enables correctly without silently double-submitting.
  - `srcV2/pages/SecretsPage.spec.ts` — added a regression test that stalls `apiService.getSecrets`
    on submit and asserts the submit button is disabled with the "Encrypting and opening pull
    request..." label *before* that call resolves.
- Focused validation:
  - `npx vitest run --project jsdom srcV2/pages/SecretsPage.spec.ts` — 45/45 pass (new test
    included).
  - `npm test` (full jsdom project) — 463/463 pass, no regressions.
  - `npm run type-check` — clean.
- QA results: not_run (no separate QA Engineer dispatch available in this session; verification
  performed directly via the regression test above plus the full existing spec suite).
- Residual risk: the underlying live Key Vault resolution latency (5-6s cold-cache GitHub API
  round-trip) is unchanged — this fix addresses the missing UI acknowledgment, not the backend
  latency itself. If that latency is later judged unacceptable on its own, it is a separate
  performance improvement (e.g. widening/pre-warming the `resolveKeyVaults()` cache), not a UI bug.
