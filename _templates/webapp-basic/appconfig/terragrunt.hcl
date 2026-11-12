terraform {
  source = "git::ssh://git@github.com/${get_env("TERRAFORM_MODULES_REPO")}.git//appConfiguration?ref=${local.latest_tag}"

}

locals {
  envName       = "${basename(dirname(get_terragrunt_dir()))}"
  common_locals = read_terragrunt_config(find_in_parent_folders("common.hcl"))
  config        = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  location      = local.config.locals.location
  alias         = local.config.locals.alias
  latest_tag    = local.config.locals.module_version
  currentsubID  = local.config.locals.currentsubID
  appconfig     = local.config.locals.appconfig
}

include "root" {
  path           = find_in_parent_folders("root.hcl")
  merge_strategy = "deep"
  expose         = true
}

dependencies {
  paths = ["../resourcegroup"]
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

inputs = {
  resource_group_name     = dependency.rg.outputs.resource_group_name
  app_configuration_name  = local.appconfig
  enable_private_endpoint = false

}
