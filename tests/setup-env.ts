import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
require('dotenv').config = () => ({ parsed: {} })

Object.assign(process.env, {
  NODE_ENV: 'test',
  GITHUB_APP_ID: '',
  GITHUB_INSTALLATION_ID: '',
  GITHUB_PRIVATE_KEY: '',
  GITHUB_PRIVATE_KEY_PATH: '',
  GITHUB_CODE_APP_ID: '',
  GITHUB_CODE_INSTALLATION_ID: '',
  GITHUB_CODE_PRIVATE_KEY: '',
  GITHUB_CODE_PRIVATE_KEY_PATH: '',
  GITHUB_SERVICE_REPO: 'organization/service-catalog',
  GITHUB_SELF_SERVICE_REPO: 'organization/self-service-infra',
  GITHUB_MODULES_REPO: 'organization/terraform-modules',
  GITHUB_INFRA_LIVE_REPO: 'organization/infrastructure-live',
  GITHUB_CODE_SERVICE_REPO: 'organization/self-service-catalog',
  AKS_FLUX_REPO: 'organization/flux-config',
  AKS_DEFAULT_REGISTRY: 'exampleregistry.azurecr.io',
  SHIP_REGISTRY: 'exampleregistry.azurecr.io',
  AKS_PRIVATE_ZONES: '{}'
})