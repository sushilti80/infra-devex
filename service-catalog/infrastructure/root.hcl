
locals {
  config                     = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  common_vars                = read_terragrunt_config(find_in_parent_folders("common.hcl"))
  rscfg                      = yamldecode(file(find_in_parent_folders("remote_state.yml")))
  prefix                     = local.config.locals.prefix
  currentsubID               = local.config.locals.currentsubID
  envName                    = local.config.locals.envName
  parentdir                  = "${get_terragrunt_dir()}/../../"
  path                       = basename(dirname(local.parentdir))
  alias                      = local.config.locals.alias
  common_remote_state_rgname = local.rscfg.remote_state.common.resource_group_name
  common_remote_state_name   = local.rscfg.remote_state.common.storage_account_name
  dr_remote_state_rgname     = local.rscfg.remote_state.dr.resource_group_name
  dr_remote_state_name       = local.rscfg.remote_state.dr.storage_account_name
}

generate "backend" {
  path      = "backend.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
  %{if local.envName != "dr"}
    terraform {
      backend "azurerm" {
        key = "${path_relative_to_include()}/terraform.tfstate"
        resource_group_name  = "${local.common_remote_state_rgname}"
        storage_account_name = "${local.common_remote_state_name}"
        container_name       = "${local.rscfg.remote_state.common.container_name}"
        use_azuread_auth     = true
      }
    }
  %{endif}
  %{if local.envName == "dr"}
    terraform {
      backend "azurerm" {
        key = "${path_relative_to_include()}/terraform.tfstate"
        resource_group_name  = "${local.dr_remote_state_rgname}"
        storage_account_name = "${local.dr_remote_state_name}"
        container_name       =  "${local.rscfg.remote_state.dr.container_name}"
        use_azuread_auth     =  true
      }
    }
  %{endif}
EOF
}

generate "versions" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
    provider "azurerm" {
      features {}
      subscription_id = "${local.currentsubID}"
      storage_use_azuread = true
    }
    provider "azurerm" {
      # to access diag storage account
      features {}
      alias           = "sharedsvcsub"
      subscription_id = "${local.common_vars.locals.sharedsvcsub}"
    }

    provider "azurerm" {
      # Microsoft Azure Enterprise - to register private dns
      features {}
      alias           = "ms_ent_sub"
      subscription_id = "${local.common_vars.locals.ms_ent_sub}"
    }
    provider "azurerm" {
      # Microsoft Azure Enterprise - to register private dns
      features {}
      alias           = "security_sub"
      subscription_id = "${local.common_vars.locals.security_sub}"
    }
EOF
}

inputs = merge(
  local.common_vars.inputs,
  {
    extra_tags = merge(
      # local.common_vars.locals.common_tags,       # This includes the common tags defined in common.hcl
      local.config.locals.app_metadata, # This allows env-specific tags to override common tags if needed
      {
        service            = "${local.prefix}"
        env                = local.envName
        createdate         = lookup(local.config.locals, "createdate", "")
        dataclassification = lookup(local.config.locals, "dataclassification", "")
        businessunit       = lookup(local.config.locals, "businessunit", "")
        product            = lookup(local.config.locals, "product", "")
        productowner       = lookup(local.config.locals, "productowner", "")
        serviceowner       = lookup(local.config.locals, "serviceowner", "")
      }
    )
  }
)
