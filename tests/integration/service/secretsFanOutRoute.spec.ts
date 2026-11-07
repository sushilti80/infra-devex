/**
 * QA gap-fill — secrets-environment-scope (PRD: docs/prd/secrets-environment-scope.md).
 * No architecture spec exists for this feature; the PRD's FR-004/FR-005/FR-006/NFR-SEC-002 are
 * the acceptance criteria under test here.
 *
 * Exercises POST /api/secrets through the REAL express-validator chain (same dispatch pattern as
 * secretsRouteValidation.spec.ts) for the parts of the fan-out contract that existing coverage
 * does not reach at the HTTP layer:
 *   - secretsService.spec.ts covers submitSecretsFanOut() directly (service layer, concurrency).
 *   - secretsRouteValidation.spec.ts covers secretName/jiraTicket/target validators.
 *   - SecretsPage.spec.ts covers the UI's production-write confirmation gating.
 * This file closes the remaining gap: the route's HTTP status/response-shape decisions for
 * environments[] (FR-004(a)/FR-006(c) mutual exclusivity, FR-004(b) duplicates, FR-005(b) status
 * selection across all/partial/all-fail-mixed outcomes, FR-005(c) exhaustive error-code mapping,
 * FR-006(b) legacy top-level field preservation, and NFR-SEC-002's audit log field).
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

// Runs every middleware after requireAuth (index 0), including the real check()/oneOf()/custom
// chains, then invokes the final async handler directly. No listen(), no network.
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
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: unknown) => {
    res.body = body
    return res
  }
  return res
}

function baseReq(overrides: Record<string, unknown> = {}) {
  return {
    body: {
      target: 'sand',
      appName: 'mlops',
      jiraTicket: 'DSO-123',
      secretName: 'API-TOKEN',
      secretValue: 'v',
      ...overrides
    },
    user: { email: 'dev@example.com' },
    correlationId: 'cid-fanout-test'
  }
}

// Per-environment outcome table consumed by a mock submitSecretViaGitOps: env name -> either a
// success payload or an { code, message } to throw, mirroring the real function's contract.
function mockSubmitByEnvironment(svc: any, outcomes: Record<string, { prNumber: number } | { code: string; message?: string }>) {
  svc.submitSecretViaGitOps = async ({ environment, secrets }: any) => {
    const outcome = outcomes[environment]
    if (!outcome) throw new Error(`no mock outcome configured for environment ${environment}`)
    if ('code' in outcome) {
      const err: any = new Error(outcome.message || `${outcome.code} for ${environment}`)
      err.code = outcome.code
      throw err
    }
    return { prNumber: outcome.prNumber, prUrl: `https://github.com/example/pr/${outcome.prNumber}`, secretCount: secrets.length }
  }
}

describe('POST /api/secrets — environment/environments mutual exclusivity (FR-004(a)/FR-006(c))', () => {
  const stack = getStack('/secrets', 'post')
  const svc: any = secretsService

  it('rejects a request supplying both environment and environments with HTTP 400', async () => {
    const req: any = baseReq({ environment: 'dev', environments: ['qa', 'staging'] })
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.success).toBe(false)
    // secrets-environment-bundles §3.3 (Round 3, approved) replaces the 2-way XOR message with a
    // unified 3-way exactly-one-of message (environment | environments | bundleId+environmentSecrets).
    expect(res.body.error).toMatch(/Provide exactly one of: environment, environments, or bundleId with environmentSecrets/)
  })

  it('rejects a request supplying neither environment nor environments with HTTP 400', async () => {
    const req: any = baseReq({})
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('rejects an environments array with more than 10 entries with HTTP 400', async () => {
    const envs = Array.from({ length: 11 }, (_, i) => `env${i}`)
    const req: any = baseReq({ environments: envs })
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects an empty environments array with HTTP 400', async () => {
    const req: any = baseReq({ environments: [] })
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects duplicate environment entries, case-insensitive, with HTTP 400 (FR-004(b))', async () => {
    const req: any = baseReq({ environments: ['dev', 'DEV', 'qa'] })
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/Duplicate environment/)
  })
})

describe('POST /api/secrets — fan-out partial-failure HTTP contract (FR-005(a)/(b))', () => {
  const stack = getStack('/secrets', 'post')
  const svc: any = secretsService
  let originalSubmit: any

  beforeEach(() => {
    originalSubmit = svc.submitSecretViaGitOps
  })

  afterEach(() => {
    svc.submitSecretViaGitOps = originalSubmit
  })

  it('all environments succeed -> HTTP 201, success:true, results[] with one entry per environment, no top-level prNumber (3 results)', async () => {
    mockSubmitByEnvironment(svc, {
      dev: { prNumber: 101 },
      qa: { prNumber: 102 },
      staging: { prNumber: 103 }
    })
    const req: any = baseReq({ environments: ['dev', 'qa', 'staging'] })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.results).toHaveLength(3)
    expect(res.body.results.map((r: any) => r.environment)).toEqual(['dev', 'qa', 'staging'])
    expect(res.body.results.every((r: any) => r.success)).toBe(true)
    // FR-006(b): legacy top-level prNumber/prUrl only apply when the batch resolves to exactly
    // one result — must not appear for a genuine multi-environment success.
    expect(res.body.prNumber).toBeUndefined()
    expect(res.body.prUrl).toBeUndefined()
  })

  it('some succeed, some fail -> HTTP 207, top-level success:false, results[] identifies each outcome (FR-005(a)/(b))', async () => {
    mockSubmitByEnvironment(svc, {
      dev: { prNumber: 101 },
      qa: { prNumber: 102 },
      staging: { code: 'CONFLICT' }
    })
    const req: any = baseReq({ environments: ['dev', 'qa', 'staging'] })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(207)
    expect(res.body.success).toBe(false)
    expect(res.body.results).toHaveLength(3)
    const byEnv = Object.fromEntries(res.body.results.map((r: any) => [r.environment, r]))
    expect(byEnv.dev).toMatchObject({ success: true, prNumber: 101 })
    expect(byEnv.qa).toMatchObject({ success: true, prNumber: 102 })
    expect(byEnv.staging).toMatchObject({ success: false, errorCode: 'CONFLICT' })
    // A 207 must never be mistaken for a full failure by a caller reading only the top level.
    expect(res.body.error).toBeUndefined()
  })

  it('all environments fail with the SAME errorCode -> top-level status matches the existing single-environment mapping for that code', async () => {
    mockSubmitByEnvironment(svc, {
      dev: { code: 'CONFLICT' },
      qa: { code: 'CONFLICT' }
    })
    const req: any = baseReq({ environments: ['dev', 'qa'] })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(503)
    expect(res.body.success).toBe(false)
    expect(res.body.results.every((r: any) => r.errorCode === 'CONFLICT')).toBe(true)
    expect(res.body.error).toBeTruthy()
  })

  it('all environments fail with MIXED errorCodes -> top-level status falls back to 500, results[] retains each specific code', async () => {
    mockSubmitByEnvironment(svc, {
      dev: { code: 'FOUND_FALSE' },
      qa: { code: 'CONFLICT' }
    })
    const req: any = baseReq({ environments: ['dev', 'qa'] })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(500)
    expect(res.body.success).toBe(false)
    const byEnv = Object.fromEntries(res.body.results.map((r: any) => [r.environment, r]))
    expect(byEnv.dev.errorCode).toBe('FOUND_FALSE')
    expect(byEnv.qa.errorCode).toBe('CONFLICT')
  })

  // FR-005(c): the full, exhaustive set of 9 single-environment error codes must map through the
  // fan-out path (single-environment array) identically to the pre-existing statusByCode mapping.
  it.each([
    ['FOUND_FALSE', 422],
    ['VAULT_AMBIGUOUS', 422],
    ['VAULT_INVALID', 422],
    ['PR_EXISTS', 409],
    ['CONFLICT', 503],
    ['ENCRYPTION_FAILED', 400],
    ['SOPS_NOT_CONFIGURED', 503],
    ['QUALIFIER_AMBIGUOUS', 422],
    ['QUALIFIER_MISMATCH', 422]
  ])('single-environment fan-out failure with errorCode %s maps to HTTP %i (FR-005(c))', async (code, expectedStatus) => {
    mockSubmitByEnvironment(svc, { dev: { code } })
    const req: any = baseReq({ environments: ['dev'] })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(expectedStatus)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0].errorCode).toBe(code)
  })
})

describe('POST /api/secrets — backward compatibility (FR-006)', () => {
  const stack = getStack('/secrets', 'post')
  const svc: any = secretsService
  let originalSubmit: any

  beforeEach(() => {
    originalSubmit = svc.submitSecretViaGitOps
  })

  afterEach(() => {
    svc.submitSecretViaGitOps = originalSubmit
  })

  it('legacy singular `environment` field succeeds with 201 and keeps top-level prNumber/prUrl/secretCount alongside results[] (FR-006(a)/(b))', async () => {
    mockSubmitByEnvironment(svc, { dev: { prNumber: 55 } })
    const req: any = baseReq({ environment: 'dev' })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.prNumber).toBe(55)
    expect(res.body.prUrl).toBe('https://github.com/example/pr/55')
    expect(res.body.secretCount).toBe(1)
    expect(res.body.results).toEqual([{ environment: 'dev', success: true, prNumber: 55, prUrl: 'https://github.com/example/pr/55', secretCount: 1 }])
  })

  it('a single-element `environments` array gets the same legacy top-level fields as the singular shape (FR-006(b))', async () => {
    mockSubmitByEnvironment(svc, { dev: { prNumber: 56 } })
    const req: any = baseReq({ environments: ['dev'] })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(201)
    expect(res.body.prNumber).toBe(56)
    expect(res.body.prUrl).toBeTruthy()
  })

  it('a failed legacy singular `environment` request still surfaces the existing top-level error shape (no results[] regression)', async () => {
    mockSubmitByEnvironment(svc, { dev: { code: 'FOUND_FALSE' } })
    const req: any = baseReq({ environment: 'dev' })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(422)
    expect(res.body.success).toBe(false)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.prNumber).toBeUndefined()
  })
})

describe('POST /api/secrets — submission telemetry and production-tier audit trail (NFR-SEC-002)', () => {
  const stack = getStack('/secrets', 'post')
  const svc: any = secretsService
  let originalSubmit: any
  let originalLogMetric: any
  let capturedMetrics: Array<{ event: string; fields: any }>

  beforeEach(() => {
    originalSubmit = svc.submitSecretViaGitOps
    originalLogMetric = logger.logMetric
    capturedMetrics = []
    logger.logMetric = (event: string, fields: any) => capturedMetrics.push({ event, fields })
  })

  afterEach(() => {
    svc.submitSecretViaGitOps = originalSubmit
    logger.logMetric = originalLogMetric
  })

  it.each([
    ['single', { dev: { code: 'ENCRYPTION_FAILED' } }, { environment: 'dev' }, 400, 'error'],
    ['fan-out', { dev: { code: 'ENCRYPTION_FAILED' }, qa: { code: 'SOPS_NOT_CONFIGURED' } }, { environments: ['dev', 'qa'] }, 500, 'error'],
    ['partial', { dev: { prNumber: 1 }, qa: { code: 'ENCRYPTION_FAILED' } }, { environments: ['dev', 'qa'] }, 207, 'warn']
  ])('logs structured %s failures without secret values or raw error text', async (_mode, outcomes, request, status, level) => {
    mockSubmitByEnvironment(svc, outcomes)
    const req = baseReq(request)
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(status)
    const metric = capturedMetrics.find(m => m.event === 'secret_create_submitted')
    expect(metric?.fields).toMatchObject({
      level, status_code: status, correlationId: req.correlationId,
      outcome: status === 207 ? 'partial' : 'error',
      failures: Object.entries(outcomes)
        .filter(([, outcome]) => 'code' in outcome)
        .map(([environment, outcome]) => ({ environment, error_code: 'code' in outcome ? outcome.code : '' }))
    })
    expect(JSON.stringify(capturedMetrics)).not.toContain('"secretValue"')
    expect(JSON.stringify(capturedMetrics)).not.toContain('ENCRYPTION_FAILED for')
  })

  it('re-derives production-tier membership server-side and logs confirmedProductionWrite, ignoring a false client claim for a non-production-only batch', async () => {
    mockSubmitByEnvironment(svc, { dev: { prNumber: 1 }, qa: { prNumber: 2 } })
    const req: any = baseReq({ environments: ['dev', 'qa'], confirmedProductionWrite: true })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(201)
    const submitMetric = capturedMetrics.find(m => m.event === 'secret_create_submitted' && m.fields.outcome === 'success')
    // No production-tier environment in this batch -> the audit fields are simply absent, per
    // routes/api.js only attaching them when productionEnvironments.length > 0.
    expect(submitMetric?.fields.confirmedProductionWrite).toBeUndefined()
    expect(submitMetric?.fields.productionEnvironments).toBeUndefined()
  })

  it('logs confirmedProductionWrite:true and the production environment list when a prod-tier environment is submitted with confirmation', async () => {
    mockSubmitByEnvironment(svc, { prod: { prNumber: 9 }, dev: { prNumber: 10 } })
    const req: any = baseReq({ environments: ['prod', 'dev'], confirmedProductionWrite: true })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(201)
    const submitMetric = capturedMetrics.find(m => m.event === 'secret_create_submitted' && m.fields.outcome === 'success')
    expect(submitMetric?.fields.confirmedProductionWrite).toBe(true)
    expect(submitMetric?.fields.productionEnvironments).toEqual(['prod'])
  })

  it('logs confirmedProductionWrite:false when a prod-tier environment is submitted without the client claiming confirmation', async () => {
    mockSubmitByEnvironment(svc, { prod: { prNumber: 11 } })
    const req: any = baseReq({ environments: ['prod'] })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(201)
    const submitMetric = capturedMetrics.find(m => m.event === 'secret_create_submitted' && m.fields.outcome === 'success')
    expect(submitMetric?.fields.confirmedProductionWrite).toBe(false)
    expect(submitMetric?.fields.productionEnvironments).toEqual(['prod'])
  })
})
