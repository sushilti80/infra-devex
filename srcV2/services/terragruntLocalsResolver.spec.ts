import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const githubService = require('../../services/githubService')
const resolver = require('../../services/terragruntLocalsResolver')

describe('terragruntLocalsResolver', () => {
  afterEach(() => vi.restoreAllMocks())

  it('resolves an aliased Key Vault name using the environment directory', async () => {
    const files: Record<string, string> = {
      'infrastructure/commHub/dev/keyvault/terragrunt.hcl': `
        locals {
          env = read_terragrunt_config(find_in_parent_folders("env.hcl"))
        }
        inputs = {
          keyvaultname = local.env.locals.keyvaultname
        }
      `,
      'infrastructure/commHub/dev/env.hcl': `
        locals {
          envName = "\${basename(dirname(get_original_terragrunt_dir()))}" # gets current env name
          prefix = "commhub"
          alias = "wus"
          keyvaultname = "\${local.prefix}-\${local.envName}-\${local.alias}-kv-1"
        }
      `
    }
    vi.spyOn(githubService, 'getFileContent').mockImplementation(async (_repo: string, path: string) => {
      return files[path] ? { content: files[path] } : null
    })

    await expect(resolver.resolveName(
      'infrastructure/commHub/dev/keyvault',
      'live',
      'cid-resolver'
    )).resolves.toBe('commhub-dev-wus-kv-1')
  })

  it('resolves a Key Vault name defined only in a shared file via `include` (ITG-style)', async () => {
    const files: Record<string, string> = {
      'infrastructure/ITG/dev/keyvault/terragrunt.hcl': `
        locals {
          config = read_terragrunt_config(find_in_parent_folders("env.hcl"))
        }
        include "appConfiguration" {
          path = find_in_parent_folders("keyvault.hcl")
        }
      `,
      'infrastructure/ITG/keyvault.hcl': `
        inputs = {
          keyvaultname = local.config.locals.keyvaultname
        }
      `,
      'infrastructure/ITG/dev/env.hcl': `
        locals {
          keyvaultname = "itg-dev-wus-kv-1"
        }
      `
    }
    vi.spyOn(githubService, 'getFileContent').mockImplementation(async (_repo: string, path: string) => {
      return files[path] ? { content: files[path] } : null
    })

    await expect(resolver.resolveName(
      'infrastructure/ITG/dev/keyvault',
      'live',
      'cid-resolver'
    )).resolves.toBe('itg-dev-wus-kv-1')
  })

  it('prefers the vault\'s own `inputs.keyvaultname` over an `include`d shared value', async () => {
    const files: Record<string, string> = {
      'infrastructure/ITG/dev/keyvault/terragrunt.hcl': `
        include "appConfiguration" {
          path = find_in_parent_folders("keyvault.hcl")
        }
        inputs = {
          keyvaultname = "own-vault-name"
        }
      `,
      'infrastructure/ITG/keyvault.hcl': `
        inputs = {
          keyvaultname = "shared-vault-name"
        }
      `
    }
    vi.spyOn(githubService, 'getFileContent').mockImplementation(async (_repo: string, path: string) => {
      return files[path] ? { content: files[path] } : null
    })

    await expect(resolver.resolveName(
      'infrastructure/ITG/dev/keyvault',
      'live',
      'cid-resolver'
    )).resolves.toBe('own-vault-name')
  })

  it('returns null (not a throw) when an `include` target file cannot be found upward', async () => {
    const files: Record<string, string> = {
      'infrastructure/ITG/dev/keyvault/terragrunt.hcl': `
        include "appConfiguration" {
          path = find_in_parent_folders("missing-keyvault.hcl")
        }
      `
    }
    vi.spyOn(githubService, 'getFileContent').mockImplementation(async (_repo: string, path: string) => {
      return files[path] ? { content: files[path] } : null
    })

    await expect(resolver.resolveName(
      'infrastructure/ITG/dev/keyvault',
      'live',
      'cid-resolver'
    )).resolves.toBeNull()
  })

  it('terminates without hanging when included files form an `include` cycle', async () => {
    const files: Record<string, string> = {
      'infrastructure/CycleApp/dev/keyvault/terragrunt.hcl': `
        include "a" {
          path = find_in_parent_folders("shared1.hcl")
        }
      `,
      'infrastructure/CycleApp/shared1.hcl': `
        include "b" {
          path = find_in_parent_folders("shared2.hcl")
        }
      `,
      'infrastructure/CycleApp/shared2.hcl': `
        include "c" {
          path = find_in_parent_folders("shared1.hcl")
        }
      `
    }
    vi.spyOn(githubService, 'getFileContent').mockImplementation(async (_repo: string, path: string) => {
      return files[path] ? { content: files[path] } : null
    })

    await expect(resolver.resolveName(
      'infrastructure/CycleApp/dev/keyvault',
      'live',
      'cid-resolver'
    )).resolves.toBeNull()
  })

  it('resolves a Key Vault name through a 2-hop alias chain guarded by a contains()-ternary (ayaApplications-style)', async () => {
    const files: Record<string, string> = {
      'infrastructure/ayaCore/dev/keyvault/terragrunt.hcl': `
        locals {
          env = read_terragrunt_config(find_in_parent_folders("env.hcl"))
        }
        inputs = {
          keyvaultname = local.env.locals.keyvaultname
        }
      `,
      'infrastructure/ayaCore/dev/env.hcl': `
        locals {
          common_vars = read_terragrunt_config(find_in_parent_folders("common.hcl"))
          keyvaultname = local.common_vars.locals.env_key_vault_name
        }
      `,
      'infrastructure/ayaCore/common.hcl': `
        locals {
          envName = "\${basename(dirname(get_original_terragrunt_dir()))}"
          intsuffix = contains(["cint", "sint"], "\${local.envName}") ? "1" : "01"
          env_key_vault_name = contains(["shared"], "\${local.envName}") ? "aya-shared-services-kv-1" : "aya-\${local.envName}-kv-\${local.intsuffix}"
        }
      `
    }
    vi.spyOn(githubService, 'getFileContent').mockImplementation(async (_repo: string, path: string) => {
      return files[path] ? { content: files[path] } : null
    })

    await expect(resolver.resolveName(
      'infrastructure/ayaCore/dev/keyvault',
      'live',
      'cid-resolver'
    )).resolves.toBe('aya-dev-kv-01')
  })

  it('resolves an equality ternary (`X == "literal"`) independent of contains()', async () => {
    const files: Record<string, string> = {
      'infrastructure/EqApp/cint/keyvault/terragrunt.hcl': `
        locals {
          envName = "\${basename(dirname(get_original_terragrunt_dir()))}" == "default" ? "fallback" : "\${basename(dirname(get_original_terragrunt_dir()))}"
        }
        inputs = {
          keyvaultname = "eqapp-\${local.envName}-kv-1"
        }
      `
    }
    vi.spyOn(githubService, 'getFileContent').mockImplementation(async (_repo: string, path: string) => {
      return files[path] ? { content: files[path] } : null
    })

    await expect(resolver.resolveName(
      'infrastructure/EqApp/cint/keyvault',
      'live',
      'cid-resolver'
    )).resolves.toBe('eqapp-cint-kv-1')
  })

  it('resolves a Key Vault name via `lookup()` against a locals map literal (sint-style)', async () => {
    const files: Record<string, string> = {
      'infrastructure/LookupApp/sint/keyvault/terragrunt.hcl': `
        locals {
          env = read_terragrunt_config(find_in_parent_folders("env.hcl"))
        }
        inputs = {
          keyvaultname = local.env.locals.keyvaultname
        }
      `,
      'infrastructure/LookupApp/sint/env.hcl': `
        locals {
          common_vars = read_terragrunt_config(find_in_parent_folders("common.hcl"))
          keyvaultname = local.common_vars.locals.env_key_vault_name
        }
      `,
      'infrastructure/LookupApp/common.hcl': `
        locals {
          envName = "\${basename(dirname(get_original_terragrunt_dir()))}"
          envkvcount = {
            poc  = "02"
            sint = "2"
            demo = "03"
          }
          envcount = lookup(local.envkvcount, "\${local.envName}", "")
          kvintsuffix = contains(["poc", "sint", "demo"], "\${local.envName}") ? "\${local.envcount}" : "01"
          env_key_vault_name = "aya-\${local.envName}-kv-\${local.kvintsuffix}"
        }
      `
    }
    vi.spyOn(githubService, 'getFileContent').mockImplementation(async (_repo: string, path: string) => {
      return files[path] ? { content: files[path] } : null
    })

    await expect(resolver.resolveName(
      'infrastructure/LookupApp/sint/keyvault',
      'live',
      'cid-resolver'
    )).resolves.toBe('aya-sint-kv-2')
  })

  it('resolves a per-hop `get_terragrunt_dir()` (varies per alias hop, unlike get_original_terragrunt_dir) through `lower()`/generic `basename()`/`dirname()` (idm-style)', async () => {
    const files: Record<string, string> = {
      'infrastructure/idm/devsand/keyvault/terragrunt.hcl': `
        locals {
          env = read_terragrunt_config(find_in_parent_folders("env.hcl"))
        }
        inputs = {
          keyvaultname = local.env.locals.keyvaultname
        }
      `,
      'infrastructure/idm/devsand/env.hcl': `
        locals {
          envName   = lower(basename(get_terragrunt_dir()))
          parentdir = "\${get_terragrunt_dir()}/../"
          prefix    = lower(basename(dirname(local.parentdir)))
          alias     = "uks"
          keyvaultname = "\${local.prefix}-\${local.envName}-\${local.alias}-kv-1"
        }
      `
    }
    vi.spyOn(githubService, 'getFileContent').mockImplementation(async (_repo: string, path: string) => {
      return files[path] ? { content: files[path] } : null
    })

    await expect(resolver.resolveName(
      'infrastructure/idm/devsand/keyvault',
      'live',
      'cid-resolver'
    )).resolves.toBe('idm-devsand-uks-kv-1')
  })

  it('resolves `resource_group_name` via `dependency.NAME.outputs.FIELD` by reading the dependency directory\'s own `inputs` (idm sub-app-style)', async () => {
    const files: Record<string, string> = {
      'infrastructure/idm/_idmapplications/idmprtl/devsand/keyvault/terragrunt.hcl': `
        dependency "rg" {
          config_path = "../resourcegroups"
          mock_outputs = {
            resource_group_name = "dummy-rg"
          }
        }
        inputs = {
          resource_group_name = dependency.rg.outputs.resource_group_name
        }
      `,
      'infrastructure/idm/_idmapplications/idmprtl/devsand/resourcegroups/terragrunt.hcl': `
        inputs = {
          resource_group_name = "idmprtl-devsand-uks-rg-1"
        }
      `
    }
    vi.spyOn(githubService, 'getFileContent').mockImplementation(async (_repo: string, path: string) => {
      return files[path] ? { content: files[path] } : null
    })

    await expect(resolver.resolveResourceGroup(
      'infrastructure/idm/_idmapplications/idmprtl/devsand/keyvault',
      'live',
      'cid-resolver'
    )).resolves.toBe('idmprtl-devsand-uks-rg-1')
  })
})
