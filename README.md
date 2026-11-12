# Infra DevEx

Infra DevEx is an early-stage self-service tool for generating Azure infrastructure as code. Choose an environment and a catalog offering to create reviewable Terragrunt configuration backed by pinned, public Azure Verified Modules. GitHub Actions runs the workflow in **this same repository**.

The initial catalog supports resource groups and storage accounts. Selecting storage includes its resource group. Adding other module types and supporting arbitrary module sources are future work.

**Start in generation-only mode.** Generating and reviewing code does not need an Azure subscription, service principal, backend, or OIDC federation. Azure plan and apply remain disabled until the repository owner configures them and explicitly sets `ENABLE_AZURE_DEPLOYMENT=true`. No real Azure deployment has been validated yet.

## How it works

1. A user starts a request from GitHub Actions or the portal.
2. The workflow generates Terragrunt files for the chosen project and environment.
3. The workflow creates a branch and pull request in this repository.
4. A reviewer examines the code and metadata. Azure plan/apply do not run in generation-only mode.

## Option 1: Try generation locally

You need Git, Node.js 24, and Python 3. This option needs no GitHub token, GitHub App, Azure account, or cloud credentials.

```bash
git clone https://github.com/sushilti80/infra-devex.git
cd infra-devex

# Create a local proposal branch.
git switch -c example/generate-demo

# Generate the module configurations.
PROJECT_NAME=demo ENVIRONMENT=dev MODULES=storageV2 \
  node catalog/generate.mjs

# Generate the environment file and catalog metadata.
PROJECT_NAME=demo ENVIRONMENT=dev MODULES=storageV2 \
  OWNER="Example User" PROJECT_DESC="Example infrastructure" \
  GITHUB_SHA="$(git rev-parse HEAD)" \
  node .github/workflows/scripts/generate_request.mjs

git status --short
```

Review `infrastructure/demo/dev/env.hcl`, the `resourcegroups` and `storagev2` Terragrunt files below that directory, and `docs/metadata/demo-dev.json`. No Terraform plan or Azure resource is created. To create a PR manually, commit the generated files and push your branch using your own GitHub authentication.

## Option 2: Generate a PR using GitHub Actions

1. Fork or create your own copy of this repository. Workflows must be present on its default branch before GitHub can dispatch them.
2. In **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**. Organization policy may also control this setting. The workflow uses the repository's built-in `GITHUB_TOKEN`; it does not require a GitHub App or personal access token.
3. Open **Actions → Deploy Custom Infrastructure → Run workflow**. For a first request use project `demo`, environment `dev`, modules `storageV2`, an owner, and any offered project life. The change request, description, and RBAC fields are optional; leave RBAC empty for the initial catalog.
4. Open the generated pull request and inspect the files. GitHub may require a repository writer to approve workflows on a PR created using `GITHUB_TOKEN`. The PR does not prove a Terraform plan or deployment succeeded.

You can add environment names to `data/environments.json`; an empty subscription ID is valid for code generation. Generated module sources and template mappings are in [catalog/modules.json](catalog/modules.json) and [catalog/templates](catalog/templates). See [the catalog guide](catalog/README.md) for dependency and state details.

## Option 3: Use the portal

The portal can dispatch the same workflow in the same repository. It currently requires a GitHub credential for its API calls and Microsoft Entra ID for user sign-in. These are separate from Azure deployment OIDC. A GitHub App is **optional**: a fine-grained personal access token scoped to this repository can authenticate the portal.

1. Create a fine-grained token restricted to your repository with **Actions: read and write** to dispatch and monitor workflows and **Contents: read** to read catalog and metadata. Add **Pull requests: read** if needed for PR details. Keep the token server-side.
2. Install dependencies and configure the portal:

   ```bash
   npm ci --legacy-peer-deps
   cp .env.example .env
   ```

3. Set `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_SERVICE_REPO=OWNER/infra-devex`, and `GITHUB_SELF_SERVICE_REPO=OWNER/infra-devex` in `.env`, substituting your repository. Configure the Entra client, tenant, API scope and redirect URIs using [the authentication guide](docs/AUTHENTICATION-GUIDE.md). Do not commit `.env` or your token.
4. Run `npm run dev` and, in another terminal, `npm run dev:client`. Open `http://localhost:5173`, sign in, and choose **Custom Infrastructure**. Select `dev` and `storageV2`, enter the project details, and submit. Follow the run and review its PR in the same repository.

The GitHub App integration remains an alternative for the portal. Other portal features, including legacy application templates, AKS deployment, secrets sync, promotion, and code deployment, are not part of this initial single-repository generation path. Their workflow definitions remain inactive under `legacy/catalog-workflows/` until separately configured and reviewed.

## Azure deployment later

When ready to plan or deploy, the customer must supply a subscription and configure the remote state backend, GitHub protected environments, Azure identities and OIDC federation. Review [deployment setup](docs/CATALOG-SETUP.md) before setting `ENABLE_AZURE_DEPLOYMENT=true`. The workflow checks that the job's subscription matches the selected environment and runs Checkov on Terraform plans. A fresh plan is created after merge; review the behavior and approval requirements before enabling writes.

## Verify

```bash
node --test tests/catalog.test.mjs tests/deployment-config.test.mjs tests/generate-request.test.mjs tests/clean-install.test.mjs tests/github-token.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

The clean-install test exercises generation in a temporary repository without Azure or GitHub credentials. These tests do not verify a real GitHub dispatch, Terraform plan, or Azure deployment.

## Project status and licensing

This project is under active development. The ownership, third-party license review, and Git history review described in [the public-source checklist](docs/OPEN-SOURCE-SETUP.md) remain necessary before relying on a public release. Do not commit credentials, Terraform state, or sensitive plan data.
