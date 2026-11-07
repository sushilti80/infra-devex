/**
 * QA gap-fill — exercises the REAL express-validator chain (oneOf, per-shape secretName regex,
 * jiraTicket regex, duplicate-name check, value redaction) for POST /api/secrets and the
 * target validator for GET /api/secrets/apps. `secretsRoute.spec.ts` only invokes the final
 * handler and bypasses all validators; this file closes that gap without hitting GitHub/network.
 *
 * Verifies (against actual code, not spec prose) the Architecture Challenger Round 2 concern:
 * bulk-array-shape and legacy-singular-shape secretName must be validated identically.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const router = cjsRequire('../../../routes/api')
const secretsService = cjsRequire('../../../services/secretsService')

function getStack(path: string, method: string) {
  const layer = router.stack.find(
    (l: any) => l.route && l.route.path === path && l.route.methods[method]
  )
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`)
  return layer.route.stack
}

// Runs every middleware after requireAuth (index 0), including the real check()/oneOf() chains,
// then invokes the final async handler directly. No listen(), no network.
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
  const res: any = { statusCode: 200 } // Express defaults to 200 when only .json() is called
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

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    target: 'sand',
    appName: 'mlops',
    environment: 'dev',
    jiraTicket: 'DSO-123',
    ...overrides
  }
}

describe('POST /api/secrets — full validator chain (request-shape parity + redaction)', () => {
  const stack = getStack('/secrets', 'post')
  const svc: any = secretsService
  let originalSubmit: any

  beforeEach(() => {
    originalSubmit = svc.submitSecretViaGitOps
    svc.submitSecretViaGitOps = async ({ secrets }: any) => ({
      prNumber: 1,
      prUrl: 'https://github.com/example/pr/1',
      secretCount: secrets.length
    })
  })

  afterEach(() => {
    svc.submitSecretViaGitOps = originalSubmit
  })

  it('accepts a bulk secrets[] entry whose name would be rejected by the old bulk-only regex (digit-start, >63 chars)', async () => {
    const longDigitStartName = `1${'a'.repeat(99)}` // 100 chars, starts with a digit
    const req: any = {
      body: baseBody({ secrets: [{ secretName: longDigitStartName, secretValue: 'v' }] }),
      user: { email: 'dev@example.com' },
      correlationId: 'cid-parity-bulk'
    }
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(201)
    expect(res.body.success).toBe(true)
  })

  it('accepts the identical name via the legacy singular shape (proves both shapes share one regex)', async () => {
    const longDigitStartName = `1${'a'.repeat(99)}`
    const req: any = {
      body: baseBody({ secretName: longDigitStartName, secretValue: 'v' }),
      user: { email: 'dev@example.com' },
      correlationId: 'cid-parity-singular'
    }
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(201)
    expect(res.body.success).toBe(true)
  })

  it('rejects an invalid secretName identically in both shapes (space is not allowed)', async () => {
    const bulkReq: any = {
      body: baseBody({ secrets: [{ secretName: 'has space', secretValue: 'v' }] }),
      user: { email: 'dev@example.com' },
      correlationId: 'cid-invalid-bulk'
    }
    const bulkRes = makeRes()
    await dispatch(stack, bulkReq, bulkRes)

    const singularReq: any = {
      body: baseBody({ secretName: 'has space', secretValue: 'v' }),
      user: { email: 'dev@example.com' },
      correlationId: 'cid-invalid-singular'
    }
    const singularRes = makeRes()
    await dispatch(stack, singularReq, singularRes)

    expect(bulkRes.statusCode).toBe(400)
    expect(singularRes.statusCode).toBe(400)
  })

  it('redacts a failing secretValue from the JSON error response body', async () => {
    const leakedMarker = 'super-secret-leak-marker-xyz'
    const req: any = {
      body: baseBody({ secrets: [{ secretName: 'api-key', secretValue: { leaked: leakedMarker } }] }),
      user: { email: 'dev@example.com' },
      correlationId: 'cid-redact'
    }
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(400)
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain(leakedMarker)
    expect(serialized).toContain('[REDACTED]')
  })

  it('redacts a failing legacy secretValue from the JSON error response body', async () => {
    const leakedMarker = 'legacy-secret-leak-marker-xyz'
    const req: any = {
      body: baseBody({ secretName: 'api-key', secretValue: { leaked: leakedMarker } }),
      user: { email: 'dev@example.com' },
      correlationId: 'cid-redact-legacy'
    }
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(400)
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain(leakedMarker)
    expect(serialized).toContain('[REDACTED]')
  })

  it('rejects a batch with a duplicate secretName without calling submitSecretViaGitOps', async () => {
    let called = false
    svc.submitSecretViaGitOps = async () => {
      called = true
      return { prNumber: 1, prUrl: 'x', secretCount: 1 }
    }
    const req: any = {
      body: baseBody({
        secrets: [
          { secretName: 'dup-name', secretValue: 'v1' },
          { secretName: 'dup-name', secretValue: 'v2' }
        ]
      }),
      user: { email: 'dev@example.com' },
      correlationId: 'cid-dup'
    }
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/Duplicate secret name/)
    expect(called).toBe(false)
  })

  it('rejects case-different duplicate secret names (Api-Token vs api-token) without calling submitSecretViaGitOps', async () => {
    let called = false
    svc.submitSecretViaGitOps = async () => {
      called = true
      return { prNumber: 1, prUrl: 'x', secretCount: 1 }
    }
    const req: any = {
      body: baseBody({
        secrets: [
          { secretName: 'Api-Token', secretValue: 'v1' },
          { secretName: 'api-token', secretValue: 'v2' }
        ]
      }),
      user: { email: 'dev@example.com' },
      correlationId: 'cid-dup-ci'
    }
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/Duplicate secret name/i)
    expect(called).toBe(false)
  })

  it('rejects a missing Jira ticket with HTTP 400', async () => {
    const req: any = {
      body: { target: 'sand', appName: 'mlops', environment: 'dev', secretName: 'x', secretValue: 'v' },
      user: { email: 'dev@example.com' },
      correlationId: 'cid-jira-missing'
    }
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects a malformed Jira ticket (no dash+digits) with HTTP 400', async () => {
    const req: any = {
      body: baseBody({ jiraTicket: 'not-a-ticket', secretName: 'x', secretValue: 'v' }),
      user: { email: 'dev@example.com' },
      correlationId: 'cid-jira-malformed'
    }
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(400)
  })

  it('accepts a valid Jira ticket format (LETTERS-digits)', async () => {
    const req: any = {
      body: baseBody({ jiraTicket: 'INFRA-42', secretName: 'x', secretValue: 'v' }),
      user: { email: 'dev@example.com' },
      correlationId: 'cid-jira-valid'
    }
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(201)
  })
})

describe('GET /api/secrets/apps — target filtering validator', () => {
  const stack = getStack('/secrets/apps', 'get')
  const svc: any = secretsService
  let originalDiscover: any

  beforeEach(() => {
    originalDiscover = svc.discoverAppsForTarget
  })

  afterEach(() => {
    svc.discoverAppsForTarget = originalDiscover
  })

  it('target=live delegates to discoverAppsForTarget with "live" and returns 200', async () => {
    let receivedTarget: string | undefined
    svc.discoverAppsForTarget = async (target: string) => {
      receivedTarget = target
      return [{ name: 'idm', environment: 'dev' }]
    }
    const req: any = { query: { target: 'live' }, user: { email: 'dev@example.com' }, correlationId: 'cid-live' }
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(200)
    expect(receivedTarget).toBe('live')
    expect(res.body.data).toEqual([{ name: 'idm', environment: 'dev' }])
  })

  it('target=sand delegates to discoverAppsForTarget with "sand" and returns 200', async () => {
    let receivedTarget: string | undefined
    svc.discoverAppsForTarget = async (target: string) => {
      receivedTarget = target
      return [{ name: 'mlops', environment: 'sand' }]
    }
    const req: any = { query: { target: 'sand' }, user: { email: 'dev@example.com' }, correlationId: 'cid-sand' }
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(200)
    expect(receivedTarget).toBe('sand')
  })

  it('rejects an invalid target value with HTTP 400', async () => {
    const req: any = { query: { target: 'production' }, user: { email: 'dev@example.com' }, correlationId: 'cid-bad-target' }
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/secrets/:appName/:environment — vaultDir disambiguates qualifier ambiguity', () => {
  const stack = getStack('/secrets/:appName/:environment', 'get')
  const svc: any = secretsService
  let originalGetSecretsList: any

  beforeEach(() => {
    originalGetSecretsList = svc.getSecretsList
  })

  afterEach(() => {
    svc.getSecretsList = originalGetSecretsList
  })

  it('returns 422 QUALIFIER_AMBIGUOUS when neither qualifier nor vaultDir is supplied', async () => {
    svc.getSecretsList = async () => ({
      found: true, vaultMismatch: false, anyFileFound: true, secrets: [],
      vaults: [{ vaultDir: 'infrastructure/idm/dev/keyvault' }, { vaultDir: 'infrastructure/idm/_idmapplications/autobk/dev/keyvault', qualifier: 'autobk' }],
      qualifiers: ['autobk', 'notif']
    })
    const req: any = { params: { appName: 'idm', environment: 'dev' }, query: { target: 'live' }, user: { email: 'dev@example.com' }, correlationId: 'cid-ambiguous' }
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(422)
    expect(res.body.error).toMatch(/qualifier is required/)
  })

  it('bypasses the ambiguity gate and returns 200 when an explicit vaultDir is supplied, even with multiple qualifiers present', async () => {
    const rootVaultDir = 'infrastructure/idm/dev/keyvault'
    svc.getSecretsList = async () => ({
      found: true, vaultMismatch: false, anyFileFound: true,
      secrets: [{ name: 'API_KEY', vaultDir: rootVaultDir, vaultName: 'idm-dev-root-kv' }],
      vaults: [{ vaultDir: rootVaultDir }, { vaultDir: 'infrastructure/idm/_idmapplications/autobk/dev/keyvault', qualifier: 'autobk' }],
      qualifiers: ['autobk', 'notif']
    })
    const req: any = { params: { appName: 'idm', environment: 'dev' }, query: { target: 'live', vaultDir: rootVaultDir }, user: { email: 'dev@example.com' }, correlationId: 'cid-vaultdir-bypass' }
    const res = makeRes()
    await dispatch(stack, req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
