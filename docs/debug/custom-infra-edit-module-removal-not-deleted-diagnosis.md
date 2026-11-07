# Bug Diagnosis: custom-infra-edit-module-removal-not-deleted

## Report
- Observed behavior: When editing an existing app, removing a module and adjusting/removing the RBAC relationship tied to that module, then clicking "Generate Infrastructure Code", the removed module is not deleted from the app's actual Terraform/Terragrunt code stack — it keeps existing alongside the new changes.
- Expected behavior: Per [docs/EDIT-INFRASTRUCTURE-GUIDE.md](../EDIT-INFRASTRUCTURE-GUIDE.md) ("Make your changes — add or remove modules... click Generate Infrastructure Code to submit"), removing a module in the wizard and resubmitting should result in that module being removed from the deployed infrastructure.
- Environment: local-safe investigation (no live correlation ID provided by reporter).
- Correlation ID: unavailable

## Evidence
- Reproduction: Traced the full submission path by code inspection; not independently reproduced end-to-end (would require dispatching the real `self-service-custom-infra.yml` GitHub Actions workflow in the `service-catalog` repo, which is out of scope for a safe local check).
- Existing contract: [docs/EDIT-INFRASTRUCTURE-GUIDE.md](../EDIT-INFRASTRUCTURE-GUIDE.md) documents module removal as supported edit-flow behavior.
- Affected paths (traced, this repo only):
  - [srcV2/pages/CustomInfrastructurePage.vue](../../srcV2/pages/CustomInfrastructurePage.vue) `handleDeployInfrastructure()` — builds `modules`/`moduleInstances`/`rbacPairs` purely from current `selectedModules`/`resourceInstances`/`rbacRelationships`. Confirmed: a deselected module is correctly excluded from the submitted `modules` array (no stale entries carried over from `prefillResourceInstances`).
  - [routes/api.js](../../routes/api.js) `POST /api/custom` — passes the submitted `modules` array straight through to `infrastructureService.buildCustomInfrastructure()` with no diff against the app's previous module list; there is no `isEditingMode`/`previousModules` concept anywhere in this request.
  - [services/infrastructureService.js](../../services/infrastructureService.js) `buildCustomInfrastructure()` — dispatches the `self-service-custom-infra.yml` workflow (in the separate `Aya-DevOpsTeam/service-catalog` repo) with only the final desired `modules` string. It never reads the app's existing metadata/module state and never signals "these modules were removed."
- Conclusion: this repository always sends the correct, shrunk desired-state module list on every edit submission (verified by code trace — no bug on the frontend/backend request-building side). Whether the removed module's Terraform/Terragrunt folder actually gets deleted depends entirely on `self-service-custom-infra.yml`'s own reconciliation logic in the `service-catalog` repo, which is not part of this codebase and was not inspectable in this session.

## Classification
- Classification: confirmed_bug (against the documented edit-flow contract) — but the defect is not reproducible or fixable inside this repository's ownership boundary.
- Rationale: The observed behavior violates the documented contract in EDIT-INFRASTRUCTURE-GUIDE.md, and this repo's request-building code was verified correct, so the missing reconciliation must live in the external workflow (`self-service-custom-infra.yml`) that receives the desired module list and is responsible for adding/removing module folders accordingly. This Debugger's ownership explicitly excludes editing CI/CD workflows, and that workflow file is not even present in this workspace to inspect or fix.
- Scope owner: Human / owning SRE DevOps agent with access to the `Aya-DevOpsTeam/service-catalog` repository's `.github/workflows/self-service-custom-infra.yml`

## Root Cause
- Hypothesis: `self-service-custom-infra.yml` is additive-only — it creates/updates Terragrunt module directories for every module in the incoming `modules` input but never deletes directories for modules that existed previously but are absent from the new list.
- Discriminating check: Would require reading `self-service-custom-infra.yml` in the `service-catalog` repo (not accessible from this workspace) and/or dispatching a real edit-with-removal against a disposable test app to observe whether the module's Terragrunt folder is deleted in the resulting PR.
- Result: Not verified — workflow source unavailable in this session.

## Resolution
- Status: fix_blocked
- Changed paths: none (no in-repo root cause found; nothing to safely change without risking the additive-only workflow reconciling incorrectly)
- Focused validation: not_run — blocked on access to the external workflow definition
- QA results: not_run
- Residual risk: Users editing an app to remove a module will see stale infrastructure remain deployed with no error surfaced, which can cause cost/drift and confusion about actual deployed state. Recommend: (1) a human with `service-catalog` repo access audits `self-service-custom-infra.yml` for module-removal reconciliation, and (2) if reconciliation is intentionally out of scope for that workflow, file a feature request (via SelfService Product Manager) to add an explicit "modules to remove" step — e.g. this repo computing a diff against `GET /api/app-metadata` and calling a dedicated removal workflow/endpoint before/alongside `POST /api/custom`.
