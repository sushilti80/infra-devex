/**
 * BT-01 (shipValidators) + BT-03 (flag gating in config / environments.json) — spec §9.1.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const config = cjsRequire('../../../config')
const v = cjsRequire('../../../utils/shipValidators')
const { isPlatformMember } = cjsRequire('../../../utils/platformTeam')
const { v7 } = cjsRequire('uuid')

async function run(chains: any[], req: any) {
  for (const chain of chains) await chain.run(req)
  const { validationResult } = cjsRequire('express-validator')
  const errs = validationResult(req).array()
  return errs.map((e: any) => e.path)
}

const good = { repo: 'organization/my-svc', branch: 'main', app: 'my-app', env: 'devsand' }
let saved: any
beforeEach(() => {
  saved = { orgs: config.ship.allowedOrgs, envs: config.ship.supportedShipEnvironments, extra: config.ship.reservedNamespaces }
  config.ship.allowedOrgs = ['organization']
  config.ship.supportedShipEnvironments = ['devsand']
  config.ship.reservedNamespaces = []
})
afterEach(() => {
  config.ship.allowedOrgs = saved.orgs
  config.ship.supportedShipEnvironments = saved.envs
  config.ship.reservedNamespaces = saved.extra
})

describe('BT-01 shipValidators — POST body', () => {
  const start = (body: any) => run(v.startShipValidators, { body })

  it('accepts a minimal valid body', async () => {
    expect(await start(good)).toEqual([])
  })

  it('rejects missing/mistyped required fields', async () => {
    expect(await start({})).toEqual(expect.arrayContaining(['repo', 'branch', 'app', 'env']))
    expect(await start({ ...good, repo: ['a/b'], branch: { x: 1 }, app: 5 })).toEqual(expect.arrayContaining(['repo', 'branch', 'app']))
  })

  describe('repo', () => {
    it.each(['https://github.com/organization/x', 'organization', 'organization/', '/x', 'organization/x/y', 'organization/..', 'organization/.', 'organization/x.git', 'organization/x y', 'organization/x\n', '-bad/x', 'Other/x'])(
      'rejects %j', async (repo) => { expect(await start({ ...good, repo })).toContain('repo') })
    it('org match is case-insensitive and canonicalised from the allowlist', () => {
      expect(v.parseRepo('organization/Svc')).toMatchObject({ ok: true, fullName: 'organization/Svc' })
      expect(v.pickStartBody({ ...good, repo: 'ORGANIZATION/svc' }).repo).toBe('organization/svc')
    })
    it('empty org allowlist rejects everything (fail closed)', async () => {
      config.ship.allowedOrgs = []
      expect(await start(good)).toContain('repo')
    })
  })

  describe('branch (git-ref rules)', () => {
    it.each(['feature/x', 'release-1.2', 'a.b_c', 'main'])('accepts %s', async (branch) => { expect(await start({ ...good, branch })).toEqual([]) })
    it.each(['', 'a..b', 'a//b', '-x', '/x', 'x/', 'x.', 'x.lock', 'a@{b', 'a b', 'a;b', 'a\nb', '$(id)', 'a`b`', 'x'.repeat(201), "a'b", 'a"b', 'a\\b'])(
      'rejects %j', async (branch) => { expect(await start({ ...good, branch })).toContain('branch') })
  })

  describe('app / namespace / teamLabel (DNS-1123)', () => {
    it.each(['a', 'my-app', 'a1', 'x'.repeat(63)])('accepts %s', async (app) => { expect(await start({ ...good, app })).toEqual([]) })
    it.each(['', 'My-App', '-a', 'a-', 'a_b', 'a.b', 'x'.repeat(64), 'a b', 'a;b', '$(x)'])('rejects app %j', async (app) => {
      expect(await start({ ...good, app })).toContain('app')
    })
    it('namespace and teamLabel use the same rule', async () => {
      expect(await start({ ...good, namespace: 'Bad_NS', teamLabel: 'Bad Team' })).toEqual(expect.arrayContaining(['namespace', 'teamLabel']))
      expect(await start({ ...good, namespace: 'team-ns', teamLabel: 'platform' })).toEqual([])
    })
  })

  describe('reserved namespaces', () => {
    it.each(['kube-system', 'kube-public', 'flux-system', 'default', 'cert-manager', 'ingress-nginx'])('rejects namespace %s', async (namespace) => {
      expect(await start({ ...good, namespace })).toContain('namespace')
    })
    it('rejects an app whose default namespace is reserved', async () => {
      expect(await start({ ...good, app: 'kube-system' })).toContain('app')
      expect(await start({ ...good, app: 'default' })).toContain('app')
    })
    it('honours configured extras (exact and trailing-*)', async () => {
      config.ship.reservedNamespaces = ['monitoring', 'infra-*']
      expect(await start({ ...good, namespace: 'monitoring' })).toContain('namespace')
      expect(await start({ ...good, namespace: 'infra-tools' })).toContain('namespace')
      expect(await start({ ...good, namespace: 'monitoring2' })).toEqual([])
    })
    it('does not reject lookalikes', async () => {
      expect(await start({ ...good, namespace: 'kubernetes-app' })).toEqual([])
      expect(await start({ ...good, namespace: 'defaults' })).toEqual([])
    })
  })

  describe('port / healthPath / bump', () => {
    it.each([1024, 8080, 65535, '3000'])('accepts port %s', async (port) => { expect(await start({ ...good, port })).toEqual([]) })
    it.each([0, 80, 1023, 65536, 80.5, '80a', '', -1, null, 'abc', [8080], '1e3'])('rejects port %j', async (port) => {
      expect(await start({ ...good, port })).toContain('port')
    })
    it.each(['/', '/healthz', '/api/v1/health', '/a.b_c~d-e'])('accepts healthPath %s', async (healthPath) => { expect(await start({ ...good, healthPath })).toEqual([]) })
    it.each(['healthz', '/a b', "/a'b", '/a"b', '/$x', '/`x`', '/{x}', '/a;b', '/a\nb', '/' + 'x'.repeat(255), '/a?b=1', '/a\\b', '/a&b'])('rejects healthPath %j', async (healthPath) => {
      expect(await start({ ...good, healthPath })).toContain('healthPath')
    })
    it.each(['patch', 'minor', 'major'])('accepts bump %s', async (bump) => { expect(await start({ ...good, bump })).toEqual([]) })
    it.each(['PATCH', 'x', '', 'patch;ls'])('rejects bump %j', async (bump) => { expect(await start({ ...good, bump })).toContain('bump') })
  })

  describe('env (flag gating)', () => {
    it('rejects an env without features.shipFromRepo', async () => {
      expect(await start({ ...good, env: 'sand' })).toContain('env')
      expect(await start({ ...good, env: 'nope' })).toContain('env')
    })
    it('rejects everything when no env is flagged', async () => {
      config.ship.supportedShipEnvironments = []
      expect(await start(good)).toContain('env')
    })
  })

  it('NFR-004 fuzz: injection payloads are rejected in every interpolated field', async () => {
    const payloads = ['$(curl evil)', '`id`', '"; rm -rf /; "', "' OR '1'='1", '${{ secrets.X }}', '\r\nX-Header: 1', '../../etc/passwd', '%0a', '{{7*7}}', '<script>', 'a\u0000b', '\u202e']
    for (const p of payloads) {
      for (const field of ['branch', 'app', 'namespace', 'teamLabel', 'healthPath', 'bump', 'port']) {
        expect(await start({ ...good, [field]: p }), `${field}=${JSON.stringify(p)}`).toContain(field)
      }
    }
  })

  it('pickStartBody applies defaults and discards non-whitelisted keys', () => {
    const picked = v.pickStartBody({ ...good, triggeredBy: 'x', correlationId: 'y', requesterLogin: 'z', triggered_by_oid: 'o', mode: 'config_only' })
    expect(picked).toEqual({ repo: 'organization/my-svc', branch: 'main', app: 'my-app', env: 'devsand', namespace: 'my-app', teamLabel: 'software-engineering', port: 8080, healthPath: '/healthz', bump: 'patch' })
  })
})

describe('BT-01 shipValidators — other inputs', () => {
  it('correlationId must be a UUIDv7', async () => {
    expect(await run(v.shipIdParam, { params: { correlationId: v7() } })).toEqual([])
    expect(await run(v.shipIdParam, { params: { correlationId: '3f1d8b0e-6a3c-4b83-9d0a-0d5f8e2d9c11' } })).toEqual(['correlationId'])
    expect(await run(v.shipIdParam, { params: { correlationId: 'cid-123' } })).toEqual(['correlationId'])
  })
  it('logs query: stage whitelist, offset int >= 0', async () => {
    expect(await run(v.logsQuery, { query: { stage: 'config_pr', offset: '10' } })).toEqual([])
    expect(await run(v.logsQuery, { query: { stage: 'config' } })).toContain('stage')
    expect(await run(v.logsQuery, { query: { stage: 'build', offset: '-1' } })).toContain('offset')
    expect(await run(v.logsQuery, { query: { stage: 'build', offset: 'x' } })).toContain('offset')
    expect(await run(v.logsQuery, { query: { stage: 'build', download: '2' } })).toContain('download')
  })
  it('repos query: q charset/length, limit 1-500', async () => {
    expect(await run(v.reposQuery, { query: { q: 'my-repo', limit: '500' } })).toEqual([])
    expect(await run(v.reposQuery, { query: { q: 'a b' } })).toContain('q')
    expect(await run(v.reposQuery, { query: { q: 'x'.repeat(101) } })).toContain('q')
    expect(await run(v.reposQuery, { query: { limit: '501' } })).toContain('limit')
    expect(await run(v.reposQuery, { query: { limit: '0' } })).toContain('limit')
  })
  it('branches params: org must be allowlisted (AC-001-6), repo valid', async () => {
    expect(await run(v.branchesParams, { params: { org: 'organization', repo: 'svc' }, query: {} })).toEqual([])
    expect(await run(v.branchesParams, { params: { org: 'evil', repo: 'svc' }, query: {} })).toContain('org')
    expect(await run(v.branchesParams, { params: { org: 'organization', repo: '..' }, query: {} })).toContain('org')
    expect(await run(v.branchesParams, { params: { org: 'organization', repo: 'svc' }, query: { page: '0' } })).toContain('page')
  })
  it('app-state params', async () => {
    expect(await run(v.appStateParams, { params: { env: 'devsand', app: 'a1' }, query: { repo: 'organization/x' } })).toEqual([])
    expect(await run(v.appStateParams, { params: { env: 'sand', app: 'A!' }, query: { repo: 'x' } })).toEqual(expect.arrayContaining(['env', 'app', 'repo']))
  })
  it('sanitizeActor lower-cases and maps odd chars; collisions are possible (so never an auth key)', () => {
    expect(v.sanitizeActor('Alex.Smith@x.com')).toBe('alex.smith@x.com')
    expect(v.sanitizeActor("O'Brien@x")).toBe('o_brien@x')
    expect(v.sanitizeActor("o_brien@x")).toBe(v.sanitizeActor("O'Brien@x"))
    expect(v.sanitizeActor(undefined)).toBe('')
  })
  it('handleValidation returns a 400 VALIDATION_FAILED envelope', async () => {
    const req: any = { body: {}, correlationId: 'rid' }
    await run(v.startShipValidators, req)
    const res: any = { status(c: number) { this.code = c; return this }, json(b: any) { this.body = b; return this } }
    v.handleValidation(req, res, () => { throw new Error('should not continue') })
    expect(res.code).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.map((d: any) => d.field)).toContain('repo')
    expect(res.body.success).toBe(false)
  })
})

describe('BT-03 flag gating (config + environments.json)', () => {
  const catalog = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'data/environments.json'), 'utf8'))

  it('environments.json carries features.shipFromRepo=false on devsand only until Phase 4 gates pass', () => {
    const withKey = catalog.environments.filter((e: any) => 'shipFromRepo' in (e.features || {}))
    expect(withKey.map((e: any) => e.id)).toEqual(['devsand'])
    expect(withKey[0].features.shipFromRepo).toBe(false)
  })
  it('config.ship.supportedShipEnvironments derives from enabled ∧ aks ∧ shipFromRepo (empty while flag is false)', () => {
    const expected = catalog.environments.filter((e: any) => e.enabled && e.features?.aks && e.features?.shipFromRepo === true).map((e: any) => e.id)
    expect(saved.envs).toEqual(expected)
    expect(saved.envs).toEqual([])
  })
  it('defaults are fail-closed', () => {
    expect(config.ship.identityProvider).toBe('none')
    expect(saved.orgs).toEqual([])
    expect(config.ship.platformRoles).toEqual([])
    expect(config.ship.watchdogCancelEnabled).toBe(false)
    expect(config.ship.acrReadEnabled).toBe(false)
    expect(config.ship.allowDefaultRef).toBe(false)
    expect(config.ship.previewHosts).toEqual({})
  })
})

describe('platformTeam.isPlatformMember', () => {
  it('empty config → nobody qualifies', () => {
    config.ship.platformRoles = []; config.ship.platformGroupIds = []
    expect(isPlatformMember({ roles: ['Admin'], groups: ['g1'] })).toBe(false)
    expect(isPlatformMember(undefined)).toBe(false)
  })
  it('matches configured roles or group ids', () => {
    config.ship.platformRoles = ['Platform.Admin']; config.ship.platformGroupIds = ['g-1']
    expect(isPlatformMember({ roles: ['Platform.Admin'], groups: [] })).toBe(true)
    expect(isPlatformMember({ roles: [], groups: ['g-1'] })).toBe(true)
    expect(isPlatformMember({ roles: ['Other'], groups: ['g-2'] })).toBe(false)
    expect(isPlatformMember({})).toBe(false)
    config.ship.platformRoles = []; config.ship.platformGroupIds = []
  })
})
