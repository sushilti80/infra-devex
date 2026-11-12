inputs = {
  name             = "{{project}}-{{environment}}-rg"
  location         = local.env.locals.location
  enable_telemetry = false
}
