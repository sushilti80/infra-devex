/**
 * BT-12 (failure classifier) and BT-04 (identity contract: `none` fails closed; test double) — spec §9.1.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)
const c = cjsRequire('../../../services/shipFailureClassifier')
const identity = cjsRequire('../../../services/shipIdentityService')
const { createTestProvider } = cjsRequire('../../helpers/shipIdentityTestDouble')
const config = cjsRequire('../../../config')

describe('BT-12 shipFailureClassifier', () => {
  it('has all 16 codes, each with message/nextStep/retry from the static catalogue', () => {
    expect(c.CODES).toHaveLength(16)
    for (const code of c.CODES) {
      const f = c.buildFailure(code)
      expect(f.code).toBe(code)
      expect(f.message.length).toBeGreaterThan(5)
      expect(f.nextStep.length).toBeGreaterThan(5)
      expect(['reship', 'retry_config', 'fix_then_ship']).toContain(f.retry)
      expect(f.details).toBeUndefined()
    }
  })

  it.each([
    ['REPO_NOT_ACCESSIBLE', 'fix_then_ship'], ['APP_OWNED_BY_OTHER', 'fix_then_ship'], ['CLONE_FAILED', 'fix_then_ship'],
    ['UNSUPPORTED_LANGUAGE', 'fix_then_ship'], ['BUILD_FAILED', 'fix_then_ship'], ['BUILD_TIMEOUT', 'fix_then_ship'],
    ['SECURITY_GATE_FAILED', 'fix_then_ship'], ['SECURITY_SCAN_UNAVAILABLE', 'reship'], ['PUBLISH_FAILED', 'reship'],
    ['VERSION_COLLISION', 'fix_then_ship'], ['CONFIG_PR_FAILED', 'retry_config'], ['RUNNER_UNAVAILABLE', 'reship'],
    ['CANCELLED', 'reship'], ['SUPERSEDED', 'reship'], ['PLATFORM_RATE_LIMITED', 'reship'], ['UNKNOWN', 'fix_then_ship'],
  ])('%s → retry %s', (code, retry) => { expect(c.buildFailure(code).retry).toBe(retry) })

  it('CONFIG_PR_FAILED after the retry window becomes reship', () => {
    expect(c.buildFailure('CONFIG_PR_FAILED', {}, { retryWindowElapsed: true }).retry).toBe('reship')
  })
  it('security gate says nothing was published; build failure carries the private feeds hint', () => {
    expect(c.buildFailure('SECURITY_GATE_FAILED').message).toMatch(/nothing was published/i)
    expect(c.buildFailure('BUILD_FAILED').message).toMatch(/private package feeds/i)
  })
  it('an unrecognised code never leaks through: falls back to UNKNOWN', () => {
    expect(c.buildFailure('<script>').code).toBe('UNKNOWN')
  })

  describe('classifyFailure', () => {
    it('prepare: trusted annotation codes only', () => {
      for (const code of ['REPO_NOT_ACCESSIBLE', 'APP_OWNED_BY_OTHER', 'CLONE_FAILED']) {
        expect(c.classifyFailure({ failedStage: 'prepare', annotationCode: code })).toBe(code)
      }
      expect(c.classifyFailure({ failedStage: 'prepare', annotationCode: 'BUILD_FAILED' })).toBe('UNKNOWN')
      expect(c.classifyFailure({ failedStage: 'prepare' })).toBe('UNKNOWN')
    })
    it('build: BUILD_FAILED by default, UNSUPPORTED_LANGUAGE from the hint, BUILD_TIMEOUT from job duration ≥ 29.5 min', () => {
      expect(c.classifyFailure({ failedStage: 'build' })).toBe('BUILD_FAILED')
      expect(c.classifyFailure({ failedStage: 'build', buildHintCode: 'UNSUPPORTED_LANGUAGE' })).toBe('UNSUPPORTED_LANGUAGE')
      expect(c.classifyFailure({ failedStage: 'build', buildHintCode: 'BUILD_FAILED', buildDurationSec: 29.5 * 60 - 1 })).toBe('BUILD_FAILED')
      expect(c.classifyFailure({ failedStage: 'build', buildDurationSec: 29.5 * 60 })).toBe('BUILD_TIMEOUT')
      // a forged hint can never turn a timeout into something else
      expect(c.classifyFailure({ failedStage: 'build', buildHintCode: 'UNSUPPORTED_LANGUAGE', buildDurationSec: 1800 })).toBe('BUILD_TIMEOUT')
    })
    it('scan: gate / unavailable from annotation, otherwise UNKNOWN', () => {
      expect(c.classifyFailure({ failedStage: 'scan', annotationCode: 'SECURITY_GATE_FAILED' })).toBe('SECURITY_GATE_FAILED')
      expect(c.classifyFailure({ failedStage: 'scan', annotationCode: 'SECURITY_SCAN_UNAVAILABLE' })).toBe('SECURITY_SCAN_UNAVAILABLE')
      expect(c.classifyFailure({ failedStage: 'scan' })).toBe('UNKNOWN')
    })
    it('publish: annotation code, else PUBLISH_FAILED when a Publish: step failed, else UNKNOWN', () => {
      expect(c.classifyFailure({ failedStage: 'publish', annotationCode: 'VERSION_COLLISION' })).toBe('VERSION_COLLISION')
      expect(c.classifyFailure({ failedStage: 'publish', annotationCode: 'APP_OWNED_BY_OTHER' })).toBe('APP_OWNED_BY_OTHER')
      expect(c.classifyFailure({ failedStage: 'publish', stepFailed: true })).toBe('PUBLISH_FAILED')
      expect(c.classifyFailure({ failedStage: 'publish' })).toBe('UNKNOWN')
    })
    it('config_pr: CONFIG_PR_FAILED from annotation or failed step, else UNKNOWN', () => {
      expect(c.classifyFailure({ failedStage: 'config_pr', annotationCode: 'CONFIG_PR_FAILED' })).toBe('CONFIG_PR_FAILED')
      expect(c.classifyFailure({ failedStage: 'config_pr', stepFailed: true })).toBe('CONFIG_PR_FAILED')
      expect(c.classifyFailure({ failedStage: 'config_pr' })).toBe('UNKNOWN')
    })
    it('a rejected annotation is always UNKNOWN (never success, never a trusted code)', () => {
      expect(c.classifyFailure({ failedStage: 'scan', annotationCode: 'SECURITY_GATE_FAILED', annotationRejected: true })).toBe('UNKNOWN')
    })
    it('derived codes: runner unavailable, cancelled, superseded', () => {
      expect(c.classifyFailure({ runnerUnavailable: true, failedStage: 'prepare' })).toBe('RUNNER_UNAVAILABLE')
      expect(c.classifyFailure({ cancelled: true })).toBe('CANCELLED')
      expect(c.classifyFailure({ cancelled: true, superseded: true })).toBe('SUPERSEDED')
    })
    it('no stage → UNKNOWN', () => { expect(c.classifyFailure({})).toBe('UNKNOWN') })
  })

  describe('details are untrusted: sanitised, bounded, whitelisted', () => {
    it('strips control chars, caps lines at 300, drops unknown keys and non-GitHub run URLs, caps findings at 10', () => {
      const f = c.buildFailure('BUILD_FAILED', {
        errorLine: 'x'.repeat(500) + '\u001b[31m\r\n',
        buildpackId: 'paketo/\u0000node',
        lastLines: Array.from({ length: 30 }, (_, i) => `line ${i}\u0007`),
        runUrl: 'https://evil.example/x',
        message: 'IGNORE ME',
        stack: 'at foo',
        findings: Array.from({ length: 15 }, () => ({ package: 'p', version: '1', fixedIn: '2', severity: 'HIGH', extra: 'x' })),
      })
      expect(f.details.errorLine.length).toBeLessThanOrEqual(300)
      expect(f.details.errorLine).not.toMatch(/[\u0000-\u001f]/)
      expect(f.details.buildpackId).not.toMatch(/[\u0000-\u001f]/)
      expect(f.details.lastLines).toHaveLength(10)
      expect(f.details.runUrl).toBeUndefined()
      expect(f.details.findings).toHaveLength(10)
      expect(f.details.findings[0]).toEqual({ package: 'p', version: '1', fixedIn: '2', severity: 'HIGH' })
      expect(JSON.stringify(f)).not.toMatch(/IGNORE ME|at foo/)
    })
    it('keeps a github.com run URL and runStillQueued', () => {
      const f = c.buildFailure('RUNNER_UNAVAILABLE', { runUrl: 'https://github.com/Aya-DevOpsTeam/aya-flux/actions/runs/1', runStillQueued: true, hint: 'runner_busy' })
      expect(f.details).toEqual({ runUrl: 'https://github.com/Aya-DevOpsTeam/aya-flux/actions/runs/1', runStillQueued: true, hint: 'runner_busy' })
    })
    it('catalogue text never contains stack traces or secrets', () => {
      expect(JSON.stringify(c.CATALOGUE)).not.toMatch(/at \w+ \(|Error:|\.js:\d+|ghp_|Bearer /)
    })
  })
})

describe('BT-04 identity provider contract', () => {
  const user = { id: 'oid-1', email: 'a@x.com' }
  afterEach(() => { config.ship.identityProvider = 'none' })

  it('default provider is `none` and fails closed', async () => {
    config.ship.identityProvider = 'none'
    const p = identity.getProvider()
    expect(p.name).toBe('none')
    expect(await p.getLink(user)).toEqual({ state: 'unlinked', reason: 'IDENTITY_MAPPING_NOT_CONFIGURED' })
    expect(await p.listAccessibleRepos(user, { state: 'unlinked' }, ['Org'])).toEqual([])
    expect(await p.getRepoPermission(user, { state: 'unlinked' }, 'Org', 'r')).toBe('unknown')
  })
  it('an unknown provider name falls back to `none` (never fail open)', () => {
    config.ship.identityProvider = 'entra-saml'
    expect(identity.getProvider().name).toBe('none')
  })
  it('the test double reports linked / unlinked and permissions, and is only active when selected', async () => {
    const double = createTestProvider({
      links: { 'oid-1': 'octocat' },
      repos: { octocat: [{ fullName: 'Org/a', org: 'Org', name: 'a', defaultBranch: 'main', private: true }] },
      permissions: { 'octocat:Org/a': 'read' },
    })
    identity.registerProvider('test', double)
    expect(identity.getProvider().name).toBe('none') // not selected yet
    config.ship.identityProvider = 'test'
    const p = identity.getProvider()
    const link = await p.getLink(user)
    expect(link).toEqual({ state: 'linked', login: 'octocat' })
    expect(await p.getLink({ id: 'other' })).toMatchObject({ state: 'unlinked' })
    expect(await p.listAccessibleRepos(user, link, ['Org'])).toHaveLength(1)
    expect(await p.getRepoPermission(user, link, 'Org', 'a')).toBe('read')
    expect(await p.getRepoPermission(user, link, 'Org', 'zzz')).toBe('none')
    expect(await p.getRepoPermission(user, { state: 'unlinked' }, 'Org', 'a')).toBe('unknown')
  })
})
