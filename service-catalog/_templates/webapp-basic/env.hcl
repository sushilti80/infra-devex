locals {
  metadata       = jsondecode(file(find_in_parent_folders("metadata.json")))
  app_metadata   = local.metadata.app_metadata
  extra_tags     = local.app_metadata
  envName        = "${basename(dirname(get_original_terragrunt_dir()))}"
  common_vars    = read_terragrunt_config(find_in_parent_folders("common.hcl"))
  currentsubID   = local.common_vars.locals.subscriptions[local.envName]
  parentdir      = "${get_terragrunt_dir()}/../"
  appName        = local.metadata.project
  prefix         = local.appName
  location       = local.common_vars.locals.location
  alias          = local.common_vars.locals.alias
  module_version = local.common_vars.locals.module_version


  resource_group_name         = "${local.prefix}-${local.envName}-${local.alias}-rg-1"
  minimumElasticInstanceCount = 1
  maximumElasticWorkerCount   = 5
  targetWorkerCount           = 1
  appsvcplan1                 = "${local.prefix}-${local.envName}-${local.alias}-plan-1"
  appsvcplan2                 = "${local.prefix}-${local.envName}-${local.alias}-plan-2"
  appsvc1                     = "${local.prefix}-${local.envName}-${local.alias}-app-1"
  appsvc2                     = "${local.prefix}-${local.envName}-${local.alias}-app-2"

  appsvsc1_subnet_name = "${local.prefix}-${local.envName}-${local.alias}-snet-1"
  appsvsc2_subnet_name = "${local.prefix}-${local.envName}-${local.alias}-snet-2"
  pe_subnet_name       = local.common_vars.locals.pe_subnet_name

  key_vault_name = local.common_vars.locals.env_key_vault_name
  key_vault_rg   = local.common_vars.locals.env_key_vault_rg
  appconfig      = "${local.prefix}-${local.envName}-${local.alias}-appcfg-1"
  msi_name       = "${local.prefix}-${local.envName}-${local.alias}-id-1"
}
