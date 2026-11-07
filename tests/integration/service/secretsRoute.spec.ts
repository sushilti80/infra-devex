/**
 * Focused route-handler test — POST /api/secrets error-status mapping (FR-002(j)).
 * Spec: docs/architecture/secret-self-service-spec.json — TS-010
 * "POST /api/secrets with resolveKeyVaults found=false returns 422"
 *
 * Invokes the Express route handler directly (no listen(), no network) to stay inside
 * this sandbox's socket restrictions — extracts the final route.stack handler and calls
 * it with a minimal req/res, bypassing requireAuth/validators (already covered elsewhere).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const router = cjsRequire('../../../routes/api')
const secretsService = cjsRequire('../../../services/secretsService')

function getRouteHandler(path: string, method: string) {
  const layer = router.stack.find(
    (l: any) => l.route && l.route.path === path && l.route.methods[method]
  )
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function makeRes() {
  const res: any = {}
  res.status = (code: number) => { res.statusCode = code; return res }
  res.json = (body: unknown) => { res.body = body; return res }
  return res
}

describe('POST /api/secrets — error status mapping', () => {
  const handler = getRouteHandler('/secrets', 'post')
  const svc: any = secretsService
  let originalSubmit: any

  beforeEach(() => {
    originalSubmit = svc.submitSecretViaGitOps
  })

  it('TS-010: FOUND_FALSE maps to HTTP 422, not 404', async () => {
    svc.submitSecretViaGitOps = async () => {
      const err: any = new Error('Cannot resolve Key Vault for this app/environment')
      err.code = 'FOUND_FALSE'
      throw err
    }

    const req: any = { body: { target: 'sand', appName: 'mlops', environment: 'dev', secretName: 'X', secretValue: 'v' }, user: { email: 'dev@example.com' }, correlationId: 'cid-test' }
    const res = makeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(422)
    expect(res.body.success).toBe(false)

    svc.submitSecretViaGitOps = originalSubmit
  })
})
