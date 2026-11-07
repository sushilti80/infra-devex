import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const secretsService = require('../../services/secretsService')

const { matchVaultsFromEntries, parseSecretNames, upsertSecretBlock, classifyVaultEntry, extractAppEnvPairs } = secretsService._internal

describe('secretsService pure transformations', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('extracts only top-level secret names from encrypted YAML', () => {
    const content = [
      'DATABASE_URL: |',
      '  value: opaque',
      'API-TOKEN: |',
      '  another: opaque',
      '  nested: |',
      '    ignored: value'
    ].join('\n')

    expect(parseSecretNames(content)).toEqual(['DATABASE_URL', 'API-TOKEN'])
  })

  it('matches numbered vault directories and keyvault files across supported layouts', () => {
    const entries = [
      { path: 'infrastructure/mlops/dev/keyvault01', type: 'tree' },
      { path: 'infrastructure/mlops/hub/dev/keyvault.hcl', type: 'blob' },
      { path: 'infrastructure/other/dev/keyvault', type: 'tree' },
      { path: 'infrastructure/mlops/prod/keyvault02', type: 'tree' }
    ]

    const result = matchVaultsFromEntries(entries, 'mlops', 'dev')
    expect(result.vaults).toEqual([
      { vaultDir: 'infrastructure/mlops/dev/keyvault01', vaultName: null, resourceGroup: null },
      { vaultDir: 'infrastructure/mlops/hub/dev', vaultName: null, resourceGroup: null }
    ])
    expect(result.qualifiers).toEqual([])
  })

  it('appends and replaces secret blocks without adding extra blank lines', () => {
    const original = 'FIRST: |\n  encrypted-first\n'

    expect(upsertSecretBlock(original, 'SECOND', 'encrypted-second\n')).toBe(
      'FIRST: |\n  encrypted-first\nSECOND: |\n  encrypted-second\n'
    )
    expect(upsertSecretBlock(original, 'FIRST', 'encrypted-updated\n')).toBe(
      'FIRST: |\n  encrypted-updated\n'
    )
  })

  // ── Round 4 dual-root tests ──────────────────────────────────────────────

  // TS-035: azureDatabricks root match
  it('matches keyvault entries under the azureDatabricks root (TS-035)', () => {
    const entries = [
      { path: 'azureDatabricks/dev/keyvault', type: 'tree' },
      { path: 'azureDatabricks/sit/keyvault', type: 'tree' },
      { path: 'azureDatabricks/prd/keyvault', type: 'tree' },
    ]
    const result = matchVaultsFromEntries(entries, 'azureDatabricks', 'dev')
    expect(result.vaults).toEqual([
      { vaultDir: 'azureDatabricks/dev/keyvault', vaultName: null, resourceGroup: null }
    ])
    expect(result.qualifiers).toEqual([])
  })

  it('does not include an azureDatabricks vault when resolving another application', () => {
    const entries = [
      { path: 'azureDatabricks/dev/keyvault', type: 'tree' },
      { path: 'infrastructure/commhub/dev/keyvault', type: 'tree' }
    ]

    expect(matchVaultsFromEntries(entries, 'commhub', 'dev').vaults).toEqual([
      { vaultDir: 'infrastructure/commhub/dev/keyvault', vaultName: null, resourceGroup: null }
    ])
  })

  // TS-036: `shared` is a literal environment segment, not a wildcard.
  it('matches a `shared` segment only for the shared environment (TS-036)', () => {
    const entries = [
      { path: 'infrastructure/sharedsvc/shared/keyvault', type: 'tree' },
      { path: 'infrastructure/sharedsvc/staging/keyvault', type: 'tree' },
    ]
    const result = matchVaultsFromEntries(entries, 'sharedsvc', 'shared')
    // The `shared` segment matches its own environment; staging only matches its own env.
    expect(result.vaults).toHaveLength(1)
    expect(result.vaults[0].vaultDir).toBe('infrastructure/sharedsvc/shared/keyvault')
    expect(result.qualifiers).toEqual([])
  })

  // TS-037: sub-app qualifier disambiguation — idm/_idmapplications/notif vs autobk
  it('distinguishes sub-app qualifiers under a grouping directory (TS-037)', () => {
    const entries = [
      { path: 'infrastructure/idm/_idmapplications/notif/dev/keyvault', type: 'tree' },
      { path: 'infrastructure/idm/_idmapplications/autobk/dev/keyvault', type: 'tree' },
    ]
    // No qualifier supplied → return both vaults and collect both qualifiers.
    const withoutQual = matchVaultsFromEntries(entries, 'idm', 'dev')
    expect(withoutQual.vaults).toHaveLength(2)
    expect(withoutQual.qualifiers.sort()).toEqual(['autobk', 'notif'])

    // Qualifier supplied → filter to matching only.
    const withQualifier = matchVaultsFromEntries(entries, 'idm', 'dev', 'notif')
    expect(withQualifier.vaults).toHaveLength(1)
    expect(withQualifier.vaults[0].vaultDir).toBe('infrastructure/idm/_idmapplications/notif/dev/keyvault')
    expect(withQualifier.qualifiers).toEqual(['notif'])
  })

  it('resolves a shared parent vault alongside nested IDM application vaults', () => {
    const entries = [
      { path: 'infrastructure/idm/keyvault', type: 'tree' },
      { path: 'infrastructure/idm/_idmapplications/notif/dev/keyvault', type: 'tree' }
    ]

    const result = matchVaultsFromEntries(entries, 'idm', 'dev')
    expect(result.vaults.map((vault: any) => vault.vaultDir).sort()).toEqual([
      'infrastructure/idm/_idmapplications/notif/dev/keyvault',
      'infrastructure/idm/keyvault'
    ])
    expect(result.qualifiers).toEqual(['notif'])
  })

  it('treats the application before keyvaults as the nested qualifier', () => {
    const entries = [
      { path: 'infrastructure/ayaApplications/ayaCoreServices/keyvaults/shared/keyvault', type: 'tree' }
    ]

    const result = matchVaultsFromEntries(entries, 'ayaApplications', 'shared', 'ayaCoreServices')
    expect(result.vaults).toEqual([
      {
        vaultDir: 'infrastructure/ayaApplications/ayaCoreServices/keyvaults/shared/keyvault',
        vaultName: null,
        resourceGroup: null,
        qualifier: 'ayaCoreServices'
      }
    ])
    expect(result.qualifiers).toEqual(['ayaCoreServices'])
  })

  // TS-038: qualifier omitted → qualifiers list returned (already tested in TS-037 without-qualifier path)

  // TS-039: extractAppEnvPairs produces synthetic azureDatabricks entries
  it('extractAppEnvPairs yields synthetic azureDatabricks entries (TS-039)', () => {
    const entries = [
      { path: 'azureDatabricks/dev/keyvault', type: 'tree' },
      { path: 'azureDatabricks/prd/keyvault01', type: 'tree' },
      { path: 'infrastructure/mlops/dev/keyvault', type: 'tree' },
    ]
    const pairs = extractAppEnvPairs(entries)
    expect(pairs).toContainEqual({ name: 'azureDatabricks', environment: 'dev' })
    expect(pairs).toContainEqual({ name: 'azureDatabricks', environment: 'prd' })
    expect(pairs).toContainEqual({ name: 'mlops', environment: 'dev' })
  })

  // TS-039(b): extractAppEnvPairs emits qualifier for sub-apps under grouping dirs
  it('extractAppEnvPairs emits qualifier for sub-apps (TS-039b)', () => {
    const entries = [
      { path: 'infrastructure/idm/_idmapplications/notif/dev/keyvault', type: 'tree' },
      { path: 'infrastructure/idm/_idmapplications/autobk/dev/keyvault', type: 'tree' },
    ]
    const pairs = extractAppEnvPairs(entries)
    expect(pairs).toHaveLength(2)
    expect(pairs).toContainEqual({ name: 'idm', environment: 'dev', qualifier: 'notif' })
    expect(pairs).toContainEqual({ name: 'idm', environment: 'dev', qualifier: 'autobk' })
  })

  it('extractAppEnvPairs emits the nested application before keyvaults as a qualifier', () => {
    const pairs = extractAppEnvPairs([
      { path: 'infrastructure/ayaApplications/ayaCoreServices/keyvaults/shared/keyvault', type: 'tree' }
    ])

    expect(pairs).toEqual([
      { name: 'ayaApplications', environment: 'shared', qualifier: 'ayaCoreServices' }
    ])
  })

  // classifyVaultEntry pure-function unit test
  it('classifyVaultEntry rejects unknown roots and returns qualifier metadata (TS-035-classify)', () => {
    // Unknown root
    expect(classifyVaultEntry(['someother', 'app', 'dev', 'keyvault'], 'app', 'dev')).toBeNull()

    // azureDatabricks happy path
    const adb = classifyVaultEntry(['azureDatabricks', 'dev', 'keyvault'], 'azureDatabricks', 'dev')
    expect(adb).toEqual({ appName: 'azureDatabricks', qualifier: null })

    // infrastructure happy path
    const infra = classifyVaultEntry(['infrastructure', 'myapp', 'dev', 'keyvault'], 'myapp', 'dev')
    expect(infra).toEqual({ appName: 'myapp', qualifier: null })

    // Sub-app qualifier
    const sub = classifyVaultEntry(
      ['infrastructure', 'idm', '_idmapplications', 'notif', 'dev', 'keyvault'],
      'idm', 'dev'
    )
    expect(sub).toEqual({ appName: 'idm', qualifier: 'notif' })
  })
})
