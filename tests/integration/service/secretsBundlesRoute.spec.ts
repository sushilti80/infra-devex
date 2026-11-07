/**
 * QA — secrets-environment-bundles (docs/architecture/secrets-environment-bundles-spec.json).
 *
 * Independently derived from spec.json testing.functional_test_scenarios/integration_tests and
 * spec.md §3.2/§3.3 (modified `GET /api/secrets/apps` and `POST /api/secrets` bundle-mode
 * contracts). Exercises the REAL express-validator chain through `router.stack` (same dispatch
 * pattern as `secretsRouteValidation.spec.ts`/`secretsFanOutRoute.spec.ts`), mocking only
 * `secretsService` methods — never `githubService` directly at this layer, matching the existing
 * convention that route-level tests validate HTTP status/response-shape decisions, while GitHub
 * API mechanics are covered by `secretsBundleSubmission.spec.ts` and
 * `githubServiceMultiFileCommit.spec.ts`.
 *
 * As of this session, `routes/api.js`'s `POST /api/secrets` `oneOf()` chain has only 2 branches
 * (legacy `secrets[]` array, legacy singular `secretName`/`secretValue`) — confirmed via
 * `grep -n "bundleId\|environmentSecrets\|handleBundleSecretsSubmission" routes/api.js`, which
 * returns no matches — so every bundle-mode request in this file is expected to be rejected by
 * the existing 2-way `oneOf()` generic error, not routed to bundle-specific logic. Every test
 * below is expected to fail until the 3rd `oneOf()` branch and `handleBundleSecretsSubmission()`
 * are implemented per spec.md §3.3. See tests/results/secrets-environment-bundles-results.json.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const router = cjsRequire('../../../routes/api')
const secretsService = cjsRequire('../../../services/secretsService')
const logger = cjsRequire('../../../utils/logger')

function getStack(path: string, method: string) {
  const layer = router.stack.find(
    (l: any) => l.route && l.route.path === path && l.route.methods[method]
  )
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`)
  return layer.route.stack
}

async function dispatch(stack: any[], req: any, res: any) {
  for (let i = 1; i < stack.length - 1; i++) {
    await new Promise<void>((resolve, reject) => {
      try {
        stack[i].handle(req, res, (err: unknown) => (err ? reject(err) : resolve()))
      } catch (e) {
        reject(e)
      }
    })
  }
  await stack[stack.length - 1].handle(req, res)
}

function makeRes() {
  const res: any = { statusCode: 200 }
  res.status = (code: number) => { res.statusCode = code; return res }
  res.json = (body: unknown) => { res.body = body; return res }
  return res
}

function bundleReq(overrides: Record<string, unknown> = {}) {
  return {
    body: {
      target: 'live',
      appName: 'myapp',
      jiraTicket: 'JIRA-1234',
      bundleId: 'release',
      environmentSecrets: [
        { environment: 'prod', secrets: [{ secretName: 'API-KEY', secretValue: 'super-secret-value' }] },
        { environment: 'cint', secrets: [{ secretName: 'API-KEY', secretValue: 'other-secret-value' }] }
      ],
      ...overrides
    },
    query: {},
    user: { email: 'dev@example.com' },
    correlationId: 'cid-bundle-route-test'
  }
}

describe('POST /api/secrets — 3-way validator dispatch for bundle-mode (Round 1 Blocking Finding 1)', () => {
  const stack = getStack('/secrets', 'post')
  const svc: any = secretsService
  let originalSubmit: any

  beforeEach(() => {
    originalSubmit = svc.submitSecretBundleViaGitOps
  })

  afterEach(() => {
    if (originalSubmit) svc.submitSecretBundleViaGitOps = originalSubmit
  })

  it('a well-formed bundle-mode request (bundleId+environmentSecrets[], no secrets/secretName) is not rejected by the oneOf() shape validator and reaches bundle-mode handling', async () => {
    svc.submitSecretBundleViaGitOps = async () => ({
      includedEnvironments: ['prod', 'cint'],
      excludedEnvironments: [],
      secretCount: 1,
      prNumber: 1,
      prUrl: 'https://github.com/example/pull/1'
    })

    const req: any = bundleReq()
    const res = makeRes()
    await dispatch(stack, req, res)

    // The legacy 2-way oneOf() generic message must never be the outcome for a well-formed
    // bundle-mode request once branch C exists. Real 400 shape here is
    // `{ success:false, errors: [...] }` (plural, express-validator array), not a singular
    // `error` string — search whichever shape the (currently non-bundle-aware) route returns.
    const bodyText = JSON.stringify(res.body ?? {})
    expect(bodyText).not.toMatch(/must include either a secrets\[\] array/i)
    expect(res.statusCode).not.toBe(400)
  })

  it('a request supplying both `environment` and `bundleId`+`environmentSecrets[]` is rejected with 400 REQUEST_SHAPE_CONFLICT', async () => {
    const req: any = bundleReq({ environment: 'dev' })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.success).toBe(false)
    // spec.md §3.3 REQUEST_SHAPE_CONFLICT message; real route currently has no bundle-mode
    // awareness so this legitimately fails today (falls through to the legacy oneOf() message
    // or a different validator branch entirely) — see results.json gap narrative.
    expect(JSON.stringify(res.body)).toMatch(/Provide exactly one of: environment, environments, or bundleId with environmentSecrets/)
  })

  it('a request with none of environment/environments/bundleId+environmentSecrets present is rejected with 400', async () => {
    const req: any = bundleReq({ bundleId: undefined, environmentSecrets: undefined })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.success).toBe(false)
  })
})

describe('POST /api/secrets — no secret leakage via the new nested validator path (NFR-SEC-001)', () => {
  const stack = getStack('/secrets', 'post')

  it('a bundle-mode request failing validation on environmentSecrets[].secrets[].secretValue never leaks the submitted value in the serialized JSON response', async () => {
    const req: any = bundleReq({
      environmentSecrets: [
        { environment: 'prod', secrets: [{ secretName: 'API-KEY', secretValue: '' }] } // empty -> invalid
      ]
    })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(400)
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain('super-secret-value')
    expect(serialized).not.toContain('other-secret-value')
  })
})

describe('POST /api/secrets — bundle-mode error code -> HTTP status map (spec.md §3.3)', () => {
  const stack = getStack('/secrets', 'post')
  const svc: any = secretsService
  let originalSubmit: any
  let originalLogMetric: typeof logger.logMetric
  let metrics: Array<{ event: string; fields: Record<string, unknown> }>

  beforeEach(() => {
    originalSubmit = svc.submitSecretBundleViaGitOps
    originalLogMetric = logger.logMetric
    metrics = []
    logger.logMetric = (event: string, fields: Record<string, unknown>) => metrics.push({ event, fields })
  })

  afterEach(() => {
    if (originalSubmit) svc.submitSecretBundleViaGitOps = originalSubmit
    logger.logMetric = originalLogMetric
  })

  it.each([
    ['BUNDLE_CONFIG_UNAVAILABLE', 503],
    ['BUNDLE_UNKNOWN', 400],
    ['ENVIRONMENT_NOT_IN_BUNDLE', 400],
    ['INCOMPLETE_BUNDLE', 400],
    ['NO_ELIGIBLE_ENVIRONMENTS', 422],
    ['PR_EXISTS', 409],
    ['ENCRYPTION_FAILED', 400],
    ['CONFLICT', 503],
    ['SOPS_NOT_CONFIGURED', 503],
    ['PR_CREATION_FAILED', 500]
  ])('errorCode %s maps to HTTP %i', async (code, expectedStatus) => {
    svc.submitSecretBundleViaGitOps = async () => {
      const err: any = new Error(`${code} for test`)
      err.code = code
      if (code === 'PR_CREATION_FAILED') {
        err.branchName = 'secrets/myapp-release-abcd1234'
        err.commitSha = 'deadbeef'
      }
      throw err
    }

    const req: any = bundleReq()
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(expectedStatus)
    expect(res.body.success).toBe(false)
    expect(metrics).toContainEqual({
      event: 'secret_create_submitted',
      fields: expect.objectContaining({
        level: 'error', correlationId: req.correlationId, bundleId: 'release',
        environments: ['prod', 'cint'], outcome: 'error', reason: code, status_code: expectedStatus
      })
    })
    expect(JSON.stringify(metrics)).not.toContain('super-secret-value')
    expect(JSON.stringify(metrics)).not.toContain(`${code} for test`)
    if (code === 'PR_CREATION_FAILED') {
      expect(res.body.branchName).toBe('secrets/myapp-release-abcd1234')
      expect(res.body.commitSha).toBe('deadbeef')
    }
  })

  it('a successful bundle submission responds 201 with includedEnvironments/excludedEnvironments/secretCount/prNumber/prUrl/bundleId', async () => {
    svc.submitSecretBundleViaGitOps = async () => ({
      includedEnvironments: ['prod', 'cint'],
      excludedEnvironments: [{ environment: 'demo', reason: 'VAULT_AMBIGUOUS', vaults: [] }],
      secretCount: 1,
      prNumber: 42,
      prUrl: 'https://github.com/example/pull/42'
    })

    const req: any = bundleReq()
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(201)
    expect(res.body).toMatchObject({
      success: true,
      bundleId: 'release',
      prNumber: 42,
      prUrl: 'https://github.com/example/pull/42',
      includedEnvironments: ['prod', 'cint'],
      secretCount: 1
    })
    expect(res.body.excludedEnvironments).toEqual([{ environment: 'demo', reason: 'VAULT_AMBIGUOUS', vaults: [] }])
    expect(metrics).toContainEqual({
      event: 'secret_create_submitted',
      fields: expect.objectContaining({
        correlationId: req.correlationId, outcome: 'success', status_code: 201, environments: ['prod', 'cint']
      })
    })
  })

  it('rejects a bundle submission naming the same environment twice in environmentSecrets[] with 400', async () => {
    svc.submitSecretBundleViaGitOps = async () => ({ includedEnvironments: [], excludedEnvironments: [], secretCount: 0 })
    const req: any = bundleReq({
      environmentSecrets: [
        { environment: 'prod', secrets: [{ secretName: 'A', secretValue: 'v1' }] },
        { environment: 'PROD', secrets: [{ secretName: 'A', secretValue: 'v2' }] }
      ]
    })
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects a bundle submission exceeding the 20-distinct-secret-name union cap across all environments', async () => {
    svc.submitSecretBundleViaGitOps = async () => ({ includedEnvironments: [], excludedEnvironments: [], secretCount: 0 })
    const manySecrets = Array.from({ length: 21 }, (_, i) => ({ secretName: `SECRET-${i}`, secretValue: 'v' }))
    const req: any = bundleReq({
      environmentSecrets: [{ environment: 'prod', secrets: manySecrets }]
    })
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/secrets/apps — bundleId per entry + bundles catalog (spec.md §3.2)', () => {
  const stack = getStack('/secrets/apps', 'get')
  const svc: any = secretsService
  let originalDiscover: any
  let originalReadBundleConfigFile: any

  beforeEach(() => {
    originalDiscover = svc.discoverAppsForTarget
    originalReadBundleConfigFile = svc._internal?.readBundleConfigFile
    svc._internal?.resetLastKnownGoodBundleConfig()
  })

  afterEach(() => {
    svc.discoverAppsForTarget = originalDiscover
    if (svc._internal && originalReadBundleConfigFile) svc._internal.readBundleConfigFile = originalReadBundleConfigFile
    svc._internal?.resetLastKnownGoodBundleConfig()
  })

  it('response includes a top-level bundles catalog sorted by order, and bundleId per app/environment entry', async () => {
    svc.discoverAppsForTarget = async () => ([
      { name: 'myapp', environment: 'dev', qualifier: null, tier: 'non-production', bundleId: 'developer' },
      { name: 'myapp', environment: 'prod', qualifier: null, tier: 'production', bundleId: 'release' }
    ])

    const req: any = { query: { target: 'live' }, user: { email: 'dev@example.com' }, correlationId: 'cid-apps-bundle' }
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.bundles)).toBe(true)
    expect(res.body.bundles.length).toBeGreaterThan(0)
    const orders = res.body.bundles.map((b: any) => b.order)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(res.body.data.find((a: any) => a.environment === 'dev').bundleId).toBe('developer')
    expect(res.body.data.find((a: any) => a.environment === 'prod').bundleId).toBe('release')
  })

  it('bundles catalog is an empty array when bundle config is unavailable, and every entry has bundleId: null', async () => {
    // "Config unavailable" must be simulated at its real source (_internal.readBundleConfigFile,
    // with no stale fallback available) so the route's own loadSecretBundles()/getBundleCatalog()
    // calls genuinely fail-open, rather than faking bundleId:null purely on the discoverAppsForTarget
    // mock — the real handler independently calls getBundleCatalog(bundleConfig) against the actual
    // on-disk data/secretBundles.json, which would otherwise still return the 3 real bundles here.
    if (svc._internal) {
      svc._internal.readBundleConfigFile = () => { throw new Error('simulated read failure') }
    }
    svc.discoverAppsForTarget = async () => ([
      { name: 'myapp', environment: 'dev', qualifier: null, tier: 'non-production', bundleId: null }
    ])

    const req: any = { query: { target: 'live' }, user: { email: 'dev@example.com' }, correlationId: 'cid-apps-nobundle' }
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.bundles).toEqual([])
    expect(res.body.data[0].bundleId).toBeNull()
  })
})
