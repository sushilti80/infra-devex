/**
 * Unit Tests — InstalledAppsPage.vue
 * Covers: FR-001, FR-005 — Edit Infrastructure button rendering and navigation
 * Spec: edit-existing-infra-ui-path-spec.json
 *
 * Tests:
 * - FR-001: Edit button renders for non-production apps when prefill flag enabled
 * - FR-001: Edit button NOT rendered when VITE_ENABLE_CATALOG_PREFILL === 'false'
 * - FR-001: Clicking Edit button calls navigateToPage with correct context
 * - FR-001: Edit button has correct aria-label per FR-006
 * - FR-005: Edit button absent for production lifecycle apps
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import InstalledAppsPage from './InstalledAppsPage.vue'
import { useNavigationStore } from '@v2/stores/navigation'
import { useEnvironmentsStore } from '@v2/stores/environments'
import apiService from '@v2/services/api'

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@v2/services/api', () => ({
  default: {
    getInstalledApps: vi.fn(),
    promoteInfrastructure: vi.fn().mockResolvedValue({ success: true }),
    deleteInfrastructure: vi.fn().mockResolvedValue({ success: true }),
    labelApp: vi.fn().mockResolvedValue({ success: true }),
    addCodeRepo: vi.fn().mockResolvedValue({ success: true }),
  },
}))

// Stub window APIs used by action handlers so tests don't pop alerts/prompts
vi.stubGlobal('open', vi.fn())
vi.stubGlobal('confirm', vi.fn(() => false))
vi.stubGlobal('prompt', vi.fn(() => null))

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const EXPERIMENTAL_APP = {
  name: 'jobplc',
  environment: 'devsand',
  owner: 'Vijay Batham',
  deployedAt: '2025-07-14T21:59:14Z',
  lifecycle: 'experimental' as const,
  status: 'active' as const,
  modules: ['functionAppSvcWindows'],
  description: 'jobplc devsand app',
  version: '1.0',
}

const PRODUCTION_APP = {
  name: 'prodapp',
  environment: 'prod',
  owner: 'Alice Smith',
  deployedAt: '2025-06-01T10:00:00Z',
  lifecycle: 'production' as const,
  status: 'active' as const,
  modules: ['appServiceWindows'],
  description: 'production app',
  version: '2.0',
}

const DEVELOPMENT_APP = {
  name: 'devapp',
  environment: 'sand',
  owner: 'Bob Dev',
  deployedAt: '2025-05-15T08:00:00Z',
  lifecycle: 'development' as const,
  status: 'active' as const,
  modules: ['keyvault'],
  description: 'development app',
  version: '1.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mountPage() {
  return mount(InstalledAppsPage, {
    global: {
      stubs: {
        // Stub heavy child components to keep tests fast
        StatusModal: { template: '<div data-testid="status-modal-stub"></div>' },
      },
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('InstalledAppsPage — Edit Infrastructure button (FR-001, FR-005, FR-006)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // ─── FR-001 / FR-005: Edit button renders for non-production apps ──────

  describe('FR-001: Edit button renders when prefill flag is enabled (default)', () => {
    it('renders edit button for each experimental app row', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const editBtn = wrapper.find(
        `[aria-label="Edit infrastructure for ${EXPERIMENTAL_APP.name} in ${EXPERIMENTAL_APP.environment}"]`
      )
      expect(editBtn.exists()).toBe(true)
    })

    it('renders edit button for development lifecycle apps', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [DEVELOPMENT_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const editBtn = wrapper.find(
        `[aria-label="Edit infrastructure for ${DEVELOPMENT_APP.name} in ${DEVELOPMENT_APP.environment}"]`
      )
      expect(editBtn.exists()).toBe(true)
    })

    it('renders one edit button per non-production app when multiple are listed', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP, DEVELOPMENT_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const editBtns = wrapper.findAll('[aria-label*="Edit infrastructure for"]')
      expect(editBtns).toHaveLength(2)
    })
  })

  // ─── FR-005: Edit button NOT shown for production apps ────────────────

  describe('FR-005: Production apps do not show Edit button', () => {
    it('does NOT render edit button for production lifecycle app', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [PRODUCTION_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const editBtn = wrapper.find('[aria-label*="Edit infrastructure for"]')
      expect(editBtn.exists()).toBe(false)
    })
  })

  // ─── FR-005: VITE_ENABLE_CATALOG_PREFILL=false hides Edit button ───────

  describe("FR-005: Edit button hidden when VITE_ENABLE_CATALOG_PREFILL === 'false'", () => {
    it('does NOT render edit button when prefill flag is disabled', async () => {
      vi.stubEnv('VITE_ENABLE_CATALOG_PREFILL', 'false')

      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const editBtn = wrapper.find('[aria-label*="Edit infrastructure for"]')
      expect(editBtn.exists()).toBe(false)
    })

    it('renders edit button when flag is "true" (not "false")', async () => {
      vi.stubEnv('VITE_ENABLE_CATALOG_PREFILL', 'true')

      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const editBtn = wrapper.find('[aria-label*="Edit infrastructure for"]')
      expect(editBtn.exists()).toBe(true)
    })
  })

  // ─── FR-001: Clicking edit button calls navigateToPage with context ────

  describe('FR-001: Clicking Edit button triggers navigation with context', () => {
    it('calls navigateToPage with correct appName and environment', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const navStore = useNavigationStore()
      const navSpy = vi.spyOn(navStore, 'navigateToPage')

      const editBtn = wrapper.find(
        `[aria-label="Edit infrastructure for ${EXPERIMENTAL_APP.name} in ${EXPERIMENTAL_APP.environment}"]`
      )
      await editBtn.trigger('click')

      expect(navSpy).toHaveBeenCalledWith('custom', {
        appName: EXPERIMENTAL_APP.name,
        environment: EXPERIMENTAL_APP.environment,
      })
    })

    it('navigates with correct context for development app', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [DEVELOPMENT_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const navStore = useNavigationStore()
      const navSpy = vi.spyOn(navStore, 'navigateToPage')

      const editBtn = wrapper.find(
        `[aria-label="Edit infrastructure for ${DEVELOPMENT_APP.name} in ${DEVELOPMENT_APP.environment}"]`
      )
      await editBtn.trigger('click')

      expect(navSpy).toHaveBeenCalledWith('custom', {
        appName: DEVELOPMENT_APP.name,
        environment: DEVELOPMENT_APP.environment,
      })
    })

    it('navigates to the correct page (custom) after click', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const navStore = useNavigationStore()

      const editBtn = wrapper.find('[aria-label*="Edit infrastructure for"]')
      await editBtn.trigger('click')

      expect(navStore.currentPage).toBe('custom')
    })
  })

  // ─── FR-006: Accessibility attributes ─────────────────────────────────

  describe('FR-006: Edit button accessibility', () => {
    it('edit button has title "Edit Infrastructure"', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const editBtn = wrapper.find('[aria-label*="Edit infrastructure for"]')
      expect(editBtn.attributes('title')).toBe('Edit Infrastructure')
    })

    it('aria-label includes both appName and environment', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const editBtn = wrapper.find('[aria-label*="Edit infrastructure for"]')
      const ariaLabel = editBtn.attributes('aria-label') ?? ''
      expect(ariaLabel).toContain(EXPERIMENTAL_APP.name)
      expect(ariaLabel).toContain(EXPERIMENTAL_APP.environment)
    })

    it('each app row has a unique aria-label for its edit button', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP, DEVELOPMENT_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const editBtns = wrapper.findAll('[aria-label*="Edit infrastructure for"]')
      const labels = editBtns.map(b => b.attributes('aria-label'))
      const uniqueLabels = new Set(labels)
      expect(uniqueLabels.size).toBe(editBtns.length)
    })

    it('edit button is a real <button> element (keyboard-operable)', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      const editBtn = wrapper.find('[aria-label*="Edit infrastructure for"]')
      expect(editBtn.element.tagName).toBe('BUTTON')
    })
  })

  // ─── Existing functionality not broken (regression) ────────────────────

  describe('Regression: existing action buttons still render', () => {
    it('still renders the Delete button alongside Edit button', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.find('[title="Delete Application"]').exists()).toBe(true)
      expect(wrapper.find('[aria-label*="Edit infrastructure for"]').exists()).toBe(true)
    })
  })

  // ─── Bug 1: formatDate fallback for missing/invalid deployedAt ─────────

  describe('Bug 1: formatDate fallback for invalid dates', () => {
    it('renders "Unknown" instead of "Invalid Date" when deployedAt is empty', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [{ ...EXPERIMENTAL_APP, deployedAt: '' }],
      })

      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).toContain('Unknown')
      expect(wrapper.text()).not.toContain('Invalid Date')
    })

    it('still renders a formatted date for a valid deployedAt', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).not.toContain('Unknown')
      expect(wrapper.text()).not.toContain('Invalid Date')
    })
  })

  // ─── Bug 2: environment filter stays 'all' despite late-loading envs ──

  describe("Bug 2: selectedEnvironment stays 'all' regardless of environment store loading state", () => {
    it('keeps the filter on "all" and shows Edit icons across environments once environments load asynchronously', async () => {
      ;(apiService.getInstalledApps as Mock).mockResolvedValue({
        success: true,
        data: [EXPERIMENTAL_APP, DEVELOPMENT_APP],
      })

      const wrapper = mountPage()
      await flushPromises()

      // Simulate the race: environments arrive from the API after the initial render
      const envStore = useEnvironmentsStore()
      envStore.environments = [
        {
          id: 'sand',
          displayName: 'IT Sandbox (sand)',
          subscriptionId: 'sub-1',
          enabled: true,
          features: { customInfra: true, templates: true, aks: true },
        },
        {
          id: 'devsand',
          displayName: 'Dev Sandbox (devsand)',
          subscriptionId: 'sub-2',
          enabled: true,
          features: { customInfra: true, templates: true, aks: true },
        },
      ]
      await flushPromises()

      const select = wrapper.find('[data-testid="environment-filter"]')
      expect((select.element as HTMLSelectElement).value).toBe('all')

      // Edit icon must be visible for apps in both environments, not just the first option
      expect(wrapper.findAll('[aria-label*="Edit infrastructure for"]')).toHaveLength(2)
    })
  })

  // ─── Bug 3: template markup hygiene (no literal \n text node) ─────────

  describe('Bug 3: template markup hygiene', () => {
    it('does not contain a literal backslash-n text node in the template', () => {
      const source = readFileSync(path.join(__dirname, 'InstalledAppsPage.vue'), 'utf-8')
      const templateMatch = source.match(/<template>[\s\S]*<\/template>/)

      expect(templateMatch).not.toBeNull()
      expect(templateMatch![0]).not.toMatch(/>\\n/)
    })
  })
})
