# Architecture Challenger Review: secrets-app-selector-qualifiers (Round 2)
Date: 2026-08-12
Spec: docs/architecture/secrets-app-selector-qualifiers-spec.json
PRD:  docs/prd/secrets-app-selector-qualifiers.md

## Verdict
approved

## Blocking Findings
None.

## Advisory Findings
None re-raised (delta-only round; Round 1 Advisory items were not in scope for re-check).

## Round Context
Round 1 Blocking finding — "Multi-environment eligibility path never receives the qualifier" — is
resolved:
- spec.md §2.5 (new section) now documents that `resolveEnvironmentEligibility()` must pass
  `selectedQualifier.value || undefined` as the fourth argument to `api.getSecrets(...)`, mirroring
  `resolveSecretMetadata()`, and explains the `root-only` case (`undefined`, relies on
  `vaultCount === 1 && qualifierCount <= 1` unchanged).
- spec.md §2.6 lists this as a required `SecretsPage.vue` change; §4 Testing references a scenario
  covering "select `idm::autobk`, multi-select 2+ environments, verify none are spuriously excluded."
- spec.json is consistent with spec.md: `acceptance.acceptance_criteria` includes the qualifier-passing
  criterion verbatim, `technical.components.frontend[0].ui_changes`/`user_interactions` list the fix, and
  a new `flows` entry "Multi-environment fan-out after selecting a qualifier" walks through the fixed
  path plus its error path (still-ambiguous case stays `excluded`, other environments unaffected).

No new defect was introduced by this revision. Note for QA/SRE DevOps: the fix is currently
spec-only — `srcV2/pages/SecretsPage.vue`'s `resolveEnvironmentEligibility()` still calls
`api.getSecrets(selectedApp.value.name, environment, target.value)` without the qualifier argument as
of this review; Vue.js Dev must implement per spec §2.5/§2.6 before QA verifies the corresponding test
scenario.

<!-- ARCH-CHALLENGER-VERDICT
feature: secrets-app-selector-qualifiers
round: 2
verdict: approved
blocking_count: 0
advisory_count: 0
-->
