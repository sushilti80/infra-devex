dependency "resource_group" {
  config_path = "../resourcegroups"
  mock_outputs = { resource_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/mock-rg" }
  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
}

inputs = {
  name             = "{{storage_name}}"
  location         = local.env.locals.location
  parent_id        = dependency.resource_group.outputs.resource_id
  enable_telemetry = false
}
