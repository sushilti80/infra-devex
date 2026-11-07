/**
 * O-1 (SRE): the Infrastructure-App GitHub calls added for ship-from-repo (runs, jobs, annotations, logs, cancel) emit the
 * existing `github_api_call` metric (operation, repo, duration_ms, success, correlationId[, status_code]).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'

process.env.GITHUB_APP_ID = ''
process.env.GITHUB_INSTALLATION_ID = ''
const cjsRequire = createRequire(import.meta.url)
const githubService = cjsRequire('../../../services/githubService')
const logger = cjsRequire('../../../utils/logger')

const REPO = 'Aya-DevOpsTeam/infra-workflows'
const CID = '0194a000-0000-7000-8000-000000000001'
const notFound = () => { const e: any = new Error('Not Found'); e.status = 404; throw e }
let impl: Record<string, (a: any) => any>
let spy: any

beforeEach(() => {
  impl = {}
  const wrap = (name: string, data: any) => async (a: any) => (impl[name] ? impl[name](a) : { data })
  githubService.octokit = {
    rest: {
      actions: {
        listWorkflowRuns: wrap('listWorkflowRuns', { workflow_runs: [{ id: 1 }] }),
        listJobsForWorkflowRun: wrap('listJobsForWorkflowRun', { jobs: [{ id: 2 }] }),
        downloadJobLogsForWorkflowRun: wrap('downloadJobLogsForWorkflowRun', 'log text'),
        cancelWorkflowRun: wrap('cancelWorkflowRun', {}),
      },
      pulls: { list: wrap('pullsList', [{ number: 7, html_url: 'https://example.test/pr/7', state: 'open', merged_at: null }]) },
      checks: { listAnnotations: wrap('listAnnotations', [{ title: 'x' }]) },
    },
  }
  spy = vi.spyOn(logger, 'log')
})
afterEach(() => { vi.restoreAllMocks() })

const apiCalls = () => spy.mock.calls.filter((c: any[]) => c[1] === 'github_api_call').map((c: any[]) => ({ level: c[0], ...c[2] }))

describe('O-1 github_api_call for the Infrastructure-App ship calls', () => {
  it('emits one success metric per call, with operation, repo, duration and the ship correlation id, and returns the same data', async () => {
    expect(await githubService.listWorkflowRunsInWindow(REPO, 'ship.yml', { created: 'a..b', page: 1, perPage: 100, correlationId: CID })).toEqual([{ id: 1 }])
    expect(await githubService.listJobsForRun(REPO, 1, CID)).toEqual([{ id: 2 }])
    expect(await githubService.listJobAnnotations(REPO, 2, CID)).toEqual([{ title: 'x' }])
    expect(await githubService.downloadJobLogs(REPO, 2, CID)).toBe('log text')
    await githubService.cancelWorkflowRun(REPO, 1, CID)
    const calls = apiCalls()
    expect(calls.map((c: any) => c.operation)).toEqual(['listWorkflowRuns', 'listJobsForRun', 'listJobAnnotations', 'downloadJobLogs', 'cancelWorkflowRun'])
    for (const c of calls) {
      expect(c).toMatchObject({ level: 'info', repo: REPO, success: true, correlation_id: CID })
      expect(typeof c.duration_ms).toBe('number')
    }
  })

  it('emits a failed metric (success:false, status_code, warn for 4xx) and rethrows', async () => {
    impl.listJobsForWorkflowRun = notFound
    await expect(githubService.listJobsForRun(REPO, 1, CID)).rejects.toMatchObject({ status: 404 })
    expect(apiCalls()).toEqual([expect.objectContaining({ operation: 'listJobsForRun', success: false, status_code: 404, level: 'warn', error: 'Not Found', correlation_id: CID })])
  })

  it('5xx failures log at error level; a log that is not available yet still returns null and records the 404', async () => {
    impl.cancelWorkflowRun = () => { const e: any = new Error('boom'); e.status = 502; throw e }
    await expect(githubService.cancelWorkflowRun(REPO, 1, CID)).rejects.toMatchObject({ status: 502 })
    impl.downloadJobLogsForWorkflowRun = notFound
    expect(await githubService.downloadJobLogs(REPO, 2, CID)).toBeNull()
    const [cancel, logs] = apiCalls()
    expect(cancel).toMatchObject({ operation: 'cancelWorkflowRun', success: false, status_code: 502, level: 'error' })
    expect(logs).toMatchObject({ operation: 'downloadJobLogs', success: false, status_code: 404 })
  })

  it('O-7: findPullRequestForBranch emits github_api_call (success and failure) and keeps its mapping', async () => {
    expect(await githubService.findPullRequestForBranch(REPO, 'auto/gen-dev-app', 'all', CID)).toEqual({ number: 7, url: 'https://example.test/pr/7', state: 'open' })
    impl.pullsList = notFound
    await expect(githubService.findPullRequestForBranch(REPO, 'auto/gen-dev-app', 'all', CID)).rejects.toMatchObject({ status: 404 })
    expect(apiCalls()).toEqual([
      expect.objectContaining({ operation: 'findPullRequestForBranch', repo: REPO, success: true, level: 'info', correlation_id: CID }),
      expect.objectContaining({ operation: 'findPullRequestForBranch', success: false, status_code: 404, level: 'warn', correlation_id: CID }),
    ])
  })

  it('falls back to correlationId "unknown" when none is supplied (existing pattern)', async () => {
    await githubService.listJobsForRun(REPO, 1)
    expect(apiCalls()[0].correlation_id).toBe('unknown')
  })
})
