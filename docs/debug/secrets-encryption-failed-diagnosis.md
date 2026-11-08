# Bug Diagnosis: secrets-encryption-failed

## Report
- Observed behavior: Secret submission fails for both bundle and single-environment paths with `ENCRYPTION_FAILED` in Shared and Sand. The Shared response includes correlation ID `f976d256-6922-41e8-89c1-a3f42e289159` and names secret `test`; the Sand report identifies subscription `00000000-0000-0000-0000-000000000002` but does not provide a correlation ID.
- Expected behavior: With valid SOPS configuration and Key Vault authorization, the portal encrypts the value and proceeds to create the encrypted-file pull request.
- Environment: Shared AKS, subscription `ca2c368d-e375-44db-8db9-d6c243c71ca5`, resource group `shared-wus3-aks-rg-1`, cluster `shared-wus3-aks-1`, namespace `self-service`, workload `self-service-app`; and Sand AKS, subscription `00000000-0000-0000-0000-000000000002`, resource group `sand-wus3-aks-rg-1`, cluster `sand-wus3-aks-1`, namespace `self-service-test`, workload `self-service-test-app`.
- Correlation ID: Shared `f976d256-6922-41e8-89c1-a3f42e289159`; Sand unavailable.

## Evidence
- Reproduction: The user reports the newer image fails in Shared and that rolling back to the previous image restores encryption. This A/B behavior is consistent with the source-history finding below. Azure CLI confirmed the current identity can see both subscriptions. Shared AKS metadata returned provisioning state `Succeeded`, but credential retrieval was denied to the current identity (`listClusterUserCredential/action`). In Sand, the saved kubectl query and a direct AKS metadata/credential query stalled before returning deployment or log data. No pod logs were obtained from either workload.
- Existing contract: `encryptValueWithSops()` runs the SOPS executable with the configured Azure Key Vault key. The architecture spec requires the SOPS CLI in the runtime image. `git show c07a04d^:Dockerfile` contains the pinned SOPS 3.9.4 install and checksum verification; commit `c07a04d` removed that block while retaining the call from `services/secretsService.js`. The current runtime Dockerfile therefore does not install SOPS. Missing `SOPS_KEYVAULT_URL` or `SOPS_KEY_VERSION` is reported separately as `SOPS_NOT_CONFIGURED`. Both submission paths abort before GitHub writes when encryption fails.
- Diagnostics limitation: The single-environment path replaces the SOPS subprocess error with `Encryption failed for: <secretName>`. Bundle handling reports failed environment/secret names but does not preserve the subprocess stderr. The correlation ID alone may therefore not expose the Azure/SOPS cause in application logs.
- Affected paths: `services/secretsService.js` (`encryptValueWithSops`, `submitSecretViaGitOps`, `submitSecretBundleViaGitOps`); `routes/api.js` (error-to-status mapping); shared workload SOPS configuration and Key Vault access.

## Classification
- Classification: confirmed_bug
- Rationale: The runtime image violated the existing architecture contract by omitting the SOPS CLI required by the backend. The omission is visible in the current Dockerfile and was introduced by `c07a04d`; the user reports that rolling back the image restores encryption. The specific child-process error remains masked, but the code/history and rollback behavior identify the regression.
- Scope owner: SelfService Debugger

## Root Cause
- Root cause: Commit `c07a04d` removed the SOPS binary installation from the production Dockerfile. `encryptValueWithSops()` still invokes `sops` via `execFileAsync`; without the executable, process spawn fails and the single-secret path wraps that failure as `Encryption failed for: <secretName>`. The previous image included SOPS, matching the user's report that rollback restores encryption.
- Discriminating check: Build the corrected runtime image and run `sops --version` inside it; then verify a synthetic-value encryption from the Sand workload and confirm a PR is created. The image build check is blocked locally because the Docker/Colima daemon is not running.
- Result: Source/history and user-reported rollback evidence confirm the regression. Live pod-log reproduction and post-fix sandbox verification remain outstanding.

## Resolution
- Status: fixing
- Changed paths: `Dockerfile`, `docs/debug/secrets-encryption-failed-diagnosis.md`, and `.agent/state/project-state.md`; no Azure resources changed.
- Focused validation: `git diff --check` passes. The Docker image build/runtime check was attempted but could not connect to `/Users/Alex.Smith/.colima/default/docker.sock`; no post-fix image was built. QA results remain pending.
- QA results: not_run
- Residual risk: The source regression is fixed, but the corrected image has not been built or deployed, so encryption recovery is not yet verified. Build the image, verify `sops --version` in the runtime stage, then run a synthetic-value sandbox submission. If that still fails, capture sanitized SOPS stderr and inspect the workload principal's Key Vault `wrapKey` audit result. Never collect or log submitted secret values.
