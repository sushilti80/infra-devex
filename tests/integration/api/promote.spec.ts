/**
 * Integration tests for POST /api/promote (Move to Infrastructure-Live) and
 * GET /api/infra-live-environments — multi-environment target selection.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import express, { Application, Request, Response, NextFunction } from 'express'
import { createServer, Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)

const githubServiceModule = cjsRequire('../../../services/githubService')
let dispatchCalls: unknown[][] = []
githubServiceModule.triggerWorkflow = async (...args: unknown[]) => {
  dispatchCalls.push(args)
  return { success: true }
}

const authModule = cjsRequire('../../../middleware/auth')
authModule.requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  ;(req as any).user = { email: 'tester@example.com' }
  next()
}

const apiRouter = cjsRequire('../../../routes/api')

let server: Server
let baseUrl: string

const post = (body: object) =>
  fetch(`${baseUrl}/api/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const valid = {
  projectName: 'jobplc',
  environment: 'devsand',
  crNumber: 'CHG0012345',
  environments: ['prod', 'dev'],
}

describe('Move to Infrastructure-Live — /api/promote', () => {
  beforeAll(async () => {
    const app: Application = express()
    app.use(express.json())
    app.use((req: any, _res: Response, next: NextFunction) => {
      req.correlationId = 'test-cid-001'
      next()
    })
    app.use('/api', apiRouter)
    server = createServer(app)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())))
  })

  beforeEach(() => {
    dispatchCalls = []
  })

  it('GET /infra-live-environments returns the default targets without devsand', async () => {
    const res = await fetch(`${baseUrl}/api/infra-live-environments`)
    const body = await res.json()
    expect(body.data).toEqual(['prod', 'stage', 'dev', 'int', 'sint', 'cint', 'hot', 'demo'])
  })

  it('dispatches the workflow with source and comma-separated target environments', async () => {
    const res = await post(valid)
    expect(res.status).toBe(200)
    const inputs = dispatchCalls[0][3] as Record<string, string>
    expect(inputs).toMatchObject({
      application_folder: 'jobplc',
      source_environment: 'devsand',
      target_environments: 'prod,dev',
      cr_number: 'CHG0012345',
    })
  })

  it('de-duplicates target environments', async () => {
    await post({ ...valid, environments: ['prod', 'prod'] })
    expect((dispatchCalls[0][3] as Record<string, string>).target_environments).toBe('prod')
  })

  it.each([
    ['no environments', { environments: [] }],
    ['missing environments', { environments: undefined }],
    ['unknown environment', { environments: ['prod', 'nope'] }],
    ['oversized environments array', { environments: Array(50).fill('prod') }],
    ['path traversal environment', { environments: ['../prod'] }],
    ['unsafe project name', { projectName: 'a;rm -rf /' }],
    ['unsafe CR number', { crNumber: '$(whoami)' }],
  ])('rejects %s with 400 and does not dispatch', async (_label, override) => {
    const res = await post({ ...valid, ...override })
    expect(res.status).toBe(400)
    expect(dispatchCalls).toHaveLength(0)
  })
})
