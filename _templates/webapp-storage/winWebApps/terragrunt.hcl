terraform {
  source = "git::ssh://git@github.com/${get_env("TERRAFORM_MODULES_REPO")}.git//appServiceWindows?ref=${local.latest_tag}"
  # source = "./../../../../../terraform-modules/appServiceWindows"
}

locals {
  envName              = "${basename(dirname(get_terragrunt_dir()))}"
  common_vars          = read_terragrunt_config(find_in_parent_folders("common.hcl"))
  config               = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  location             = local.config.locals.location
  alias                = local.config.locals.alias
  currentsubID         = local.config.locals.currentsubID
  prefix               = local.config.locals.prefix
  latest_tag           = local.config.locals.module_version
  spoke_vnet_name      = local.common_vars.locals.spoke_vnet_name
  spoke_vnet_rg        = local.common_vars.locals.spoke_vnet_rg
  vnet_int_subnet_id   = "/subscriptions/${local.currentsubID}/resourceGroups/${local.spoke_vnet_rg}/providers/Microsoft.Network/virtualNetworks/${local.spoke_vnet_name}/subnets/${local.vnet_int_subnet_name}"
  vnet_int_subnet_name = local.config.locals.winApp1_subnet_name
}

include "root" {
  path           = find_in_parent_folders("root.hcl")
  merge_strategy = "deep"
  expose         = true
}

dependencies {
  paths = ["../resourcegroup", "../appConfiguration"]
}

dependency "rg" {
  config_path = "../resourcegroup"
  mock_outputs = {
    resource_group_name = local.config.locals.resource_group_name
    location            = local.location
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

dependency "appConf" {

  config_path = "../appConfiguration"
  mock_outputs = {
    app_configuration_name = local.config.locals.app_configuration_name
    endpoint               = "dummyendpoint"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

inputs = {
  location            = dependency.rg.outputs.location
  resource_group_name = dependency.rg.outputs.resource_group_name

  # ROle Assignment
  key_vault_name = "example-${local.envName}-kv-wus-01"
  key_vault_rg   = "example-${local.envName}-spoke-vnet-rg-wus-01"
  pe_subnet_name = local.config.locals.pe_subnet_name

  app_plan_name     = local.config.locals.appsvcplan
  worker_count      = "1"
  os_type           = "Windows"
  sku_name          = "P0v3"
  health_check_path = "/health/full"
  app_services = {
    app1 = {
      name                        = local.config.locals.appsvc1
      dotnet_version              = "v8.0"
      current_stack               = "dotnet"
      enable_application_insights = false
      enable_kv_role_assignments  = true
      enable_data_dog_extension   = false
      app_settings = {
        "DD_API_KEY"                = "@Microsoft.KeyVault(VaultName=example-${local.envName}-kv-wus-01;SecretName=datadog-key)"
        "DD_ENV"                    = "example-${local.envName}"
        "DD_SERVICE"                = local.config.locals.appsvc1
        "DD_APPLICATION"            = local.config.locals.appsvc1
        "ConfigManagement:Endpoint" = "https://${local.config.locals.app_configuration_name}.azconfig.io"
      }
    }
  }
  vnet_int_subnet_id = local.vnet_int_subnet_id
}
