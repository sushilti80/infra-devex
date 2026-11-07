# Architecture Challenger Review: secrets-ui-enhancements (Round 2)
Date: 2026-08-01
Spec: docs/architecture/secrets-ui-enhancements-spec.md, docs/architecture/secrets-ui-enhancements-spec.json
PRD:  docs/prd/secrets-ui-enhancements.md
Round 1 review: docs/reviews/secrets-ui-enhancements-arch-review-round1.md

## Note on Prior Review File

This file previously held a Round 2 review of an older, already-superseded Round 1 pass (the
409 PR_EXISTS finding). Per `docs/reviews/secrets-ui-enhancements-arch-review-round1.md`'s own
note, that content was fully resolved and superseded by a fresh Round 1 pass with 5 new Blocking
findings (FR-001(e) algorithm, oneOf() validation, cache-reuse claim, hash algorithm, error
sanitization). This is the Round 2 delta-only check against *that* Round 1 pass.

## Verdict
escalate_to_human

## Round Context

Delta-only check of the 5 Round 1 Blocking findings:

1. **FR-001(e) environment-derivation algorithm** — **Resolved.** New "App Discovery Algorithm (FR-001)" section in spec.md gives a concrete 3-step iterate/extract/dedupe algorithm for `target=live`, explicitly states app+env pairs are included even with no `keyvaultN` marker (directly closes the "silent omission" regression risk called out in Round 1), and pins the response shape to a flat `[{name, environment}]` list. Confirms `discoverAppsForTarget` is new logic, not a reuse of `matchVaultsFromEntries`. spec.json's `response_schema` (`Array<{name: string, environment: string}>`) agrees.
2. **Legacy singular vs. bulk-array validation mechanism** — **Resolved (mechanism), see new Blocking finding below for a side-effect defect.** `oneOf([arrayShapeChain, singularShapeChain])` is now specified with both chains defined, plus the required "both shapes independently pass" integration test.
3. **FR-001(g) cache-reuse claim** — **Resolved.** spec.md now explicitly states `discoverAppsForTarget` builds its **own** new per-target `Map<target, {promise, timestamp}>` cache, calls out that `getInstalledApps()` has no caching today, and clarifies the tree cache is only reused for the fetch, not the discovery-result cache. No more false "reuses existing cache module" claim.
4. **Bulk branch-name hash algorithm** — **Resolved in spec.md**, not fully carried into spec.json (see Advisory below). The exact serialization (lowercase names, sort, `,`-join, SHA-256, first 8 hex chars) is pinned with a code sample.
5. **NFR-SEC-001 error-response sanitization** — **Resolved in spec.md**, not fully carried into spec.json (see Advisory below). Explicit redaction step and code sample added; explicit QA test described in prose.

All 5 original items are addressed in spec.md. However, verifying finding #2's fix (dimension: Contract clarity) surfaced a new inconsistency introduced by the fix itself — see Blocking Findings.

## Blocking Findings

- [ ] **The new bulk array-shape `secretName` validator uses a different regex than the existing (unchanged) singular-shape validator, for what is conceptually the same field** — reference: spec.md "Modify: `POST /api/secrets`" bullet (Array shape vs. Singular shape), `routes/api.js:264`. The singular chain is unchanged from v1: `check('secretName').matches(/^[a-zA-Z0-9-]{1,127}$/)` (no leading-letter requirement, no underscore, up to 127 chars) — this also matches `spec.json`'s `validation` arrays in both `technical.components.backend[0].endpoints[1]` and `technical.api_endpoints[1]`. But the new array-shape chain added to resolve Round 1 finding #2 is `check('secrets.*.secretName').matches(/^[A-Za-z][A-Za-z0-9_-]{0,62}$/)` — a different pattern (must start with a letter, allows `_`, max 63 chars). Because `oneOf()` routes a request to whichever chain matches its shape, the **same secretName value** is validated by different rules depending on whether it's submitted via the legacy singular shape or the new `secrets[]` array shape: an existing 100-character or underscore-containing secret name (valid under the unchanged singular regex, and potentially already present in a vault) would be silently rejected the moment a developer resubmits it through the new bulk form, and neither `spec.json`'s validation list nor its request/response schemas mention this divergence at all.
  **Fix**: Make the array-shape regex identical to the singular-shape regex (`/^[a-zA-Z0-9-]{1,127}$/`) unless there's a deliberate, PRD-driven reason for a stricter bulk-only rule — the PRD doesn't ask for one. Update spec.json's `validation` entries to reflect whichever single regex is chosen so both shapes enforce the same rule, and note this explicitly in spec.md's Design Decisions or Component Changes section so it isn't lost in a future revision.

## Advisory Findings

- **spec.json testing arrays weren't updated for findings #4 and #5.** spec.md's Testing Notes now describe two new tests in prose ("Unit tests must assert the exact expected hash for a known input set" for the branch-hash fix, and "submit a `secretValue` that fails a validator and grep the JSON response body" for the sanitization fix), but neither test appears in spec.json's `testing.unit_tests` or `testing.integration_tests` arrays — the `secretsService.submitSecretViaGitOps (batch)` unit-test entry still lists only the original 3 cases from Round 1, with no "exact hash for known input" case, and `testing.integration_tests` has no error-sanitization scenario. Since spec.md itself is unambiguous on both points, this is a completeness/parity gap rather than a blocker — but QA agents that scaffold test suites primarily from spec.json's structured `testing.*` arrays could miss both. Recommend adding one `unit_tests` entry (e.g., "Bulk branch name for `['b','a']` == `secrets/{app}-{env}-{vault}-bulk-{sha256('a,b').slice(0,8)}`") and one `integration_tests` entry for the redaction check, to keep spec.json in sync with spec.md per the "mechanical extraction" contract.

<!-- ARCH-CHALLENGER-VERDICT
feature: secrets-ui-enhancements
round: 2
verdict: escalate_to_human
blocking_count: 1
advisory_count: 1
-->
