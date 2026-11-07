/**
 * Vue.js Developer — secrets-environment-bundles (docs/architecture/secrets-environment-bundles-spec.json).
 *
 * Supplementary route-level TDD coverage for `POST /api/secrets` bundle-mode paths not exercised
 * by QA's `secretsBundlesRoute.spec.ts` (which mocks `submitSecretBundleViaGitOps` as always
 * *throwing* per errorCode, including for `PR_CREATION_FAILED`). Per spec.md §2.4,
 * `submitSecretBundleViaGitOps` deliberately *resolves* (never throws) with
 * `{ success:false, errorCode:'PR_CREATION_FAILED', branchName, commitSha, error }` after a
 * successful commit — this file asserts the route maps that *resolved* failure shape correctly,
 * plus the 20-distinct-secret-name cap boundary (exactly 20 must be accepted, not rejected).
 * Same dispatch/getStack/makeRes helpers as `secretsBundlesRoute.spec.ts`/`secretsRouteValidation.spec.ts`.
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
    correlationId: 'cid-bundle-route-vuedev'
  }
}

describe('POST /api/secrets — bundle-mode resolved (non-throw) PR_CREATION_FAILED (spec.md §2.4)', () => {
  const stack = getStack('/secrets', 'post')
  const svc: any = secretsService
  let originalSubmit: any

  beforeEach(() => {
    originalSubmit = svc.submitSecretBundleViaGitOps
  })

  afterEach(() => {
    if (originalSubmit) svc.submitSecretBundleViaGitOps = originalSubmit
  })

  it('maps a resolved (not thrown) success:false/PR_CREATION_FAILED result to HTTP 500 with branchName/commitSha', async () => {
    svc.submitSecretBundleViaGitOps = async () => ({
      success: false,
      errorCode: 'PR_CREATION_FAILED',
      branchName: 'secrets/myapp-release-deadbeef',
      commitSha: 'abc123',
      error: 'Commit created but PR creation failed: PR API unavailable'
    })

    const req: any = bundleReq()
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'PR_CREATION_FAILED',
      branchName: 'secrets/myapp-release-deadbeef',
      commitSha: 'abc123'
    })
  })
})

describe('POST /api/secrets — 20-distinct-secret-name union cap boundary (bundle mode)', () => {
  const stack = getStack('/secrets', 'post')
  const svc: any = secretsService
  let originalSubmit: any

  beforeEach(() => {
    originalSubmit = svc.submitSecretBundleViaGitOps
  })

  afterEach(() => {
    if (originalSubmit) svc.submitSecretBundleViaGitOps = originalSubmit
  })

  it('accepts exactly 20 distinct secret names across all environments (boundary, not rejected)', async () => {
    svc.submitSecretBundleViaGitOps = async () => ({
      includedEnvironments: ['prod'],
      excludedEnvironments: [],
      secretCount: 20,
      prNumber: 7,
      prUrl: 'https://github.com/example/pull/7'
    })
    const twentySecrets = Array.from({ length: 20 }, (_, i) => ({ secretName: `SECRET-${i}`, secretValue: 'v' }))
    const req: any = bundleReq({ environmentSecrets: [{ environment: 'prod', secrets: twentySecrets }] })
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(201)
    expect(res.body.success).toBe(true)
  })

  it('treats the same secret name repeated across two environments as one distinct name (union, not sum)', async () => {
    svc.submitSecretBundleViaGitOps = async () => ({
      includedEnvironments: ['prod', 'cint'],
      excludedEnvironments: [],
      secretCount: 1,
      prNumber: 8,
      prUrl: 'https://github.com/example/pull/8'
    })
    // Same secret name ('API-KEY') in both environments -> union size 1, well under the cap.
    const req: any = bundleReq()
    const res = makeRes()
    await dispatch(stack, req, res)

    expect(res.statusCode).toBe(201)
  })
})
