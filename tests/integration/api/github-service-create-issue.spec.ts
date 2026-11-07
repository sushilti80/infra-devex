/**
 * Unit tests for githubService.createIssue
 *
 * Covers:
 *   FR-010 — createIssue service method behaves correctly
 *   FR-011 — issue body format (tested via API route tests)
 *   FR-015 — unit tests for the service method
 *
 * Strategy:
 *  - The service uses CJS require() which bypasses ESM vi.mock in vitest's node env.
 *  - The service constructor skips real GitHub initialization in NODE_ENV=test.
 *  - We patch logMetric on the logger module exports BEFORE the service is loaded.
 *  - After loading, we inject a mock octokit into the singleton to enable createIssue calls.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)

// ─── Patch logMetric on the logger module BEFORE the service loads ────────────
// githubService.js destructures logMetric at module evaluation time, so we must
// replace it before the first require of githubService.
const loggerModule = cjsRequire('../../../utils/logger')
const logMetricSpy = vi.fn()
loggerModule.logMetric = logMetricSpy

// ─── Now load the service singleton ───────────────────────────────────────────
// NODE_ENV=test guard in the constructor means Octokit is never instantiated.
const githubService = cjsRequire('../../../services/githubService')

describe('githubService.createIssue (FR-010, FR-015)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: any = githubService
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockIssuesCreate: ReturnType<typeof vi.fn>

  beforeAll(() => {
    // Confirm the singleton was loaded
    expect(service).toBeDefined()
  })

  beforeEach(() => {
    mockIssuesCreate = vi.fn()

    // Inject a fresh mock octokit into the singleton for each test
    service.octokit = {
      rest: {
        issues: {
          create: mockIssuesCreate,
        },
      },
    }
    service.initialized = true

    // Clear spy call histories (not implementations)
    logMetricSpy.mockClear()
    mockIssuesCreate.mockClear()
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('calls octokit.rest.issues.create with correct owner, repo, title, body, labels', async () => {
    mockIssuesCreate.mockResolvedValue({
      data: {
        html_url: 'https://github.com/TestOrg/test-repo/issues/7',
        number: 7,
      },
    })

    await service.createIssue('TestOrg/test-repo', 'My title', 'My body', ['bug'], 'cid-abc')

    expect(mockIssuesCreate).toHaveBeenCalledOnce()
    expect(mockIssuesCreate).toHaveBeenCalledWith({
      owner: 'TestOrg',
      repo: 'test-repo',
      title: 'My title',
      body: 'My body',
      labels: ['bug'],
    })
  })

  it('returns { issueUrl, issueNumber } on success', async () => {
    mockIssuesCreate.mockResolvedValue({
      data: {
        html_url: 'https://github.com/TestOrg/test-repo/issues/99',
        number: 99,
      },
    })

    const result = await service.createIssue('TestOrg/test-repo', 'Title', 'Body')

    expect(result).toEqual({
      issueUrl: 'https://github.com/TestOrg/test-repo/issues/99',
      issueNumber: 99,
    })
  })

  it('defaults labels to [] when not provided', async () => {
    mockIssuesCreate.mockResolvedValue({ data: { html_url: 'https://github.com/o/r/issues/1', number: 1 } })

    await service.createIssue('TestOrg/repo', 'Title', 'Body')

    expect(mockIssuesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ labels: [] })
    )
  })

  // ── GitHub 429 rate-limit ───────────────────────────────────────────────────

  it('throws with retryAfter property when GitHub returns 429', async () => {
    const rateLimitError: any = new Error('You have exceeded a secondary rate limit')
    rateLimitError.status = 429
    rateLimitError.response = { headers: { 'retry-after': '45' } }
    mockIssuesCreate.mockRejectedValue(rateLimitError)

    await expect(
      service.createIssue('TestOrg/repo', 'Title', 'Body', [], 'cid-rate')
    ).rejects.toMatchObject({ status: 429, retryAfter: '45' })
  })

  it('uses default retryAfter of "60" when header is absent', async () => {
    const rateLimitError: any = new Error('Rate limit')
    rateLimitError.status = 429
    rateLimitError.response = { headers: {} }
    mockIssuesCreate.mockRejectedValue(rateLimitError)

    await expect(
      service.createIssue('TestOrg/repo', 'Title', 'Body')
    ).rejects.toMatchObject({ retryAfter: '60' })
  })

  // ── Timeout ─────────────────────────────────────────────────────────────────

  it('throws with error.code === GITHUB_TIMEOUT when 10 s elapses', async () => {
    vi.useFakeTimers()

    // Promise that never resolves to simulate a hung GitHub API
    mockIssuesCreate.mockReturnValue(new Promise(() => {}))

    const createPromise = service.createIssue('TestOrg/repo', 'Title', 'Body', [], 'cid-timeout')

    // Fast-forward 10 seconds to trigger the timeout
    vi.advanceTimersByTime(10001)

    await expect(createPromise).rejects.toMatchObject({ code: 'GITHUB_TIMEOUT' })

    vi.useRealTimers()
  })

  // ── ensureInitialized guard ──────────────────────────────────────────────────

  it('throws when octokit is not initialized', async () => {
    service.octokit = null
    service.initialized = false

    await expect(
      service.createIssue('TestOrg/repo', 'Title', 'Body')
    ).rejects.toThrow()
  })

  // ── logMetric is called ──────────────────────────────────────────────────────

  it('calls logMetric with operation=createIssue and success=true on success', async () => {
    mockIssuesCreate.mockResolvedValue({
      data: { html_url: 'https://github.com/o/r/issues/1', number: 1 },
    })

    await service.createIssue('TestOrg/repo', 'Title', 'Body', ['bug'], 'cid-metric')

    expect(logMetricSpy).toHaveBeenCalledWith(
      'github_api_call',
      expect.objectContaining({
        operation: 'createIssue',
        success: true,
        correlationId: 'cid-metric',
      })
    )
  })

  it('calls logMetric with success=false on failure', async () => {
    mockIssuesCreate.mockRejectedValue(new Error('network error'))

    await expect(
      service.createIssue('TestOrg/repo', 'Title', 'Body', [], 'cid-fail')
    ).rejects.toThrow()

    expect(logMetricSpy).toHaveBeenCalledWith(
      'github_api_call',
      expect.objectContaining({
        operation: 'createIssue',
        success: false,
        correlationId: 'cid-fail',
      })
    )
  })
})
