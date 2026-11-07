# Prompt: Implement Secret Self-Service Repository Prerequisites

You are implementing the repository-side prerequisites for Secret Self-Service. Work only in the
target repository assigned to you: `infrastructure-live` for `live`, or `service-catalog` for
`sand`. Do not modify `self-service-infra`, add portal routes, add a database, or introduce another
secret-file format.

## Problem to Fix

The portal currently reports:

```text
No Key Vault secret file found for this app and environment
```

The portal reads secret names from GitHub files; it does not list them from Azure Key Vault. A
vault's Terragrunt definition must be discoverable in the repository. The first successful portal
submission can create a missing `secrets.enc.yaml`; the repository agent must not require an empty
file to be committed beforehand.

## Repository Contract

Support the layouts that exist in the target repository:

```text
infrastructure/.../keyvault/terragrunt.hcl
infrastructure/.../keyvault01/terragrunt.hcl
infrastructure/.../<vault-parent>/keyvault.hcl
azureDatabricks/<environment>/keyvault/terragrunt.hcl
```

For a directory definition, the encrypted file is:

```text
<vaultDir>/secrets.enc.yaml
```

For the `keyvault.hcl` form, `vaultDir` is the parent directory and
`<vaultDir>/secrets.enc.yaml` is a sibling of `keyvault.hcl`.

Do not infer the destination vault from only the application or environment name. Resolve the
authoritative Azure Key Vault from the matching Terragrunt configuration. Missing, ambiguous, or
path-mismatched mappings must fail closed.

## Required Changes

### 1. SOPS policy

Add or update `.sops.yaml` in the target repository. Use the shared RSA key:

```text
self-service-infra-sops-master-key
```

Use the shared platform Key Vault URL supplied by the platform owner. The policy must cover:

```yaml
creation_rules:
  - path_regex: ^infrastructure/.*/keyvault[0-9]*/secrets\.enc\.yaml$
    azure_keyvault: https://<shared-platform-kv>.vault.azure.net/keys/self-service-infra-sops-master-key/<key-version>
  - path_regex: ^azureDatabricks/[^/]+/keyvault/secrets\.enc\.yaml$
    azure_keyvault: https://<shared-platform-kv>.vault.azure.net/keys/self-service-infra-sops-master-key/<key-version>
```

If the repository uses the `keyvault.hcl` form, add a compatible `infrastructure` rule as well:

```yaml
  - path_regex: ^infrastructure/.*/secrets\.enc\.yaml$
    azure_keyvault: https://<shared-platform-kv>.vault.azure.net/keys/self-service-infra-sops-master-key/<key-version>
```

The portal invokes SOPS with `--azure-kv` using `SOPS_KEYVAULT_URL` and
`SOPS_KEY_NAME=self-service-infra-sops-master-key`. Keep the repository policy and runtime key
configuration consistent.

### 2. Post-merge sync workflow

Add `.github/workflows/secrets-sync.yml`.

Trigger it on the default branch after changes to:

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'infrastructure/**/secrets.enc.yaml'
      - 'azureDatabricks/**/keyvault/secrets.enc.yaml'
  workflow_dispatch:
    inputs:
      file_path:
        required: true
        type: string
```

For every selected file, the workflow must:

1. Check out the merged repository content.
2. Authenticate with `azure/login@v2` using OIDC and `id-token: write`.
3. Install a pinned SOPS version and verify its checksum or signature.
4. Validate that the file is under an accepted root and has the matching vault definition.
5. Resolve exactly one Azure Key Vault from the vault's Terragrunt configuration.
6. Parse the outer YAML with a pinned, approved YAML parser.
7. For each top-level secret block, write only that block to a `0600` temporary JSON file.
8. Run `sops --decrypt --input-type json --output-type json` on that temporary file.
9. Extract the decrypted JSON `value` to a separate `0600` temporary file.
10. Run `az keyvault secret set --file <plaintext-file>` against the resolved application vault.
11. Delete both temporary files on success and failure.

The workflow must fail before decryption or Azure writes when the path, vault mapping, identity
scope, or Terragrunt resolution is invalid. Manual dispatch must process only the requested valid
file; it must never process every encrypted file implicitly.

## Encrypted File Contract

`secrets.enc.yaml` is a plain YAML map of independently encrypted per-value SOPS blobs:

```yaml
API_TOKEN: |
  {"value":"ENC[...]","sops":{"azure_kv":[...],"mac":"ENC[...]"}}
```

Secret names remain readable for portal inventory. Do not run SOPS over the outer YAML map, decrypt
or re-encrypt sibling blocks, create one file per secret, or combine sibling vaults into one file.

## Security Requirements

- Portal identity: `wrapKey` on `self-service-infra-sops-master-key` only.
- CI identity: `unwrapKey` on the SOPS key and `Key Vault Secrets Officer` only on the intended
  application Key Vault.
- Use workload identity/OIDC; do not add client secrets to the workflow.
- Never use `set -x`.
- Never print plaintext, decrypted JSON, full encrypted blocks, or secret values in logs, annotations,
  artifacts, PR descriptions, or files outside the temporary workspace.
- Require CODEOWNERS and branch protection for `.sops.yaml`, the workflow, and encrypted files.

## Acceptance Criteria

- A real vault definition is discovered in the target repository.
- The portal can submit the first secret without a pre-existing `secrets.enc.yaml`.
- The portal creates or updates the correct `<vaultDir>/secrets.enc.yaml` in a PR.
- The workflow runs only after merge and syncs each per-value blob to the resolved Azure Key Vault.
- Invalid paths and ambiguous/missing vault mappings fail closed.
- OIDC authentication and least-privilege RBAC are verified.
- No plaintext secret value appears in repository content, logs, PRs, or artifacts.
- A non-production test secret is visible by name in the portal after merge and sync.

## Required Agent Report

Return:

- target repository and branch;
- changed files;
- one validated vault path and mapping example without secret values;
- workflow validation results for push, manual dispatch, and invalid-path rejection;
- OIDC and RBAC verification results;
- end-to-end test result; and
- unresolved platform prerequisites or blockers.
