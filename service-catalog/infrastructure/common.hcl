locals {
  settings           = jsondecode(get_env("CATALOG_CONFIG_JSON", "{}"))
  subscriptions      = lookup(local.settings, "subscriptions", {})
  modules_repo       = get_env("TERRAFORM_MODULES_REPO")
  module_version     = get_env("TERRAFORM_MODULE_REF", "main")
  envName            = basename(dirname(get_original_terragrunt_dir()))
  location           = lookup(local.settings, "location", "westus2")
  alias              = lookup(local.settings, "alias", "wus2")
  network            = lookup(local.settings, "network", {})
  spoke_vnet_name    = lookup(local.network, "vnet_name", "")
  spoke_vnet_rg      = lookup(local.network, "vnet_resource_group", "")
  pe_subnet_name     = lookup(local.network, "private_endpoint_subnet", "")
  law_name           = lookup(local.settings, "log_analytics_workspace", "")
  law_rg             = lookup(local.settings, "log_analytics_resource_group", "")
  env_key_vault_name = lookup(local.settings, "key_vault_name", "")
  env_key_vault_rg   = lookup(local.settings, "key_vault_resource_group", "")
  sharedsvcsub       = lookup(local.settings, "shared_subscription_id", lookup(local.subscriptions, local.envName, ""))
  ms_ent_sub         = lookup(local.settings, "dns_subscription_id", lookup(local.subscriptions, local.envName, ""))
  security_sub       = lookup(local.settings, "security_subscription_id", lookup(local.subscriptions, local.envName, ""))
  dummyrg            = "mock-resource-group"
  dummyObjectId      = "00000000-0000-0000-0000-000000000000"
  dummy_msi_id       = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/mock-resource-group/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mock-identity"
  dummystrgId        = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/mock-resource-group/providers/Microsoft.Storage/storageAccounts/mockstorage"
  dummyappConfigId   = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/mock-resource-group/providers/Microsoft.AppConfiguration/configurationStores/mock-config"
}

inputs = merge(lookup(local.settings, "inputs", {}), {
  spoke_vnet_name          = local.spoke_vnet_name
  spoke_vnet_rg            = local.spoke_vnet_rg
  law_name                 = local.law_name
  law_rg                   = local.law_rg
  env_key_vault_name       = local.env_key_vault_name
  diags_storage_account_id = lookup(local.settings, "diagnostics_storage_id", "")
  location                 = local.location
  environment              = local.envName
  envName                  = local.envName
  key_vault_name           = local.env_key_vault_name
  key_vault_rg             = local.env_key_vault_rg
})
