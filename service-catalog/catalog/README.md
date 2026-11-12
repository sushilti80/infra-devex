# Azure module catalog

The initial catalog offers an Azure resource group and storage account using
Microsoft Azure Verified Modules. `modules.json` records the upstream release,
immutable Git commit, license, input origins, outputs, and dependencies. The
generator emits one Terragrunt configuration per module and automatically adds
the resource group required by storage. Both modules disable optional telemetry.

For local generation from the root of a copied catalog repository:

```sh
PROJECT_NAME=demo ENVIRONMENT=dev MODULES=storageV2 node catalog/generate.mjs
```

This command requires no Azure subscription or credentials. The generator creates infrastructure files only. The existing workflow supplies
`env.hcl`, metadata, and the pull request. The storage account name is derived
from project and environment plus a short hash. Azure storage names are globally
unique; a collision requires choosing a different project name. Review the
generated name, network configuration, and plan before deployment.

Each module has its own state. Storage reads `resource_id` from the resource group
dependency. Mock output is used only for plan/validate when real outputs do not
exist, so an initial plan is indicative; review a fresh plan after the resource
group exists. Apply still needs real dependency outputs.

Only new catalog-managed module directories are supported. Existing hand-written
or previously generated module directories are rejected, and changed managed files
are not overwritten. Do not point these modules at existing Terraform state or
resources without a separate reviewed migration. Pinned versions describe the
tested upstream interfaces, not a guarantee of a successful Azure deployment.

To add an offering, extend the catalog and generator together, including input
validation, dependencies, version pins, licensing, and offline regression tests.
This is not yet a generic arbitrary-module importer.
