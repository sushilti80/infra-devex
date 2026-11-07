/**
 * Integration tests for POST /api/feedback endpoint
 *
 * Covers:
 *   FR-009  — endpoint returns correct responses for valid/invalid payloads
 *   FR-011  — GitHub issue body format per request type
 *   FR-014  — repo resolved from config.github.selfServiceRepo
 *   NFR-003 — unauthenticated POST → 401
 *   NFR-004 — HTML injection in payload is escaped in issue body
 *   NFR-007 — GitHub 429 → API returns 429 with retryAfter
 *
 * Strategy: mutate CJS module exports BEFORE the router is loaded so that
 * our test stubs are what api.js receives when it requires those modules.
 * This avoids the ESM→CJS mock-interop limitation of vitest's node environment.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import express, { Application, Request, Response, NextFunction } from 'express'
import { createServer, Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'

// Use a CommonJS require to mutate module exports BEFORE the router loads
const cjsRequire = createRequire(import.meta.url)

// ─── Prepare CJS module stubs ──────────────────────────────────────────────────

// 1. githubService — replace createIssue with a controllable spy
const githubServiceModule = cjsRequire('../../../services/githubService')
const mockCreateIssue = Object.assign(
  async (..._args: unknown[]) => mockCreateIssue._impl(..._args),
  {
    _impl: async () => ({
      issueUrl: 'https://github.com/TestOrg/self-service-infra/issues/42',
      issueNumber: 42,
    }),
    calls: [] as unknown[][],
    mockResolvedValue(val: unknown) {
      this.calls = []
      this._impl = async (...args: unknown[]) => { this.calls.push(args); return val }
    },
    mockRejectedValue(err: unknown) {
      this.calls = []
      this._impl = async (...args: unknown[]) => { this.calls.push(args); throw err }
    },
    mockReset() {
      this.calls = []
      this._impl = async (...args: unknown[]) => {
        this.calls.push(args)
        return {
          issueUrl: 'https://github.com/TestOrg/self-service-infra/issues/42',
          issueNumber: 42,
        }
      }
    },
  }
)

// Wire up calls tracking
const originalImpl = mockCreateIssue._impl
mockCreateIssue._impl = async (...args: unknown[]) => {
  mockCreateIssue.calls.push(args)
  return originalImpl(...args)
}

// Patch the singleton
githubServiceModule.createIssue = async (...args: unknown[]) => mockCreateIssue._impl(...args)

// 2. requireAuth — default: inject a test user; can be switched to return 401
let authShouldFail = false
const authModule = cjsRequire('../../../middleware/auth')
authModule.requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (authShouldFail) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      correlationId: (req as any).correlationId,
    })
  }
  ;(req as any).user = { email: 'tester@example.com', name: 'Tester' }
  next()
}

// 3. Load the router AFTER stubs are in place
const apiRouter = cjsRequire('../../../routes/api')

// ─── Test server ──────────────────────────────────────────────────────────────

let server: Server
let baseUrl: string

async function post(path: string, body: object) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ─── Valid payloads ───────────────────────────────────────────────────────────

const validBugPayload = {
  type: 'bug',
  title: 'Login button crashes',
  description: 'App crashes when clicking login',
  observedBehaviour: 'App crashes on click',
  expectedBehaviour: 'Should redirect to dashboard',
  severity: 'High',
}

const validFeaturePayload = {
  type: 'feature-request',
  title: 'Add dark mode',
  description: 'Users want a dark mode toggle',
  painPoint: 'Screen is too bright at night',
  desiredOutcome: 'Toggle dark theme in settings',
  priority: 'Medium',
}

const validAgentPayload = {
  type: 'agent-request',
  title: 'Auto-scale provisioning agent',
  description: 'We need an agent to auto-scale AKS clusters',
  agentType: 'AKS Manager',
  agentBehaviour: 'Monitor CPU and scale nodes automatically',
  businessJustification: 'Reduces cost by 30%',
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('POST /api/feedback — endpoint (FR-009, FR-011, FR-014, NFR-003, NFR-004, NFR-007)', () => {
  beforeAll(async () => {
    const app: Application = express()
    app.use(express.json())

    // Attach correlation ID (mirrors server.js)
    app.use((req: any, _res: Response, next: NextFunction) => {
      req.correlationId = 'test-cid-001'
      next()
    })

    app.use('/api', apiRouter)

    server = createServer(app)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve()))
    )
  })

  beforeEach(() => {
    authShouldFail = false
    mockCreateIssue.mockReset()
  })

  // ── FR-009: Valid responses ────────────────────────────────────────────────

  describe('Valid bug payload (FR-009)', () => {
    it('returns 201 with issueUrl, issueNumber, and correlationId', async () => {
      const res = await post('/api/feedback', validBugPayload)
      const data = await res.json()

      expect(res.status).toBe(201)
      expect(data.success).toBe(true)
      expect(data.issueUrl).toBe('https://github.com/TestOrg/self-service-infra/issues/42')
      expect(data.issueNumber).toBe(42)
      expect(data.correlationId).toBeTruthy()
    })

    it('calls createIssue with type label "bug"', async () => {
      await post('/api/feedback', validBugPayload)
      const lastCall = mockCreateIssue.calls[mockCreateIssue.calls.length - 1] as any[]
      expect(lastCall).toBeDefined()
      expect(lastCall[3]).toContain('bug')
    })
  })

  describe('Valid feature-request payload (FR-009)', () => {
    it('returns 201 for feature-request type', async () => {
      const res = await post('/api/feedback', validFeaturePayload)
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.success).toBe(true)
    })

    it('calls createIssue with type label "feature-request"', async () => {
      await post('/api/feedback', validFeaturePayload)
      const lastCall = mockCreateIssue.calls[mockCreateIssue.calls.length - 1] as any[]
      expect(lastCall).toBeDefined()
      expect(lastCall[3]).toContain('feature-request')
    })
  })

  describe('Valid agent-request payload (FR-009)', () => {
    it('returns 201 for agent-request type', async () => {
      const res = await post('/api/feedback', validAgentPayload)
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.success).toBe(true)
    })

    it('calls createIssue with type label "agent-request"', async () => {
      await post('/api/feedback', validAgentPayload)
      const lastCall = mockCreateIssue.calls[mockCreateIssue.calls.length - 1] as any[]
      expect(lastCall).toBeDefined()
      expect(lastCall[3]).toContain('agent-request')
    })
  })

  // ── FR-014: repo from config ───────────────────────────────────────────────

  it('calls createIssue with the configured selfServiceRepo (FR-014)', async () => {
    await post('/api/feedback', validBugPayload)
    const lastCall = mockCreateIssue.calls[mockCreateIssue.calls.length - 1] as any[]
    const [repo] = lastCall
    expect(typeof repo).toBe('string')
    expect(repo.length).toBeGreaterThan(0)
    expect(repo).toContain('/')
  })

  // ── FR-011: Issue body format ─────────────────────────────────────────────

  describe('Issue body format (FR-011)', () => {
    it('bug body includes ## Observed Behaviour and ## Expected Behaviour sections', async () => {
      await post('/api/feedback', validBugPayload)
      const lastCall = mockCreateIssue.calls[mockCreateIssue.calls.length - 1] as any[]
      const [, , body] = lastCall
      expect(body).toContain('## Observed Behaviour')
      expect(body).toContain('## Expected Behaviour')
      expect(body).toContain('## Severity')
      expect(body).toContain('## Submitted By')
      expect(body).toContain('## Correlation ID')
    })

    it('feature-request body includes ## Pain Point and ## Desired Outcome sections', async () => {
      await post('/api/feedback', validFeaturePayload)
      const lastCall = mockCreateIssue.calls[mockCreateIssue.calls.length - 1] as any[]
      const [, , body] = lastCall
      expect(body).toContain('## Pain Point')
      expect(body).toContain('## Desired Outcome')
      expect(body).toContain('## Priority')
      expect(body).toContain('## Submitted By')
      expect(body).toContain('## Correlation ID')
    })

    it('agent-request body includes ## What the Agent Should Do section', async () => {
      await post('/api/feedback', validAgentPayload)
      const lastCall = mockCreateIssue.calls[mockCreateIssue.calls.length - 1] as any[]
      const [, , body] = lastCall
      expect(body).toContain('## What the Agent Should Do')
      expect(body).toContain('## Business Justification')
      expect(body).toContain('## Submitted By')
      expect(body).toContain('## Correlation ID')
    })

    it('bug body contains the actual observed behaviour text', async () => {
      await post('/api/feedback', validBugPayload)
      const lastCall = mockCreateIssue.calls[mockCreateIssue.calls.length - 1] as any[]
      const [, , body] = lastCall
      expect(body).toContain('App crashes on click')
    })
  })

  // ── Validation errors → 400 ───────────────────────────────────────────────

  describe('Validation errors (FR-009)', () => {
    it('returns 400 when type is missing', async () => {
      const res = await post('/api/feedback', {
        title: 'Some title',
        description: 'Some description',
      })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.success).toBe(false)
      expect(data.errors).toBeDefined()
    })

    it('returns 400 when type is invalid', async () => {
      const res = await post('/api/feedback', {
        type: 'invalid-type',
        title: 'Some title',
        description: 'Some description',
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 when title is missing', async () => {
      const res = await post('/api/feedback', {
        type: 'bug',
        description: 'Some description',
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 when title exceeds 120 characters', async () => {
      const res = await post('/api/feedback', {
        type: 'bug',
        title: 'a'.repeat(121),
        description: 'Some description',
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 when description is missing', async () => {
      const res = await post('/api/feedback', {
        type: 'bug',
        title: 'Some title',
      })
      expect(res.status).toBe(400)
    })

    it('validation error response includes correlationId', async () => {
      const res = await post('/api/feedback', { type: 'bug' })
      const data = await res.json()
      expect(data.correlationId).toBeTruthy()
    })
  })

  // ── NFR-003: Unauthenticated → 401 ───────────────────────────────────────

  it('returns 401 when request is unauthenticated (NFR-003)', async () => {
    authShouldFail = true
    const res = await post('/api/feedback', validBugPayload)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.success).toBe(false)
  })

  // ── NFR-004: HTML injection is escaped ────────────────────────────────────

  it('escapes HTML angle brackets in issue body — prevents injection (NFR-004)', async () => {
    const maliciousPayload = {
      type: 'bug',
      title: '<script>alert(1)</script> Bug',
      description: '<img src=x onerror=alert(1)>',
      observedBehaviour: '<b>bold</b> crash',
      expectedBehaviour: '<em>normal</em> behaviour',
    }

    await post('/api/feedback', maliciousPayload)

    const lastCall = mockCreateIssue.calls[mockCreateIssue.calls.length - 1] as any[]
    const [, title, body] = lastCall

    // Title should have < > escaped
    expect(title).not.toContain('<script>')
    expect(title).not.toContain('</script>')
    expect(title).toContain('&lt;script&gt;')

    // Body should have < > escaped
    expect(body).not.toContain('<b>')
    expect(body).not.toContain('<em>')
    expect(body).toContain('&lt;b&gt;')
    expect(body).toContain('&lt;em&gt;')
  })

  // ── NFR-007: GitHub 429 → 429 with retryAfter ────────────────────────────

  it('returns 429 with retryAfter when GitHub rate limit is hit (NFR-007)', async () => {
    const rateLimitError: any = new Error('GitHub rate limit exceeded')
    rateLimitError.status = 429
    rateLimitError.retryAfter = '30'
    mockCreateIssue.mockRejectedValue(rateLimitError)

    const res = await post('/api/feedback', validBugPayload)
    expect(res.status).toBe(429)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.retryAfter).toBeTruthy()
    expect(data.correlationId).toBeTruthy()
  })

  it('returns 503 when GitHub API times out', async () => {
    const timeoutError: any = new Error('GitHub API request timed out after 10s')
    timeoutError.code = 'GITHUB_TIMEOUT'
    mockCreateIssue.mockRejectedValue(timeoutError)

    const res = await post('/api/feedback', validBugPayload)
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.correlationId).toBeTruthy()
  })

  it('returns 500 when GitHub throws a generic error', async () => {
    mockCreateIssue.mockRejectedValue(new Error('Something went wrong'))

    const res = await post('/api/feedback', validBugPayload)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.correlationId).toBeTruthy()
  })
})
