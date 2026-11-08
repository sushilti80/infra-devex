locals {
  metadata            = jsondecode(file(find_in_parent_folders("metadata.json")))
  app_metadata        = local.metadata.app_metadata
  extra_tags          = local.app_metadata
  common_vars         = read_terragrunt_config(find_in_parent_folders("common.hcl")) #load common hcl config
  envName             = "${basename(dirname(get_original_terragrunt_dir()))}"        # gets current env name
  currentsubID        = local.common_vars.locals.subscriptions[local.envName]
  parentdir           = "${get_terragrunt_dir()}/../"
  prefix              = local.metadata.project
  resource_group_name = "${local.prefix}-${local.envName}-${local.alias}-rg-1"
  location            = local.common_vars.locals.location
  alias               = local.common_vars.locals.alias
  module_version      = local.common_vars.locals.module_version
  spoke_vnet_name     = local.common_vars.locals.spoke_vnet_name
  spoke_vnet_rg       = local.common_vars.locals.spoke_vnet_rg
  spoke_suffix        = "01"

  winApp1_subnet_name = "${local.prefix}-${local.envName}-${local.alias}-snet-1"
  pe_subnet_name      = local.common_vars.locals.pe_subnet_name

  appsvc1 = "${local.prefix}-${local.envName}-${local.alias}-app-1"
  appsvc2 = "${local.prefix}-${local.envName}-${local.alias}-app-2"

  appsvcplan             = "${local.prefix}-${local.envName}-${local.alias}-plan-1"
  env_redis              = "example-${local.envName}-${local.alias}-redis-01"
  storage_account_name   = lower("${local.prefix}${local.envName}${local.alias}st1")
  app_configuration_name = "${local.prefix}-${local.envName}-${local.alias}-appcfg-1"
  owner                  = local.app_metadata.owner
}
