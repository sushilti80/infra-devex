/**
 * Unit Tests — infrastructureService.getApplicationDetails()
 * Spec: service-catalog-prefill-spec.json — FR-007, BE-007 through BE-010
 *
 * FR-007 fix validation:
 * - Primary lookup path: docs/metadata/{projectName}-{environment}.json
 * - Fallback to directory scan only when primary 404
 * - Returns null when both miss
 * - Exactly 1 GitHub call on happy path (NFR-008)
 * - Normalized return shape
 *
 * Strategy (matches established pattern in github-service-create-issue.spec.ts):
 * - CJS require() bypasses vi.mock() interception entirely in Vitest node env
 * - Load singletons via createRequire(import.meta.url) to get the real module
 * - Patch the singleton's properties DIRECTLY in beforeEach (inject mock octokit)
 * - No vi.mock() needed — NODE_ENV=test prevents real GitHub init in constructor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRequire } from 'node:module'

const cjsRequire = createRequire(import.meta.url)

// ─── Load singletons using CJS require (same as the production code uses) ────
const githubService = cjsRequire('../../../services/githubService')
const infrastructureService = cjsRequire('../../../services/infrastructureService')

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeBase64(content: object) {
  return Buffer.from(JSON.stringify(content)).toString('base64')
}

const SAMPLE_METADATA = {
  project: 'jobplc',
  projectName: 'jobplc',
  environment: 'devsand',
  description: 'jobplc service',
  owner: 'Example User',
  lifecycle: 'Live',
  modules: ['functionAppSvcWindows'],
  rbac_pairs: [
    'jobplc-mi|jobplc-kv|Key Vault Secrets User',
  ],
  tags: { costCenter: 'self-service' },
  meta: {
    cost_center: 'self-service',
    commit_sha: '649f071b29d6d9eec2c4cba417278735ce4d23a8',
    deployed_at: '2025-07-14T21:59:14Z',
    description: 'jobplc service',
    owner: 'Example User',
    lifecycle: 'Live',
  },
  createdAt: '2025-07-14T21:59:14Z',
}

// ─────────────────────────────────────────────────────────────────────────────

describe('infrastructureService.getApplicationDetails() — FR-007 Bug Fix', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc: any = infrastructureService
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gs: any = githubService
  let mockGetContent: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockGetContent = vi.fn()

    // Inject a fresh mock octokit into the githubService singleton for each test
    // (Same pattern as github-service-create-issue.spec.ts)
    gs.octokit = {
      rest: {
        repos: {
          getContent: mockGetContent,
        },
      },
    }
    gs.initialized = true
    gs.initialize = vi.fn().mockResolvedValue(undefined)
  })

  // ─── BE-007: Primary lookup path ─────────────────────────────────────────
  describe('BE-007 — Primary lookup uses correct file path (FR-007 fix)', () => {
    it('calls getContent with docs/metadata/jobplc-devsand.json as primary path', async () => {
      mockGetContent.mockResolvedValueOnce({
        data: { content: makeBase64(SAMPLE_METADATA), type: 'file' },
      })

      await svc.getApplicationDetails('jobplc', 'devsand')

      // FR-007: Primary lookup must use {projectName}-{environment}.json
      expect(mockGetContent).toHaveBeenCalled()
      const firstCallPath = mockGetContent.mock.calls[0]?.[0]?.path
      expect(firstCallPath).toBe('docs/metadata/jobplc-devsand.json')
    })

    it('does NOT use the old broken path docs/metadata/jobplc.json', async () => {
      mockGetContent.mockResolvedValueOnce({
        data: { content: makeBase64(SAMPLE_METADATA), type: 'file' },
      })

      await svc.getApplicationDetails('jobplc', 'devsand')

      const calledPaths = mockGetContent.mock.calls.map((c: any[]) => c[0]?.path)
      expect(calledPaths).not.toContain('docs/metadata/jobplc.json')
    })
  })

  // ─── BE-010 / NFR-008: No N+1 calls ──────────────────────────────────────
  describe('BE-010 / NFR-008 — Exactly 1 GitHub call when primary succeeds', () => {
    it('makes exactly 1 getContent call when primary file exists', async () => {
      mockGetContent.mockResolvedValueOnce({
        data: { content: makeBase64(SAMPLE_METADATA), type: 'file' },
      })

      await svc.getApplicationDetails('jobplc', 'devsand')

      expect(mockGetContent).toHaveBeenCalledTimes(1)
    })
  })

  // ─── BE-009: Both paths miss → returns null ───────────────────────────────
  describe('BE-009 — Returns null when both primary and fallback miss', () => {
    it('returns null when primary 404 and no matching file in fallback', async () => {
      const notFound = Object.assign(new Error('Not Found'), { status: 404 })
      mockGetContent
        .mockRejectedValueOnce(notFound) // primary misses
        .mockResolvedValueOnce({         // directory listing
          data: [{ type: 'file', name: 'otherapp-devsand.json', path: 'docs/metadata/otherapp-devsand.json' }],
        })
        .mockResolvedValueOnce({         // otherapp file content (wrong app)
          data: { content: makeBase64({ project: 'otherapp', environment: 'devsand' }), type: 'file' },
        })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')
      expect(result).toBeNull()
    })

    it('returns null when error occurs during getApplicationDetails', async () => {
      const fatal = Object.assign(new Error('Server error'), { status: 500 })
      mockGetContent.mockRejectedValueOnce(fatal)

      const result = await svc.getApplicationDetails('jobplc', 'devsand')
      expect(result).toBeNull()
    })
  })

  // ─── FR-007: Normalized return shape ─────────────────────────────────────
  describe('FR-007 — Normalized return shape', () => {
    it('returns object with all required AppMetadata fields', async () => {
      mockGetContent.mockResolvedValueOnce({
        data: { content: makeBase64(SAMPLE_METADATA), type: 'file' },
      })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result).not.toBeNull()
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('environment')
      expect(result).toHaveProperty('description')
      expect(result).toHaveProperty('owner')
      expect(result).toHaveProperty('lifecycle')
      expect(result).toHaveProperty('modules')
      expect(result).toHaveProperty('rbacPairs')
      expect(result).toHaveProperty('costCenter')
      expect(result).toHaveProperty('commitSha')
      expect(result).toHaveProperty('deployedAt')
    })

    it('normalizes name from projectName or project field', async () => {
      mockGetContent.mockResolvedValueOnce({
        data: { content: makeBase64(SAMPLE_METADATA), type: 'file' },
      })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result).not.toBeNull()
      expect(result.name).toBe('jobplc')
    })

    it('normalizes modules to an array', async () => {
      mockGetContent.mockResolvedValueOnce({
        data: { content: makeBase64(SAMPLE_METADATA), type: 'file' },
      })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result).not.toBeNull()
      expect(Array.isArray(result.modules)).toBe(true)
    })

    it('normalizes rbac_pairs to frontend restore shape', async () => {
      mockGetContent.mockResolvedValueOnce({
        data: { content: makeBase64(SAMPLE_METADATA), type: 'file' },
      })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result).not.toBeNull()
      expect(result.rbacPairs).toEqual([
        {
          id: 'prefill-rbac-1',
          sourceId: 'jobplc-mi',
          sourceName: 'jobplc-mi',
          targetId: 'jobplc-kv',
          targetName: 'jobplc-kv',
          role: 'Key Vault Secrets User',
          description: undefined,
        },
      ])
    })

    it('normalizes canonical pipe-delimited rbac_pairs (multiple pairs)', async () => {
      const META = {
        ...SAMPLE_METADATA,
        rbac_pairs: [
          'appServiceWindows|appConfiguration|App Configuration Data Reader',
          'appConfiguration|keyvault|Key Vault Secrets User',
          'appServiceWindows|keyvault|Key Vault Secrets User',
        ],
      }
      mockGetContent.mockResolvedValueOnce({
        data: { content: makeBase64(META), type: 'file' },
      })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result.rbacPairs).toEqual([
        {
          id: 'prefill-rbac-1',
          sourceId: 'appServiceWindows',
          sourceName: 'appServiceWindows',
          targetId: 'appConfiguration',
          targetName: 'appConfiguration',
          role: 'App Configuration Data Reader',
          description: undefined,
        },
        {
          id: 'prefill-rbac-2',
          sourceId: 'appConfiguration',
          sourceName: 'appConfiguration',
          targetId: 'keyvault',
          targetName: 'keyvault',
          role: 'Key Vault Secrets User',
          description: undefined,
        },
        {
          id: 'prefill-rbac-3',
          sourceId: 'appServiceWindows',
          sourceName: 'appServiceWindows',
          targetId: 'keyvault',
          targetName: 'keyvault',
          role: 'Key Vault Secrets User',
          description: undefined,
        },
      ])
    })

    it('normalizes costCenter from meta.cost_center', async () => {
      mockGetContent.mockResolvedValueOnce({
        data: { content: makeBase64(SAMPLE_METADATA), type: 'file' },
      })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result).not.toBeNull()
      expect(result.costCenter).toBeTruthy()
    })

    it('normalizes commitSha from meta.commit_sha', async () => {
      mockGetContent.mockResolvedValueOnce({
        data: { content: makeBase64(SAMPLE_METADATA), type: 'file' },
      })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result).not.toBeNull()
      expect(result.commitSha).toBe('649f071b29d6d9eec2c4cba417278735ce4d23a8')
    })
  })

  // ─── BE-008: Fallback to directory scan ──────────────────────────────────
  describe('BE-008 — Fallback to directory scan when primary returns 404', () => {
    it('makes multiple getContent calls when primary returns 404 (directory scan)', async () => {
      const notFound = Object.assign(new Error('Not Found'), { status: 404 })
      mockGetContent
        .mockRejectedValueOnce(notFound) // primary path fails with 404
        .mockResolvedValueOnce({         // directory listing
          data: [{ type: 'file', name: 'jobplc-devsand.json', path: 'docs/metadata/jobplc-devsand.json' }],
        })
        .mockResolvedValueOnce({         // file content from fallback
          data: { content: makeBase64(SAMPLE_METADATA), type: 'file' },
        })

      await svc.getApplicationDetails('jobplc', 'devsand')

      expect(mockGetContent.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('finds correct app in directory scan fallback', async () => {
      const notFound = Object.assign(new Error('Not Found'), { status: 404 })
      mockGetContent
        .mockRejectedValueOnce(notFound) // primary misses
        .mockResolvedValueOnce({         // directory listing has ONE matching file
          data: [{ type: 'file', name: 'jobplc-devsand.json', path: 'docs/metadata/jobplc-devsand.json' }],
        })
        .mockResolvedValueOnce({         // matching file content
          data: { content: makeBase64(SAMPLE_METADATA), type: 'file' },
        })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result).not.toBeNull()
      expect(result.name).toBe('jobplc')
    })
  })

  // ─── Bug: quote-wrapped values in edit prefill ────────────────────────────
  describe('Quote stripping — upstream metadata wrapped in literal quotes', () => {
    it('strips wrapping quotes from module names (string form)', async () => {
      const META = { ...SAMPLE_METADATA, modules: '"appServiceWindows-1", "keyvault"' }
      mockGetContent.mockResolvedValueOnce({ data: { content: makeBase64(META), type: 'file' } })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result.modules).toEqual(['appServiceWindows-1', 'keyvault'])
    })

    it('strips wrapping quotes from module names (array form)', async () => {
      const META = { ...SAMPLE_METADATA, modules: ['"appServiceWindows-1"', "'keyvault'"] }
      mockGetContent.mockResolvedValueOnce({ data: { content: makeBase64(META), type: 'file' } })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result.modules).toEqual(['appServiceWindows-1', 'keyvault'])
    })

    it('strips wrapping quotes from pipe-delimited rbac_pairs', async () => {
      const META = {
        ...SAMPLE_METADATA,
        rbac_pairs: ['"jobplc-mi"|"jobplc-kv"|"Key Vault Secrets User"'],
      }
      mockGetContent.mockResolvedValueOnce({ data: { content: makeBase64(META), type: 'file' } })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result.rbacPairs[0]).toMatchObject({
        sourceName: 'jobplc-mi',
        targetName: 'jobplc-kv',
        role: 'Key Vault Secrets User',
      })
    })

    it('strips wrapping quotes from name/description/owner fields', async () => {
      const META = { ...SAMPLE_METADATA, projectName: '"jobplc"', description: '"jobplc service"', owner: '"Example User"' }
      mockGetContent.mockResolvedValueOnce({ data: { content: makeBase64(META), type: 'file' } })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result.name).toBe('jobplc')
      expect(result.description).toBe('jobplc service')
      expect(result.owner).toBe('Example User')
    })

    it('does not strip an internal apostrophe (e.g. "O\'Brien")', async () => {
      const META = { ...SAMPLE_METADATA, owner: "O'Brien" }
      mockGetContent.mockResolvedValueOnce({ data: { content: makeBase64(META), type: 'file' } })

      const result = await svc.getApplicationDetails('jobplc', 'devsand')

      expect(result.owner).toBe("O'Brien")
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Pure unit tests — no mocks needed
// ─────────────────────────────────────────────────────────────────────────────
describe('getApplicationDetails — Input validation and path logic (pure unit)', () => {
  it('appName regex /^[a-zA-Z0-9]{1,8}$/ validates correctly', () => {
    const APP_NAME_REGEX = /^[a-zA-Z0-9]{1,8}$/
    expect(APP_NAME_REGEX.test('jobplc')).toBe(true)
    expect(APP_NAME_REGEX.test('toolongname')).toBe(false)
    expect(APP_NAME_REGEX.test('../etc')).toBe(false)
    expect(APP_NAME_REGEX.test('')).toBe(false)
    expect(APP_NAME_REGEX.test('exactly8')).toBe(true)
    expect(APP_NAME_REGEX.test('123456789')).toBe(false)
  })

  it('primary path construction produces correct filename', () => {
    const buildPrimaryPath = (proj: string, env: string) =>
      `docs/metadata/${proj}-${env}.json`
    expect(buildPrimaryPath('jobplc', 'devsand')).toBe('docs/metadata/jobplc-devsand.json')
    expect(buildPrimaryPath('webapp01', 'sand')).toBe('docs/metadata/webapp01-sand.json')
  })
})
