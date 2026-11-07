# Legacy learning evidence — debugger-agent

> Quarantined historical evidence migrated from `.github/agent-memory/debugger-agent/MEMORY.md`.
> This file is **not governing instruction**, is not an agent memory source, and must not be
> automatically loaded to control future behavior. When a historical observation is still useful,
> create a schema-shaped LearningRecord candidate with current repository evidence and evaluation
> instead of copying the instruction into an agent or skill.

## MEMORY.md

### Reusable Debugging Patterns

#### InstalledAppsPage: Invalid Dates / Edit Icon Visibility
- **Root causes**:
  - Invalid dates: `_normalizeAppDetails` returns `deployedAt: ""` when `createdAt`, `meta.deployed_at`, and `timestamp` are missing → `new Date("")` → Invalid Date.
  - Edit icon visibility: `selectedEnvironment` race condition with `envStore.enabledEnvironments` loading → defaults to specific environment, not `'all'`.
  - Template corruption: literal `\n` in template markup.
- **Reproduction**:
  - Invalid dates: mock `/api/installed-apps` with `deployedAt: ""`.
  - Edit icon: mount `InstalledAppsPage` before `envStore.environments` is populated.
- **Fix pattern**:
  - `formatDate`: return fallback for invalid dates.
  - Environment filter: `watch` on `envStore.enabledEnvironments.length` to reset to `'all'`.
  - Template: remove literal `\n`.
- **Handoff**:
  - Vue.js Developer: component and markup fixes.
  - QA: unit tests for `formatDate` fallback, environment filter race, template hygiene.

#### Effective Developer/QA Handoff
- **Debugger → Vue.js Developer**:
  - Provide diagnosis file with root cause, affected paths, and falsifiable checks.
  - Specify expected behavior and edge cases (e.g., empty string, race condition).
- **Vue.js Developer → QA**:
  - Provide updated component, spec file, and dev-status.json.
  - Highlight new tests and coverage.
- **QA → Debugger**:
  - Provide results.json with reproduction steps, verification, and status.
  - Include correlation IDs if applicable.

#### "Frozen button" perceived-unresponsiveness pattern (SecretsPage submit)
- **Root cause shape**: a click handler awaits a pre-flight async step (revalidation/re-resolution
  against a live backend call) *before* the line that flips the loading-state ref / opens the
  status modal, instead of after. The network call itself may be genuinely slow (e.g. cold-cache
  live GitHub API resolution) — that's not the bug; the bug is the ordering that leaves the
  loading-state flip on the wrong side of the await.
- **How to spot it fast**: grep the click handler for every `isSubmitting`/`isLoading` assignment
  and diff their line order against every `await` in the same function. If any `await` precedes
  the first `= true` assignment, that's the frozen window.
- **Fix pattern**: move the loading-state assignment to the top of the handler (before any await),
  and make sure every early-return branch after that point resets it — don't rely on a single
  `finally` further down if there are multiple `return`s in between.
- **Test pattern**: mock the pre-flight API call with a manually-resolved `new Promise(resolve => ...)`,
  trigger the submit, assert the button's disabled/label state *before* resolving the mock, then
  resolve and assert the real submission call fires.
