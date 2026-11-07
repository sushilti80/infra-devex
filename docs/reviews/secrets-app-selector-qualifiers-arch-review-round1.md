# Architecture Challenger Review: secrets-app-selector-qualifiers (Round 1)
Date: 2026-08-12
Spec: docs/architecture/secrets-app-selector-qualifiers-spec.json
PRD:  docs/prd/secrets-app-selector-qualifiers.md

## Verdict
changes_requested

## Blocking Findings
- [ ] **Multi-environment eligibility path never receives the qualifier, silently defeating the feature's own goal for fan-out submissions** — component: `srcV2/pages/SecretsPage.vue` `resolveEnvironmentEligibility()` (traces to PRD FR-003/G3; not covered by any spec `flows`/`testing` entry). `resolveEnvironmentEligibility()` is the resolution path used whenever `selectedEnvironments.length > 1` (this page already supports up to `MAX_ENVIRONMENTS = 10` via the `secrets-environment-scope` feature). It calls `api.getSecrets(selectedApp.value.name, environment, target.value)` **without** the qualifier argument, unlike `resolveSecretMetadata()` (the single-environment path), which does pass `selectedQualifier.value || undefined`. Per `routes/api.js` (~L242-253), when `qualifier` is omitted and the resolved vault paths have more than one sub-app qualifier, the backend throws a 422 `QUALIFIER_AMBIGUOUS` with the *full* qualifier list (e.g. all 4 IDM qualifiers). That response lands in `resolveEnvironmentEligibility()`'s `catch` block, which only inspects `responseData.vaults.length` (not `qualifiers`) and falls through to `excluded` with a generic error. Net effect: after this feature ships, a user who explicitly picks `idm::autobk` from the new grouped selector and then multi-selects 2+ environments will still see **every** environment marked "excluded — Multiple sub-applications found; submit individually," exactly as if no qualifier had ever been chosen. This directly contradicts FR-003's stated goal ("Environment selector never shows an environment that does not belong to the selected app+qualifier combination") for the one workflow (multi-environment fan-out) where the friction this PRD is trying to remove matters most. The spec's Design (§2.1-2.5), Flows, `testing.functional_test_scenarios`, and `error_scenarios` all reference only the single-environment `resolveSecretMetadata()`/`watch(selectedQualifier)` path and never once mention `resolveEnvironmentEligibility()` — so this is neither fixed nor documented as an accepted limitation.
  - Suggested fix: either (a) extend `resolveEnvironmentEligibility()` to pass `selectedQualifier.value || undefined` (and treat `isRootOnlySelected` appropriately) to `api.getSecrets(...)`, mirroring `resolveSecretMetadata()`, and add a design/flow note plus a test scenario covering "select `idm::autobk`, select 2+ environments, verify none are spuriously excluded as ambiguous"; or (b) if deferring this is intentional, add it to PRD §3 Non-Goals and spec §6 Out of Scope with an explicit rationale, so QA doesn't file it as a regression and Dev doesn't need to guess.

## Advisory Findings
- The `::` composite-value delimiter's safety argument (spec.md §2.1: "app/qualifier names are constrained to `^[a-zA-Z0-9_-]{1,64}$`... see services/secretsService.js validation") conflates two different things: that regex (`QUALIFIER_RE` in `secretsService.js:55`, and the matching `express-validator` checks in `routes/api.js:206/210`) only validates **outbound** request params on `GET /api/secrets/:appName/:environment`. The data actually populating `apps.value` (and therefore the new selector's options) comes from `GET /api/secrets/apps` → `discoverAppsForTarget()`/`extractAppEnvPairs()`, which derives `appName`/`qualifier` directly from GitHub repo directory names with no regex enforcement at all. In practice this is very unlikely to matter (nobody names a service-catalog directory with `::`), but the spec should either reword the justification to rest on directory-naming convention rather than an inapplicable validator, or add a defensive skip/normalize step for any discovered entry whose name/qualifier contains `::`.
- Minor: spec.md §2.2's Mermaid state names use `root_only` (underscore) while prose elsewhere (and the PRD) consistently write `root-only` (hyphen) — purely cosmetic, but worth aligning so QA doesn't second-guess whether they're the same state.

## Round Context
N/A — Round 1.

<!-- ARCH-CHALLENGER-VERDICT
feature: secrets-app-selector-qualifiers
round: 1
verdict: changes_requested
blocking_count: 1
advisory_count: 2
-->
