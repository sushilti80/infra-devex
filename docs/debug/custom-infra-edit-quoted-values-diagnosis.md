# Bug Diagnosis: custom-infra-edit-quoted-values

## Report
- Observed behavior: When editing an existing app via the Custom Infrastructure wizard (Edit Infrastructure button → prefill), some restored values (module names, RBAC source/target names, project name/description/owner) are shown wrapped in literal double-quote characters.
- Expected behavior: Prefilled values should be plain identifiers matching the canonical `docs/metadata/{appName}-{environment}.json` schema (`services/infrastructureService.js` docblock, `.github/skills/service-catalog-metadata/SKILL.md`) — no literal quote characters.
- Environment: local-safe investigation (no live correlation ID provided by reporter).
- Correlation ID: unavailable

## Evidence
- Reproduction: Not independently reproduced against live service-catalog data (no correlationId/sample app supplied). Root cause isolated by code inspection + targeted unit tests simulating upstream metadata that is wrapped in quotes (a known pattern when values are shell/jq-serialized before being written to the JSON file by the external `self-service-custom-infra.yml` workflow in the `service-catalog` repo).
- Existing contract: `srcV2/types/infrastructure.types.ts` `AppMetadata.modules: string[]`/`RbacRelationship` fields and `tests/integration/service/infrastructureService.prefill.spec.ts` assert plain-string values (e.g. `sourceName: 'jobplc-mi'`, no quote characters). `.github/skills/service-catalog-metadata/SKILL.md` documents `modules` as a plain `string[]`.
- Affected paths: `services/infrastructureService.js` — `_normalizeAppDetails()`, `_normalizeModules()`, `_normalizeRbacPairs()`. These functions passed upstream string values through unmodified (only `.trim()`), so any literal wrapping quotes already present in the source JSON value surfaced directly into the `GET /api/app-metadata/:appName/:environment` response and then into the Vue prefill wizard (`ProjectInfoForm.vue`, `CustomInfrastructurePage.vue` → `parseModuleInstances()`, RBAC restore).

## Classification
- Classification: confirmed_bug
- Rationale: The response shape contract (types + existing tests) requires plain string values; passing through unmodified is a defect regardless of exactly which upstream writer introduces the quotes, since normalization is precisely this layer's responsibility (it already normalizes format differences — array vs. comma-string vs. legacy field names — but omitted quote-stripping).
- Scope owner: SelfService Debugger (backend service layer, non-frontend)

## Root Cause
- Hypothesis: Upstream metadata occasionally stores string fields with a residual layer of literal quote characters (e.g. `"appServiceWindows-1"` instead of `appServiceWindows-1`, or pipe-delimited RBAC parts like `"jobplc-mi"|"jobplc-kv"|"Key Vault Secrets User"`), most likely introduced when the external workflow serializes shell/JSON values before writing `docs/metadata/*.json`. `_normalizeModules()`/`_normalizeRbacPairs()`/`_normalizeAppDetails()` did not strip this, so it propagated verbatim to the frontend.
- Discriminating check: Added unit tests (`tests/integration/service/infrastructureService.prefill.spec.ts`) feeding quote-wrapped module names, RBAC pipe-strings, and project fields into `getApplicationDetails()`; before the fix these values would come back with literal quotes intact (matches reporter's symptom), and legitimate values containing an internal apostrophe (`O'Brien`) must NOT be altered.
- Result: Fix applied — added `_stripQuotes()` helper (strips only a single matching layer of leading/trailing `"`/`'`, leaves internal punctuation untouched) and applied it in `_normalizeAppDetails()` (name/description/owner), `_normalizeModules()` (both array and comma-string forms), and `_normalizeRbacPairs()` (string and object forms, all id/name/role fields).

## Resolution
- Status: pass
- Changed paths: [services/infrastructureService.js](../../services/infrastructureService.js), [tests/integration/service/infrastructureService.prefill.spec.ts](../../tests/integration/service/infrastructureService.prefill.spec.ts)
- Focused validation: `npx vitest run --project node tests/integration/service/infrastructureService.prefill.spec.ts` — 21/21 passed (16 pre-existing + 5 new quote-stripping regression tests, including an apostrophe-preservation guard).
- QA results: not_run — no frontend behavior change; fix is isolated to backend normalization and covered by targeted integration tests. Recommend QA Engineer independently verify against a live/staging app with known quote-wrapped metadata if available.
- Residual risk: If the true upstream root cause is a workflow bug that double-encodes JSON (not just wrapping-quote strings), some malformed values could still slip through (e.g. embedded escaped `\"` mid-string). This fix is a defensive normalization boundary, not a fix to the (out-of-repo) `self-service-custom-infra.yml` write path — recommend the SRE DevOps owner audit that workflow in the `service-catalog` repo for the actual write-time cause.
