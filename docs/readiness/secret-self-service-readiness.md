# Feature Readiness Report: secret-self-service
Date: 2026-07-31
PRD: docs/prd/secret-self-service.md
Spec: docs/architecture/secret-self-service-spec.json

## Summary

| Agent | Status | Output Artifact |
|---|---|---|
| Architect | COMPLETE | docs/architecture/secret-self-service-spec.json |
| Architecture Challenger | PASS | docs/reviews/secret-self-service-arch-review-round4.md |
| Vue.js Dev | PASS | docs/readiness/secret-self-service-dev-status.json |
| QA Engineer | PASS WITH GAPS | tests/results/secret-self-service-results.json |
| SRE DevOps | PASS WITH GAPS | docs/security/wiz-secret-self-service-report.json |

## Executable Evidence

- Full Vitest suite (jsdom): **396 passed, 0 failed** across 19 files.
- Backend service tests (node): **28 passed, 0 failed** across 3 files.
- TypeScript check: **PASS**.
- Vue production build: **PASS**.
- Backend syntax checks: **PASS**.
- SOPS is packaged in the runtime image and the final image runs as non-root `node`.

## FR Conformance

| FR | Status |
|---|---|
| FR-001 Secret metadata list | Met — flat `data[]` plus top-level `vaults` |
| FR-002 Create/update via GitOps | Met — top-level `prNumber`/`prUrl`, `vaultDir` allow-listed before path construction |
| FR-003 Key Vault auto-discovery | Met in code — multi-vault tree enumeration, repo-level cache, truncation fallback |
| FR-004 Vue page and navigation | Met — `StatusModal` sync mode, no polling |
| FR-005 `secrets` feature flag | Met — `secretsEnabledEnvironments` plus fallback defaults |
| FR-006 Correlation ID and audit | Met — `secret_list_fetched` / `secret_create_submitted` on success and error paths, no secret value logged |
| FR-007 Live/Sand target selection | Met — validated, mapped, Infrastructure App only |

## Security Gate

- Feature gate: **PASS** with zero feature-introduced critical or high findings.
- Real Wiz CLI scan: **not available in this environment**; run code and image scans in CI before promotion beyond sandbox.
- Secret values are not logged or returned. `vaultDir` is allow-list validated before repository path construction.
- Azure RBAC wrapKey-only assignments require an environment-level audit before enabling the feature flag.

## External Dependencies (block activation, not implementation)

1. `SOPS_KEYVAULT_URL` must be set. Until then `POST /api/secrets` returns HTTP 503 `SOPS_NOT_CONFIGURED`.
2. Azure RBAC `wrapKey`-only grant on `sops-master-key` for the portal identity (NFR-SEC-003) requires a live audit.
3. The CI decrypt-and-sync workflow must exist in `infrastructure-live` and `service-catalog`; it performs the actual Key Vault write and is outside this repository.
4. `features.secrets` must be flipped to `true` for the target environment in `data/environments.json` (FR-005(d), deliberately left `false`).

## Known Gaps

- Integration and smoke suites cannot bind `127.0.0.1:3001` in this sandbox (`health.spec.ts`, `feedback.spec.ts`); pre-existing and unrelated to this feature.
- `services/terragruntLocalsResolver.js` still has no dedicated test file (TS-028..030).
- Comment-stripping (TS-023) and truncated-tree fallback (TS-025) are implemented but untested.
- NFR-PERF-001 p95 latency has no load test.
- The SOPS binary download should gain checksum or signature verification before production promotion.

## Decision

**GO TO SANDBOX / HOLD FOR PRODUCTION PROMOTION**

The implementation blocker is cleared and the feature is ready for controlled sandbox validation. Production promotion remains gated on real Wiz scans, Azure RBAC verification, and the listed supply-chain and integration-test follow-ups.
