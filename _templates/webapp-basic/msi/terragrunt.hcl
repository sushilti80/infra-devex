terraform {
  source = "git::ssh://git@github.com/${get_env("TERRAFORM_MODULES_REPO")}.git//UserAssignMSI?ref=${local.latest_tag}"
  # source = "./../../../../../terraform-modules/UserAssignMSI"
}

include "root" {
  path           = find_in_parent_folders("root.hcl")
  merge_strategy = "deep"
  expose         = true
}

locals {
  envName      = "${basename(dirname(get_terragrunt_dir()))}"
  common_vars  = read_terragrunt_config(find_in_parent_folders("common.hcl"))
  config       = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  currentsubID = local.config.locals.currentsubID
  location     = local.config.locals.location
  alias        = local.config.locals.alias
  latest_tag   = local.config.locals.module_version
}

dependencies {
  paths = ["../resourcegroup", ]
}

dependency "rg" {
  config_path = "../resourcegroup"
  mock_outputs = {
    resource_group_name = local.common_vars.locals.dummyrg
    location            = local.location
  }
  mock_outputs_allowed_terraform_commands = ["plan", "init"]
}


inputs = {
  location            = dependency.rg.outputs.location
  resource_group_name = dependency.rg.outputs.resource_group_name
  msi_name            = local.config.locals.msi_name
}
