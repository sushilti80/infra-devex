/**
 * QA — secrets-environment-bundles (docs/architecture/secrets-environment-bundles-spec.json,
 * approved docs/reviews/secrets-environment-bundles-arch-review-round3.md).
 *
 * Independently derived from spec.json testing.unit_tests ("secretsService.loadSecretBundles",
 * "secretsService.validateBundleMembership", "secretsService.classifyBundleMembership /
 * getBundleCatalog / discoverAppsForTarget", "secretsService.computeBundleContentHash") and
 * spec.md §2.3/§2.6. Written TDD-style against the documented contract — NOT against the Vue.js
 * Developer's implementation choices — but updated in place once the backend service layer landed
 * mid-session (confirmed via `grep -n "Bundle" services/secretsService.js`) so assertions target
 * the REAL exported surface: `classifyBundleMembership`, `getBundleCatalog`, and
 * `computeBundleContentHash` are top-level `module.exports` members (not under `_internal`), and
 * `_internal` only exposes `validateBundleConfigShape`, `readBundleConfigFile`, and
 * `resetLastKnownGoodBundleConfig` (no `setLastKnownGoodBundleConfig` setter) for bundle config.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const svc: any = cjsRequire('../../../services/secretsService')

describe('secretsService.loadSecretBundles (FR-001, spec.md §2.3)', () => {
  let originalReadFile: any

  beforeEach(() => {
    originalReadFile = svc._internal.readBundleConfigFile
    // spec.md §2.3 test-only reset so cold-start cases don't leak the in-process
    // last-known-good state from a prior successful load into subsequent tests.
    svc._internal.resetLastKnownGoodBundleConfig()
  })

  afterEach(() => {
    svc._internal.readBundleConfigFile = originalReadFile
    svc._internal.resetLastKnownGoodBundleConfig()
  })

  it('is exported as a function', () => {
    expect(typeof svc.loadSecretBundles).toBe('function')
  })

  it('cold start with no last-known-good and an unreadable on-disk file returns { config: null, source: "unavailable" } (fail-closed)', async () => {
    svc._internal.readBundleConfigFile = () => { throw new Error('ENOENT: ephemeral test condition') }
    const result = await svc.loadSecretBundles('cid-bundle-cfg-1')
    expect(result).toMatchObject({ config: null, source: 'unavailable' })
  })

  it('cold start with malformed JSON on disk also fails closed to { config: null, source: "unavailable" }', async () => {
    svc._internal.readBundleConfigFile = () => '{ not valid json'
    const result = await svc.loadSecretBundles('cid-bundle-cfg-1b')
    expect(result).toMatchObject({ config: null, source: 'unavailable' })
  })

  it('a well-formed on-disk file loads with source "fresh"', async () => {
    const result = await svc.loadSecretBundles('cid-bundle-cfg-fresh')
    expect(result.source).toBe('fresh')
    expect(Array.isArray(result.config?.bundles)).toBe(true)
  })

  it('serves the last-known-good config with source "stale" when a prior valid load exists in-process but the on-disk file is currently unavailable/invalid', async () => {
    // Step 1: a real successful load populates the module-level last-known-good cache as a
    // side effect (services/secretsService.js line ~644: `lastKnownGoodBundleConfig = candidate`).
    const goodLoad = await svc.loadSecretBundles('cid-bundle-cfg-seed')
    expect(goodLoad.source).toBe('fresh')

    // Step 2: the on-disk file becomes unavailable.
    svc._internal.readBundleConfigFile = () => { throw new Error('simulated read failure') }
    const result = await svc.loadSecretBundles('cid-bundle-cfg-2')

    expect(result.source).toBe('stale')
    expect(result.config).toEqual(goodLoad.config)
  })
})

describe('secretsService._internal.validateBundleConfigShape (FR-001, spec.md §2.3 pure validator)', () => {
  const valid = {
    version: '1.0',
    bundles: [
      { id: 'independent', displayName: 'Independent Environments', order: 1, releaseControlled: false, environments: ['sand', 'devsand'] },
      { id: 'developer', displayName: 'Developer Bundle', order: 2, releaseControlled: false, environments: ['dev', 'int'] },
      { id: 'release', displayName: 'Release Bundle', order: 3, releaseControlled: true, environments: ['prod', 'cint'] }
    ]
  }

  function validateFn() {
    expect(svc._internal).toBeDefined()
    expect(typeof svc._internal.validateBundleConfigShape).toBe('function')
    return svc._internal.validateBundleConfigShape
  }

  it('a well-formed config returns null (no violation)', () => {
    const validate = validateFn()
    expect(validate(valid)).toBeNull()
  })

  it('rejects a duplicate bundle id, case-insensitive', () => {
    const validate = validateFn()
    const candidate = {
      version: '1.0',
      bundles: [
        { id: 'release', displayName: 'A', order: 1, releaseControlled: false, environments: ['a'] },
        { id: 'RELEASE', displayName: 'B', order: 2, releaseControlled: true, environments: ['b'] }
      ]
    }
    expect(validate(candidate)).toBeTruthy()
  })

  it('rejects an environment present in two bundles, case-insensitive', () => {
    const validate = validateFn()
    const candidate = {
      version: '1.0',
      bundles: [
        { id: 'a', displayName: 'A', order: 1, releaseControlled: false, environments: ['prod'] },
        { id: 'b', displayName: 'B', order: 2, releaseControlled: false, environments: ['PROD'] }
      ]
    }
    expect(validate(candidate)).toBeTruthy()
  })

  it('rejects bundles being empty/non-array, or a bundle missing a required field / wrong type', () => {
    const validate = validateFn()
    expect(validate({ version: '1.0', bundles: [] })).toBeTruthy()
    expect(validate({ version: '1.0', bundles: 'not-an-array' })).toBeTruthy()
    expect(validate({
      version: '1.0',
      bundles: [{ id: 'a', displayName: 'A', order: 'not-a-number', releaseControlled: false, environments: ['x'] }]
    })).toBeTruthy()
    expect(validate({
      version: '1.0',
      bundles: [{ id: 'a', displayName: 'A', order: 1, releaseControlled: false, environments: [] }]
    })).toBeTruthy()
  })
})

describe('secretsService.validateBundleMembership (FR-003, spec.md §2.3)', () => {
  let originalReadFile: any

  beforeEach(() => {
    originalReadFile = svc._internal.readBundleConfigFile
    svc._internal.resetLastKnownGoodBundleConfig()
  })

  afterEach(() => {
    svc._internal.readBundleConfigFile = originalReadFile
    svc._internal.resetLastKnownGoodBundleConfig()
  })

  it('is exported as a function', () => {
    expect(typeof svc.validateBundleMembership).toBe('function')
  })

  it('throws BUNDLE_CONFIG_UNAVAILABLE when bundle config cannot be loaded', () => {
    svc._internal.readBundleConfigFile = () => { throw new Error('simulated read failure') }
    expect(() => svc.validateBundleMembership('release', ['prod'], 'cid-vbm-1'))
      .toThrow(expect.objectContaining({ code: 'BUNDLE_CONFIG_UNAVAILABLE' }))
  })

  it('throws BUNDLE_UNKNOWN for a bundle id absent from the real on-disk config, case-insensitively matching known ids otherwise', () => {
    expect(() => svc.validateBundleMembership('not-a-real-bundle', ['prod'], 'cid-vbm-2'))
      .toThrow(expect.objectContaining({ code: 'BUNDLE_UNKNOWN' }))
    // Case-insensitive positive match against the real config (data/secretBundles.json "release").
    const bundle = svc.validateBundleMembership('RELEASE', ['prod'], 'cid-vbm-3')
    expect(bundle.id).toBe('release')
  })

  it('throws ENVIRONMENT_NOT_IN_BUNDLE (FR-003, NFR-SEC-002) when a submitted environment is not a member of the named bundle, even though it is a real, deployed environment elsewhere', () => {
    // 'dev' is a real environment but belongs to the "developer" bundle, not "release" — this
    // proves membership enforcement is server-derived and cannot be satisfied by supplying any
    // arbitrary real environment name.
    expect(() => svc.validateBundleMembership('release', ['prod', 'dev'], 'cid-vbm-4'))
      .toThrow(expect.objectContaining({ code: 'ENVIRONMENT_NOT_IN_BUNDLE', environments: ['dev'] }))
  })
})

describe('secretsService.classifyBundleMembership / getBundleCatalog (Round 1 Advisory A5, spec.md §2.3)', () => {
  const bundleConfig = {
    version: '1.0',
    bundles: [
      { id: 'independent', displayName: 'Independent Environments', order: 1, releaseControlled: false, environments: ['sand', 'devsand'] },
      { id: 'developer', displayName: 'Developer Bundle', order: 2, releaseControlled: false, environments: ['dev', 'int'] },
      { id: 'release', displayName: 'Release Bundle', order: 3, releaseControlled: true, environments: ['prod', 'cint'] }
    ]
  }

  it('classifyBundleMembership is a pure, top-level exported function (not nested under _internal, Round 1 Advisory A5)', () => {
    expect(typeof svc.classifyBundleMembership).toBe('function')
    expect(svc.classifyBundleMembership('dev', bundleConfig)).toBe('developer')
    expect(svc.classifyBundleMembership('DEV', bundleConfig)).toBe('developer') // case-insensitive
    expect(svc.classifyBundleMembership('unmapped-env', bundleConfig)).toBeNull()
  })

  it('classifyBundleMembership returns null (never throws) when bundleConfig is null (config unavailable)', () => {
    expect(svc.classifyBundleMembership('dev', null)).toBeNull()
  })

  it('getBundleCatalog returns the catalog sorted by order, derived only from the passed-in config', () => {
    expect(typeof svc.getBundleCatalog).toBe('function')
    const catalog = svc.getBundleCatalog(bundleConfig)
    expect(catalog.map((b: any) => b.id)).toEqual(['independent', 'developer', 'release'])
    expect(catalog[2]).toMatchObject({ id: 'release', displayName: 'Release Bundle', releaseControlled: true })
  })

  it('getBundleCatalog returns [] when bundleConfig is null (config unavailable)', () => {
    expect(svc.getBundleCatalog(null)).toEqual([])
  })
})

describe('secretsService.discoverAppsForTarget — bundleId attachment (Round 1 Advisory A5)', () => {
  const bundleConfig = {
    version: '1.0',
    bundles: [{ id: 'developer', displayName: 'Developer Bundle', order: 1, releaseControlled: false, environments: ['dev'] }]
  }

  it('attaches bundleId per entry when a preloaded bundleConfig is supplied as the 3rd argument, and null when omitted (legacy 2-arg callers unaffected)', async () => {
    const gs: any = cjsRequire('../../../services/githubService')
    const originalGetRepoTree = gs.getRepoTree
    gs.getRepoTree = async () => ({
      truncated: false,
      tree: [{ path: 'infrastructure/myapp/dev/keyvault', type: 'tree' }]
    })
    try {
      svc._internal.discoverCache?.clear()
      const withConfig = await svc.discoverAppsForTarget('live', 'cid-daft-1', bundleConfig)
      expect(withConfig.find((a: any) => a.environment === 'dev')?.bundleId).toBe('developer')

      svc._internal.discoverCache?.clear()
      const legacyTwoArg = await svc.discoverAppsForTarget('live', 'cid-daft-2')
      expect(legacyTwoArg.find((a: any) => a.environment === 'dev')?.bundleId).toBeNull()
    } finally {
      gs.getRepoTree = originalGetRepoTree
      svc._internal.discoverCache?.clear()
    }
  })
})

describe('secretsService.computeBundleContentHash (FR-005(g)/NFR-REL-002, spec.md §2.6)', () => {
  it('is exported as a top-level function (not nested under _internal)', () => {
    expect(typeof svc.computeBundleContentHash).toBe('function')
  })

  const baseIncluded = [
    { environment: 'prod', vault: { vaultDir: 'infra/myapp/prod/keyvault' }, secrets: [{ secretName: 'API_KEY', secretValue: 'v1' }] },
    { environment: 'cint', vault: { vaultDir: 'infra/myapp/cint/keyvault' }, secrets: [{ secretName: 'API_KEY', secretValue: 'v2' }] }
  ]

  it('is deterministic for identical structural input', () => {
    const a = svc.computeBundleContentHash({ target: 'live', appName: 'myapp', bundleId: 'release', included: baseIncluded })
    const b = svc.computeBundleContentHash({ target: 'live', appName: 'myapp', bundleId: 'release', included: baseIncluded })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}$/)
  })

  it('excludes secret values: differing secretValue with identical structure produces the same hash', () => {
    const includedDifferentValues = baseIncluded.map(e => ({
      ...e,
      secrets: e.secrets.map(s => ({ ...s, secretValue: `${s.secretValue}-CHANGED` }))
    }))
    const a = svc.computeBundleContentHash({ target: 'live', appName: 'myapp', bundleId: 'release', included: baseIncluded })
    const b = svc.computeBundleContentHash({ target: 'live', appName: 'myapp', bundleId: 'release', included: includedDifferentValues })
    expect(a).toBe(b)
  })

  it('a differing included-environment set produces a different hash', () => {
    const a = svc.computeBundleContentHash({ target: 'live', appName: 'myapp', bundleId: 'release', included: baseIncluded })
    const b = svc.computeBundleContentHash({ target: 'live', appName: 'myapp', bundleId: 'release', included: [baseIncluded[0]] })
    expect(a).not.toBe(b)
  })

  it('a differing secret-name set produces a different hash', () => {
    const includedDifferentNames = baseIncluded.map(e => ({
      ...e,
      secrets: e.secrets.map(s => ({ ...s, secretName: `${s.secretName}_2` }))
    }))
    const a = svc.computeBundleContentHash({ target: 'live', appName: 'myapp', bundleId: 'release', included: baseIncluded })
    const b = svc.computeBundleContentHash({ target: 'live', appName: 'myapp', bundleId: 'release', included: includedDifferentNames })
    expect(a).not.toBe(b)
  })
})

describe('data/secretBundles.json (spec.md §3.1 data contract)', () => {
  it('exists and matches the documented schema', () => {
    let raw: string
    try {
      raw = cjsRequire('fs').readFileSync(cjsRequire('path').join(__dirname, '../../../data/secretBundles.json'), 'utf8')
    } catch (e: any) {
      throw new Error(`data/secretBundles.json is missing (spec.md §3.1 requires this file to exist): ${e.message}`)
    }
    const parsed = JSON.parse(raw)
    expect(Array.isArray(parsed.bundles)).toBe(true)
    expect(parsed.bundles.length).toBeGreaterThan(0)
    const ids = parsed.bundles.map((b: any) => String(b.id).toLowerCase())
    expect(new Set(ids).size).toBe(ids.length) // unique, case-insensitive
    const seenEnvs = new Set<string>()
    for (const bundle of parsed.bundles) {
      expect(typeof bundle.id).toBe('string')
      expect(typeof bundle.displayName).toBe('string')
      expect(typeof bundle.order).toBe('number')
      expect(typeof bundle.releaseControlled).toBe('boolean')
      expect(Array.isArray(bundle.environments)).toBe(true)
      expect(bundle.environments.length).toBeGreaterThan(0)
      for (const env of bundle.environments) {
        const key = String(env).toLowerCase()
        expect(seenEnvs.has(key)).toBe(false) // no environment in >1 bundle
        seenEnvs.add(key)
      }
    }
  })
})

