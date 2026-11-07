/**
 * Unit tests — secretsService.js secrets-environment-bundles logic.
 * Spec: docs/architecture/secrets-environment-bundles-spec.json / .md §2.3-§2.6
 *
 * Strategy: same pattern as secretsService.spec.ts — CJS require() the singletons, monkey-patch
 * githubService methods and secretsService._internal.readBundleConfigFile directly (no vi.mock(),
 * no network, no real disk I/O for the invalid/stale/unavailable config cases).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const secretsService = cjsRequire('../../../services/secretsService')
const githubService = cjsRequire('../../../services/githubService')

const svc: any = secretsService
const gs: any = githubService

function treeEntry(path: string, type: 'tree' | 'blob' = 'tree') {
  return { path, type }
}

const validConfig = {
  version: '1.0',
  bundles: [
    { id: 'independent', displayName: 'Independent Environments', order: 1, releaseControlled: false, environments: ['sand', 'devsand'] },
    { id: 'developer', displayName: 'Developer Bundle', order: 2, releaseControlled: false, environments: ['dev', 'int', 'sint', 'stage'] },
    { id: 'release', displayName: 'Release Bundle', order: 3, releaseControlled: true, environments: ['prod', 'cint', 'hot', 'demo', 'dr'] }
  ]
}

describe('secretsService.validateBundleConfigShape (_internal)', () => {
  const { validateBundleConfigShape } = svc._internal

  it('accepts a well-formed config', () => {
    expect(validateBundleConfigShape(validConfig)).toBeNull()
  })

  it('rejects a missing/empty bundles array', () => {
    expect(validateBundleConfigShape({ bundles: [] })).toMatch(/non-empty array/)
    expect(validateBundleConfigShape({})).toMatch(/non-empty array/)
    expect(validateBundleConfigShape(null)).toMatch(/non-empty array/)
  })

  it('rejects a bundle missing a required field', () => {
    expect(validateBundleConfigShape({ bundles: [{ id: 'x', displayName: 'X', order: 1, releaseControlled: false, environments: [] }] })).toMatch(/environments must be a non-empty array/)
    expect(validateBundleConfigShape({ bundles: [{ id: 'x', displayName: 'X', order: 'one', releaseControlled: false, environments: ['dev'] }] })).toMatch(/order must be numeric/)
    expect(validateBundleConfigShape({ bundles: [{ id: 'x', displayName: 'X', order: 1, releaseControlled: 'no', environments: ['dev'] }] })).toMatch(/releaseControlled must be boolean/)
  })

  it('rejects duplicate bundle ids, case-insensitively', () => {
    const dup = { bundles: [
      { id: 'release', displayName: 'A', order: 1, releaseControlled: false, environments: ['dev'] },
      { id: 'RELEASE', displayName: 'B', order: 2, releaseControlled: false, environments: ['prod'] }
    ] }
    expect(validateBundleConfigShape(dup)).toMatch(/duplicate bundle id/)
  })

  it('rejects an environment claimed by more than one bundle, case-insensitively', () => {
    const overlap = { bundles: [
      { id: 'a', displayName: 'A', order: 1, releaseControlled: false, environments: ['dev'] },
      { id: 'b', displayName: 'B', order: 2, releaseControlled: false, environments: ['DEV'] }
    ] }
    expect(validateBundleConfigShape(overlap)).toMatch(/appears in more than one bundle/)
  })
})

describe('secretsService.loadSecretBundles', () => {
  let originalRead: any

  beforeEach(() => {
    originalRead = svc._internal.readBundleConfigFile
    svc._internal.resetLastKnownGoodBundleConfig()
  })

  afterEach(() => {
    svc._internal.readBundleConfigFile = originalRead
    svc._internal.resetLastKnownGoodBundleConfig()
  })

  it('returns { config, source: "fresh" } for a valid config file', () => {
    svc._internal.readBundleConfigFile = () => JSON.stringify(validConfig)
    const result = svc.loadSecretBundles('cid-1')
    expect(result.source).toBe('fresh')
    expect(result.config.bundles).toHaveLength(3)
  })

  it('falls back to last-known-good ("stale") when the file becomes malformed JSON after a prior good load', () => {
    svc._internal.readBundleConfigFile = () => JSON.stringify(validConfig)
    svc.loadSecretBundles('cid-1')

    svc._internal.readBundleConfigFile = () => '{not valid json'
    const result = svc.loadSecretBundles('cid-2')
    expect(result.source).toBe('stale')
    expect(result.config.bundles).toHaveLength(3)
  })

  it('falls back to last-known-good ("stale") when the file fails shape validation after a prior good load', () => {
    svc._internal.readBundleConfigFile = () => JSON.stringify(validConfig)
    svc.loadSecretBundles('cid-1')

    svc._internal.readBundleConfigFile = () => JSON.stringify({ bundles: [] })
    const result = svc.loadSecretBundles('cid-2')
    expect(result.source).toBe('stale')
  })

  it('returns { config: null, source: "unavailable" } when invalid and no prior good load exists', () => {
    svc._internal.readBundleConfigFile = () => '{not valid json'
    const result = svc.loadSecretBundles('cid-1')
    expect(result).toEqual({ config: null, source: 'unavailable' })
  })
})

describe('secretsService.classifyBundleMembership (pure)', () => {
  it('returns the matching bundle id, case-insensitively', () => {
    expect(svc.classifyBundleMembership('PROD', validConfig)).toBe('release')
    expect(svc.classifyBundleMembership('dev', validConfig)).toBe('developer')
    expect(svc.classifyBundleMembership('sand', validConfig)).toBe('independent')
  })

  it('returns null for an environment not in any bundle, and when bundleConfig is null', () => {
    expect(svc.classifyBundleMembership('unmapped-env', validConfig)).toBeNull()
    expect(svc.classifyBundleMembership('prod', null)).toBeNull()
  })
})

describe('secretsService.getBundleCatalog (pure)', () => {
  it('returns bundles sorted by order, stripped to catalog fields', () => {
    const unordered = { bundles: [validConfig.bundles[2], validConfig.bundles[0], validConfig.bundles[1]] }
    expect(svc.getBundleCatalog(unordered)).toEqual([
      { id: 'independent', displayName: 'Independent Environments', order: 1, releaseControlled: false },
      { id: 'developer', displayName: 'Developer Bundle', order: 2, releaseControlled: false },
      { id: 'release', displayName: 'Release Bundle', order: 3, releaseControlled: true }
    ])
  })

  it('returns [] when bundleConfig is null', () => {
    expect(svc.getBundleCatalog(null)).toEqual([])
  })
})

describe('secretsService.validateBundleMembership', () => {
  let originalRead: any

  beforeEach(() => {
    originalRead = svc._internal.readBundleConfigFile
    svc._internal.resetLastKnownGoodBundleConfig()
    svc._internal.readBundleConfigFile = () => JSON.stringify(validConfig)
  })

  afterEach(() => {
    svc._internal.readBundleConfigFile = originalRead
    svc._internal.resetLastKnownGoodBundleConfig()
  })

  it('returns the matched bundle object when all environments are members', () => {
    const bundle = svc.validateBundleMembership('developer', ['dev', 'int'], 'cid-1')
    expect(bundle.id).toBe('developer')
  })

  it('matches bundleId case-insensitively', () => {
    const bundle = svc.validateBundleMembership('DEVELOPER', ['dev'], 'cid-1')
    expect(bundle.id).toBe('developer')
  })

  it('throws BUNDLE_UNKNOWN for an unrecognized bundleId', () => {
    expect(() => svc.validateBundleMembership('not-a-bundle', ['dev'], 'cid-1')).toThrowError(
      expect.objectContaining({ code: 'BUNDLE_UNKNOWN' })
    )
  })

  it('throws ENVIRONMENT_NOT_IN_BUNDLE listing every offending environment', () => {
    try {
      svc.validateBundleMembership('developer', ['dev', 'prod', 'sand'], 'cid-1')
      expect.fail('expected to throw')
    } catch (error: any) {
      expect(error.code).toBe('ENVIRONMENT_NOT_IN_BUNDLE')
      expect(error.environments.sort()).toEqual(['prod', 'sand'])
    }
  })

  it('throws BUNDLE_CONFIG_UNAVAILABLE when the config cannot be loaded and no stale copy exists', () => {
    svc._internal.readBundleConfigFile = () => '{not valid json'
    expect(() => svc.validateBundleMembership('developer', ['dev'], 'cid-1')).toThrowError(
      expect.objectContaining({ code: 'BUNDLE_CONFIG_UNAVAILABLE' })
    )
  })
})

describe('secretsService.resolveBundleEnvironments', () => {
  const bundle = validConfig.bundles[1] // developer: dev, int, sint, stage

  beforeEach(() => {
    svc._internal.treeCache.clear()
  })

  it('includes every currently-eligible environment with a submitted payload', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [
        treeEntry('infrastructure/app/dev/keyvault'),
        treeEntry('infrastructure/app/int/keyvault'),
        treeEntry('infrastructure/app/sint/keyvault'),
        treeEntry('infrastructure/app/stage/keyvault')
      ]
    })
    const byEnv: Record<string, any> = {
      dev: { environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'x' }] },
      int: { environment: 'int', secrets: [{ secretName: 'API_KEY', secretValue: 'y' }] },
      sint: { environment: 'sint', secrets: [{ secretName: 'API_KEY', secretValue: 'z' }] },
      stage: { environment: 'stage', secrets: [{ secretName: 'API_KEY', secretValue: 'w' }] }
    }

    const { included, excluded } = await svc.resolveBundleEnvironments(bundle, byEnv, 'live', 'app', 'cid-1')
    expect(included.map((e: any) => e.environment).sort()).toEqual(['dev', 'int', 'sint', 'stage'])
    expect(excluded).toEqual([])
  })

  it('silently skips a bundle environment that is not deployed at all (never appears in excluded[])', async () => {
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/app/dev/keyvault')] })
    const byEnv = { dev: { environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'x' }] } }

    const { included, excluded } = await svc.resolveBundleEnvironments(bundle, byEnv, 'live', 'app', 'cid-1')
    expect(included.map((e: any) => e.environment)).toEqual(['dev'])
    expect(excluded).toEqual([])
  })

  it('excludes with reason QUALIFIER_AMBIGUOUS when multiple qualifiers exist and none was submitted', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [
        treeEntry('infrastructure/app/_idmapplications/notif/dev/keyvault'),
        treeEntry('infrastructure/app/_idmapplications/autobk/dev/keyvault')
      ]
    })
    const byEnv = { dev: { environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'x' }] } }

    const { included, excluded } = await svc.resolveBundleEnvironments(bundle, byEnv, 'live', 'app', 'cid-1')
    expect(included).toEqual([])
    expect(excluded).toEqual([{ environment: 'dev', reason: 'QUALIFIER_AMBIGUOUS', qualifiers: ['autobk', 'notif'] }])
  })

  it('resolves a qualifier-ambiguous environment to included when only vaultDir (no qualifier) is submitted', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [
        treeEntry('infrastructure/app/_idmapplications/notif/dev/keyvault'),
        treeEntry('infrastructure/app/_idmapplications/autobk/dev/keyvault')
      ]
    })
    const byEnv = {
      dev: {
        environment: 'dev',
        vaultDir: 'infrastructure/app/_idmapplications/autobk/dev/keyvault',
        secrets: [{ secretName: 'API_KEY', secretValue: 'x' }]
      }
    }

    const { included, excluded } = await svc.resolveBundleEnvironments(bundle, byEnv, 'live', 'app', 'cid-1')
    expect(excluded).toEqual([])
    expect(included).toEqual([
      expect.objectContaining({
        environment: 'dev',
        vault: expect.objectContaining({ vaultDir: 'infrastructure/app/_idmapplications/autobk/dev/keyvault' })
      })
    ])
  })

  it('excludes with reason QUALIFIER_MISMATCH when a submitted qualifier matches no resolved vault', async () => {
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/app/_idmapplications/notif/dev/keyvault')] })
    const byEnv = { dev: { environment: 'dev', qualifier: 'bogus', secrets: [{ secretName: 'API_KEY', secretValue: 'x' }] } }

    const { excluded } = await svc.resolveBundleEnvironments(bundle, byEnv, 'live', 'app', 'cid-1')
    expect(excluded).toEqual([{ environment: 'dev', reason: 'QUALIFIER_MISMATCH', qualifiers: ['notif'] }])
  })

  it('excludes with reason VAULT_INVALID when a submitted vaultDir matches no resolved vault', async () => {
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/app/dev/keyvault')] })
    const byEnv = { dev: { environment: 'dev', vaultDir: 'infrastructure/app/dev/keyvault02', secrets: [{ secretName: 'API_KEY', secretValue: 'x' }] } }

    const { excluded } = await svc.resolveBundleEnvironments(bundle, byEnv, 'live', 'app', 'cid-1')
    expect(excluded).toEqual([{ environment: 'dev', reason: 'VAULT_INVALID', vaults: [{ vaultDir: 'infrastructure/app/dev/keyvault', vaultName: null, resourceGroup: null }] }])
  })

  it('excludes with reason VAULT_AMBIGUOUS when multiple vaults exist and none was submitted', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [treeEntry('infrastructure/app/dev/keyvault01'), treeEntry('infrastructure/app/dev/keyvault02')]
    })
    const byEnv = { dev: { environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'x' }] } }

    const { excluded } = await svc.resolveBundleEnvironments(bundle, byEnv, 'live', 'app', 'cid-1')
    expect(excluded[0]).toMatchObject({ environment: 'dev', reason: 'VAULT_AMBIGUOUS' })
  })

  it('throws INCOMPLETE_BUNDLE when a currently-eligible environment has no submitted secrets', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [treeEntry('infrastructure/app/dev/keyvault'), treeEntry('infrastructure/app/int/keyvault')]
    })
    const byEnv = { dev: { environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'x' }] } } // int omitted

    await expect(svc.resolveBundleEnvironments(bundle, byEnv, 'live', 'app', 'cid-1')).rejects.toMatchObject({
      code: 'INCOMPLETE_BUNDLE',
      environment: 'int'
    })
  })
})

describe('secretsService.computeBundleContentHash', () => {
  it('is deterministic and excludes secret values from the hashed payload', () => {
    const includedA = [
      { environment: 'dev', vault: { vaultDir: 'infrastructure/app/dev/keyvault' }, qualifier: undefined, secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] },
      { environment: 'int', vault: { vaultDir: 'infrastructure/app/int/keyvault' }, qualifier: undefined, secrets: [{ secretName: 'API_KEY', secretValue: 'two' }] }
    ]
    const includedB = [
      { environment: 'INT', vault: { vaultDir: 'infrastructure/app/int/keyvault' }, qualifier: undefined, secrets: [{ secretName: 'api_key', secretValue: 'DIFFERENT' }] },
      { environment: 'DEV', vault: { vaultDir: 'infrastructure/app/dev/keyvault' }, qualifier: undefined, secrets: [{ secretName: 'API_KEY', secretValue: 'DIFFERENT-TOO' }] }
    ]

    const hashA = svc.computeBundleContentHash({ target: 'live', appName: 'app', bundleId: 'developer', included: includedA })
    const hashB = svc.computeBundleContentHash({ target: 'live', appName: 'app', bundleId: 'developer', included: includedB })

    expect(hashA).toBe(hashB) // same logical shape, different order/case/values → same hash
    expect(hashA).toMatch(/^[0-9a-f]{8}$/)
  })

  it('changes when the included environment set changes', () => {
    const included = [{ environment: 'dev', vault: { vaultDir: 'infrastructure/app/dev/keyvault' }, qualifier: undefined, secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] }]
    const includedPlus = [...included, { environment: 'int', vault: { vaultDir: 'infrastructure/app/int/keyvault' }, qualifier: undefined, secrets: [{ secretName: 'API_KEY', secretValue: 'two' }] }]

    const hashA = svc.computeBundleContentHash({ target: 'live', appName: 'app', bundleId: 'developer', included })
    const hashB = svc.computeBundleContentHash({ target: 'live', appName: 'app', bundleId: 'developer', included: includedPlus })
    expect(hashA).not.toBe(hashB)
  })
})

describe('secretsService.submitSecretBundleViaGitOps', () => {
  let calls: { createMultiFileCommit: any[]; createPullRequest: any[] }
  let originalEncrypt: any
  let originalRead: any
  let infoSpy: any
  let warnSpy: any

  beforeEach(() => {
    svc._internal.treeCache.clear()
    svc._internal.overridesCache.clear()
    svc._internal.resetLastKnownGoodBundleConfig()
    originalRead = svc._internal.readBundleConfigFile
    svc._internal.readBundleConfigFile = () => JSON.stringify(validConfig)
    originalEncrypt = svc._internal.encryptValueWithSops
    calls = { createMultiFileCommit: [], createPullRequest: [] }

    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [treeEntry('infrastructure/app/dev/keyvault'), treeEntry('infrastructure/app/int/keyvault'), treeEntry('infrastructure/app/sint/keyvault'), treeEntry('infrastructure/app/stage/keyvault')]
    })
    // Only the per-environment secrets.enc.yaml lookups are meaningful to these tests; anything
    // else (e.g. the keyvault-overrides.json sidecar read inside resolveKeyVaults) resolves to
    // null, same convention as the existing bulk submitSecretViaGitOps test suite.
    gs.getFileContent = async (_repo: string, path: string) => (path.endsWith('secrets.enc.yaml') ? { content: '', sha: `sha-${path}` } : null)
    gs.findOpenPullRequest = async () => null
    gs.branchExists = async () => false
    gs.createMultiFileCommit = async (_repo: string, opts: any) => {
      calls.createMultiFileCommit.push(opts)
      return { commitSha: 'new-commit-sha', branchName: opts.branchName, branchAlreadyExisted: false }
    }
    gs.createPullRequest = async (_repo: string, _base: string, branch: string, title: string, body: string, correlationId: string) => {
      calls.createPullRequest.push({ branch, title, body, correlationId })
      return { prUrl: 'https://github.com/example/pull/42', prNumber: 42 }
    }
    if (!gs.octokit) gs.octokit = {}
    gs.octokit.rest = { ...(gs.octokit.rest || {}), repos: { ...(gs.octokit.rest?.repos || {}), get: async () => ({ data: { default_branch: 'main' } }) } }

    infoSpy = null
    warnSpy = null
  })

  afterEach(() => {
    svc._internal.encryptValueWithSops = originalEncrypt
    svc._internal.readBundleConfigFile = originalRead
    svc._internal.resetLastKnownGoodBundleConfig()
  })

  const baseInput = {
    target: 'live',
    appName: 'app',
    bundleId: 'developer',
    jiraTicket: 'DSO-999',
    userEmail: 'dev@example.com',
    correlationId: 'cid-bundle-1'
  }

  it('happy path: one commit, one PR, includes every currently-eligible environment', async () => {
    svc._internal.encryptValueWithSops = async (value: string) => `ENC[${value}]`

    const result = await svc.submitSecretBundleViaGitOps({
      ...baseInput,
      environmentSecrets: [
        { environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] },
        { environment: 'int', secrets: [{ secretName: 'API_KEY', secretValue: 'two' }] },
        { environment: 'sint', secrets: [{ secretName: 'API_KEY', secretValue: 'three' }] },
        { environment: 'stage', secrets: [{ secretName: 'API_KEY', secretValue: 'four' }] }
      ]
    })

    expect(result.success).toBe(true)
    expect(result.prUrl).toBe('https://github.com/example/pull/42')
    expect(result.includedEnvironments.sort()).toEqual(['dev', 'int', 'sint', 'stage'])
    expect(calls.createMultiFileCommit).toHaveLength(1)
    expect(calls.createMultiFileCommit[0].files).toHaveLength(4)
    expect(calls.createPullRequest).toHaveLength(1)
    expect(calls.createPullRequest[0].title).toContain('[DSO-999]')
    expect(calls.createPullRequest[0].body).not.toContain('one')
    expect(calls.createPullRequest[0].body).not.toContain('two')
    expect(calls.createPullRequest[0].title).not.toContain('[RELEASE]')
  })

  it('prefixes the PR title with [RELEASE] and adds a release-marker body line for a releaseControlled bundle', async () => {
    svc._internal.encryptValueWithSops = async (value: string) => `ENC[${value}]`
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/app/prod/keyvault')] })

    const result = await svc.submitSecretBundleViaGitOps({
      ...baseInput,
      bundleId: 'release',
      environmentSecrets: [{ environment: 'prod', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] }]
    })

    expect(result.success).toBe(true)
    expect(result.releaseControlled).toBe(true)
    expect(calls.createPullRequest[0].title).toContain('[RELEASE]')
    expect(calls.createPullRequest[0].body).toContain('Release-controlled')
  })

  it('throws NO_ELIGIBLE_ENVIRONMENTS when every declared bundle environment is undeployed', async () => {
    gs.getRepoTree = async () => ({ truncated: false, tree: [] })

    await expect(svc.submitSecretBundleViaGitOps({
      ...baseInput,
      environmentSecrets: [{ environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] }]
    })).rejects.toMatchObject({ code: 'NO_ELIGIBLE_ENVIRONMENTS' })

    expect(calls.createMultiFileCommit).toHaveLength(0)
  })

  it('surfaces ENVIRONMENT_NOT_IN_BUNDLE from membership validation before any resolution/GitHub call', async () => {
    await expect(svc.submitSecretBundleViaGitOps({
      ...baseInput,
      environmentSecrets: [{ environment: 'prod', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] }]
    })).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_IN_BUNDLE' })

    expect(calls.createMultiFileCommit).toHaveLength(0)
  })

  it('atomicity: a failing secret aborts encryption entirely with zero GitHub writes', async () => {
    svc._internal.encryptValueWithSops = async (value: string) => {
      if (value === 'two') throw new Error('sops: exit status 1')
      return `ENC[${value}]`
    }

    await expect(svc.submitSecretBundleViaGitOps({
      ...baseInput,
      environmentSecrets: [
        { environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] },
        { environment: 'int', secrets: [{ secretName: 'API_KEY', secretValue: 'two' }] },
        { environment: 'sint', secrets: [{ secretName: 'API_KEY', secretValue: 'three' }] },
        { environment: 'stage', secrets: [{ secretName: 'API_KEY', secretValue: 'four' }] }
      ]
    })).rejects.toMatchObject({ code: 'ENCRYPTION_FAILED' })

    expect(calls.createMultiFileCommit).toHaveLength(0)
  })

  it('SOPS_NOT_CONFIGURED is never masked as ENCRYPTION_FAILED', async () => {
    svc._internal.encryptValueWithSops = async () => {
      const err: any = new Error('SOPS Key Vault URL is not configured')
      err.code = 'SOPS_NOT_CONFIGURED'
      throw err
    }

    await expect(svc.submitSecretBundleViaGitOps({
      ...baseInput,
      environmentSecrets: [
        { environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] },
        { environment: 'int', secrets: [{ secretName: 'API_KEY', secretValue: 'two' }] },
        { environment: 'sint', secrets: [{ secretName: 'API_KEY', secretValue: 'three' }] },
        { environment: 'stage', secrets: [{ secretName: 'API_KEY', secretValue: 'four' }] }
      ]
    })).rejects.toMatchObject({ code: 'SOPS_NOT_CONFIGURED' })
  })

  it('throws CONFLICT when a target file changes between pre-encryption capture and post-encryption re-check', async () => {
    svc._internal.encryptValueWithSops = async (value: string) => `ENC[${value}]`
    let call = 0
    gs.getFileContent = async (_repo: string, path: string) => {
      if (!path.endsWith('secrets.enc.yaml')) return null
      call++
      // first pass (pre-encryption capture) returns sha-A for every path; second pass (post-
      // encryption re-check) returns sha-B for the 'dev' path only, simulating a concurrent write.
      const pass = call <= 4 ? 1 : 2
      if (pass === 2 && path.includes('/dev/')) return { content: '', sha: 'sha-B-dev' }
      return { content: '', sha: `sha-A-${path}` }
    }

    await expect(svc.submitSecretBundleViaGitOps({
      ...baseInput,
      environmentSecrets: [
        { environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] },
        { environment: 'int', secrets: [{ secretName: 'API_KEY', secretValue: 'two' }] },
        { environment: 'sint', secrets: [{ secretName: 'API_KEY', secretValue: 'three' }] },
        { environment: 'stage', secrets: [{ secretName: 'API_KEY', secretValue: 'four' }] }
      ]
    })).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(calls.createMultiFileCommit).toHaveLength(0)
  })

  it('throws PR_EXISTS with the existing PR URL when an open PR for this exact content hash already exists', async () => {
    gs.findOpenPullRequest = async () => ({ html_url: 'https://github.com/example/pull/7' })
    svc._internal.encryptValueWithSops = async (value: string) => `ENC[${value}]`

    await expect(svc.submitSecretBundleViaGitOps({
      ...baseInput,
      environmentSecrets: [
        { environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] },
        { environment: 'int', secrets: [{ secretName: 'API_KEY', secretValue: 'two' }] },
        { environment: 'sint', secrets: [{ secretName: 'API_KEY', secretValue: 'three' }] },
        { environment: 'stage', secrets: [{ secretName: 'API_KEY', secretValue: 'four' }] }
      ]
    })).rejects.toMatchObject({ code: 'PR_EXISTS', prUrl: 'https://github.com/example/pull/7' })
  })

  it('returns { success: false, errorCode: PR_CREATION_FAILED, branchName, commitSha } rather than throwing when PR creation fails after a successful commit', async () => {
    svc._internal.encryptValueWithSops = async (value: string) => `ENC[${value}]`
    gs.createPullRequest = async () => { throw new Error('GitHub API rate limited') }

    const result = await svc.submitSecretBundleViaGitOps({
      ...baseInput,
      environmentSecrets: [
        { environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] },
        { environment: 'int', secrets: [{ secretName: 'API_KEY', secretValue: 'two' }] },
        { environment: 'sint', secrets: [{ secretName: 'API_KEY', secretValue: 'three' }] },
        { environment: 'stage', secrets: [{ secretName: 'API_KEY', secretValue: 'four' }] }
      ]
    })

    expect(result).toMatchObject({ success: false, errorCode: 'PR_CREATION_FAILED', commitSha: 'new-commit-sha' })
    expect(result.branchName).toMatch(/^secrets\/app-developer-[0-9a-f]{8}$/)
  })

  it('emits phase-tagged log lines "[correlationId][bundle:bundleId]" at each of the 6 phase transitions', async () => {
    const infoLines: string[] = []
    const logger = cjsRequire('../../../utils/logger')
    const originalInfo = logger.info
    logger.info = (msg: string) => { infoLines.push(msg); return logger }
    svc._internal.encryptValueWithSops = async (value: string) => `ENC[${value}]`

    try {
      await svc.submitSecretBundleViaGitOps({
        ...baseInput,
        environmentSecrets: [
          { environment: 'dev', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] },
          { environment: 'int', secrets: [{ secretName: 'API_KEY', secretValue: 'two' }] },
          { environment: 'sint', secrets: [{ secretName: 'API_KEY', secretValue: 'three' }] },
          { environment: 'stage', secrets: [{ secretName: 'API_KEY', secretValue: 'four' }] }
        ]
      })
    } finally {
      logger.info = originalInfo
    }

    const tagged = infoLines.filter(l => l.startsWith('[cid-bundle-1][bundle:developer]'))
    expect(tagged.length).toBeGreaterThanOrEqual(4) // membership / resolution / encryption / commit / PR (some share one call site)
    expect(tagged.some(l => l.includes('membership validated'))).toBe(true)
    expect(tagged.some(l => l.includes('resolution complete'))).toBe(true)
    expect(tagged.some(l => l.includes('encryption complete'))).toBe(true)
    expect(tagged.some(l => l.includes('commit created'))).toBe(true)
    expect(tagged.some(l => l.includes('PR created'))).toBe(true)
  })
})
