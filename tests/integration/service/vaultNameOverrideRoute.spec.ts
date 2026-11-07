/**
 * Route-handler test — POST /api/secrets/vault-name-override (vault-resolution-override).
 * Spec: docs/architecture/vault-resolution-override-spec.json — technical.api_endpoints,
 * testing.integration_tests.
 *
 * Runs the real express-validator chain (mirrors secretsRouteValidation.spec.ts's `dispatch`
 * helper) then the handler, monkey-patching secretsService methods directly. No listen(), no
 * network.
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

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    vaultDir: 'infrastructure/idm/_idmapplications/notif/dev/keyvault',
    name: 'idm-notif-dev-kv',
    appName: 'idm',
    environment: 'dev',
    target: 'live',
    ...overrides
  }
}

describe('POST /api/secrets/vault-name-override', () => {
  const stack = getStack('/secrets/vault-name-override', 'post')
  const svc: any = secretsService
  let originalResolveKeyVaults: any
  let originalSetVaultNameOverride: any

  beforeEach(() => {
    originalResolveKeyVaults = svc.resolveKeyVaults
    originalSetVaultNameOverride = svc.setVaultNameOverride
    svc.resolveKeyVaults = async (appName: string, environment: string, target: string, correlationId: string, qualifier?: string) => ({
      found: true,
      vaults: [{ vaultDir: 'infrastructure/idm/_idmapplications/notif/dev/keyvault', vaultName: null, resourceGroup: null, qualifier: 'notif' }],
      qualifiers: ['notif']
    })
    svc.setVaultNameOverride = async (args: any) => ({
      vaultDir: args.vaultDir,
      name: args.name,
      resourceGroup: args.resourceGroup || null,
      appName: args.appName,
      environment: args.environment,
      qualifier: args.qualifier || null,
      verifiedBy: args.verifiedBy,
      verifiedAt: '2026-08-12T00:00:00.000Z'
    })
  })

  afterEach(() => {
    svc.resolveKeyVaults = originalResolveKeyVaults
    svc.setVaultNameOverride = originalSetVaultNameOverride
  })

  it('happy path: discovered vaultDir persists and returns 200 with correlationId', async () => {
    const req: any = { body: baseBody({ qualifier: 'notif' }), user: { email: 'user@example.com' }, correlationId: 'cid-happy' }
    const res = makeRes()

    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.name).toBe('idm-notif-dev-kv')
    expect(res.body.correlationId).toBe('cid-happy')
  })

  it('rejects missing required fields with HTTP 400 and correlationId', async () => {
    const req: any = { body: { target: 'live' }, user: { email: 'user@example.com' }, correlationId: 'cid-400' }
    const res = makeRes()

    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.correlationId).toBe('cid-400')
  })

  it('rejects an invalid target enum value with HTTP 400', async () => {
    const req: any = { body: baseBody({ target: 'production' }), user: { email: 'user@example.com' }, correlationId: 'cid-bad-target' }
    const res = makeRes()

    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(400)
  })

  it('rejects a vaultDir not discovered by resolveKeyVaults with HTTP 422, without writing', async () => {
    let writeCalled = false
    svc.setVaultNameOverride = async () => { writeCalled = true; return {} }

    const req: any = { body: baseBody({ vaultDir: 'infrastructure/idm/not-a-real-vault/dev/keyvault' }), user: { email: 'user@example.com' }, correlationId: 'cid-422' }
    const res = makeRes()

    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(422)
    expect(res.body.success).toBe(false)
    expect(res.body.correlationId).toBe('cid-422')
    expect(writeCalled).toBe(false)
  })

  it('maps a CONFLICT error from setVaultNameOverride to HTTP 409 with correlationId', async () => {
    svc.setVaultNameOverride = async () => {
      const err: any = new Error('Override file was modified concurrently; retry the request')
      err.code = 'CONFLICT'
      throw err
    }

    const req: any = { body: baseBody(), user: { email: 'user@example.com' }, correlationId: 'cid-409' }
    const res = makeRes()

    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(409)
    expect(res.body.success).toBe(false)
    expect(res.body.correlationId).toBe('cid-409')
  })

  it('maps an unexpected error to HTTP 500 with correlationId', async () => {
    svc.setVaultNameOverride = async () => { throw new Error('boom') }

    const req: any = { body: baseBody(), user: { email: 'user@example.com' }, correlationId: 'cid-500' }
    const res = makeRes()

    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(500)
    expect(res.body.success).toBe(false)
    expect(res.body.correlationId).toBe('cid-500')
  })
})
