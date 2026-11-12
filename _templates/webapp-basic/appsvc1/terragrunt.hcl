include "root" {
  path           = find_in_parent_folders("root.hcl")
  merge_strategy = "deep"
  expose         = true
}

locals {
  envName     = "${basename(dirname(get_terragrunt_dir()))}"
  common_vars = read_terragrunt_config(find_in_parent_folders("common.hcl"))
  config      = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  prefix      = local.config.locals.prefix
  location    = local.config.locals.location
  alias       = local.config.locals.alias
  latest_tag  = local.config.locals.module_version
  appconfig   = local.config.locals.appconfig

  currentsubID         = local.config.locals.currentsubID
  spoke_vnet_name      = local.common_vars.locals.spoke_vnet_name
  spoke_vnet_rg        = local.common_vars.locals.spoke_vnet_rg
  vnet_int_subnet_id   = "/subscriptions/${local.currentsubID}/resourceGroups/${local.spoke_vnet_rg}/providers/Microsoft.Network/virtualNetworks/${local.spoke_vnet_name}/subnets/${local.vnet_int_subnet_name}"
  vnet_int_subnet_name = local.config.locals.appsvsc1_subnet_name
}

terraform {
  source = "git::ssh://git@github.com/${get_env("TERRAFORM_MODULES_REPO")}.git//appServiceWindows?ref=${local.latest_tag}"
  # source = "./../../../../../../terraform-modules/appServiceWindows"
}

dependencies {
  paths = ["../resourcegroup", "../msi", "../appconfig"]
}

dependency "rg" {
  config_path = "../resourcegroup"
  mock_outputs = {
    resource_group_name = local.common_vars.locals.dummyrg
    location            = local.location
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

dependency "msi" {
  config_path = "../msi"
  mock_outputs = {
    msi_id = local.common_vars.locals.dummy_msi_id
  }
  mock_outputs_allowed_terraform_commands = ["plan", "init"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

inputs = {
  location            = dependency.rg.outputs.location            # location for all resources
  resource_group_name = dependency.rg.outputs.resource_group_name # ResourceGroup name to be created

  # Role Assignment
  key_vault_name = local.config.locals.key_vault_name
  key_vault_rg   = local.config.locals.key_vault_rg
  msi_id         = [dependency.msi.outputs.msi_id]
  pe_subnet_name = local.config.locals.pe_subnet_name
  azapi_serverfarms = {
    maximumElasticWorkerCount = local.config.locals.maximumElasticWorkerCount
    targetWorkerCount         = local.config.locals.targetWorkerCount
  }

  app_plan_name = local.config.locals.appsvcplan1
  worker_count  = "1"
  os_type       = "Windows"
  sku_name      = "P0v3"
  app_services = {
    app1 = {
      name                        = local.config.locals.appsvc1
      dotnet_version              = "v6.0"
      current_stack               = "dotnet"
      enable_application_insights = false
      enable_kv_role_assignments  = true
      enable_data_dog_extension   = false
      azapi_sites = {
        minimumElasticInstanceCount = local.config.locals.minimumElasticInstanceCount
      }
      app_settings = {
        "DD_API_KEY"         = "@Microsoft.KeyVault(VaultName=${local.common_vars.locals.env_key_vault_name};SecretName=datadog-key)"
        "DD_ENV"             = "${local.envName}"
        "DD_SERVICE"         = "${local.prefix}"
        "DD_APPLICATION"     = "${local.prefix}"
        "WEBSITE_TIME_ZONE"  = "Pacific Standard Time"
        "AppConfig:Endpoint" = "https://${local.appconfig}.azconfig.io"
      }
    }
  }
  vnet_int_subnet_id = local.vnet_int_subnet_id
}
