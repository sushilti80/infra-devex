/**
 * Unit Tests — CustomInfrastructurePage.vue Auto-Load Path (Edit Flow)
 *
 * Since the AppSelector manual picker has been removed from the Custom Infra page,
 * pre-fill is exclusively triggered via the navigation store context set by the
 * Edit Infrastructure button on InstalledAppsPage (FR-003 / FR-004).
 *
 * Tests covered:
 * - No context → blank wizard; no API call; no editing banner
 * - Valid context → getAppMetadata called → modules and RBAC hydrated; editing banner shown
 * - Auto-load failure (API error) → step0Error set; isEditingMode false; no banner
 * - Invalid appName (special chars) → step0Error; no API call
 * - Invalid environment (too long) → step0Error; no API call
 * - Context cleared after mount (NFR-004: no re-trigger on back-navigation)
 * - clearEditingMode() resets all editing state
 * - Feature flag off → auto-load skipped even with valid context
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CustomInfrastructurePage from './CustomInfrastructurePage.vue'
import { useNavigationStore } from '@v2/stores/navigation'
import apiService from '@v2/services/api'
import type { AppMetadata } from '@v2/types/infrastructure.types'

vi.mock('@v2/services/api', () => ({
  default: {
    getInstalledApps: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getAppMetadata: vi.fn().mockResolvedValue({ success: false }),
    getModules: vi.fn().mockResolvedValue({
      success: true,
      data: [
        { name: 'storageV2', description: 'Azure Storage', version: '1.0.0', category: 'storage', supportsMultiInstance: false },
        { name: 'functionAppSvcWindows', description: 'Function App', version: '1.0.0', category: 'compute', supportsMultiInstance: false },
        { name: 'keyvault', description: 'Key Vault', version: '1.0.0', category: 'security', supportsMultiInstance: false },
      ],
    }),
    getRoles: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}))

const MOCK_METADATA: AppMetadata = {
  name: 'jobplc',
  environment: 'devsand',
  description: 'jobplc service',
  owner: 'Vijay Batham',
  lifecycle: 'experimental',
  modules: ['functionAppSvcWindows', 'keyvault'],
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
}

describe('CustomInfrastructurePage — Edit Flow (auto-load via navigation context)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: false })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ── No context ──────────────────────────────────────────────────────────────

  describe('No navigation context (fresh wizard)', () => {
    it('does not call getAppMetadata when no prefillContext is set', async () => {
      mount(CustomInfrastructurePage)
      await flushPromises()
      expect(apiService.getAppMetadata).not.toHaveBeenCalled()
    })

    it('does not show editing-mode banner when no context', async () => {
      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()
      expect(wrapper.find('[data-testid="editing-mode-banner"]').exists()).toBe(false)
    })

    it('isEditingMode is false when no context', async () => {
      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()
      expect(wrapper.vm.isEditingMode).toBe(false)
    })
  })

  // ── Valid context: auto-load success ────────────────────────────────────────

  describe('Valid context → auto-load success', () => {
    it('calls getAppMetadata with appName and environment', async () => {
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: true, data: MOCK_METADATA })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      mount(CustomInfrastructurePage)
      await flushPromises()

      expect(apiService.getAppMetadata).toHaveBeenCalledWith('jobplc', 'devsand')
    })

    it('shows editing-mode banner with appName and environment', async () => {
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: true, data: MOCK_METADATA })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()

      const banner = wrapper.find('[data-testid="editing-mode-banner"]')
      expect(banner.exists()).toBe(true)
      expect(banner.text()).toContain('jobplc')
      expect(banner.text()).toContain('devsand')
    })

    it('hydrates selectedModules from metadata.modules', async () => {
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: true, data: MOCK_METADATA })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()

      expect(wrapper.vm.selectedModules).toContain('functionAppSvcWindows')
      expect(wrapper.vm.selectedModules).toContain('keyvault')
    })

    it('hydrates rbacRelationships from metadata.rbacPairs', async () => {
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: true, data: MOCK_METADATA })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()

      expect(wrapper.vm.rbacRelationships).toEqual(MOCK_METADATA.rbacPairs)
    })

    it('sets prefillData so ProjectInfoForm receives it', async () => {
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: true, data: MOCK_METADATA })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()

      expect(wrapper.vm.prefillData).toEqual(MOCK_METADATA)
    })
  })

  // ── NFR-004: Context cleared after mount ────────────────────────────────────

  describe('NFR-004: Context cleared after mount to prevent re-trigger', () => {
    it('prefillContext is null in store after mount completes', async () => {
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: true, data: MOCK_METADATA })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      mount(CustomInfrastructurePage)
      await flushPromises()

      expect(navStore.prefillContext).toBeNull()
    })

    it('does not call getAppMetadata a second time on re-mount without new context', async () => {
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: true, data: MOCK_METADATA })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()
      wrapper.unmount()

      mount(CustomInfrastructurePage)
      await flushPromises()

      expect(apiService.getAppMetadata).toHaveBeenCalledTimes(1)
    })
  })

  // ── Auto-load failure ───────────────────────────────────────────────────────

  describe('Auto-load failure', () => {
    it('sets step0Error when API returns success=false', async () => {
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: false, error: 'App not found' })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()

      expect(wrapper.vm.step0Error).toBeTruthy()
    })

    it('isEditingMode is false after API failure', async () => {
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: false })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()

      expect(wrapper.vm.isEditingMode).toBe(false)
    })

    it('sets step0Error when API throws (network failure)', async () => {
      ;(apiService.getAppMetadata as Mock).mockRejectedValue(new Error('Network error'))
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()

      expect(wrapper.vm.step0Error).toBeTruthy()
      expect(wrapper.vm.isEditingMode).toBe(false)
    })
  })

  // ── Input validation ─────────────────────────────────────────────────────────

  describe('Input validation on context', () => {
    it('does not call getAppMetadata for invalid appName (special chars)', async () => {
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: '../../etc/passwd', environment: 'devsand' })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()

      expect(apiService.getAppMetadata).not.toHaveBeenCalled()
      expect(wrapper.vm.step0Error).toBeTruthy()
    })

    it('does not call getAppMetadata for environment exceeding 64 chars', async () => {
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'validapp', environment: 'a'.repeat(65) })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()

      expect(apiService.getAppMetadata).not.toHaveBeenCalled()
      expect(wrapper.vm.step0Error).toBeTruthy()
    })
  })

  // ── clearEditingMode() ───────────────────────────────────────────────────────

  describe('clearEditingMode()', () => {
    it('resets isEditingMode, editingAppName, editingEnvironment', async () => {
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: true, data: MOCK_METADATA })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()

      expect(wrapper.vm.isEditingMode).toBe(true)
      wrapper.vm.clearEditingMode()
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.isEditingMode).toBe(false)
      expect(wrapper.vm.editingAppName).toBeNull()
      expect(wrapper.vm.editingEnvironment).toBeNull()
    })

    it('resets selectedModules and rbacRelationships', async () => {
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: true, data: MOCK_METADATA })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()

      expect(wrapper.vm.selectedModules.length).toBeGreaterThan(0)
      wrapper.vm.clearEditingMode()
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.selectedModules).toEqual([])
      expect(wrapper.vm.rbacRelationships).toEqual([])
    })

    it('resets currentStep to 0', async () => {
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: true, data: MOCK_METADATA })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      const wrapper = mount(CustomInfrastructurePage)
      await flushPromises()

      wrapper.vm.currentStep = 2
      wrapper.vm.clearEditingMode()
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.currentStep).toBe(0)
    })
  })

  // ── Feature flag off ────────────────────────────────────────────────────────

  describe('Feature flag VITE_ENABLE_CATALOG_PREFILL=false', () => {
    it('skips auto-load even with valid context when flag is off', async () => {
      ;(import.meta.env as Record<string, unknown>).VITE_ENABLE_CATALOG_PREFILL = 'false'
      ;(apiService.getAppMetadata as Mock).mockResolvedValue({ success: true, data: MOCK_METADATA })
      const navStore = useNavigationStore()
      navStore.navigateToPage('custom', { appName: 'jobplc', environment: 'devsand' })

      mount(CustomInfrastructurePage)
      await flushPromises()

      expect(apiService.getAppMetadata).not.toHaveBeenCalled()
    })
  })
})
