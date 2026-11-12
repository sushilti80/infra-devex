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
  paths = ["../resourcegroup", "../storage", "../winWebApps", "../appConfiguration"]
}

dependency "rg" {
  config_path = "../resourcegroup"
  # skip_outputs = true
  mock_outputs = {
    resource_group_name = local.config.locals.resource_group_name
    location            = local.location
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

dependency "appsvc" {
  config_path = "../winWebApps"
  mock_outputs = {
    principal_id = {
      "${local.config.locals.appsvc1}" = ["${local.common_vars.locals.dummyObjectId}"]
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}
dependency "strg" {
  config_path = "../storage"
  mock_outputs = {
    storage_account_name = local.config.locals.storage_account_name
    storage_account_id   = local.common_vars.locals.dummystrgId
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

dependency "appConf" {
  config_path = "../appConfiguration"
  mock_outputs = {
    app_configuration_name = local.config.locals.app_configuration_name
    app_configuration_id   = local.common_vars.locals.dummyappConfigId
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

inputs = {
  location            = dependency.rg.outputs.location            # location for all resources
  resource_group_name = dependency.rg.outputs.resource_group_name #ResourceGroup name to be created

  redis_policy_assignment = {
    app1 = {
      redis_cache_id  = "/subscriptions/${local.currentsubID}/resourceGroups/example-${local.envName}-wus-redis-01_rg/providers/Microsoft.Cache/redis/example-${local.envName}-wus-redis-01"
      object_id       = dependency.appsvc.outputs.principal_id[local.config.locals.appsvc1][0]
      object_id_alias = local.config.locals.appsvc1
    }
  }

  servicePrinciple_rbac = [
    {
      service_principle_id = dependency.appsvc.outputs.principal_id[local.config.locals.appsvc1][0]
      roles = [
        {
          scope                = dependency.strg.outputs.storage_account_id
          role_definition_name = "Storage Table Data Contributor"
        },
        {
          scope                = "/subscriptions/${local.currentsubID}/resourceGroups/webapp-storage-${local.envName}-wus-rg-1/providers/Microsoft.appConfiguration/configurationStores/${local.config.locals.app_configuration_name}"
          role_definition_name = "App Configuration Data Reader"
        }
      ]
    }
  ]
}
