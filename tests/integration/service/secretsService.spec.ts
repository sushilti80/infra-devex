/**
 * Unit tests — secretsService.js pure logic + resolveKeyVaults matching (FR-001/FR-003).
 * Spec: docs/architecture/secret-self-service-spec.json — TS-018/019/020/021/022/023/024
 *
 * Strategy: same pattern as infrastructureService.prefill.spec.ts — CJS require() the
 * singletons, monkey-patch githubService methods directly (no vi.mock(), no network).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const secretsService = cjsRequire('../../../services/secretsService')
const githubService = cjsRequire('../../../services/githubService')
const terragruntLocalsResolver = cjsRequire('../../../services/terragruntLocalsResolver')

const svc: any = secretsService
const gs: any = githubService

function treeEntry(path: string, type: 'tree' | 'blob' = 'tree') {
  return { path, type }
}

describe('secretsService._internal — pure logic', () => {
  const { matchVaultsFromEntries, parseSecretNames, upsertSecretBlock } = svc._internal

  it('TS-018: canonical depth-2 layout (app/env/keyvault)', () => {
    const entries = [treeEntry('infrastructure/idm/dev/keyvault')]
    const vaults = matchVaultsFromEntries(entries, 'idm', 'dev').vaults
    expect(vaults).toEqual([{ vaultDir: 'infrastructure/idm/dev/keyvault', vaultName: null, resourceGroup: null }])
  })

  it('TS-019: numbered vault dirs (keyvault01 + keyvault02) resolve as two distinct vaults', () => {
    const entries = [
      treeEntry('infrastructure/mlops/dev/keyvault01'),
      treeEntry('infrastructure/mlops/dev/keyvault02'),
      treeEntry('infrastructure/mlops/prod/keyvault01'), // different env, must not match
    ]
    const vaults = matchVaultsFromEntries(entries, 'mlops', 'dev').vaults
    expect(vaults.map((v: any) => v.vaultDir).sort()).toEqual([
      'infrastructure/mlops/dev/keyvault01',
      'infrastructure/mlops/dev/keyvault02',
    ])
  })

  it('TS-020: depth-3 environment layout ({app}/hub/{env}) is not misparsed as depth-2', () => {
    const entries = [treeEntry('infrastructure/doccafe/hub/int/keyvault')]
    const vaults = matchVaultsFromEntries(entries, 'doccafe', 'int').vaults
    expect(vaults).toEqual([{ vaultDir: 'infrastructure/doccafe/hub/int/keyvault', vaultName: null, resourceGroup: null }])
  })

  it('TS-021: sub-app nesting ({app}/{env}/{subapp}) does not treat subapp as the environment', () => {
    const entries = [treeEntry('infrastructure/linuxVms/sand/acunetix/keyvault')]
    const vaults = matchVaultsFromEntries(entries, 'linuxVms', 'sand').vaults
    expect(vaults).toEqual([{ vaultDir: 'infrastructure/linuxVms/sand/acunetix/keyvault', vaultName: null, resourceGroup: null }])
  })

  it('TS-022: Key Vault config as a file (keyvault.hcl) resolves vaultDir to the containing directory', () => {
    const entries = [treeEntry('infrastructure/legacy/dev/keyvault.hcl', 'blob')]
    const vaults = matchVaultsFromEntries(entries, 'legacy', 'dev').vaults
    expect(vaults).toEqual([{ vaultDir: 'infrastructure/legacy/dev', vaultName: null, resourceGroup: null }])
  })

  it('does not treat a shared keyvault.hcl include as a second selectable vault', () => {
    const entries = [
      treeEntry('infrastructure/itg/_common/keyvault.hcl', 'blob'),
      treeEntry('infrastructure/itg/dev/keyvault')
    ]
    const vaults = matchVaultsFromEntries(entries, 'itg', 'dev').vaults
    expect(vaults).toEqual([{ vaultDir: 'infrastructure/itg/dev/keyvault', vaultName: null, resourceGroup: null }])
  })

  it('TS-024: returns empty array when no qualifying vault directory/file exists', () => {
    const entries = [treeEntry('infrastructure/idm/dev/notavault')]
    expect(matchVaultsFromEntries(entries, 'idm', 'dev')).toEqual({ vaults: [], qualifiers: [] })
  })

  it('parseSecretNames: extracts only top-level (un-indented) keys', () => {
    const content = 'DATABASE_URL: |\n    ENC[blob,line1]\n    ENC[blob,line2]\nAPI_KEY: |\n    ENC[blob]\n'
    expect(parseSecretNames(content)).toEqual(['DATABASE_URL', 'API_KEY'])
  })

  it('upsertSecretBlock: adds a new key without disturbing existing ones', () => {
    const content = 'DATABASE_URL: |\n  ENC[a]\n'
    const result = upsertSecretBlock(content, 'API_KEY', 'ENC[b]')
    expect(result).toBe('DATABASE_URL: |\n  ENC[a]\nAPI_KEY: |\n  ENC[b]\n')
  })

  it('upsertSecretBlock: replaces an existing key in place, leaving sibling keys byte-identical', () => {
    const content = 'DATABASE_URL: |\n  ENC[old]\nAPI_KEY: |\n  ENC[untouched]\n'
    const result = upsertSecretBlock(content, 'DATABASE_URL', 'ENC[new]')
    expect(result).toBe('DATABASE_URL: |\n  ENC[new]\nAPI_KEY: |\n  ENC[untouched]\n')
  })
})

describe('secretsService.resolveKeyVaults — repo-level cache', () => {
  let originalGetFileContent: any
  let originalResolveName: any
  let originalResolveResourceGroup: any

  beforeEach(() => {
    svc._internal.treeCache.clear()
    svc._internal.overridesCache.clear()
    originalGetFileContent = gs.getFileContent
    originalResolveName = terragruntLocalsResolver.resolveName
    originalResolveResourceGroup = terragruntLocalsResolver.resolveResourceGroup
    gs.getFileContent = async () => null
    terragruntLocalsResolver.resolveName = async () => null
    terragruntLocalsResolver.resolveResourceGroup = async () => null
  })

  afterEach(() => {
    gs.getFileContent = originalGetFileContent
    terragruntLocalsResolver.resolveName = originalResolveName
    terragruntLocalsResolver.resolveResourceGroup = originalResolveResourceGroup
  })

  it('TS-026: concurrent calls for differing app/environment tuples share one underlying tree fetch', async () => {
    let callCount = 0
    gs.getRepoTree = async () => {
      callCount++
      await new Promise((r) => setTimeout(r, 5))
      return { truncated: false, tree: [treeEntry('infrastructure/idm/dev/keyvault'), treeEntry('infrastructure/mlops/prod/keyvault01')] }
    }

    const calls = [
      svc.resolveKeyVaults('idm', 'dev', 'sand', 'cid-1'),
      svc.resolveKeyVaults('mlops', 'prod', 'sand', 'cid-2'),
      svc.resolveKeyVaults('idm', 'dev', 'sand', 'cid-3'),
    ]
    const results = await Promise.all(calls)

    expect(callCount).toBe(1)
    expect(results[0].found).toBe(true)
    expect(results[1].found).toBe(true)
  })

  it('TS-027: unconfigured target returns found:false/vaults:[] without throwing', async () => {
    const result = await svc.resolveKeyVaults('idm', 'dev', 'not-a-target', 'cid-4')
    expect(result).toEqual({ found: false, vaults: [], qualifiers: [] })
  })

  // ── Round 4 integration tests ────────────────────────────────────────────

  // TS-040: dual-root discovery — azureDatabricks root
  it('TS-040: resolveKeyVaults discovers vaults under azureDatabricks root', async () => {
    const entries = [
      treeEntry('azureDatabricks/dev/keyvault'),
      treeEntry('azureDatabricks/sit/keyvault'),
    ]
    gs.getRepoTree = async () => ({ truncated: false, tree: entries })

    const { found, vaults } = await svc.resolveKeyVaults('azureDatabricks', 'dev', 'live', 'corr123')
    expect(found).toBe(true)
    expect(vaults).toEqual([
      { vaultDir: 'azureDatabricks/dev/keyvault', vaultName: null, resourceGroup: null },
    ])
  })

  // TS-041: grouping-dir skip-list — keyvaults is skipped while _idmapplications qualifiers remain discoverable
  it('TS-041: resolveKeyVaults skips grouping directories (_idmapplications, keyvaults)', async () => {
    const entries = [
      treeEntry('infrastructure/idm/_idmapplications/notif/dev/keyvault'),
      treeEntry('infrastructure/idm/keyvaults/dev/keyvault'),
      treeEntry('infrastructure/idm/dev/keyvault'), // only this should match
    ]
    gs.getRepoTree = async () => ({ truncated: false, tree: entries })

    const { found, vaults } = await svc.resolveKeyVaults('idm', 'dev', 'live', 'corr123')
    expect(found).toBe(true)
    expect(vaults.map((vault: any) => vault.vaultDir).sort()).toEqual([
      'infrastructure/idm/_idmapplications/notif/dev/keyvault',
      'infrastructure/idm/dev/keyvault',
    ])
  })

  // TS-042: a literal `shared` segment is a real sibling environment (like ayaApplications'
  // ayaCoreServices/keyvaults/shared, alongside dev/prod/sand), not an env-agnostic wildcard —
  // it must only resolve when `shared` itself is the requested environment.
  it('TS-042: resolveKeyVaults treats `shared` as its own environment, not a wildcard', async () => {
    const entries = [
      treeEntry('infrastructure/sharedsvc/shared/keyvault'),
      treeEntry('infrastructure/sharedsvc/dev/keyvault'),
    ]
    gs.getRepoTree = async () => ({ truncated: false, tree: entries })

    const dev = await svc.resolveKeyVaults('sharedsvc', 'dev', 'live', 'corr123')
    expect(dev.found).toBe(true)
    expect(dev.vaults.map((vault: any) => vault.vaultDir)).toEqual([
      'infrastructure/sharedsvc/dev/keyvault',
    ])

    const shared = await svc.resolveKeyVaults('sharedsvc', 'shared', 'live', 'corr123')
    expect(shared.found).toBe(true)
    expect(shared.vaults.map((vault: any) => vault.vaultDir)).toEqual([
      'infrastructure/sharedsvc/shared/keyvault',
    ])
  })

  // Env-agnostic (no environment segment at all) must still match any requested environment.
  it('resolveKeyVaults still treats a vault with no environment segment as env-agnostic', async () => {
    const entries = [treeEntry('infrastructure/idm/keyvault')]
    gs.getRepoTree = async () => ({ truncated: false, tree: entries })

    const { found, vaults } = await svc.resolveKeyVaults('idm', 'dev', 'live', 'corr123')
    expect(found).toBe(true)
    expect(vaults.map((vault: any) => vault.vaultDir)).toEqual(['infrastructure/idm/keyvault'])
  })

  // TS-043: qualifier field for sub-app disambiguation
  it('TS-043: resolveKeyVaults filters by qualifier when supplied', async () => {
    const entries = [
      treeEntry('infrastructure/idm/_idmapplications/notif/dev/keyvault'),
      treeEntry('infrastructure/idm/_idmapplications/autobk/dev/keyvault'),
    ]
    gs.getRepoTree = async () => ({ truncated: false, tree: entries })

    // Without qualifier → returns both vaults + both qualifiers
    const withoutQual = await svc.resolveKeyVaults('idm', 'dev', 'live', 'corr123')
    expect(withoutQual.found).toBe(true)
    expect(withoutQual.vaults).toHaveLength(2)
    expect(withoutQual.qualifiers.sort()).toEqual(['autobk', 'notif'])

    // With qualifier → filters to matching vault only
    const withQualifier = await svc.resolveKeyVaults('idm', 'dev', 'live', 'corr123', 'notif')
    expect(withQualifier.found).toBe(true)
    expect(withQualifier.vaults).toHaveLength(1)
    expect(withQualifier.vaults[0].vaultDir).toBe('infrastructure/idm/_idmapplications/notif/dev/keyvault')
    expect(withQualifier.qualifiers).toEqual(['notif'])
  })
})

describe('secretsService.discoverAppsForTarget (FR-001)', () => {
  const infrastructureService = cjsRequire('../../../services/infrastructureService')

  beforeEach(() => {
    svc._internal.treeCache.clear()
    svc._internal.discoverCache.clear()
    gs.getRepoTree = undefined
  })

  it('target=sand delegates to infrastructureService.getInstalledApps()', async () => {
    const original = infrastructureService.getInstalledApps
    infrastructureService.getInstalledApps = async () => [
      { projectName: 'app-a', environment: 'dev' },
      { projectName: 'app-a', environment: 'prod' }
    ]
    try {
      const apps = await svc.discoverAppsForTarget('sand', 'cid-sand-1')
      expect(apps).toEqual([
        { name: 'app-a', environment: 'dev', tier: 'non-production', bundleId: null },
        { name: 'app-a', environment: 'prod', tier: 'production', bundleId: null }
      ])
    } finally {
      infrastructureService.getInstalledApps = original
    }
  })

  it('target=live extracts unique {app, environment} pairs from the tree (excluding apps with no vault dir/file)', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [
        treeEntry('infrastructure/app-b/dev/keyvault'),
        treeEntry('infrastructure/app-b/dev/other-file', 'blob'),
        treeEntry('infrastructure/app-c/prod/env.hcl', 'blob') // no keyvaultN marker anywhere
      ]
    })

    const apps = await svc.discoverAppsForTarget('live', 'cid-live-1')
    // Bug 1 fix: app-c/prod has env.hcl (blob) but no keyvault dir/file — should NOT appear.
    expect(apps.slice().sort((a: any, b: any) => a.name.localeCompare(b.name))).toEqual([
      { name: 'app-b', environment: 'dev', tier: 'non-production', bundleId: null }
    ])
  })

  it('does not expose a shared keyvault.hcl include as an environment', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [
        treeEntry('infrastructure/itg/_common/keyvault.hcl', 'blob'),
        treeEntry('infrastructure/itg/dev/keyvault')
      ]
    })

    const apps = await svc.discoverAppsForTarget('live', 'cid-itg-shared-config')
    expect(apps).toEqual([{ name: 'itg', environment: 'dev', tier: 'non-production', bundleId: null }])
  })

  it('regression: app with keyvault dir but no secrets.enc.yaml still appears (vault presence is the gate)', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [
        treeEntry('infrastructure/app-e/staging/keyvault'), // dir exists, no secrets.enc.yaml yet
        treeEntry('infrastructure/app-f/prod/keyvault'), // valid vault dir
      ]
    })

    const apps = await svc.discoverAppsForTarget('live', 'cid-regress-1')
    expect(apps.slice().sort((a: any, b: any) => a.name.localeCompare(b.name))).toEqual([
      { name: 'app-e', environment: 'staging', tier: 'unclassified', bundleId: null },
      { name: 'app-f', environment: 'prod', tier: 'production', bundleId: null },
    ])
  })

  it('a second call within the 5-minute TTL reuses the cached result and does not re-fetch the tree', async () => {
    let callCount = 0
    gs.getRepoTree = async () => {
      callCount++
      return { truncated: false, tree: [treeEntry('infrastructure/app-d/dev/keyvault')] }
    }

    await svc.discoverAppsForTarget('live', 'cid-live-2')
    await svc.discoverAppsForTarget('live', 'cid-live-3')

    expect(callCount).toBe(1)
  })
})

describe('secretsService._internal.bulkBranchHash (OQ-002)', () => {
  it('is deterministic regardless of input order and name case (lowercase, comma-join, sha256, first 8 hex chars)', () => {
    const crypto = cjsRequire('crypto')
    const expected = crypto.createHash('sha256').update('a,b').digest('hex').slice(0, 8)

    expect(svc._internal.bulkBranchHash([{ secretName: 'b' }, { secretName: 'a' }])).toBe(expected)
    expect(svc._internal.bulkBranchHash([{ secretName: 'A' }, { secretName: 'B' }])).toBe(expected)

    // Regression: sorting case-sensitively before lowercasing used to produce different hashes for
    // the same logical set in different input order/case (e.g. ['a','B'] vs ['A','b']). Lowercasing
    // BEFORE sort makes these collide as expected.
    expect(svc._internal.bulkBranchHash([{ secretName: 'a' }, { secretName: 'B' }])).toBe(expected)
    expect(svc._internal.bulkBranchHash([{ secretName: 'A' }, { secretName: 'b' }])).toBe(expected)
    expect(svc._internal.bulkBranchHash([{ secretName: 'b' }, { secretName: 'A' }])).toBe(expected)
  })
})

describe('secretsService.submitSecretViaGitOps — bulk (FR-003)', () => {
  let calls: { createOrUpdateFile: any[]; createPullRequest: any[]; createBranch: any[] }
  let originalEncrypt: any

  beforeEach(() => {
    svc._internal.treeCache.clear()
    calls = { createOrUpdateFile: [], createPullRequest: [], createBranch: [] }
    originalEncrypt = svc._internal.encryptValueWithSops

    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [treeEntry('infrastructure/mlops/dev/keyvault')]
    })
    gs.getFileContent = async (_repo: string, path: string, branch: string) => {
      if (path.endsWith('secrets.enc.yaml') && branch === 'main') {
        return { content: '', sha: 'sha-main' }
      }
      return null // terragrunt.hcl/keyvault.hcl lookups and new-branch file reads: not found
    }
    gs.findOpenPullRequest = async () => null
    gs.branchExists = async () => false
    gs.createBranch = async (repo: string, base: string, branch: string) => { calls.createBranch.push(branch) }
    gs.createOrUpdateFile = async (repo: string, branch: string) => { calls.createOrUpdateFile.push(branch) }
    gs.createPullRequest = async (repo: string, base: string, branch: string, title: string, body: string) => {
      calls.createPullRequest.push({ branch, title, body })
      return { prUrl: 'https://github.com/example/pull/99', prNumber: 99 }
    }
    if (!gs.octokit) gs.octokit = {}
    gs.octokit.rest = { ...(gs.octokit.rest || {}), repos: { ...(gs.octokit.rest?.repos || {}), get: async () => ({ data: { default_branch: 'main' } }) } }
  })

  afterEach(() => {
    svc._internal.encryptValueWithSops = originalEncrypt
  })

  it('happy path: all secrets encrypt successfully, one commit, one PR, bulk branch/PR naming', async () => {
    const encrypt = vi.fn(async (value: string) => `ENC[${value}]`)
    svc._internal.encryptValueWithSops = encrypt

    const result = await svc.submitSecretViaGitOps({
      target: 'sand',
      appName: 'mlops',
      environment: 'dev',
      secrets: [
        { secretName: 'api-token', secretValue: 'one' },
        { secretName: 'db-password', secretValue: 'two' }
      ],
      jiraTicket: 'DSO-123',
      userEmail: 'dev@example.com',
      correlationId: 'cid-bulk-1'
    })

    expect(result).toEqual({ prUrl: 'https://github.com/example/pull/99', prNumber: 99, secretCount: 2 })
    expect(encrypt).toHaveBeenCalledWith('one', {
      correlationId: 'cid-bulk-1', target: 'sand', appName: 'mlops', environment: 'dev'
    })
    expect(calls.createOrUpdateFile).toHaveLength(1)
    expect(calls.createPullRequest).toHaveLength(1)
    expect(calls.createBranch[0]).toMatch(/^secrets\/mlops-dev-keyvault-bulk-[0-9a-f]{8}$/)
    expect(calls.createPullRequest[0].title).toContain('[DSO-123]')
    expect(calls.createPullRequest[0].body).toContain('Jira: DSO-123'.replace('Jira: ', '**Jira**: '))
    expect(calls.createPullRequest[0].body).not.toContain('one')
    expect(calls.createPullRequest[0].body).not.toContain('two')
  })

  it('preserves the exact v1 branch name for a single secret (legacy singular shape wrapped by the route)', async () => {
    svc._internal.encryptValueWithSops = async (value: string) => `ENC[${value}]`

    await svc.submitSecretViaGitOps({
      target: 'sand',
      appName: 'mlops',
      environment: 'dev',
      secrets: [{ secretName: 'legacy-secret', secretValue: 'one' }],
      jiraTicket: 'DSO-123',
      userEmail: 'dev@example.com',
      correlationId: 'cid-single-1'
    })

    expect(calls.createBranch[0]).toBe('secrets/mlops-dev-keyvault-legacy-secret')
  })

  it('atomicity: a failing Nth secret aborts with zero GitHub writes and names only the failing secretName', async () => {
    svc._internal.encryptValueWithSops = async (value: string) => {
      if (value === 'two') throw new Error('sops: exit status 1')
      return `ENC[${value}]`
    }

    await expect(svc.submitSecretViaGitOps({
      target: 'sand',
      appName: 'mlops',
      environment: 'dev',
      secrets: [
        { secretName: 'api-token', secretValue: 'one' },
        { secretName: 'db-password', secretValue: 'two' }
      ],
      jiraTicket: 'DSO-123',
      userEmail: 'dev@example.com',
      correlationId: 'cid-atomic-1'
    })).rejects.toMatchObject({ code: 'ENCRYPTION_FAILED', secretNames: ['db-password'] })

    expect(calls.createBranch).toHaveLength(0)
    expect(calls.createOrUpdateFile).toHaveLength(0)
    expect(calls.createPullRequest).toHaveLength(0)
  })

  it('SOPS_NOT_CONFIGURED (environment misconfiguration) is never masked as a per-secret ENCRYPTION_FAILED', async () => {
    svc._internal.encryptValueWithSops = async () => {
      const err: any = new Error('SOPS Key Vault URL is not configured')
      err.code = 'SOPS_NOT_CONFIGURED'
      throw err
    }

    await expect(svc.submitSecretViaGitOps({
      target: 'sand',
      appName: 'mlops',
      environment: 'dev',
      secrets: [{ secretName: 'api-token', secretValue: 'one' }],
      jiraTicket: 'DSO-123',
      userEmail: 'dev@example.com',
      correlationId: 'cid-sops-1'
    })).rejects.toMatchObject({ code: 'SOPS_NOT_CONFIGURED' })

    expect(calls.createOrUpdateFile).toHaveLength(0)
  })
})

describe('secretsService.classifyEnvironmentTier (FR-001, secrets-environment-scope)', () => {
  it('classifies a data/environmentTiers.json "production" entry as tier production', () => {
    expect(svc.classifyEnvironmentTier('prod')).toBe('production')
  })

  it('classifies curated environment tiers and leaves documented "other" entries unclassified', () => {
    expect(svc.classifyEnvironmentTier('dev')).toBe('non-production')
    expect(svc.classifyEnvironmentTier('devsand')).toBe('unclassified')
  })

  it('is case-insensitive', () => {
    expect(svc.classifyEnvironmentTier('PROD')).toBe('production')
  })

  it('defaults to unclassified for a name absent from every group (FR-001(b) safe default)', () => {
    expect(svc.classifyEnvironmentTier('totally-unknown-env')).toBe('unclassified')
  })

  it('defaults to unclassified for a name only present in the curated "other" group', () => {
    // 'other' is documentation-only, not a distinct tier value (FR-001(a)/(b)).
    expect(svc.classifyEnvironmentTier('shared-services')).toBe('unclassified')
  })
})

describe('secretsService.submitSecretsFanOut (FR-004/FR-005, secrets-environment-scope)', () => {
  let originalSubmit: any

  beforeEach(() => {
    originalSubmit = svc.submitSecretViaGitOps
  })

  afterEach(() => {
    svc.submitSecretViaGitOps = originalSubmit
  })

  it('runs every environment concurrently and aggregates success results (NFR-PERF-001/NFR-REL-001)', async () => {
    const started: string[] = []
    svc.submitSecretViaGitOps = async ({ environment }: any) => {
      started.push(environment)
      return { prNumber: started.length, prUrl: `https://pr/${environment}`, secretCount: 1 }
    }

    const results = await svc.submitSecretsFanOut({
      target: 'sand',
      appName: 'mlops',
      environments: ['dev', 'qa', 'staging'],
      jiraTicket: 'DSO-123',
      secrets: [{ secretName: 'api-token', secretValue: 'one' }],
      userEmail: 'dev@example.com',
      correlationId: 'cid-fanout-1'
    })

    // All three calls were dispatched before any resolved — proves concurrency, not a serial loop.
    expect(started).toHaveLength(3)
    expect(results).toEqual([
      { environment: 'dev', success: true, prNumber: expect.any(Number), prUrl: 'https://pr/dev', secretCount: 1 },
      { environment: 'qa', success: true, prNumber: expect.any(Number), prUrl: 'https://pr/qa', secretCount: 1 },
      { environment: 'staging', success: true, prNumber: expect.any(Number), prUrl: 'https://pr/staging', secretCount: 1 }
    ])
  })

  it('isolates one environment\'s failure from the others (NFR-REL-001) and reports its errorCode', async () => {
    svc.submitSecretViaGitOps = async ({ environment }: any) => {
      if (environment === 'qa') {
        const err: any = new Error('Concurrent secret submission detected, please retry')
        err.code = 'CONFLICT'
        throw err
      }
      return { prNumber: 1, prUrl: `https://pr/${environment}`, secretCount: 1 }
    }

    const results = await svc.submitSecretsFanOut({
      target: 'sand',
      appName: 'mlops',
      environments: ['dev', 'qa'],
      jiraTicket: 'DSO-123',
      secrets: [{ secretName: 'api-token', secretValue: 'one' }],
      userEmail: 'dev@example.com',
      correlationId: 'cid-fanout-2'
    })

    expect(results).toEqual([
      { environment: 'dev', success: true, prNumber: 1, prUrl: 'https://pr/dev', secretCount: 1 },
      { environment: 'qa', success: false, errorCode: 'CONFLICT', error: 'Concurrent secret submission detected, please retry' }
    ])
  })

  it('never lets a per-environment error carry a secretValue (NFR-SEC-001)', async () => {
    svc.submitSecretViaGitOps = async () => {
      const err: any = new Error('Encryption failed for: db-password')
      err.code = 'ENCRYPTION_FAILED'
      throw err
    }

    const results = await svc.submitSecretsFanOut({
      target: 'sand',
      appName: 'mlops',
      environments: ['dev'],
      jiraTicket: 'DSO-123',
      secrets: [{ secretName: 'db-password', secretValue: 'super-secret-value' }],
      userEmail: 'dev@example.com',
      correlationId: 'cid-fanout-3'
    })

    expect(JSON.stringify(results)).not.toContain('super-secret-value')
    expect(results[0]).toEqual({ environment: 'dev', success: false, errorCode: 'ENCRYPTION_FAILED', error: 'Encryption failed for: db-password' })
  })
})

describe('secretsService.loadVaultOverrides (vault-resolution-override)', () => {
  const trl = cjsRequire('../../../services/terragruntLocalsResolver')
  let originalResolveName: any
  let originalResolveResourceGroup: any

  beforeEach(() => {
    svc._internal.overridesCache.clear()
    originalResolveName = trl.resolveName
    originalResolveResourceGroup = trl.resolveResourceGroup
    gs.getFileContent = undefined
  })

  afterEach(() => {
    trl.resolveName = originalResolveName
    trl.resolveResourceGroup = originalResolveResourceGroup
  })

  it('happy path: valid sidecar JSON returns parsed override map', async () => {
    gs.getFileContent = async () => ({ content: JSON.stringify({ 'infra/a/dev/keyvault': { name: 'a-dev-kv' } }), sha: 'sha-1' })
    const overrides = await svc.loadVaultOverrides('cid-1')
    expect(overrides).toEqual({ 'infra/a/dev/keyvault': { name: 'a-dev-kv' } })
  })

  it('404 (null) from getFileContent returns an empty override map, not an error', async () => {
    gs.getFileContent = async () => null
    const overrides = await svc.loadVaultOverrides('cid-2')
    expect(overrides).toEqual({})
  })

  it('malformed JSON content returns an empty override map without throwing', async () => {
    gs.getFileContent = async () => ({ content: 'not json{{', sha: 'sha-2' })
    await expect(svc.loadVaultOverrides('cid-3')).resolves.toEqual({})
  })

  it('always reads config.github.serviceRepo and never calls mapRepo(target)', async () => {
    const config = cjsRequire('../../../config')
    let readRepo: string | undefined
    gs.getFileContent = async (repo: string) => { readRepo = repo; return null }
    await svc.loadVaultOverrides('cid-4')
    expect(readRepo).toBe(config.github.serviceRepo)
  })

  it('a second call within the 60s cache TTL does not trigger a new GitHub read', async () => {
    let callCount = 0
    gs.getFileContent = async () => { callCount++; return { content: '{}', sha: 'sha' } }
    await svc.loadVaultOverrides('cid-5')
    await svc.loadVaultOverrides('cid-6')
    expect(callCount).toBe(1)
  })

  it('concurrent calls during a cache miss share one in-flight GitHub read', async () => {
    let callCount = 0
    gs.getFileContent = async () => {
      callCount++
      await new Promise(r => setTimeout(r, 5))
      return { content: '{}', sha: 'sha' }
    }
    await Promise.all([svc.loadVaultOverrides('cid-7'), svc.loadVaultOverrides('cid-8')])
    expect(callCount).toBe(1)
  })
})

describe('secretsService.resolveVaultNameWithFallback (vault-resolution-override)', () => {
  const trl = cjsRequire('../../../services/terragruntLocalsResolver')
  let originalResolveName: any
  let originalResolveResourceGroup: any
  let liveCalled: boolean

  beforeEach(() => {
    liveCalled = false
    originalResolveName = trl.resolveName
    originalResolveResourceGroup = trl.resolveResourceGroup
    trl.resolveName = async () => { liveCalled = true; return 'live-name' }
    trl.resolveResourceGroup = async () => { liveCalled = true; return 'live-rg' }
  })

  afterEach(() => {
    trl.resolveName = originalResolveName
    trl.resolveResourceGroup = originalResolveResourceGroup
  })

  it('override present returns source=override and skips the live resolver', async () => {
    const vaultEntry = { vaultDir: 'infrastructure/idm/_idmapplications/notif/dev/keyvault' }
    const overrides = { [vaultEntry.vaultDir]: { name: 'idm-notif-dev-kv', resourceGroup: 'rg-idm-notif-dev' } }

    const result = await svc.resolveVaultNameWithFallback(vaultEntry, overrides, undefined, 'live', 'cid-1')

    expect(result).toEqual({ name: 'idm-notif-dev-kv', resourceGroup: 'rg-idm-notif-dev', source: 'override' })
    expect(liveCalled).toBe(false)
  })

  it('override absent, metadata entry present (direct call) returns source=metadata', async () => {
    const vaultEntry = { vaultDir: 'infrastructure/myapp/dev/keyvault-1' }
    const metadata = { keyvaults: [{ vaultDir: vaultEntry.vaultDir, name: 'myapp-dev-kv-1', resourceGroup: 'rg-myapp-dev' }] }

    const result = await svc.resolveVaultNameWithFallback(vaultEntry, {}, metadata, 'sand', 'cid-2')

    expect(result).toEqual({ name: 'myapp-dev-kv-1', resourceGroup: 'rg-myapp-dev', source: 'metadata' })
    expect(liveCalled).toBe(false)
  })

  it('both override and metadata absent falls through to the live resolver, source=live', async () => {
    const vaultEntry = { vaultDir: 'infrastructure/mlops/dev/keyvault' }

    const result = await svc.resolveVaultNameWithFallback(vaultEntry, {}, undefined, 'sand', 'cid-3')

    expect(result).toEqual({ name: 'live-name', resourceGroup: 'live-rg', source: 'live' })
    expect(liveCalled).toBe(true)
  })

  it('metadata=undefined is treated as a no-op, not an error', async () => {
    const vaultEntry = { vaultDir: 'infrastructure/mlops/dev/keyvault' }
    await expect(svc.resolveVaultNameWithFallback(vaultEntry, {}, undefined, 'sand', 'cid-4')).resolves.toBeTruthy()
  })

  it('live resolver returning no name yields source=unresolved', async () => {
    trl.resolveName = async () => null
    trl.resolveResourceGroup = async () => null
    const vaultEntry = { vaultDir: 'infrastructure/commhub/dev/keyvault' }

    const result = await svc.resolveVaultNameWithFallback(vaultEntry, {}, undefined, 'sand', 'cid-5')

    expect(result).toEqual({ name: null, resourceGroup: null, source: 'unresolved' })
  })
})

describe('secretsService.resolveKeyVaults — override integration (vault-resolution-override)', () => {
  beforeEach(() => {
    svc._internal.treeCache.clear()
    svc._internal.overridesCache.clear()
    gs.getRepoTree = undefined
    gs.getFileContent = undefined
  })

  it('vault with an override resolves via tier 1, live resolver never invoked', async () => {
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/idm/dev/keyvault')] })
    gs.getFileContent = async () => ({
      content: JSON.stringify({ 'infrastructure/idm/dev/keyvault': { name: 'idm-dev-kv-override' } }),
      sha: 'sha-override'
    })

    let liveCalled = false
    const trl = cjsRequire('../../../services/terragruntLocalsResolver')
    const originalResolveName = trl.resolveName
    trl.resolveName = async () => { liveCalled = true; return 'should-not-be-used' }
    try {
      const { vaults } = await svc.resolveKeyVaults('idm', 'dev', 'live', 'cid-override-1')
      expect(vaults[0].vaultName).toBe('idm-dev-kv-override')
      expect(liveCalled).toBe(false)
    } finally {
      trl.resolveName = originalResolveName
    }
  })

  it('vaults with no override resolve identically to pre-feature behavior (live resolver)', async () => {
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/mlops/dev/keyvault')] })
    gs.getFileContent = async () => null // no override sidecar

    const trl = cjsRequire('../../../services/terragruntLocalsResolver')
    const originalResolveName = trl.resolveName
    const originalResolveResourceGroup = trl.resolveResourceGroup
    trl.resolveName = async () => 'mlops-dev-kv'
    trl.resolveResourceGroup = async () => 'rg-mlops-dev'
    try {
      const { vaults } = await svc.resolveKeyVaults('mlops', 'dev', 'sand', 'cid-override-2')
      expect(vaults[0]).toEqual({ vaultDir: 'infrastructure/mlops/dev/keyvault', vaultName: 'mlops-dev-kv', resourceGroup: 'rg-mlops-dev' })
    } finally {
      trl.resolveName = originalResolveName
      trl.resolveResourceGroup = originalResolveResourceGroup
    }
  })

  it('an override round-trips for a target=live vault, since loadVaultOverrides always reads serviceRepo regardless of target', async () => {
    const config = cjsRequire('../../../config')
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('azureDatabricks/dev/keyvault')] })
    let readRepo: string | undefined
    gs.getFileContent = async (repo: string) => {
      readRepo = repo
      return { content: JSON.stringify({ 'azureDatabricks/dev/keyvault': { name: 'databricks-dev-kv' } }), sha: 'sha-x' }
    }

    const { vaults } = await svc.resolveKeyVaults('azureDatabricks', 'dev', 'live', 'cid-override-3')

    expect(vaults[0].vaultName).toBe('databricks-dev-kv')
    expect(readRepo).toBe(config.github.serviceRepo)
  })

  it('emits exactly one correlationId-prefixed debug log per vault naming vaultDir and source, and a logging failure never breaks resolution', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [treeEntry('infrastructure/mlops/dev/keyvault01'), treeEntry('infrastructure/mlops/dev/keyvault02')]
    })
    gs.getFileContent = async () => null

    const trl = cjsRequire('../../../services/terragruntLocalsResolver')
    const originalResolveName = trl.resolveName
    const originalResolveResourceGroup = trl.resolveResourceGroup
    trl.resolveName = async () => 'name'
    trl.resolveResourceGroup = async () => 'rg'

    const logger = cjsRequire('../../../utils/logger')
    const originalDebug = logger.debug
    const debugCalls: any[] = []
    logger.debug = (...args: any[]) => { debugCalls.push(args); throw new Error('logging transport down') }

    try {
      const { vaults } = await svc.resolveKeyVaults('mlops', 'dev', 'sand', 'cid-debug-1')
      expect(vaults).toHaveLength(2)
      expect(debugCalls).toHaveLength(2)
      expect(debugCalls[0][0]).toContain('cid-debug-1')
      expect(debugCalls[0][0]).toMatch(/vaultDir=.*source=live/)
    } finally {
      trl.resolveName = originalResolveName
      trl.resolveResourceGroup = originalResolveResourceGroup
      logger.debug = originalDebug
    }
  })
})

describe('secretsService.setVaultNameOverride (vault-resolution-override)', () => {
  beforeEach(() => {
    svc._internal.overridesCache.clear()
    gs.getFileContent = undefined
    gs.createOrUpdateFile = undefined
  })

  it('creates a new entry when the sidecar file does not exist yet (lazy creation)', async () => {
    gs.getFileContent = async () => null
    let written: any = null
    gs.createOrUpdateFile = async (repo: string, branch: string, path: string, content: string, message: string, sha: any) => {
      written = { repo, branch, path, content, message, sha }
    }

    const result = await svc.setVaultNameOverride({
      vaultDir: 'infrastructure/idm/_idmapplications/notif/dev/keyvault',
      name: 'idm-notif-dev-kv',
      resourceGroup: 'rg-idm-notif-dev',
      appName: 'idm',
      environment: 'dev',
      qualifier: 'notif',
      verifiedBy: 'user@example.com',
      correlationId: 'cid-write-1'
    })

    expect(result.name).toBe('idm-notif-dev-kv')
    expect(written.sha).toBeNull()
    expect(JSON.parse(written.content)['infrastructure/idm/_idmapplications/notif/dev/keyvault'].name).toBe('idm-notif-dev-kv')
  })

  it('overwrites rather than duplicates an existing vaultDir entry, preserving sibling entries', async () => {
    gs.getFileContent = async () => ({
      content: JSON.stringify({ 'infra/other/dev/keyvault': { name: 'other-dev-kv' }, 'infra/a/dev/keyvault': { name: 'old-name' } }),
      sha: 'sha-existing'
    })
    let written: any = null
    gs.createOrUpdateFile = async (repo: string, branch: string, path: string, content: string, message: string, sha: any) => {
      written = { content, sha }
    }

    await svc.setVaultNameOverride({
      vaultDir: 'infra/a/dev/keyvault',
      name: 'new-name',
      appName: 'a',
      environment: 'dev',
      verifiedBy: 'user@example.com',
      correlationId: 'cid-write-2'
    })

    const parsed = JSON.parse(written.content)
    expect(parsed['infra/a/dev/keyvault'].name).toBe('new-name')
    expect(parsed['infra/other/dev/keyvault']).toEqual({ name: 'other-dev-kv' })
    expect(written.sha).toBe('sha-existing')
  })

  it('a sha conflict from createOrUpdateFile surfaces as err.code=CONFLICT', async () => {
    gs.getFileContent = async () => ({ content: '{}', sha: 'sha-1' })
    gs.createOrUpdateFile = async () => {
      const err: any = new Error('sha mismatch')
      err.status = 409
      throw err
    }

    await expect(svc.setVaultNameOverride({
      vaultDir: 'infra/a/dev/keyvault',
      name: 'new-name',
      appName: 'a',
      environment: 'dev',
      verifiedBy: 'user@example.com',
      correlationId: 'cid-write-3'
    })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('a successful write invalidates the overrides cache so the next loadVaultOverrides reflects it', async () => {
    gs.getFileContent = async () => ({ content: '{}', sha: 'sha-1' })
    gs.createOrUpdateFile = async () => {}
    await svc.setVaultNameOverride({
      vaultDir: 'infra/a/dev/keyvault',
      name: 'new-name',
      appName: 'a',
      environment: 'dev',
      verifiedBy: 'user@example.com',
      correlationId: 'cid-write-4'
    })

    let readCount = 0
    gs.getFileContent = async () => { readCount++; return { content: JSON.stringify({ 'infra/a/dev/keyvault': { name: 'new-name' } }), sha: 'sha-2' } }
    const overrides = await svc.loadVaultOverrides('cid-write-5')

    expect(readCount).toBe(1)
    expect(overrides['infra/a/dev/keyvault'].name).toBe('new-name')
  })
})
