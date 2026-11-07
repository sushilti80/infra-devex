import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const config = require('../../../config')
const logger = require('../../../utils/logger')
const appId = config.github.appId
config.github.appId = ''
const githubService = require('../../../services/githubService')
config.github.appId = appId
const aksService = require('../../../services/aksService')
const router = require('../../../routes/api')
const originalOctokit = githubService.octokit
const dispatchWorkflow = vi.fn()
const sensitive = 'SYNTHETIC-CONTENT-MUST-NOT-BE-LOGGED'

function request(overrides: Record<string, unknown> = {}) {
  return {
    body: {
      envname: config.aks.supportedEnvironments[0],
      appname: 'logging-test',
      namespace: 'logging-test',
      is_web_app: true,
      image_name: 'example.azurecr.io/logging-test',
      image_tag: '1.0.0',
      correlation_id: 'aks-logging-test',
      env_vars: JSON.stringify([{ name: 'CONFIG', value: sensitive }]),
      ...overrides
    },
    user: { email: 'tester@example.com' },
    correlationId: 'http-request-id',
    params: {},
    query: {},
    headers: {}
  }
}

async function submit(req: ReturnType<typeof request>) {
  const stack = router.stack.find(
    (layer: { route?: { path: string } }) => layer.route?.path === '/aks-deploy'
  ).route.stack
  const res = { status: vi.fn(), json: vi.fn() }
  res.status.mockReturnValue(res)
  res.json.mockReturnValue(res)
  for (const layer of stack.slice(1, -1)) {
    await new Promise<void>((resolve, reject) => {
      layer.handle(req, res, (error?: Error) => error ? reject(error) : resolve())
    })
  }
  await stack[stack.length - 1].handle(req, res)
  return res
}

function metric(event: string, fields: Record<string, unknown>) {
  expect(logger.log).toHaveBeenCalledWith(
    expect.any(String), event, expect.objectContaining({ event, ...fields })
  )
}

describe('AKS request logging', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'log').mockReturnValue(logger)
    vi.spyOn(logger, 'info').mockReturnValue(logger)
    vi.spyOn(logger, 'warn').mockReturnValue(logger)
    vi.spyOn(logger, 'error').mockReturnValue(logger)
    dispatchWorkflow.mockReset().mockResolvedValue({ status: 204 })
    githubService.octokit = { rest: { actions: { createWorkflowDispatch: dispatchWorkflow } } }
  })

  afterEach(() => {
    const output = JSON.stringify([
      vi.mocked(logger.log).mock.calls,
      vi.mocked(logger.info).mock.calls,
      vi.mocked(logger.warn).mock.calls,
      vi.mocked(logger.error).mock.calls
    ])
    githubService.octokit = originalOctokit
    vi.restoreAllMocks()
    expect(output).not.toContain(sensitive)
  })

  it('links HTTP, workflow dispatch, and outcome events without logging workflow inputs', async () => {
    const req = request()
    const res = await submit(req)
    expect(req.correlationId).toBe('aks-logging-test')
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true, correlationId: req.correlationId
    }))
    metric('aks_deployment_requested', {
      correlation_id: req.correlationId, appname: 'logging-test', deploymentType: 'app'
    })
    metric('github_workflow_dispatch_requested', {
      correlation_id: req.correlationId, workflow_id: 'generate-webapp-config.yaml'
    })
    metric('github_api_call', { correlation_id: req.correlationId, success: true })
    metric('aks_deployment_dispatched', {
      correlation_id: req.correlationId, success: true, duration_ms: expect.any(Number)
    })
    expect(dispatchWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      inputs: expect.objectContaining({ env_vars: req.body.env_vars })
    }))
  })

  it('logs only failed field names on validation rejection, never submitted values', async () => {
    const res = await submit(request({ env_vars: sensitive }))
    expect(res.status).toHaveBeenCalledWith(400)
    expect(dispatchWorkflow).not.toHaveBeenCalled()
    metric('aks_deployment_rejected', {
      correlation_id: 'aks-logging-test', failed_fields: ['env_vars'], status_code: 400
    })
    expect(logger.log).toHaveBeenCalledWith('warn', 'aks_deployment_rejected', expect.any(Object))
  })

  it.each(['devsand', 'sand'])('accepts approved %s private-gateway onboarding', async envname => {
    const res = await submit(request({
      envname,
      exposure_mode: 'private-gateway',
      allow_update: 'false'
    }))
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
    expect(dispatchWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      inputs: expect.objectContaining({ envname, exposure_mode: 'private-gateway' })
    }))
  })

  it('rejects private-gateway namespace mismatches as validation errors, not dispatch failures', async () => {
    const res = await submit(request({
      envname: 'sand',
      namespace: 'other-namespace',
      exposure_mode: 'private-gateway'
    }))
    expect(res.status).toHaveBeenCalledWith(400)
    expect(dispatchWorkflow).not.toHaveBeenCalled()
    metric('aks_deployment_rejected', { failed_fields: ['exposure_mode'], status_code: 400 })
  })


  it('accepts a native true only for an eligible PostgreSQL request', async () => {
    const res = await submit(request({
      envname: 'devsand', create_postgres_db: true,
      namespace: 'logging-test', allow_update: 'false'
    }))
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
    expect(dispatchWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      inputs: expect.objectContaining({ create_postgres_db: 'true' })
    }))
  })

  it.each([true, 'true'])('rejects PostgreSQL %s with mismatched namespace as HTTP 400', async selection => {
    const res = await submit(request({
      envname: 'devsand', namespace: 'other-namespace', create_postgres_db: selection
    }))
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      details: expect.arrayContaining([expect.objectContaining({ path: 'create_postgres_db' })])
    }))
    expect(dispatchWorkflow).not.toHaveBeenCalled()
    metric('aks_deployment_rejected', { failed_fields: ['create_postgres_db'], status_code: 400 })
  })

  it('rejects native PostgreSQL true outside the approved environments', async () => {
    const res = await submit(request({
      envname: 'int', create_postgres_db: true
    }))
    expect(res.status).toHaveBeenCalledWith(400)
    expect(dispatchWorkflow).not.toHaveBeenCalled()
  })

  it('rejects PostgreSQL names beyond 60 characters and any updates before dispatch', async () => {
    for (const overrides of [
      { appname: 'a'.repeat(61), namespace: 'a'.repeat(61), create_postgres_db: true },
      { create_postgres_db: true, allow_update: 'true' }
    ]) {
      const res = await submit(request(overrides))
      expect(res.status).toHaveBeenCalledWith(400)
      expect(dispatchWorkflow).not.toHaveBeenCalled()
    }
  })

  it('rejects unknown PostgreSQL input types as HTTP 400', async () => {
    const res = await submit(request({ create_postgres_db: { enabled: true } }))
    expect(res.status).toHaveBeenCalledWith(400)
    expect(dispatchWorkflow).not.toHaveBeenCalled()
  })
  it('uses the server request ID when no client correlation ID was supplied', async () => {
    const req = request({ correlation_id: undefined })
    await submit(req)
    expect(req.correlationId).toBe('http-request-id')
    metric('aks_deployment_dispatched', { correlation_id: 'http-request-id' })
  })

  it('rejects an invalid correlation ID without logging its content', async () => {
    const res = await submit(request({ correlation_id: `${sensitive}\ninvalid` }))
    expect(res.status).toHaveBeenCalledWith(400)
    metric('aks_deployment_rejected', {
      correlation_id: 'http-request-id', failed_fields: ['correlation_id']
    })
  })

  it('retains correlation and error severity on failed GitHub dispatches without raw errors', async () => {
    dispatchWorkflow.mockRejectedValue(Object.assign(new Error(sensitive), { status: 403 }))
    const res = await submit(request())
    expect(res.status).toHaveBeenCalledWith(500)
    expect(logger.log).toHaveBeenCalledWith('error', 'github_api_call', expect.objectContaining({
      correlation_id: 'aks-logging-test', success: false, status_code: 403
    }))
    metric('aks_deployment_dispatched', {
      correlation_id: 'aks-logging-test', success: false, phase: 'dispatch'
    })
    metric('aks_deployment_failed', { correlation_id: 'aks-logging-test', status_code: 500 })
  })

  it.each(['not_found', 'in_progress', 'success', 'failure', 'error'])(
    'logs polling outcome %s with correlation and duration', async status => {
      vi.spyOn(aksService, 'searchWorkflowByCorrelationId').mockResolvedValue({
        status, conclusion: status === 'success' ? 'success' : null
      })
      await aksService.getDeploymentStatusByCorrelationId('aks-logging-test')
      expect(logger.log).toHaveBeenCalledWith(
        status === 'failure' || status === 'error' ? 'error' : 'info',
        'aks_deployment_status',
        expect.objectContaining({
          correlation_id: 'aks-logging-test', status, duration_ms: expect.any(Number)
        })
      )
    }
  )

  it('links a polling request ID to the original deployment ID', async () => {
    vi.spyOn(aksService, 'getDeploymentStatusByCorrelationId').mockResolvedValue({ status: 'in_progress' })
    const stack = router.stack.find(
      (layer: { route?: { path: string } }) => layer.route?.path === '/aks-status-by-correlation/:correlationId'
    ).route.stack
    const res = { json: vi.fn() }
    await stack[stack.length - 1].handle({
      correlationId: 'poll-request-id',
      params: { correlationId: 'aks-logging-test' }
    }, res)
    metric('aks_status_request_completed', {
      correlation_id: 'aks-logging-test',
      request_correlation_id: 'poll-request-id',
      status: 'in_progress'
    })
  })
})
