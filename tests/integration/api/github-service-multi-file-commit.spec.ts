/**
 * Unit tests for githubService.createMultiFileCommit (secrets-environment-bundles §2.4).
 *
 * Covers Round 1 Blocking Finding 2 (write-time CAS + ref-race mapping to CONFLICT) and
 * Round 1 Blocking Finding 3 (correlationId threaded through every log line/logMetric call).
 *
 * Strategy mirrors github-service-create-issue.spec.ts: patch logMetric on the logger module
 * BEFORE requiring githubService (module-load-time destructuring), then inject a mock octokit
 * into the singleton.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)

const loggerModule = cjsRequire('../../../utils/logger')
const logMetricSpy = vi.fn()
loggerModule.logMetric = logMetricSpy
const infoSpy = vi.spyOn(loggerModule, 'info').mockImplementation(() => loggerModule)
const warnSpy = vi.spyOn(loggerModule, 'warn').mockImplementation(() => loggerModule)

const githubService = cjsRequire('../../../services/githubService')

describe('githubService.createMultiFileCommit (secrets-environment-bundles §2.4)', () => {
  const service: any = githubService
  let git: {
    getRef: ReturnType<typeof vi.fn>
    getCommit: ReturnType<typeof vi.fn>
    createTree: ReturnType<typeof vi.fn>
    createCommit: ReturnType<typeof vi.fn>
    createRef: ReturnType<typeof vi.fn>
    updateRef: ReturnType<typeof vi.fn>
  }

  beforeAll(() => {
    expect(service).toBeDefined()
  })

  beforeEach(() => {
    logMetricSpy.mockClear()
    infoSpy.mockClear()
    warnSpy.mockClear()

    git = {
      getRef: vi.fn().mockResolvedValue({ data: { object: { sha: 'parent-sha' } } }),
      getCommit: vi.fn().mockResolvedValue({ data: { tree: { sha: 'base-tree-sha' } } }),
      createTree: vi.fn().mockResolvedValue({ data: { sha: 'new-tree-sha' } }),
      createCommit: vi.fn().mockResolvedValue({ data: { sha: 'new-commit-sha' } }),
      createRef: vi.fn().mockResolvedValue({ data: {} }),
      updateRef: vi.fn().mockResolvedValue({ data: {} })
    }
    service.octokit = { rest: { git, repos: { getContent: vi.fn() } } }
    service.initialized = true
    service.branchExists = async () => false
    service.getFileContent = vi.fn().mockResolvedValue(null)
  })

  const files = [
    { path: 'infrastructure/app/prod/keyvault/secrets.enc.yaml', content: 'prod-content' },
    { path: 'infrastructure/app/cint/keyvault/secrets.enc.yaml', content: 'cint-content' }
  ]

  it('creates a new branch from the default branch tip when it does not already exist', async () => {
    const result = await service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/app-release-abc12345',
      baseBranch: 'main',
      files,
      expectedFileShas: { [files[0].path]: null, [files[1].path]: null },
      commitMessage: 'chore(secrets): bundle update'
    })

    expect(git.getRef).toHaveBeenCalledWith({ owner: 'org', repo: 'repo', ref: 'heads/main' })
    expect(git.createRef).toHaveBeenCalledWith({ owner: 'org', repo: 'repo', ref: 'refs/heads/secrets/app-release-abc12345', sha: 'new-commit-sha' })
    expect(git.updateRef).not.toHaveBeenCalled()
    expect(result).toEqual({ commitSha: 'new-commit-sha', branchName: 'secrets/app-release-abc12345', branchAlreadyExisted: false })
  })

  it('updates an existing branch (updateRef) building on its current tip, when it already exists', async () => {
    service.branchExists = async () => true

    await service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/app-release-abc12345',
      baseBranch: 'main',
      files,
      expectedFileShas: { [files[0].path]: null, [files[1].path]: null },
      commitMessage: 'chore(secrets): bundle update'
    })

    expect(git.getRef).toHaveBeenCalledWith({ owner: 'org', repo: 'repo', ref: 'heads/secrets/app-release-abc12345' })
    expect(git.updateRef).toHaveBeenCalledWith({ owner: 'org', repo: 'repo', ref: 'heads/secrets/app-release-abc12345', sha: 'new-commit-sha', force: false })
    expect(git.createRef).not.toHaveBeenCalled()
  })

  it('issues exactly one createTree call covering all included files regardless of environment count', async () => {
    const manyFiles = Array.from({ length: 10 }, (_, i) => ({ path: `infrastructure/app/env${i}/keyvault/secrets.enc.yaml`, content: `c${i}` }))
    const expectedFileShas: Record<string, string | null> = {}
    manyFiles.forEach(f => { expectedFileShas[f.path] = null })

    await service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/app-release-10env',
      baseBranch: 'main',
      files: manyFiles,
      expectedFileShas,
      commitMessage: 'chore(secrets): bundle update'
    })

    expect(git.createTree).toHaveBeenCalledTimes(1)
    expect(git.createTree.mock.calls[0][0].tree).toHaveLength(10)
  })

  it('throws a CONFLICT-coded error when expectedFileShas mismatches an included path, before any mutating call', async () => {
    service.getFileContent = vi.fn().mockResolvedValue({ content: 'actual-content', sha: 'actual-sha' })

    await expect(service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/app-release-abc12345',
      baseBranch: 'main',
      files,
      expectedFileShas: { [files[0].path]: 'stale-sha', [files[1].path]: null },
      commitMessage: 'chore(secrets): bundle update'
    })).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(git.createTree).not.toHaveBeenCalled()
    expect(git.createCommit).not.toHaveBeenCalled()
    expect(git.createRef).not.toHaveBeenCalled()
    expect(git.updateRef).not.toHaveBeenCalled()
  })

  it('maps updateRef 422 (non-fast-forward) to CONFLICT, not the raw GitHub error', async () => {
    service.branchExists = async () => true
    const rawError: any = new Error('Reference update failed')
    rawError.status = 422
    git.updateRef.mockRejectedValue(rawError)

    await expect(service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/app-release-abc12345',
      baseBranch: 'main',
      files,
      expectedFileShas: { [files[0].path]: null, [files[1].path]: null },
      commitMessage: 'chore(secrets): bundle update'
    })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('maps createRef 422 (ref already exists) to CONFLICT', async () => {
    const rawError: any = new Error('Reference already exists')
    rawError.status = 422
    git.createRef.mockRejectedValue(rawError)

    await expect(service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/app-release-abc12345',
      baseBranch: 'main',
      files,
      expectedFileShas: { [files[0].path]: null, [files[1].path]: null },
      commitMessage: 'chore(secrets): bundle update'
    })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('runs the write-time CAS re-read exactly once per included path, in parallel, before createTree', async () => {
    const callOrder: string[] = []
    service.getFileContent = vi.fn().mockImplementation(async (_repo: string, path: string) => {
      callOrder.push(`read:${path}`)
      return { content: 'x', sha: null }
    })
    git.createTree.mockImplementation(async (...args: any[]) => {
      callOrder.push('createTree')
      return { data: { sha: 'new-tree-sha' } }
    })

    await service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/app-release-abc12345',
      baseBranch: 'main',
      files,
      expectedFileShas: { [files[0].path]: null, [files[1].path]: null },
      commitMessage: 'chore(secrets): bundle update'
    })

    expect(service.getFileContent).toHaveBeenCalledTimes(2)
    expect(callOrder.indexOf('createTree')).toBe(callOrder.length - 1)
    expect(callOrder.slice(0, 2).sort()).toEqual([`read:${files[0].path}`, `read:${files[1].path}`].sort())
  })

  it('threads correlationId through every logger.info/logger.warn line and the logMetric call on the success path', async () => {
    await service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/app-release-abc12345',
      baseBranch: 'main',
      files,
      expectedFileShas: { [files[0].path]: null, [files[1].path]: null },
      commitMessage: 'chore(secrets): bundle update',
      correlationId: 'cid-mfc-1'
    })

    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[cid-mfc-1]'))
    const successMetricCall = logMetricSpy.mock.calls.find(([event]) => event === 'github_api_call')
    expect(successMetricCall![1]).toMatchObject({ operation: 'createMultiFileCommit', correlationId: 'cid-mfc-1', success: true })
  })

  it('threads correlationId through the logMetric call on the failure path', async () => {
    const rawError: any = new Error('boom')
    git.createTree.mockRejectedValue(rawError)

    await expect(service.createMultiFileCommit('org/repo', {
      branchName: 'secrets/app-release-abc12345',
      baseBranch: 'main',
      files,
      expectedFileShas: { [files[0].path]: null, [files[1].path]: null },
      commitMessage: 'chore(secrets): bundle update',
      correlationId: 'cid-mfc-fail'
    })).rejects.toThrow('boom')

    const failureMetricCall = logMetricSpy.mock.calls.find(([, fields]) => fields.success === false)
    expect(failureMetricCall![1]).toMatchObject({ operation: 'createMultiFileCommit', correlationId: 'cid-mfc-fail', success: false })
  })

  it('backward compatibility: createPullRequest/getFileContent callers that omit correlationId are unaffected', async () => {
    service.octokit.rest.pulls = { create: vi.fn().mockResolvedValue({ data: { html_url: 'https://x/pr/1', number: 1 } }) }
    const result = await service.createPullRequest('org/repo', 'main', 'feature', 'title', 'body')
    expect(result).toEqual({ prUrl: 'https://x/pr/1', prNumber: 1 })
  })
})
