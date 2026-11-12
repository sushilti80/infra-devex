terraform {
  source = "git::ssh://git@github.com/${get_env("TERRAFORM_MODULES_REPO")}.git//RBAC?ref=${local.latest_tag}"
  # source = "./../../../../../terraform-modules/RBAC"
}

locals {
  envName      = "${basename(dirname(get_terragrunt_dir()))}"
  common_vars  = read_terragrunt_config(find_in_parent_folders("common.hcl"))
  config       = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  location     = local.config.locals.location
  alias        = local.config.locals.alias
  currentsubID = local.config.locals.currentsubID
  latest_tag   = local.config.locals.module_version

}

include "root" {
  path           = find_in_parent_folders("root.hcl")
  merge_strategy = "deep"
  expose         = true
}

dependencies {
  paths = ["../resourcegroup", "../appsvc1", "../appsvc2", "../msi", "../appconfig"]
}

dependency "rg" {
  config_path = "../resourcegroup"
  # skip_outputs = true
  mock_outputs = {
    resource_group_name = local.common_vars.locals.dummyrg
    location            = local.location
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

dependency "appsvc1" {
  config_path = "../appsvc1"
  mock_outputs = {
    principal_id = {
      "${local.config.locals.appsvc1}" = ["${local.common_vars.locals.dummyObjectId}"]
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

dependency "appsvc2" {
  config_path = "../appsvc2"
  mock_outputs = {
    principal_id = {
      "${local.config.locals.appsvc2}" = ["${local.common_vars.locals.dummyObjectId}"]
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}


inputs = {
  location            = dependency.rg.outputs.location
  resource_group_name = dependency.rg.outputs.resource_group_name

  servicePrinciple_rbac = [
    {
      service_principle_id = dependency.appsvc1.outputs.principal_id[local.config.locals.appsvc1][0]
      roles = [
        {
          scope                = "/subscriptions/${local.currentsubID}/resourceGroups/example-${local.envName}-spoke-vnet-rg-${local.alias}-01/providers/Microsoft.KeyVault/vaults/${local.common_vars.locals.env_key_vault_name}"
          role_definition_name = "Key Vault Secrets Officer"
        },
        {
          scope                = "/subscriptions/${local.currentsubID}/resourceGroups/example-${local.envName}-${local.alias}-appcfg-01_rg/providers/Microsoft.AppConfiguration/configurationStores/example-${local.envName}-backend-${local.alias}-appcfg-01"
          role_definition_name = "App Configuration Data Owner"
        }
      ]
    },
    {
      service_principle_id = dependency.appsvc2.outputs.principal_id[local.config.locals.appsvc2][0]
      roles = [
        {
          scope                = "/subscriptions/${local.currentsubID}/resourceGroups/example-${local.envName}-spoke-vnet-rg-${local.alias}-01/providers/Microsoft.KeyVault/vaults/${local.common_vars.locals.env_key_vault_name}"
          role_definition_name = "Key Vault Secrets Officer"
        },
        {
          scope                = "/subscriptions/${local.currentsubID}/resourceGroups/example-${local.envName}-${local.alias}-appcfg-01_rg/providers/Microsoft.AppConfiguration/configurationStores/example-${local.envName}-backend-${local.alias}-appcfg-01"
          role_definition_name = "App Configuration Data Owner"
        }
      ]
    }
  ]
}
