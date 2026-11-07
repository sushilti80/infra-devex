# Architecture Spec: Secrets Page — Application Selector Nested Qualifiers

- **Feature:** `secrets-app-selector-qualifiers`
- **Source PRD:** [docs/prd/secrets-app-selector-qualifiers.md](../prd/secrets-app-selector-qualifiers.md)
- **PRD Challenger verdict:** approved ([docs/reviews/secrets-app-selector-qualifiers-prd-review-round2.md](../reviews/secrets-app-selector-qualifiers-prd-review-round2.md))
- **Status:** ready_for_challenger
- **Last modified:** 2026-08-12

## 1. Context

The Secrets page's Application `<select>` is built from `apps.value.map(app => app.name)`, discarding the
`qualifier` field already returned by `extractAppEnvPairs()` (in [services/secretsService.js](../../services/secretsService.js#L289)).
A nested sub-app (IDM's `autobk`, `notif`, `idmprtl`, `allctmpr`, or `ayaApplications`/`ayaCoreServices`) has no
direct dropdown entry — users must pick the root app, pick an environment, wait for an ambiguous vault-resolution
response, then use a second "Sub-application" selector. A related bug: `filteredEnvironmentOptions` filters by
`app.name` alone, so it shows the union of every sub-app's environments regardless of which sub-app the user
actually wants.

This is a frontend-only, single-file change (`srcV2/pages/SecretsPage.vue` + its spec) with **no backend or API
contract change** — `extractAppEnvPairs()` and `api.getSecrets(...qualifier)` already support qualifiers end to
end; this feature only changes how already-available client-side data drives the selector UI and the
environment-scoping filter.

## 2. Design

### 2.1 New client-side state and encoding

The Application `<select>` binds to a new local `selectorValue` ref (not `selectedAppName` directly) using a
composite value encoding so one native `@change` event can synchronously resolve both the app name and the
qualifier:

| Root app shape | Rendered option(s) | Option value |
|---|---|---|
| No entry has a `qualifier` (e.g. `mlops`, `webapp01`) | One flat option | `"{name}"` (unchanged from today) |
| At least one qualified entry, no unqualified entry (e.g. `ayaApplications`) | One option per distinct qualifier, in an `<optgroup :label="name">` | `"{name}::{qualifier}"` |
| Mixed qualified + unqualified entries (e.g. `idm`) | One option per qualifier **plus** one root-only option, all in one `<optgroup>` | `"{name}::{qualifier}"` and `"{name}::"` |

The `::` delimiter is safe because app/qualifier names are constrained to `^[a-zA-Z0-9_-]{1,64}$` (see
[services/secretsService.js](../../services/secretsService.js) validation, confirmed in repo history) — neither
can contain `::`.

### 2.2 Qualifier state machine

A new `isRootOnlySelected` boolean ref, alongside the existing `selectedQualifier` ref, tracks three states:

```mermaid
stateDiagram-v2
    [*] --> unresolved: loadApps() auto-selects first app name only
    unresolved --> qualified: user picks "{name}::{qualifier}"
    unresolved --> root_only: user picks "{name}::"
    unresolved --> unresolved: user picks flat "{name}"
    qualified --> qualified: user picks a different "{name}::{qualifier}"
    qualified --> root_only: user picks "{name}::"
    qualified --> unresolved: user picks a different flat "{name}"
    root_only --> qualified: user picks "{name}::{qualifier}"
    root_only --> unresolved: user picks a different flat "{name}"
```

- **unresolved**: `selectedQualifier = ''`, `isRootOnlySelected = false` — today's default/auto-selected state;
  `filteredEnvironmentOptions` keeps its current behavior (union by `app.name` only). This exemption is required
  so the existing "Bug 3 fix" dedup test keeps passing unchanged.
- **root-only**: `selectedQualifier = ''`, `isRootOnlySelected = true` — environments filtered to entries with no
  `qualifier`.
- **qualified**: `selectedQualifier = '<value>'`, `isRootOnlySelected = false` — environments filtered to
  `app.name === selectedAppName && app.qualifier === selectedQualifier`.

### 2.3 Environment scoping flow

```mermaid
flowchart TD
    A[User changes Application selector] --> B{Composite value?}
    B -- flat "name" --> C[selectedAppName = name; unresolved state]
    B -- "name::qualifier" --> D[selectedAppName = name; selectedQualifier = qualifier; qualified state]
    B -- "name::" --> E[selectedAppName = name; selectedQualifier = ''; isRootOnlySelected = true; root-only state]
    C --> F[Reset environments/vaults/qualifier state]
    D --> F
    E --> F
    F --> G[filteredEnvironmentOptions recomputed per state rules 2.2]
```

### 2.4 Retained fallback

The existing "Sub-application" `<select>` (rendered when `qualifiers.length > 1`) is unchanged. It remains the
safety net for any residual ambiguity `resolveSecretMetadata()` still returns after a qualifier is pre-selected
via 2.2 — this covers cases outside a single qualifier→single-vault mapping.

### 2.5 Multi-environment eligibility path must also receive the qualifier

`resolveEnvironmentEligibility(environment)` — the per-environment resolution path used whenever
`selectedEnvironments.length > 1` (fan-out submissions) — currently calls
`api.getSecrets(selectedApp.value.name, environment, target.value)` **without** a qualifier argument, unlike
`resolveSecretMetadata()` (the single-environment path). Once a qualifier is pre-selected via the grouped
selector (2.2/2.3), omitting it here means the backend still sees the request as ambiguous whenever the root
app has more than one qualifier, so it returns the full qualifier list and every environment is marked
`excluded — "Multiple sub-applications found; submit individually."` — defeating FR-003's goal for exactly the
fan-out workflow this PRD targets. Fix: `resolveEnvironmentEligibility()` must pass
`selectedQualifier.value || undefined` as the fourth argument to `api.getSecrets(...)`, mirroring
`resolveSecretMetadata()`. In the `root-only` state (`isRootOnlySelected === true`), it must pass `undefined`
and rely on `vaultCount === 1 && qualifierCount <= 1` exactly as today (an unqualified selection with a single
resolvable vault is already eligible; no special-casing needed).

### 2.6 Components touched

- `srcV2/pages/SecretsPage.vue` — modify: rebuild the Application selector's option list/markup, add
  `selectorValue`/`isRootOnlySelected` refs and the `@change` handler, extend `filteredEnvironmentOptions`'s
  filter predicate, extend `onAppNameChange()`/selection-reset logic, leave `loadApps()`'s auto-select behavior
  untouched (name-only, `unresolved` state); extend `resolveEnvironmentEligibility()` to pass
  `selectedQualifier.value || undefined` to `api.getSecrets(...)` per 2.5.
- `srcV2/pages/SecretsPage.spec.ts` — modify: add coverage for grouped `<optgroup>` rendering, synchronous
  qualifier resolution, environment-scoping by qualifier, root-only filtering, and state reset on
  qualifier/root switches; keep the two named existing tests (Bug 3 fix; shared-parent-vault-beside-nested)
  passing unchanged.

No other file changes — no backend, no API surface, no other Vue page or store.

## 3. Contracts

No API contract changes. `GET /api/secrets/apps` (`api.getSecretApps()`) and
`GET /api/secrets/:appName/:environment` (`api.getSecrets(appName, environment, target, vaultDir?, qualifier?)`)
are unchanged; both already return/accept `qualifier`. See `technical.data_contracts` in the companion
spec.json for the `AppOption` shape (unchanged) and the new local selector-state shape.

## 4. Testing

See `testing.functional_test_scenarios` and `testing.edge_cases` in spec.json for the full list, derived
directly from PRD FR-001 through FR-005 acceptance criteria, including a scenario covering the
`resolveEnvironmentEligibility()` qualifier fix (2.5): selecting `idm::autobk` then multi-selecting 2+
environments must not spuriously mark them `excluded` as ambiguous. Two existing named tests must keep passing
unchanged as regression guards:
- "deduplicates environments when an app has multiple qualifier entries for the same env (Bug 3 fix)"
  ([srcV2/pages/SecretsPage.spec.ts](../../srcV2/pages/SecretsPage.spec.ts#L484))
- "keeps a shared parent vault selectable beside a nested application vault"
  ([srcV2/pages/SecretsPage.spec.ts](../../srcV2/pages/SecretsPage.spec.ts#L502))

## 5. NFRs

See `nfrs` in spec.json — derived directly from PRD NFR-001 through NFR-005 (zero added network calls, 100%
spec-suite pass rate, no new client-to-server attack surface, single-interaction keyboard-accessible selection,
linear scaling with tens of `{name, qualifier}` pairs).

## 6. Out of Scope

Key Vault name resolution, override sidecar, metadata write-back, new backend endpoints, and the
"Sub-application" selector's visual redesign are explicitly out of scope, per the PRD's Non-Goals.
