locals {
  metadata       = jsondecode(file(find_in_parent_folders("metadata.json")))
  app_metadata   = local.metadata.app_metadata
  extra_tags     = local.app_metadata
  envName        = "${basename(dirname(get_original_terragrunt_dir()))}"
  common_vars    = read_terragrunt_config(find_in_parent_folders("common.hcl")) #load common hcl config
  currentsubID   = local.common_vars.locals.subscriptions[local.envName]
  parentdir      = "${get_terragrunt_dir()}/../"
  prefix         = local.metadata.project
  location       = local.common_vars.locals.location
  alias          = local.common_vars.locals.alias
  module_version = local.common_vars.locals.module_version
  spoke_suffix   = "01"
  kv_suffix      = "01" #keyvault version

  resource_group_name = "${local.prefix}-${local.envName}-${local.alias}-rg-1"
  appsvcplan          = "${local.prefix}-${local.envName}-${local.alias}-plan-1"

  appsvc1             = "${local.prefix}-${local.envName}-${local.alias}-app-1"
  appsvc2             = "${local.prefix}-${local.envName}-${local.alias}-app-2"
  winApp1_subnet_name = "${local.prefix}-${local.envName}-${local.alias}-snet-1"
  pe_subnet_name      = local.common_vars.locals.pe_subnet_name

  key_vault_name = local.common_vars.locals.env_key_vault_name
  key_vault_rg   = local.common_vars.locals.env_key_vault_rg
}
