/**
 * QA — secrets-environment-bundles (docs/architecture/secrets-environment-bundles-spec.json).
 *
 * Independently derived from spec.json testing.unit_tests ("githubService.createMultiFileCommit",
 * "githubService.createPullRequest / getFileContent (additive correlationId parameter)") and
 * spec.md §2.4 (Round 1 Blocking Finding 2: write-time compare-and-swap; Round 1 Blocking
 * Finding 3: correlationId observability threading).
 *
 * Mirrors the existing `github-service-create-issue.spec.ts` convention: patch `logger.logMetric`
 * before the singleton loads, then inject a mock `octokit` into the singleton per test (no
 * network, no vi.mock() — CJS require() bypasses vi.mock() factories in this codebase).
 *
 * As of this session, `createMultiFileCommit` does not exist anywhere in `services/githubService.js`
 * (confirmed via `grep -n "createMultiFileCommit\|createTree\|createCommit\|createBlob\|updateRef"
 * services/githubService.js`, which returns no matches), and neither `createPullRequest` nor
 * `getFileContent` accepts a `correlationId` parameter today. Every test below is expected to fail
 * until the Vue.js Developer implements the documented contract. See
 * tests/results/secrets-environment-bundles-results.json.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)

const loggerModule = cjsRequire('../../../utils/logger')
const logMetricSpy = vi.fn()
loggerModule.logMetric = logMetricSpy

const githubService = cjsRequire('../../../services/githubService')

describe('githubService.createMultiFileCommit (spec.md §2.4, Round 1 Blocking Finding 2)', () => {
  const service: any = githubService
  let mocks: {
    getRef: ReturnType<typeof vi.fn>
    getCommit: ReturnType<typeof vi.fn>
    createTree: ReturnType<typeof vi.fn>
    createCommit: ReturnType<typeof vi.fn>
    createRef: ReturnType<typeof vi.fn>
    updateRef: ReturnType<typeof vi.fn>
    getContent: ReturnType<typeof vi.fn>
  }

  beforeAll(() => {
    expect(service).toBeDefined()
  })

  beforeEach(() => {
    mocks = {
      getRef: vi.fn(),
      getCommit: vi.fn(),
      createTree: vi.fn(),
      createCommit: vi.fn(),
      createRef: vi.fn(),
      updateRef: vi.fn(),
      getContent: vi.fn()
    }
    service.octokit = {
      rest: {
        git: {
          getRef: mocks.getRef,
          getCommit: mocks.getCommit,
          createTree: mocks.createTree,
          createCommit: mocks.createCommit,
          createRef: mocks.createRef,
          updateRef: mocks.updateRef
        },
        repos: { getContent: mocks.getContent }
      }
    }
    service.initialized = true
    logMetricSpy.mockClear()
  })

  function setUpNoDriftHappyPath() {
    mocks.getRef.mockResolvedValue({ data: { object: { sha: 'parent-commit-sha' } } })
    mocks.getCommit.mockResolvedValue({ data: { tree: { sha: 'base-tree-sha' } } })
    mocks.getContent.mockImplementation(({ path }: any) =>
      Promise.resolve({ data: { content: Buffer.from('').toString('base64'), sha: `expected-${path}` } })
    )
    mocks.createTree.mockResolvedValue({ data: { sha: 'new-tree-sha' } })
    mocks.createCommit.mockResolvedValue({ data: { sha: 'new-commit-sha' } })
    mocks.createRef.mockResolvedValue({ data: {} })
    mocks.updateRef.mockResolvedValue({ data: {} })
  }

  it('is exported as a function', () => {
    expect(typeof service.createMultiFileCommit).toBe('function')
  })

  it('happy path: creates exactly one createTree/createCommit/createRef for a brand-new branch, one getFileContent read per included path via Promise.all before createTree', async () => {
    setUpNoDriftHappyPath()
    // branchExists() -> getRef 404 first (branch lookup), so createRef (not updateRef) is used.
    let getRefCallCount = 0
    mocks.getRef.mockImplementation(({ ref }: any) => {
      getRefCallCount += 1
      if (ref === 'heads/secrets/myapp-release-abcd1234') {
        const err: any = new Error('Not Found')
        err.status = 404
        return Promise.reject(err)
      }
      return Promise.resolve({ data: { object: { sha: 'parent-commit-sha' } } })
    })

    const files = [
      { path: 'infra/myapp/prod/secrets.enc.yaml', content: 'prod-content' },
      { path: 'infra/myapp/cint/secrets.enc.yaml', content: 'cint-content' }
    ]
    const expectedFileShas = {
      'infra/myapp/prod/secrets.enc.yaml': 'expected-infra/myapp/prod/secrets.enc.yaml',
      'infra/myapp/cint/secrets.enc.yaml': 'expected-infra/myapp/cint/secrets.enc.yaml'
    }

    const result = await service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/myapp-release-abcd1234',
      baseBranch: 'main',
      files,
      expectedFileShas,
      commitMessage: 'chore(secrets): bundle update',
      correlationId: 'cid-cmfc-happy'
    })

    expect(mocks.createTree).toHaveBeenCalledOnce()
    expect(mocks.createTree.mock.calls[0][0].tree).toHaveLength(2)
    expect(mocks.createCommit).toHaveBeenCalledOnce()
    expect(mocks.createRef).toHaveBeenCalledOnce()
    expect(mocks.updateRef).not.toHaveBeenCalled()
    expect(mocks.getContent).toHaveBeenCalledTimes(2) // one CAS re-read per included path
    expect(result.commitSha).toBeTruthy()
  })

  it('happy path: builds on the existing branch tip via updateRef when the branch already exists', async () => {
    setUpNoDriftHappyPath()
    mocks.getRef.mockResolvedValue({ data: { object: { sha: 'existing-branch-tip-sha' } } })

    await service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/myapp-release-abcd1234',
      baseBranch: 'main',
      files: [{ path: 'infra/myapp/prod/secrets.enc.yaml', content: 'x' }],
      expectedFileShas: { 'infra/myapp/prod/secrets.enc.yaml': 'expected-infra/myapp/prod/secrets.enc.yaml' },
      commitMessage: 'chore(secrets): bundle update',
      correlationId: 'cid-cmfc-existing'
    })

    expect(mocks.updateRef).toHaveBeenCalledOnce()
    expect(mocks.createRef).not.toHaveBeenCalled()
  })

  it('a write-time SHA mismatch on any included path throws a CONFLICT-coded error before createTree/createCommit/createRef/updateRef are ever invoked', async () => {
    setUpNoDriftHappyPath()
    mocks.getRef.mockImplementation(() => Promise.resolve({ data: { object: { sha: 'parent-commit-sha' } } }))
    // Actual content SHA does not match what the caller expects -> conflict.
    mocks.getContent.mockResolvedValue({ data: { content: '', sha: 'actually-different-sha' } })

    await expect(service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/myapp-release-abcd1234',
      baseBranch: 'main',
      files: [{ path: 'infra/myapp/prod/secrets.enc.yaml', content: 'x' }],
      expectedFileShas: { 'infra/myapp/prod/secrets.enc.yaml': 'expected-sha-that-does-not-match' },
      commitMessage: 'chore(secrets): bundle update',
      correlationId: 'cid-cmfc-conflict'
    })).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(mocks.createTree).not.toHaveBeenCalled()
    expect(mocks.createCommit).not.toHaveBeenCalled()
    expect(mocks.createRef).not.toHaveBeenCalled()
    expect(mocks.updateRef).not.toHaveBeenCalled()
  })

  it('updateRef returning 422 (non-fast-forward) is mapped to CONFLICT, not the raw GitHub error', async () => {
    setUpNoDriftHappyPath()
    mocks.getRef.mockResolvedValue({ data: { object: { sha: 'existing-branch-tip-sha' } } }) // branch exists
    const err: any = new Error('Update is not a fast forward')
    err.status = 422
    mocks.updateRef.mockRejectedValue(err)

    await expect(service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/myapp-release-abcd1234',
      baseBranch: 'main',
      files: [{ path: 'infra/myapp/prod/secrets.enc.yaml', content: 'x' }],
      expectedFileShas: { 'infra/myapp/prod/secrets.enc.yaml': 'expected-infra/myapp/prod/secrets.enc.yaml' },
      commitMessage: 'chore(secrets): bundle update',
      correlationId: 'cid-cmfc-ff'
    })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('createRef returning 422 (ref already exists) is mapped to CONFLICT', async () => {
    setUpNoDriftHappyPath()
    mocks.getRef.mockImplementation(({ ref }: any) => {
      if (ref === 'heads/secrets/myapp-release-abcd1234') {
        const notFound: any = new Error('Not Found')
        notFound.status = 404
        return Promise.reject(notFound)
      }
      return Promise.resolve({ data: { object: { sha: 'parent-commit-sha' } } })
    })
    const err: any = new Error('Reference already exists')
    err.status = 422
    mocks.createRef.mockRejectedValue(err)

    await expect(service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/myapp-release-abcd1234',
      baseBranch: 'main',
      files: [{ path: 'infra/myapp/prod/secrets.enc.yaml', content: 'x' }],
      expectedFileShas: { 'infra/myapp/prod/secrets.enc.yaml': 'expected-infra/myapp/prod/secrets.enc.yaml' },
      commitMessage: 'chore(secrets): bundle update',
      correlationId: 'cid-cmfc-refrace'
    })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('correlationId appears in the logMetric call for both the success and failure path', async () => {
    setUpNoDriftHappyPath()
    mocks.getRef.mockImplementation(() => Promise.resolve({ data: { object: { sha: 'parent-commit-sha' } } }))

    await service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/myapp-release-abcd1234',
      baseBranch: 'main',
      files: [{ path: 'infra/myapp/prod/secrets.enc.yaml', content: 'x' }],
      expectedFileShas: { 'infra/myapp/prod/secrets.enc.yaml': 'expected-infra/myapp/prod/secrets.enc.yaml' },
      commitMessage: 'chore(secrets): bundle update',
      correlationId: 'cid-cmfc-obs-success'
    })
    expect(logMetricSpy).toHaveBeenCalledWith('github_api_call', expect.objectContaining({
      operation: 'createMultiFileCommit',
      success: true,
      correlationId: 'cid-cmfc-obs-success'
    }))

    logMetricSpy.mockClear()
    mocks.getContent.mockResolvedValue({ data: { content: '', sha: 'wrong-sha' } })
    await expect(service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/myapp-release-abcd1234',
      baseBranch: 'main',
      files: [{ path: 'infra/myapp/prod/secrets.enc.yaml', content: 'x' }],
      expectedFileShas: { 'infra/myapp/prod/secrets.enc.yaml': 'expected-infra/myapp/prod/secrets.enc.yaml' },
      commitMessage: 'chore(secrets): bundle update',
      correlationId: 'cid-cmfc-obs-fail'
    })).rejects.toThrow()
    expect(logMetricSpy).toHaveBeenCalledWith('github_api_call', expect.objectContaining({
      operation: 'createMultiFileCommit',
      success: false,
      correlationId: 'cid-cmfc-obs-fail'
    }))
  })
})

describe('githubService.createPullRequest / getFileContent — additive correlationId parameter (spec.md §2.4)', () => {
  const service: any = githubService

  beforeEach(() => {
    logMetricSpy.mockClear()
  })

  it('createPullRequest: existing callers that omit correlationId are unaffected (backward compatible)', async () => {
    service.octokit = { rest: { pulls: { create: vi.fn().mockResolvedValue({ data: { html_url: 'https://github.com/o/r/pull/1', number: 1 } }) } } }
    service.initialized = true

    const result = await service.createPullRequest('o/r', 'main', 'feature-branch', 'Title', 'Body')
    expect(result).toEqual({ prUrl: 'https://github.com/o/r/pull/1', prNumber: 1 })
  })

  it('createPullRequest: when correlationId is supplied, every logger line is tagged [correlationId] (Round 1 Blocking Finding 3)', async () => {
    const logger = cjsRequire('../../../utils/logger')
    const capturedLogs: string[] = []
    const originalInfo = logger.info
    logger.info = (msg: string) => capturedLogs.push(msg)

    service.octokit = { rest: { pulls: { create: vi.fn().mockResolvedValue({ data: { html_url: 'https://github.com/o/r/pull/2', number: 2 } }) } } }
    service.initialized = true

    await service.createPullRequest('o/r', 'main', 'feature-branch', 'Title', 'Body', 'cid-pr-tag')
    expect(capturedLogs.some(l => l.includes('[cid-pr-tag]'))).toBe(true)

    logger.info = originalInfo
  })

  it('getFileContent: when correlationId is supplied, the logMetric call includes it', async () => {
    service.octokit = { rest: { repos: { getContent: vi.fn().mockResolvedValue({ data: { content: Buffer.from('x').toString('base64'), sha: 'sha1' } }) } } }
    service.initialized = true

    await service.getFileContent('o/r', 'path/to/file', 'main', 'cid-gfc-tag')
    expect(logMetricSpy).toHaveBeenCalledWith('github_api_call', expect.objectContaining({
      operation: 'getFileContent',
      correlationId: 'cid-gfc-tag'
    }))
  })
})
