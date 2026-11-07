# Bug Diagnosis: dataops-sand-environment

## Report
- Observed behavior: DataOps Sand support is present in the environment catalog but does not work end to end.
- Expected behavior: DataOps can provision infrastructure in its own sandbox subscription.
- Environment: repository configuration
- Correlation ID: cid-1790167202517-v7ro45

## Evidence
- Reproduction: `data/environments.json` defines DataOps Sand with the same `id` (`sand`) as IT Sandbox.
- Existing contract: environment IDs are submitted to infrastructure workflows and used as keys for subscription lookup and Azure Portal links; IDs must identify one environment.
- Affected paths: `data/environments.json`, `config.js`, `services/infrastructureService.js`, `srcV2/stores/environments.ts`, `data/environmentTiers.json`.

## Classification
- Classification: confirmed_bug
- Rationale: duplicate IDs make the DataOps option indistinguishable from IT Sandbox; map-based subscription lookup overwrites one of the two subscriptions.
- Scope owner: SelfService Debugger

## Root Cause
- Hypothesis: DataOps was added as a second `sand` record instead of a unique `dataops-sand` environment, so UI selection and backend subscription resolution cannot preserve the intended target.
- Discriminating check: parse the catalog and build the configured subscription map; the current catalog contains duplicate IDs and only one `sand` subscription survives.
- Result: confirmed by repository inspection.

## Resolution
- Status: pass
- Changed paths: `data/environments.json`, `data/environmentTiers.json`, `config.js`, `services/infrastructureService.js`, `srcV2/stores/environments.ts`, `tests/integration/api/app-metadata.spec.ts`, `tests/integration/service/environmentsConfig.spec.ts`
- Focused validation: DataOps catalog and secret-bundle regression tests (26 passing), app-metadata allowlist tests (21 passing), `npm run type-check`, and `npm run build:client` pass
- QA results: `tests/results/dataops-sand-environment-results.json`
- Residual risk: the service-catalog and infrastructure-live repositories must recognize the `dataops-sand` workflow environment identifier.
