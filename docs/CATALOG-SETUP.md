# Catalog and deployment setup

Infra DevEx keeps its portal, workflows, catalog, infrastructure configuration,
and metadata in the same repository. See [the main README](../README.md) for
local generation, GitHub Actions, and portal setup.

Generation-only mode is the default. No Azure subscription, cloud credentials,
remote backend, or GitHub App is required to run the generator locally. The
GitHub Actions workflow uses the repository-provided `GITHUB_TOKEN` to create
its branch and PR. A user with write access may need to approve PR checks created
by that token. The portal uses a server-side personal access token or an optional
GitHub App to dispatch the workflow; portal user sign-in currently uses Entra ID.

Azure plan/apply run only when the repository variable
`ENABLE_AZURE_DEPLOYMENT=true` is explicitly set after the customer has configured
their Azure target. Manual dispatch fails with an explanatory message while
deployment is disabled. A generation PR is not a Terraform plan or an Azure
deployment.

## GitHub plan/apply configuration

Create protected GitHub environments `terraform-plan`, `terraform-apply`, and
`terraform-destroy` **before enabling deployments**. Require reviewers; restrict
write environments to `main`. Configure Entra OIDC federation for the exact subjects
`repo:OWNER/REPO:environment:ENVIRONMENT_NAME`, not arbitrary branches or PR refs.
Use a least-privilege read/plan identity and separately scoped write identities.
The plan identity also needs the backend access needed to acquire state locks.

Set environment variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and
`AZURE_SUBSCRIPTION_ID` for each identity. Set `CATALOG_CONFIG_JSON` where the protected jobs can read it. The initial public
module catalog uses HTTPS and does not require an SSH deploy key.

Example configuration, with all deployment values supplied by the operator:

```json
{
   "subscriptions": {"dev": "YOUR_SUBSCRIPTION_ID"},
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

Shared Key Vault, logging, and diagnostics settings can be configured in
`infrastructure/common.hcl`. The starter generates one default Azure provider;
modules requiring provider aliases need installation-specific configuration.

- Same-repository PRs select changed application/environment stacks and run plans.
   Fork PRs do not receive cloud credentials; run the credential-free tests instead.
- Pushes to `main` re-plan, security-scan, and apply after environment approval.
   Stale write runs are refused if `main` has advanced.
- Retired folders and recorded module removals require `terraform-destroy` approval.
   Removal plans/destroys target only recorded modules at their verified ancestor commit.
- Manual dispatch accepts `plan`, `apply`, or `destroy` and a stack directory such as
   `infrastructure/myapp/dev`. Writes are restricted to `main`.
- Terraform state locking remains enabled. Workflow operations are serialized;
   no state files or binary plans are uploaded as GitHub artifacts.

The workflow uses open-source Checkov to scan each generated Terraform JSON plan.
It blocks on failed checks or when no plan files are found. Review scan findings
and configure documented, justified exceptions for your own policy requirements.
Plan data and scanner output may contain sensitive infrastructure details.
Use a private deployment repository: plan logs and metadata can contain sensitive details.

All environments use the same configured backend, with separate keys by stack path.
When moving an existing installation to a different backend or state layout,
migrate state explicitly and review a plan before apply. Otherwise Terraform may
see existing resources as new. Never apply against an empty state.

## Scope and validation

The supported generation path currently covers the resource-group and storage
catalog entries. Other previously nested workflow definitions are kept inactive
under `legacy/catalog-workflows/`; they are not configured or supported by this
initial single-repository flow.

Run the clean-install and catalog tests in the main README before configuring
Azure. No real GitHub dispatch, Azure plan, or deployment has been verified by
those tests. An existing state backend requires a separately reviewed migration;
do not point a new backend at existing resources and apply without reconciling
state.
