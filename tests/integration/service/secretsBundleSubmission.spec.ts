/**
 * QA — secrets-environment-bundles (docs/architecture/secrets-environment-bundles-spec.json).
 *
 * Independently derived from spec.json testing.unit_tests ("secretsService.resolveBundleEnvironments",
 * "secretsService.submitSecretBundleViaGitOps") and spec.md §2.5 (full submission algorithm +
 * phase-tagged logging, Round 1 Blocking Finding 3 / NFR-OBS-001). Mirrors the existing
 * `submitSecretViaGitOps` test convention in `secretsService.spec.ts` (monkey-patch
 * `githubService` methods to build a fake repo tree, no network) rather than mocking
 * `resolveKeyVaults` directly, since that function is not called through `module.exports`
 * anywhere in the current source (confirmed by reading `services/secretsService.js`).
 *
 * As of this session, none of `resolveBundleEnvironments`, `submitSecretBundleViaGitOps`, or
 * `githubService.createMultiFileCommit` exist (`services/secretsService.js` `module.exports` has
 * no bundle-related keys; `grep -n "createMultiFileCommit" services/githubService.js` returns no
 * matches) — every test below is expected to fail until the Vue.js Developer implements the
 * documented contract. See tests/results/secrets-environment-bundles-results.json.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const secretsService = cjsRequire('../../../services/secretsService')
const githubService = cjsRequire('../../../services/githubService')

const svc: any = secretsService
const gs: any = githubService

function treeEntry(path: string, type: 'tree' | 'blob' = 'tree') {
  return { path, type }
}

// Bundle fixture matching spec.md §3.1's example shape.
const releaseBundle = {
  id: 'release',
  displayName: 'Release Bundle',
  order: 3,
  releaseControlled: true,
  environments: ['prod', 'cint', 'demo']
}

describe('secretsService.resolveBundleEnvironments (spec.md §2.5)', () => {
  beforeEach(() => {
    if (svc._internal?.treeCache) svc._internal.treeCache.clear()
  })

  it('is exported as a function', () => {
    expect(typeof svc.resolveBundleEnvironments).toBe('function')
  })

  it('includes every unambiguously-deployed declared environment', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [
        treeEntry('infrastructure/myapp/prod/keyvault'),
        treeEntry('infrastructure/myapp/cint/keyvault')
      ]
    })
    const environmentSecretsByEnv = {
      prod: { secrets: [{ secretName: 'API_KEY', secretValue: 'a' }] },
      cint: { secrets: [{ secretName: 'API_KEY', secretValue: 'b' }] }
      // 'demo' has no vault in the tree at all -> NOT_DEPLOYED, silently omitted.
    }
    const result = await svc.resolveBundleEnvironments(releaseBundle, environmentSecretsByEnv, 'sand', 'myapp', 'cid-rbe-1')
    expect(result.included.map((e: any) => e.environment).sort()).toEqual(['cint', 'prod'])
    expect(result.excluded).toEqual([]) // NOT_DEPLOYED is never in excluded[]
  })

  it('excludes a multi-vault environment with VAULT_AMBIGUOUS when no vaultDir is submitted', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [
        treeEntry('infrastructure/myapp/cint/keyvault01'),
        treeEntry('infrastructure/myapp/cint/keyvault02')
      ]
    })
    const environmentSecretsByEnv = { cint: { secrets: [{ secretName: 'API_KEY', secretValue: 'a' }] } }
    const bundle = { ...releaseBundle, environments: ['cint'] }
    const result = await svc.resolveBundleEnvironments(bundle, environmentSecretsByEnv, 'sand', 'myapp', 'cid-rbe-2')
    expect(result.included).toEqual([])
    expect(result.excluded).toEqual([expect.objectContaining({ environment: 'cint', reason: 'VAULT_AMBIGUOUS' })])
  })

  it('resolves a previously-ambiguous environment to included when vaultDir is supplied', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [
        treeEntry('infrastructure/myapp/cint/keyvault01'),
        treeEntry('infrastructure/myapp/cint/keyvault02')
      ]
    })
    const environmentSecretsByEnv = {
      cint: { vaultDir: 'infrastructure/myapp/cint/keyvault01', secrets: [{ secretName: 'API_KEY', secretValue: 'a' }] }
    }
    const bundle = { ...releaseBundle, environments: ['cint'] }
    const result = await svc.resolveBundleEnvironments(bundle, environmentSecretsByEnv, 'sand', 'myapp', 'cid-rbe-3')
    expect(result.included.map((e: any) => e.environment)).toEqual(['cint'])
    expect(result.excluded).toEqual([])
  })

  it('excludes with VAULT_INVALID (distinct from VAULT_AMBIGUOUS) when a submitted vaultDir matches none of the resolved vaults (Round 1 Advisory A2)', async () => {
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/myapp/cint/keyvault')] })
    const environmentSecretsByEnv = {
      cint: { vaultDir: 'infrastructure/myapp/cint/does-not-exist', secrets: [{ secretName: 'API_KEY', secretValue: 'a' }] }
    }
    const bundle = { ...releaseBundle, environments: ['cint'] }
    const result = await svc.resolveBundleEnvironments(bundle, environmentSecretsByEnv, 'sand', 'myapp', 'cid-rbe-4')
    expect(result.excluded).toEqual([expect.objectContaining({ environment: 'cint', reason: 'VAULT_INVALID' })])
  })

  it('excludes with QUALIFIER_AMBIGUOUS when a multi-qualifier environment has no qualifier submitted', async () => {
    // Qualifier convention confirmed by reading services/secretsService.js's classifyVaultEntry:
    // the sub-app qualifier is the path segment immediately after the literal `_idmapplications`
    // grouping directory (see the `idm/_idmapplications/notif/dev/keyvault` example in-source).
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [
        treeEntry('infrastructure/myapp/_idmapplications/api/cint/keyvault'),
        treeEntry('infrastructure/myapp/_idmapplications/worker/cint/keyvault')
      ]
    })
    const environmentSecretsByEnv = { cint: { secrets: [{ secretName: 'API_KEY', secretValue: 'a' }] } }
    const bundle = { ...releaseBundle, environments: ['cint'] }
    const result = await svc.resolveBundleEnvironments(bundle, environmentSecretsByEnv, 'sand', 'myapp', 'cid-rbe-5')
    expect(result.excluded.some((e: any) => e.environment === 'cint' && e.reason === 'QUALIFIER_AMBIGUOUS')).toBe(true)
  })

  it('excludes with QUALIFIER_MISMATCH (distinct from QUALIFIER_AMBIGUOUS) when a submitted qualifier matches none of the resolved vault qualifiers (Round 1 Advisory A2)', async () => {
    // Verified correctly reachable: resolveBundleEnvironments() fetches the UNFILTERED
    // vault/qualifier set from resolveKeyVaults() (deliberately not forwarding the submitted
    // qualifier into that call — see the in-source comment), then applies qualifier filtering
    // itself via `vaults.filter(v => v.qualifier === submitted.qualifier)`. This correctly keeps
    // "not deployed at all" (found:false) and "deployed, but qualifier doesn't match"
    // (candidateVaults.length === 0) as two distinct, independently reachable outcomes.
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [treeEntry('infrastructure/myapp/_idmapplications/api/cint/keyvault')]
    })
    const environmentSecretsByEnv = {
      cint: { qualifier: 'nonexistent-qualifier', secrets: [{ secretName: 'API_KEY', secretValue: 'a' }] }
    }
    const bundle = { ...releaseBundle, environments: ['cint'] }
    const result = await svc.resolveBundleEnvironments(bundle, environmentSecretsByEnv, 'sand', 'myapp', 'cid-rbe-6')
    expect(result.excluded.some((e: any) => e.environment === 'cint' && e.reason === 'QUALIFIER_MISMATCH')).toBe(true)
  })

  it('throws INCOMPLETE_BUNDLE when a currently-eligible declared environment has no submitted entry', async () => {
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [
        treeEntry('infrastructure/myapp/prod/keyvault'),
        treeEntry('infrastructure/myapp/cint/keyvault')
      ]
    })
    // 'cint' resolves as unambiguously eligible but has no entry in environmentSecretsByEnv at all.
    const environmentSecretsByEnv = { prod: { secrets: [{ secretName: 'API_KEY', secretValue: 'a' }] } }
    const bundle = { ...releaseBundle, environments: ['prod', 'cint'] }
    await expect(
      svc.resolveBundleEnvironments(bundle, environmentSecretsByEnv, 'sand', 'myapp', 'cid-rbe-7')
    ).rejects.toMatchObject({ code: 'INCOMPLETE_BUNDLE' })
  })

  it('an environment eligible at pre-flight but not-deployed by submission time is excluded, not a hard failure (race-condition scenario)', async () => {
    // Only 'prod' has a vault in the tree; 'cint' — previously eligible per the client's own
    // pre-flight — has since become undeployed (simulates a concurrent infra change).
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/myapp/prod/keyvault')] })
    const environmentSecretsByEnv = {
      prod: { secrets: [{ secretName: 'API_KEY', secretValue: 'a' }] },
      cint: { secrets: [{ secretName: 'API_KEY', secretValue: 'b' }] }
    }
    const bundle = { ...releaseBundle, environments: ['prod', 'cint'] }
    const result = await svc.resolveBundleEnvironments(bundle, environmentSecretsByEnv, 'sand', 'myapp', 'cid-rbe-8')
    expect(result.included.map((e: any) => e.environment)).toEqual(['prod'])
    expect(result.excluded).toEqual([]) // NOT_DEPLOYED is silently omitted, not an exclusion reason
  })
})

describe('secretsService.submitSecretBundleViaGitOps (spec.md §2.4/§2.5)', () => {
  let calls: { createMultiFileCommit: any[]; createPullRequest: any[] }
  let originalEncrypt: any
  let originalBundleRead: any
  let capturedLogs: string[]
  let originalInfo: any
  let originalWarn: any
  let originalError: any

  beforeEach(() => {
    svc._internal?.treeCache?.clear()
    calls = { createMultiFileCommit: [], createPullRequest: [] }
    capturedLogs = []
    originalEncrypt = svc._internal?.encryptValueWithSops
    originalBundleRead = svc._internal.readBundleConfigFile
    svc._internal.resetLastKnownGoodBundleConfig()
    svc._internal.readBundleConfigFile = () => JSON.stringify({ version: '1.0', bundles: [
      { id: 'release', displayName: 'Release', order: 1, releaseControlled: true, environments: ['prod', 'cint', 'demo'] },
      { id: 'sand', displayName: 'Sandbox', order: 2, releaseControlled: false, environments: ['sand'] }
    ] })

    const logger = cjsRequire('../../../utils/logger')
    originalInfo = logger.info
    originalWarn = logger.warn
    originalError = logger.error
    logger.info = (msg: string) => capturedLogs.push(`INFO:${msg}`)
    logger.warn = (msg: string) => capturedLogs.push(`WARN:${msg}`)
    logger.error = (msg: string) => capturedLogs.push(`ERROR:${msg}`)

    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [
        treeEntry('infrastructure/myapp/prod/keyvault'),
        treeEntry('infrastructure/myapp/cint/keyvault')
      ]
    })
    gs.getFileContent = async () => ({ content: '', sha: 'sha-fixed' })
    gs.findOpenPullRequest = async () => null
    gs.createMultiFileCommit = async (_repo: string, opts: any) => {
      calls.createMultiFileCommit.push(opts)
      return { commitSha: 'commit-sha-123', branchName: opts.branchName, branchAlreadyExisted: false }
    }
    gs.createPullRequest = async (_repo: string, _base: string, branchName: string, title: string, body: string) => {
      calls.createPullRequest.push({ branchName, title, body })
      return { prUrl: 'https://github.com/example/pull/321', prNumber: 321 }
    }
    if (!gs.octokit) gs.octokit = {}
    gs.octokit.rest = { ...(gs.octokit.rest || {}), repos: { ...(gs.octokit.rest?.repos || {}), get: async () => ({ data: { default_branch: 'main' } }) } }
  })

  afterEach(() => {
    if (svc._internal) svc._internal.encryptValueWithSops = originalEncrypt
    svc._internal.readBundleConfigFile = originalBundleRead
    svc._internal.resetLastKnownGoodBundleConfig()
    const logger = cjsRequire('../../../utils/logger')
    logger.info = originalInfo
    logger.warn = originalWarn
    logger.error = originalError
  })

  it('is exported as a function', () => {
    expect(typeof svc.submitSecretBundleViaGitOps).toBe('function')
  })

  it('happy path: produces exactly one commit and one PR for a multi-environment bundle', async () => {
    const encrypt = vi.fn(async (v: string) => `ENC[${v}]`)
    svc._internal.encryptValueWithSops = encrypt

    const result = await svc.submitSecretBundleViaGitOps({
      target: 'sand',
      appName: 'myapp',
      bundleId: 'release',
      environmentSecrets: [
        { environment: 'prod', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] },
        { environment: 'cint', secrets: [{ secretName: 'API_KEY', secretValue: 'two' }] }
      ],
      jiraTicket: 'DSO-999',
      userEmail: 'dev@example.com',
      correlationId: 'cid-bundle-happy'
    })

    expect(calls.createMultiFileCommit).toHaveLength(1)
    expect(encrypt).toHaveBeenCalledWith('one', {
      correlationId: 'cid-bundle-happy', target: 'sand', appName: 'myapp', environment: 'prod', bundleId: 'release'
    })
    expect(encrypt).toHaveBeenCalledWith('two', {
      correlationId: 'cid-bundle-happy', target: 'sand', appName: 'myapp', environment: 'cint', bundleId: 'release'
    })
    expect(calls.createPullRequest).toHaveLength(1)
    expect(result.includedEnvironments?.sort()).toEqual(['cint', 'prod'])
    expect(result.prNumber).toBe(321)
    // NFR-SEC-001: secret values must never leak into the PR body.
    expect(calls.createPullRequest[0].body).not.toContain('one')
    expect(calls.createPullRequest[0].body).not.toContain('two')
    // Release-controlled bundle: [RELEASE] prefix + marker (spec.md §2.5 step 10).
    expect(calls.createPullRequest[0].title).toContain('[RELEASE]')
  })

  it('zero writes on ENCRYPTION_FAILED: aborts before any GitHub write, even for environments whose encryption already succeeded', async () => {
    let n = 0
    if (svc._internal) {
      svc._internal.encryptValueWithSops = async (v: string) => {
        n += 1
        if (n === 2) throw new Error('sops: exit status 1')
        return `ENC[${v}]`
      }
    }
    await expect(svc.submitSecretBundleViaGitOps({
      target: 'sand',
      appName: 'myapp',
      bundleId: 'release',
      environmentSecrets: [
        { environment: 'prod', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] },
        { environment: 'cint', secrets: [{ secretName: 'API_KEY', secretValue: 'two' }] }
      ],
      jiraTicket: 'DSO-999',
      userEmail: 'dev@example.com',
      correlationId: 'cid-bundle-enc-fail'
    })).rejects.toMatchObject({ code: 'ENCRYPTION_FAILED' })

    expect(calls.createMultiFileCommit).toHaveLength(0)
    expect(calls.createPullRequest).toHaveLength(0)
  })

  it('zero writes on post-encryption SHA conflict (caller\'s own pre-write re-check)', async () => {
    if (svc._internal) svc._internal.encryptValueWithSops = async (v: string) => `ENC[${v}]`
    // Scope the tree to `prod` only for this bundle submission — the real `release` bundle in
    // data/secretBundles.json also declares cint/hot/demo/dr, and leaving `cint`'s vault in the
    // fixture (as in beforeEach) would make it "currently eligible" with no submitted secrets,
    // throwing an unrelated INCOMPLETE_BUNDLE before this test's own SHA-conflict path is hit.
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/myapp/prod/keyvault')] })
    // resolveKeyVaults()'s own vault-name resolution (loadVaultOverrides + terragrunt.hcl lookup
    // via resolveVaultNameWithFallback) ALSO calls githubService.getFileContent before
    // submitSecretBundleViaGitOps ever captures the pre-write SHA, so a plain call-order counter
    // would misfire (confirmed by direct instrumentation: calls 1-3 are overrides/terragrunt.hcl
    // reads, calls 4-5 are the real pre/post secrets.enc.yaml capture). Key the mock on the
    // requested path instead so only the two secrets.enc.yaml reads alternate sha-A -> sha-B.
    const secretsPath = 'infrastructure/myapp/prod/keyvault/secrets.enc.yaml'
    let secretsPathCallCount = 0
    gs.getFileContent = async (_repo: string, path: string) => {
      if (path === secretsPath) {
        secretsPathCallCount += 1
        return { content: '', sha: secretsPathCallCount === 1 ? 'sha-A' : 'sha-B' }
      }
      return { content: '', sha: 'unrelated-sha' }
    }

    await expect(svc.submitSecretBundleViaGitOps({
      target: 'sand',
      appName: 'myapp',
      bundleId: 'release',
      environmentSecrets: [
        { environment: 'prod', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] }
      ],
      jiraTicket: 'DSO-999',
      userEmail: 'dev@example.com',
      correlationId: 'cid-bundle-conflict'
    })).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(calls.createMultiFileCommit).toHaveLength(0)
    expect(calls.createPullRequest).toHaveLength(0)
  })

  it('PR_CREATION_FAILED resolves (does not throw) with success:false + branchName/commitSha after a successful commit, never auto-retried', async () => {
    // Confirmed by reading services/secretsService.js (submitSecretBundleViaGitOps, ~line 916):
    // unlike every OTHER bundle error code (BUNDLE_UNKNOWN, ENVIRONMENT_NOT_IN_BUNDLE,
    // INCOMPLETE_BUNDLE, NO_ELIGIBLE_ENVIRONMENTS, PR_EXISTS, ENCRYPTION_FAILED, CONFLICT — all
    // thrown Errors with a `.code`), a post-commit PR-creation failure is deliberately caught and
    // turned into a *resolved* `{ success:false, errorCode:'PR_CREATION_FAILED', branchName,
    // commitSha, error }` return value, not a thrown error. This test asserts the real,
    // documented (spec.md §2.4 docstring) shape rather than the throw-based convention every
    // other error code follows.
    if (svc._internal) svc._internal.encryptValueWithSops = async (v: string) => `ENC[${v}]`
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/myapp/prod/keyvault')] })
    let prAttempts = 0
    gs.createPullRequest = async () => { prAttempts += 1; throw new Error('PR API unavailable') }

    const result = await svc.submitSecretBundleViaGitOps({
      target: 'sand',
      appName: 'myapp',
      bundleId: 'release',
      environmentSecrets: [{ environment: 'prod', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] }],
      jiraTicket: 'DSO-999',
      userEmail: 'dev@example.com',
      correlationId: 'cid-bundle-pr-fail'
    })

    expect(result).toMatchObject({
      success: false,
      errorCode: 'PR_CREATION_FAILED',
      branchName: expect.any(String),
      commitSha: expect.any(String)
    })
    expect(calls.createMultiFileCommit).toHaveLength(1) // commit did succeed
    expect(prAttempts).toBe(1) // exactly one attempt, no retry
  })

  it('PR_EXISTS: rejects an identical structural resubmission while a PR is open, with zero further writes', async () => {
    if (svc._internal) svc._internal.encryptValueWithSops = async (v: string) => `ENC[${v}]`
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/myapp/prod/keyvault')] })
    gs.findOpenPullRequest = async () => ({ html_url: 'https://github.com/example/pull/1', number: 1 })

    await expect(svc.submitSecretBundleViaGitOps({
      target: 'sand',
      appName: 'myapp',
      bundleId: 'release',
      environmentSecrets: [{ environment: 'prod', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] }],
      jiraTicket: 'DSO-999',
      userEmail: 'dev@example.com',
      correlationId: 'cid-bundle-duplicate'
    })).rejects.toMatchObject({ code: 'PR_EXISTS' })

    expect(calls.createMultiFileCommit).toHaveLength(0)
  })

  it('release-control marker is present for a releaseControlled bundle and absent for a non-release bundle, regardless of client-supplied releaseControlled claim', async () => {
    if (svc._internal) svc._internal.encryptValueWithSops = async (v: string) => `ENC[${v}]`
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/myapp/sand/keyvault')] })

    await svc.submitSecretBundleViaGitOps({
      target: 'sand',
      appName: 'myapp',
      bundleId: 'sand', // not release-controlled
      environmentSecrets: [{ environment: 'sand', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] }],
      jiraTicket: 'DSO-999',
      userEmail: 'dev@example.com',
      correlationId: 'cid-bundle-spoof',
      releaseControlled: true // spoofed client claim — must never govern the outcome
    })

    expect(calls.createPullRequest[0].title).not.toContain('[RELEASE]')
  })

  it('per-environment secret values never cross-contaminate: each committed file contains only its own environment\'s value', async () => {
    if (svc._internal) svc._internal.encryptValueWithSops = async (v: string) => `ENC[${v}]`

    await svc.submitSecretBundleViaGitOps({
      target: 'sand',
      appName: 'myapp',
      bundleId: 'release',
      environmentSecrets: [
        { environment: 'prod', secrets: [{ secretName: 'API_KEY', secretValue: 'prod-value' }] },
        { environment: 'cint', secrets: [{ secretName: 'API_KEY', secretValue: 'cint-value' }] }
      ],
      jiraTicket: 'DSO-999',
      userEmail: 'dev@example.com',
      correlationId: 'cid-bundle-crosscheck'
    })

    const files = calls.createMultiFileCommit[0]?.files || []
    const prodFile = files.find((f: any) => f.path.includes('/prod/'))
    const cintFile = files.find((f: any) => f.path.includes('/cint/'))
    expect(prodFile?.content).toContain('ENC[prod-value]')
    expect(prodFile?.content).not.toContain('ENC[cint-value]')
    expect(cintFile?.content).toContain('ENC[cint-value]')
    expect(cintFile?.content).not.toContain('ENC[prod-value]')
  })

  it('every phase-transition log line during a successful run carries both [correlationId] and [bundle:bundleId] (Round 1 Blocking Finding 3 / NFR-OBS-001)', async () => {
    if (svc._internal) svc._internal.encryptValueWithSops = async (v: string) => `ENC[${v}]`
    gs.getRepoTree = async () => ({ truncated: false, tree: [treeEntry('infrastructure/myapp/prod/keyvault')] })

    await svc.submitSecretBundleViaGitOps({
      target: 'sand',
      appName: 'myapp',
      bundleId: 'release',
      environmentSecrets: [{ environment: 'prod', secrets: [{ secretName: 'API_KEY', secretValue: 'one' }] }],
      jiraTicket: 'DSO-999',
      userEmail: 'dev@example.com',
      correlationId: 'cid-bundle-logtag'
    })

    // spec.md §2.5: 6 phase lines emitted directly by submitSecretBundleViaGitOps.
    const ownPhaseLines = capturedLogs.filter(l =>
      /membership validated|resolution complete|encryption complete|commit created|PR created/.test(l)
    )
    expect(ownPhaseLines.length).toBeGreaterThan(0)
    for (const line of ownPhaseLines) {
      expect(line).toMatch(/\[cid-bundle-logtag\]\[bundle:release\]/)
    }
  })
})
