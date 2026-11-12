# Service catalog setup

This directory is a starter for a **separate GitHub repository**. Workflows under
this nested directory do not run in the portal repository. Copy the contents,
including the hidden `.github/` directory, into your own
`service-catalog` repository. Do not copy deployed metadata or Terraform state.

## Configure the repository

1. Create a repository with a `main` branch and install the portal's Infrastructure
   GitHub App. Grant Contents, Actions, and Pull requests read/write permissions.
2. Allow GitHub Actions to create pull requests in repository Actions settings.
   Protect `main` and require a reviewed Terraform plan before merging changes.
   Set secrets `APP_ID` and `APP_PRIVATE_KEY` for the Infrastructure App. Generation
   and deletion PRs use its scoped token so they trigger the Terraform PR workflow;
   PRs created with the default `GITHUB_TOKEN` do not trigger other workflows.
3. Set repository variable `TERRAFORM_MODULES_REPO` to `OWNER/terraform-modules`.
   That repository must contain compatible Terragrunt scaffolding templates under
   `azure/<module-type>`, including the mandatory `resourceGroups` module.
4. Set secret `ACTIONS_DEPLOY_KEY` to a read-only SSH key for the module repository.
   Keep private keys and credentials out of source control.
5. Set repository variable `CATALOG_CONFIG_JSON` with your `subscriptions` map,
   `location`, `alias`, optional `network` settings, and module `inputs`. The copied
   `infrastructure/common.hcl` reads this JSON. Set `TERRAFORM_MODULE_REF` to a
   compatible module ref (default `main`). Customize `infrastructure/remote_state.yml`
   with your pre-existing state resource group, storage account, and blob container.
   `infrastructure/root.hcl` generates the backend and provider configuration.
   Never copy another installation's state identifiers or credentials.
6. Set `GITHUB_SERVICE_REPO=OWNER/service-catalog` and `SERVICE_CATALOG_BRANCH=main`
   in the portal. Configure its environment catalog with your subscription IDs.

## Workflow behavior

| Workflow | Purpose |
| --- | --- |
| `self-service-custom-infra.yml` | Scaffold module instances, reconcile removals, update metadata, create a PR |
| `self-service-deploy-application.yml` | Copy an operator-supplied application template and create a PR |
| `catalog-delete.yml` | Move the requested application to `recycle-bin/`, remove metadata, create a PR |
| `move-to-infralive.yaml` | Copy approved infrastructure to a separate infrastructure-live repo via PR |
| `secrets-sync.yml` | Decrypt SOPS-managed secrets and synchronize Azure Key Vault |
| `secret-sync-tests.yml` | Test the secret-sync helpers |
| `terraform-iac.yml` | Plan PR changes, security-scan plans, and apply approved main changes |
| `iac-generation-tests.yml` | Test generation and operation routing without cloud credentials |

**A successful scaffolding workflow does not mean Azure resources were applied.**
GitHub Actions is the supported plan/apply path. No Azure DevOps agent pool,
service connection, or variable group is required.

## GitHub plan/apply configuration

Create protected GitHub environments `terraform-plan`, `terraform-apply`, and
`terraform-destroy` **before enabling deployments**. Require reviewers; restrict
write environments to `main`. Configure Entra OIDC federation for the exact subjects
`repo:OWNER/REPO:environment:ENVIRONMENT_NAME`, not arbitrary branches or PR refs.
Use a least-privilege read/plan identity and separately scoped write identities.
The plan identity also needs the backend access needed to acquire state locks.

Set environment variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and
`AZURE_SUBSCRIPTION_ID` for each identity. Set `CATALOG_CONFIG_JSON` and
`TERRAFORM_MODULES_REPO` where the protected jobs can read them. Module sources use
SSH, so configure secret `ACTIONS_DEPLOY_KEY` and variable `SSH_KNOWN_HOSTS` for access.

Example configuration, with all deployment values supplied by the operator:

```json
{
   "subscriptions": {"devsand": "YOUR_SUBSCRIPTION_ID"},
   "location": "westus2",
   "alias": "wus2",
   "network": {
      "vnet_name": "YOUR_VNET",
      "vnet_resource_group": "YOUR_NETWORK_RESOURCE_GROUP",
      "private_endpoint_subnet": "YOUR_PRIVATE_ENDPOINT_SUBNET"
   },
   "inputs": {}
}
```

Windows application templates need compatible existing networking and module inputs.
Shared Key Vault, logging, diagnostics, and provider-alias subscriptions can be set
through the named settings in `infrastructure/common.hcl`.

- Same-repository PRs select changed application/environment stacks and run plans.
   Fork PRs do not receive cloud credentials; run the credential-free tests instead.
- Pushes to `main` re-plan, security-scan, and apply after environment approval.
   Stale write runs are refused if `main` has advanced.
- Retired folders and recorded module removals require `terraform-destroy` approval.
   Removal plans/destroys target only recorded modules at their verified ancestor commit.
- Manual dispatch accepts `plan`, `apply`, or `destroy` and a stack directory such as
   `infrastructure/myapp/devsand`. Writes are restricted to `main`.
- Terraform state locking remains enabled. Workflow operations are serialized;
   no state files or binary plans are uploaded as GitHub artifacts.

The Wiz scan is optional and disabled by default. To enable it, set the repository
variable `WIZ_IAC_REQUIRED=true`, configure `WIZ_CLIENT_ID` and `WIZ_CLIENT_SECRET`,
and configure blocking IaC policies in Wiz. The job uses a pinned, checksum-verified
Wiz CLI. If Wiz is not enabled, the workflow has no built-in IaC security scan;
configure a security gate appropriate to your installation before deployment.
Use a private deployment repository: plan logs and metadata can contain sensitive details.

This starter uses a new relative state-key layout. Do not point it at existing
infrastructure and apply without an approved state migration and reviewed plan.

## Optional integrations

- Templates: sanitized `_templates/webapp-storage`, `_templates/webapp-basic`, and
   `_templates/webapp-full` are included. Customize them and the portal catalog together.
   Generation preserves their resource locals and writes deployment inputs to `metadata.json`.
- Promotion: set `INFRASTRUCTURE_LIVE_REPO=OWNER/infrastructure-live` and
  `INFRASTRUCTURE_LIVE_OWNER=OWNER`; configure `APP_ID` and `APP_PRIVATE_KEY` for
   an App installed on both repositories. Install `terraform-iac.yml`, its helpers,
   the shared HCL/backend configuration, and protected environments in infrastructure-live
   before promotion. No per-application Azure DevOps pipeline is copied.
- Secret sync: configure `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`, GitHub OIDC
  federation, least-privilege Key Vault access, and SOPS key permissions. Inspect
  the workflow for optional SSH secrets. Never commit plaintext secret values.
- GitHub Pages is optional and needs your own site content in `docs/`.
   The public starter does not include an organization-specific AI assistant or
   AI-assisted deployment workflow. Standard template deployment requires no model API.

## Verify before deploying

Run the helper regressions without Azure access:

```bash
node --test service-catalog/tests/generate-iac.test.mjs
python3 -m unittest discover -s service-catalog/tests -p 'test_*.py'
```

From the standalone repository, omit the `service-catalog/` prefix. Install
`.github/scripts/secret-sync/requirements.txt` in an isolated Python environment
before running the secret-sync suite. Dispatch custom provisioning for a disposable
app and inspect its PR, metadata, module paths, plan, and approvals before merging.

Automation was copied from source commit
`99bdc82cfdb4026fd63c957eecf0c93973ada6fa` and sanitized for portability.
It is not a tested Azure deployment or a licensing/ownership approval.