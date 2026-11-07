/**
 * BT-05 — credential per service function (spec §4.3, NFR-003): repo/branch/permission reads use ONLY the Code App
 * client (per-org installation); dispatch, run/job/annotation/log reads, aya-flux PR/app reads and cancel use ONLY the
 * Infrastructure App client. Real githubService/aksService/shipService code runs against two recording fake clients.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'

process.env.GITHUB_APP_ID = ''
process.env.GITHUB_INSTALLATION_ID = ''
const cjsRequire = createRequire(import.meta.url)
for (const m of ['githubService', 'aksService', 'shipStatusService', 'shipService', 'shipIdentityService']) delete cjsRequire.cache[cjsRequire.resolve(`../../../services/${m}`)]
const config = cjsRequire('../../../config')
const githubService = cjsRequire('../../../services/githubService')
const identity = cjsRequire('../../../services/shipIdentityService')
const shipService = cjsRequire('../../../services/shipService')
const shipStatus = cjsRequire('../../../services/shipStatusService')
const { createTestProvider } = cjsRequire('../../helpers/shipIdentityTestDouble')
const fx = cjsRequire('../../helpers/shipFixtures')

const sam = { id: fx.OID, email: 'sam@x.com' }
let calls: Array<{ client: 'infra' | 'code'; path: string }>

function recorder(client: 'infra' | 'code', tree: Record<string, Record<string, (args: any) => any>>) {
  const rest: any = {}
  for (const [ns, fns] of Object.entries(tree)) {
    rest[ns] = {}
    for (const [fn, impl] of Object.entries(fns)) rest[ns][fn] = async (args: any) => { calls.push({ client, path: `${ns}.${fn}` }); return impl(args) }
  }
  return { rest }
}
const notFound = () => { const e: any = new Error('Not Found'); e.status = 404; throw e }

beforeEach(() => {
  calls = []
  shipService._resetForTests(); shipStatus._resetForTests()
  Object.assign(config.ship, { allowedOrgs: ['AyaHealthcare'], supportedShipEnvironments: ['devsand'], workflowRef: 'ship/v1', allowDefaultRef: false, identityProvider: 'test', annotationsVerified: true, queueSignalsVerified: false, platformRoles: [] })
  identity.registerProvider('test', createTestProvider({ links: { [fx.OID]: 'octocat' }, permissions: { 'octocat:AyaHealthcare/my-svc': 'admin' } }))
  const t = Date.now() - 30 * 60_000
  const cid = fx.mintAt(t)
  const w: any = { runs: [], jobs: {}, anns: {}, originRunId: 1000 }
  fx.buildRun(w, { cid, id: 1000, createdAt: new Date(t + 5000).toISOString(), status: 'in_progress', conclusion: null })
  w.jobs[1000] = [fx.job(10001, 'prepare', {}), fx.job(10002, 'build', { status: 'in_progress', completed: undefined })]
  ;(globalThis as any).__cid = cid
  githubService.octokit = recorder('infra', {
    actions: {
      createWorkflowDispatch: () => ({}),
      listWorkflowRuns: () => ({ data: { workflow_runs: w.runs } }),
      listJobsForWorkflowRun: () => ({ data: { jobs: w.jobs[1000] } }),
      downloadJobLogsForWorkflowRun: () => ({ data: '2026-10-22T14:06:00Z hello' }),
      cancelWorkflowRun: () => ({}),
    },
    checks: { listAnnotations: ({ check_run_id }: any) => ({ data: w.anns[check_run_id] || [] }) },
    pulls: { list: () => ({ data: [] }) },
    repos: { getContent: notFound },
  })
  githubService.codeOrgClients.clear()
  githubService.codeOrgClients.set('AyaHealthcare', recorder('code', {
    repos: {
      get: () => ({ data: { default_branch: 'main', private: true, fork: false } }),
      listBranches: () => ({ data: [{ name: 'main' }, { name: 'dev' }] }),
      getBranch: () => ({ data: {} }),
    },
  }))
})

const CODE_ONLY = ['repos.get', 'repos.listBranches', 'repos.getBranch']
const clientsOf = (path: string) => [...new Set(calls.filter((c) => c.path === path).map((c) => c.client))]

describe('BT-05 Code App vs Infrastructure App are never mixed', () => {
  it('start(): repo/branch checks on the Code App; app state, PR reads and dispatch on the Infrastructure App', async () => {
    await shipService.start(sam, { repo: 'AyaHealthcare/my-svc', branch: 'main', app: 'my-app', env: 'devsand', namespace: 'my-app', teamLabel: 'software-engineering', port: 8080, healthPath: '/healthz', bump: 'patch' })
    expect(clientsOf('repos.get')).toEqual(['code'])
    expect(clientsOf('repos.getBranch')).toEqual(['code'])
    for (const p of ['actions.createWorkflowDispatch', 'pulls.list', 'repos.getContent']) expect(clientsOf(p)).toEqual(['infra'])
    expect(calls.filter((c) => c.client === 'code').every((c) => CODE_ONLY.includes(c.path))).toBe(true)
    expect(calls.filter((c) => c.client === 'infra').some((c) => CODE_ONLY.includes(c.path))).toBe(false)
  })
  it('listBranches(): Code App only', async () => {
    await shipService.listBranches(sam, 'AyaHealthcare', 'my-svc')
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c.client === 'code')).toBe(true)
  })
  it('getStatus / getLogs / cancel: Infrastructure App only', async () => {
    const cid = (globalThis as any).__cid
    await shipStatus.getStatus(cid, sam)
    await shipStatus.getLogs(cid, sam, { stage: 'build' })
    await shipService.cancel(sam, cid)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c.client === 'infra')).toBe(true)
    expect(calls.map((c) => c.path)).toEqual(expect.arrayContaining(['actions.listWorkflowRuns', 'actions.listJobsForWorkflowRun', 'actions.downloadJobLogsForWorkflowRun', 'actions.cancelWorkflowRun']))
  })
  it('a missing Code App fails listing closed (generic) while status reads keep working (independent init)', async () => {
    githubService.codeOrgClients.clear()
    githubService.codeOctokit = null
    await expect(shipService.listBranches(sam, 'AyaHealthcare', 'my-svc')).rejects.toMatchObject({ status: 403, code: 'REPO_NOT_ACCESSIBLE' })
    await expect(shipService.start(sam, { repo: 'AyaHealthcare/my-svc', branch: 'main', app: 'my-app', env: 'devsand', namespace: 'my-app', teamLabel: 'software-engineering', port: 8080, healthPath: '/healthz', bump: 'patch' })).rejects.toMatchObject({ code: 'REPO_NOT_ACCESSIBLE' })
    expect((await shipStatus.getStatus((globalThis as any).__cid, sam)).runResolved).toBe(true)
  })
  it('rate-limit headers are captured per App via hook.after', () => {
    const hooks: any = {}
    const client: any = { hook: { after: (name: string, fn: any) => { hooks[name] = fn } } }
    githubService._trackRateLimit(client, 'infra')
    hooks.request({ headers: { 'x-ratelimit-remaining': '321', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1800000000' } })
    expect(githubService.getRateLimitSnapshot()).toEqual({ remaining: 321, limit: 5000, reset: 1800000000 })
  })
})
