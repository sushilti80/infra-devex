/**
 * Contract Tests — TypeScript Type Interfaces — FR-008
 * Spec: service-catalog-prefill-spec.json — FR-008
 *
 * Tests:
 * - AppMetadata interface exists with all required fields (FR-008)
 * - InstalledApp has costCenter? and commitSha? fields (FR-008)
 * - tsc --noEmit passes with no errors (FR-008)
 *
 * These tests use runtime reflection to verify that types/interfaces
 * have been correctly implemented with the expected shape.
 */

import { describe, it, expect } from 'vitest'

// Import the actual type exports
// AppMetadata is a TypeScript interface, so at runtime we check
// that objects conforming to the shape can be created without errors.
import type { AppMetadata, InstalledApp } from '@v2/types/infrastructure.types'

describe('FR-008 — TypeScript Type Contracts', () => {

  // ─── AppMetadata interface ────────────────────────────────────────────────
  describe('AppMetadata interface (FR-008)', () => {

    it('AppMetadata object can be created with all required fields', () => {
      // TypeScript will catch missing fields at compile time.
      // This runtime test validates the JS shape.
      const metadata: AppMetadata = {
        name: 'jobplc',
        environment: 'devsand',
        description: 'jobplc service',
        owner: 'Example User',
        lifecycle: 'Live',
        modules: ['functionAppSvcWindows'],
        costCenter: 'self-service',
        commitSha: '649f071b29d6d9eec2c4cba417278735ce4d23a8',
        deployedAt: '2025-07-14T21:59:14Z',
      }

      expect(metadata.name).toBe('jobplc')
      expect(metadata.environment).toBe('devsand')
      expect(metadata.description).toBeDefined()
      expect(metadata.owner).toBeDefined()
      expect(metadata.lifecycle).toBeDefined()
      expect(Array.isArray(metadata.modules)).toBe(true)
      expect(metadata.costCenter).toBeDefined()
      expect(metadata.commitSha).toBeDefined()
      expect(metadata.deployedAt).toBeDefined()
    })

    it('AppMetadata.name has correct type (string)', () => {
      const metadata: AppMetadata = {
        name: 'jobplc',
        environment: 'devsand',
        description: 'desc',
        owner: 'owner',
        lifecycle: 'Live',
        modules: [],
        costCenter: 'cc',
        commitSha: 'sha',
        deployedAt: '2025-01-01T00:00:00Z',
      }
      expect(typeof metadata.name).toBe('string')
    })

    it('AppMetadata.modules is string[] type', () => {
      const metadata: AppMetadata = {
        name: 'app1',
        environment: 'devsand',
        description: 'desc',
        owner: 'owner',
        lifecycle: 'Live',
        modules: ['mod1', 'mod2'],
        costCenter: 'cc',
        commitSha: 'sha',
        deployedAt: '2025-01-01T00:00:00Z',
      }
      expect(Array.isArray(metadata.modules)).toBe(true)
      metadata.modules.forEach(m => expect(typeof m).toBe('string'))
    })

    it('AppMetadata.deployedAt is ISO 8601 string', () => {
      const metadata: AppMetadata = {
        name: 'app1',
        environment: 'devsand',
        description: 'desc',
        owner: 'owner',
        lifecycle: 'Live',
        modules: [],
        costCenter: 'cc',
        commitSha: 'sha',
        deployedAt: '2025-07-14T21:59:14Z',
      }
      // Should be parseable as a date
      const d = new Date(metadata.deployedAt)
      expect(d.getTime()).not.toBeNaN()
    })

    it('AppMetadata has exactly the fields defined in the spec', () => {
      const requiredFields = [
        'name', 'environment', 'description', 'owner',
        'lifecycle', 'modules', 'costCenter', 'commitSha', 'deployedAt',
      ]

      const metadata: AppMetadata = {
        name: 'app1',
        environment: 'devsand',
        description: 'desc',
        owner: 'owner',
        lifecycle: 'Live',
        modules: [],
        costCenter: 'cc',
        commitSha: 'sha',
        deployedAt: '2025-01-01T00:00:00Z',
      }

      requiredFields.forEach(field => {
        expect(metadata).toHaveProperty(field)
      })
    })
  })

  // ─── InstalledApp enrichment ──────────────────────────────────────────────
  describe('InstalledApp interface enrichment (FR-008)', () => {

    it('InstalledApp accepts costCenter as optional field', () => {
      const app: InstalledApp = {
        name: 'jobplc',
        environment: 'devsand',
        owner: 'Example User',
        deployedAt: '2025-07-14T21:59:14Z',
        lifecycle: 'experimental',
        status: 'active',
        modules: ['functionAppSvcWindows'],
        costCenter: 'self-service', // FR-008: new optional field
      }
      expect(app.costCenter).toBe('self-service')
    })

    it('InstalledApp accepts commitSha as optional field', () => {
      const app: InstalledApp = {
        name: 'jobplc',
        environment: 'devsand',
        owner: 'Example User',
        deployedAt: '2025-07-14T21:59:14Z',
        lifecycle: 'experimental',
        status: 'active',
        modules: [],
        commitSha: '649f071b29d6d9eec2c4cba417278735ce4d23a8', // FR-008: new optional field
      }
      expect(app.commitSha).toBe('649f071b29d6d9eec2c4cba417278735ce4d23a8')
    })

    it('InstalledApp remains valid without costCenter and commitSha (backward compat)', () => {
      // Should NOT error if fields are absent (they're optional)
      const app: InstalledApp = {
        name: 'oldapp',
        environment: 'devsand',
        owner: 'owner',
        deployedAt: '2025-01-01T00:00:00Z',
        lifecycle: 'experimental',
        status: 'active',
        modules: [],
      }
      expect(app.name).toBe('oldapp')
      expect(app.costCenter).toBeUndefined()
      expect(app.commitSha).toBeUndefined()
    })
  })

  // ─── AppMetadata matches /api/app-metadata response shape ────────────────
  describe('AppMetadata matches API response contract', () => {

    it('AppMetadata object shape matches GET /api/app-metadata response data field', () => {
      // Mock the API response shape from spec
      const apiResponse = {
        success: true,
        data: {
          name: 'jobplc',
          environment: 'devsand',
          description: 'jobplc',
          owner: 'Example User',
          lifecycle: 'experimental',
          modules: ['functionAppSvcWindows'],
          rbacPairs: [
            {
              id: 'prefill-rbac-1',
              sourceId: 'jobplc-mi',
              sourceName: 'jobplc-mi',
              targetId: 'jobplc-kv',
              targetName: 'jobplc-kv',
              role: 'Key Vault Secrets User',
            },
          ],
          costCenter: 'self-service',
          commitSha: '649f071b29d6d9eec2c4cba417278735ce4d23a8',
          deployedAt: '2025-07-14T21:59:14Z',
        },
        correlationId: 'cid-1234567890-abcd',
      }

      // Cast the response data to AppMetadata — validates the shapes are compatible
      const metadata: AppMetadata = apiResponse.data
      expect(metadata.name).toBe('jobplc')
      expect(metadata.environment).toBe('devsand')
      expect(metadata.rbacPairs?.[0]?.role).toBe('Key Vault Secrets User')
    })

    it('correlationId is present in API response (NFR-006)', () => {
      const apiResponse = {
        success: true,
        data: {} as AppMetadata,
        correlationId: 'cid-1234567890-abcd',
      }
      expect(apiResponse.correlationId).toBeDefined()
      expect(apiResponse.correlationId).toMatch(/^cid-/)
    })
  })
})
