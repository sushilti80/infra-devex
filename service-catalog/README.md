# Service catalog setup

This directory is a starter for a **separate GitHub repository**. Workflows under
this nested directory do not run in the portal repository. Copy the contents,
including the hidden `.github/` and `.pipelines/` directories, into your own
`service-catalog` repository. Do not copy deployed metadata or Terraform state.

## Configure the repository

1. Create a repository with a `main` branch and install the portal's Infrastructure
   GitHub App. Grant Contents, Actions, and Pull requests read/write permissions.
2. Allow GitHub Actions to create pull requests in repository Actions settings.
   Protect `main` and require a reviewed Terraform plan before merging changes.
3. Set repository variable `TERRAFORM_MODULES_REPO` to `OWNER/terraform-modules`.
   That repository must contain compatible Terragrunt scaffolding templates under
   `azure/<module-type>`, including the mandatory `resourceGroups` module.
4. Set secret `ACTIONS_DEPLOY_KEY` to a read-only SSH key for the module repository.
   Keep private keys and credentials out of source control.
5. Supply your own `infrastructure/common.hcl` and `infrastructure/terragrunt.hcl`
   with Azure provider authentication and a remote-state backend. The generated
   environment files read `common.hcl` locals `subscriptions`, `location`, and
   `alias`. See `infrastructure/common.hcl.example`. Never use another
   installation's state account, subscription IDs, or credentials.
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

**A successful scaffolding workflow does not mean Azure resources were applied.**
Connect a Terraform/Terragrunt plan/apply pipeline to PR review and merge. Imported
Azure DevOps pipelines under `.pipelines/` are reference implementations: configure
your own agent pools, `azdevopsterraform` variable group, SSH secure files, tool
versions, backend, Azure credentials, and approval checks before enabling them.
Destroy operations require their own approved destroy pipeline, not just a folder move.

## Optional integrations

- Templates: provide `_templates/webapp-storage`, `_templates/webapp-basic`, and
  `_templates/webapp-full`, or customize the template choices and portal catalog
  together. No private application templates are included.
- Promotion: set `INFRASTRUCTURE_LIVE_REPO=OWNER/infrastructure-live` and
  `INFRASTRUCTURE_LIVE_OWNER=OWNER`; configure `APP_ID` and `APP_PRIVATE_KEY` for
  an App installed on both repositories. Supply `_templates/_pipeline/infra-pipelines.yaml`
  if promoted apps need an Azure DevOps pipeline definition.
- Secret sync: configure `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`, GitHub OIDC
  federation, least-privilege Key Vault access, and SOPS key permissions. Inspect
  the workflow for optional SSH secrets. Never commit plaintext secret values.
- AI-assisted deployment and GitHub Pages workflows are optional; configure them
  separately. Pages needs your own site content in `docs/`.

## Verify before deploying

Run the helper regressions without Azure access:

```bash
python3 -m unittest discover -s service-catalog/tests -p 'test_*.py'
```

From the standalone repository, omit the `service-catalog/` prefix. Install
`.github/scripts/secret-sync/requirements.txt` in an isolated Python environment
before running the secret-sync suite. Dispatch custom provisioning for a disposable
app and inspect its PR, metadata, module paths, plan, and approvals before merging.

Automation was copied from source commit
`99bdc82cfdb4026fd63c957eecf0c93973ada6fa` and sanitized for portability.
It is not a tested Azure deployment or a licensing/ownership approval.