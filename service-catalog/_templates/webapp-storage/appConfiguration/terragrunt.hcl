terraform {
  source = "git::ssh://git@github.com/${get_env("TERRAFORM_MODULES_REPO")}.git//appConfiguration?ref=${local.latest_tag}"

}

locals {
  envName     = "${basename(dirname(get_terragrunt_dir()))}"
  common_vars = read_terragrunt_config(find_in_parent_folders("common.hcl"))
  config      = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  location    = local.config.locals.location
  alias       = local.config.locals.alias
  latest_tag  = local.config.locals.module_version
}

include "root" {
  path           = find_in_parent_folders("root.hcl")
  merge_strategy = "deep"
  expose         = true
}

dependencies {
  paths = ["../resourcegroup", "../storage"]
}

dependency "rg" {
  config_path = "../resourcegroup"
  mock_outputs = {
    resource_group_name = local.config.locals.resource_group_name
    location            = local.location
  }
  # skip_outputs = true
  mock_outputs_allowed_terraform_commands = ["init", "plan"]
}

dependency "strg" {
  config_path = "../storage"
  mock_outputs = {
    storage_account_name   = local.config.locals.storage_account_name
    primary_table_endpoint = "https://dummyendpoint"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

inputs = {
  location               = local.location                            #location for all resources
  resource_group_name    = dependency.rg.outputs.resource_group_name #ResourceGroup name to be create
  app_configuration_name = local.config.locals.app_configuration_name
  app_configuration_keys = {
    "TableServiceOptions:TableEndpoint" = {
      value = "https://${local.config.locals.storage_account_name}.table.core.windows.net"
    }
    "RedisCacheOptions:CacheHostName" = {
      value = "${local.config.locals.env_redis}.redis.cache.windows.net"
    }
  }
  spoke_vnet_name = local.config.locals.spoke_vnet_name
  spoke_vnet_rg   = local.config.locals.spoke_vnet_rg
}
