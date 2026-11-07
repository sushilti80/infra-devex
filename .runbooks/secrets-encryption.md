# Secrets Encryption Failure Runbook

Use this runbook for Secrets-page failures such as `ENCRYPTION_FAILED` or `SOPS_NOT_CONFIGURED`, especially when submissions fail across environments or work again after an image rollback.

For human or AI investigation in Datadog, start with [Datadog Log Investigation Runbook](./datadog-logs.md). It includes namespace-scoped queries, correlation-ID lookup, structured failure categories, and legacy-log fallbacks.

## Safety

- Do not request, print, copy, or store submitted secret values, tokens, private keys, or full process environments.
- Use a synthetic value for any encryption canary; run it only in an approved non-production environment.
- Prefer read-only cluster, image, identity, and Key Vault diagnostics. Do not change RBAC, Key Vault configuration, or deployments as part of diagnosis.
- When sharing evidence, include UTC timestamps, correlation IDs, image digests, error codes, and sanitized error text only.

## Known AKS Targets

These are the current self-service workloads. Use the existing kube context; replace only the correlation ID for each incident.

| Environment | Subscription ID | Resource group | Cluster / kube context | Namespace | Deployment |
|---|---|---|---|---|---|
| Shared | `ca2c368d-e375-44db-8db9-d6c243c71ca5` | `shared-wus3-aks-rg-1` | `shared-wus3-aks-1` | `self-service` | `self-service-app` |
| Sand | `552bdc54-0a39-4040-9d8f-4002e8f572aa` | `sand-wus3-aks-rg-1` | `sand-wus3-aks-1` | `self-service-test` | `self-service-test-app` |

Read the deployed image without changing the workload:

```sh
kubectl --context shared-wus3-aks-1 -n self-service get deployment self-service-app \
	-o jsonpath='{.spec.template.spec.containers[*].image}{"\n"}'

kubectl --context sand-wus3-aks-1 -n self-service-test get deployment self-service-test-app \
	-o jsonpath='{.spec.template.spec.containers[*].image}{"\n"}'
```

Search only log entries matching the request correlation ID. Set `CORRELATION_ID` to the ID from the API response; do not use a subscription ID in its place.

```sh
CORRELATION_ID='<request-correlation-id>'
kubectl --context shared-wus3-aks-1 -n self-service logs deployment/self-service-app \
	--all-containers=true --since=24h --timestamps=true --prefix=true 2>&1 \
	| rg --fixed-strings "$CORRELATION_ID"

kubectl --context sand-wus3-aks-1 -n self-service-test logs deployment/self-service-test-app \
	--all-containers=true --since=24h --timestamps=true --prefix=true 2>&1 \
	| rg --fixed-strings "$CORRELATION_ID"
```

An empty result means no matching log line was found in that time window; it does not prove the request did not reach the app. Older images may mask the SOPS subprocess detail. Updated images log safe failure categories rather than raw subprocess output. Inspect output before sharing and redact any sensitive values.

Check that SOPS exists in the running workload:

```sh
kubectl --context shared-wus3-aks-1 -n self-service exec deployment/self-service-app -- sops --version
kubectl --context sand-wus3-aks-1 -n self-service-test exec deployment/self-service-test-app -- sops --version
```

## Triage Order

1. **Capture the failure context.** Record the UTC time, correlation ID, submission mode (single, fan-out, or bundle), target (`sand` or `live`), environment, API error code/message, current image digest, and last-known-good digest. Never record secret values.
2. **Check for rollback evidence.** If the previous image works with the same workload identity and Key Vault, compare the exact image source SHAs and runtime contents before changing permissions. Prioritize the Dockerfile, image build inputs, `services/secretsService.js`, and SOPS version.
3. **Verify SOPS in the runtime image.** In the affected pod or an equivalent container built from that image, check `command -v sops` and `sops --version`. Confirm SOPS is installed in the final runtime stage (not only a builder stage), executable by the configured non-root user, and available for the target architecture.
4. **Check the error category.** `SOPS_NOT_CONFIGURED` means `SOPS_KEYVAULT_URL` or `SOPS_KEY_VERSION` is absent. `ENCRYPTION_FAILED` means the SOPS subprocess or another encryption step failed; it does not by itself prove an Azure authorization problem.
5. **Check runtime configuration without dumping it.** Verify that the Key Vault URL, key name, and key version are present and agree with the intended SOPS key. Do not print all pod environment variables. The expected key name is `self-service-infra-sops-master-key`.
6. **Check workload identity and Key Vault audit.** Identify the workload's principal ID without exposing credentials. For a synthetic-value canary, inspect the corresponding Key Vault `AuditEvent` for `wrapKey`, including timestamp, caller, result, and denial reason. Verify the existing grant is scoped to the SOPS key. Do not grant permissions during triage.
7. **Check reachability and key state.** If SOPS is present and the identity is authorized, investigate DNS, egress/private-endpoint reachability, Key Vault availability, and whether the configured key/version is enabled and valid.
8. **Verify the full path in sandbox.** After building the candidate image, verify `sops --version` in the final image, then submit only a synthetic value through the Secrets page. Confirm encryption succeeds and the normal PR result is returned. Do not use production secret material for this test.

## Interpreting Application Errors

`services/secretsService.js` invokes `sops --encrypt --azure-kv ...` through `execFileAsync`. Missing `SOPS_KEYVAULT_URL` or `SOPS_KEY_VERSION` is reported as `SOPS_NOT_CONFIGURED`. Other subprocess failures are wrapped as `ENCRYPTION_FAILED`; the single-secret path replaces the original error with `Encryption failed for: <secretName>`. Browser responses remain unchanged. Updated images emit `secret_encryption_failed` before wrapping, with a structured `correlation_id`, application/environment/target context, `phase`, `failure_category`, allow-listed `process_code` when available, and `duration_ms`. Retrieve this event through the approved logging path; do not retrieve or log raw SOPS stderr/stdout, arguments, or error objects. `process_failed` with a numeric exit code does not establish the underlying Azure failure cause. Follow the runtime and Key Vault checks above.

Encryption occurs before the service writes the encrypted file or opens a pull request. If encryption fails, the submission should stop before GitHub writes; do not retry repeatedly until the runtime issue is understood.

## Regression Precedent

On 2026-10-13, commit `c07a04d` removed the pinned SOPS install from the production Dockerfile while the backend continued to invoke `sops`. The user reported that rolling back to the previous image restored encryption. The Dockerfile was corrected to install SOPS `3.9.4` with checksum verification. Treat a successful rollback as strong evidence to compare image contents before investigating Key Vault permissions. A code fix is not considered verified until the corrected runtime image is built and a sandbox submission succeeds.

## Closure Evidence

Record the confirmed cause, affected image digest/source SHA, exact fix, focused checks, sandbox result, and any remaining blocker in `docs/debug/{bug_id}-diagnosis.md`. Never mark the issue resolved based only on source inspection; require runtime-image validation and the repository's required QA verification.
