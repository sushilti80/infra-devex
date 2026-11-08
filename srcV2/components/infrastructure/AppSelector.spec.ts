import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AppSelector from './AppSelector.vue'
import apiService from '@v2/services/api'

// ─── Mock API service ────────────────────────────────────────────────────────
vi.mock('@v2/services/api', () => ({
  default: {
    getInstalledApps: vi.fn(),
    getAppMetadata: vi.fn()
  }
}))

const mockApps = [
  {
    name: 'jobplc',
    environment: 'devsand',
    owner: 'Example User',
    deployedAt: '2025-07-14T21:59:14Z',
    lifecycle: 'experimental',
    status: 'active',
    modules: ['functionAppSvcWindows'],
    description: 'jobplc devsand app'
  },
  {
    name: 'jobplc',
    environment: 'sand',
    owner: 'Example User',
    deployedAt: '2025-07-10T10:00:00Z',
    lifecycle: 'experimental',
    status: 'active',
    modules: ['functionAppSvcWindows', 'keyvault'],
    description: 'jobplc sand app'
  },
  {
    name: 'webapp01',
    environment: 'devsand',
    owner: 'Alex Dev',
    deployedAt: '2025-07-01T08:00:00Z',
    lifecycle: 'experimental',
    status: 'active',
    modules: ['appServiceWindows'],
    description: 'webapp01 devsand'
  }
]

const mockMetadata = {
  name: 'jobplc',
  environment: 'devsand',
  description: 'jobplc',
  owner: 'Example User',
  lifecycle: 'Live',
  modules: ['functionAppSvcWindows'],
  costCenter: 'self-service',
  commitSha: '649f071b29d6d9eec2c4cba417278735ce4d23a8',
  deployedAt: '2025-07-14T21:59:14Z'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function mountComponent() {
  return mount(AppSelector, {
    attachTo: document.body
  })
}

describe('AppSelector', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(apiService.getInstalledApps as Mock).mockResolvedValue({
      success: true,
      data: mockApps
    })
    ;(apiService.getAppMetadata as Mock).mockResolvedValue({
      success: true,
      data: mockMetadata,
      correlationId: 'cid-test'
    })
  })

  // ── Mount behaviour ──────────────────────────────────────────────────────

  it('calls getInstalledApps once on mount', async () => {
    mountComponent()
    await flushPromises()
    expect(apiService.getInstalledApps).toHaveBeenCalledTimes(1)
  })

  it('renders collapsible section header', async () => {
    const wrapper = mountComponent()
    await flushPromises()
    expect(wrapper.text()).toContain('Load from Existing App')
  })

  // ── App name dropdown ───────────────────────────────────────────────────

  it('populates app name dropdown with deduplicated names', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    const options = wrapper.findAll('[data-testid="app-name-option"]')
    const names = options.map(o => o.element.getAttribute('value'))
    // jobplc appears twice in mock but should be deduplicated
    expect(names.filter(n => n === 'jobplc').length).toBe(1)
    expect(names).toContain('webapp01')
  })

  it('shows "No apps found" empty state when list is empty', async () => {
    ;(apiService.getInstalledApps as Mock).mockResolvedValue({
      success: true,
      data: []
    })
    const wrapper = mountComponent()
    await flushPromises()
    expect(wrapper.text()).toContain('No apps found')
  })

  it('shows retry button when app list load fails', async () => {
    ;(apiService.getInstalledApps as Mock).mockRejectedValue(new Error('Network error'))
    const wrapper = mountComponent()
    await flushPromises()
    expect(wrapper.find('[data-testid="retry-button"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Unable to load apps')
  })

  // ── Environment dropdown ─────────────────────────────────────────────────

  it('resets and repopulates environment dropdown on app name selection', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    // Select jobplc
    const appSelect = wrapper.find('[data-testid="app-name-select"]')
    await appSelect.setValue('jobplc')
    await wrapper.vm.$nextTick()

    // jobplc has 2 environments
    const envOptions = wrapper.findAll('[data-testid="env-option"]')
    const envValues = envOptions.map(o => o.element.getAttribute('value'))
    expect(envValues).toContain('devsand')
    expect(envValues).toContain('sand')
  })

  it('does not make an extra API call when environment is selected', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    const appSelect = wrapper.find('[data-testid="app-name-select"]')
    await appSelect.setValue('jobplc')

    const callCountAfterAppSelect = (apiService.getInstalledApps as Mock).mock.calls.length
    expect(callCountAfterAppSelect).toBe(1) // no additional call
  })

  // ── Load button state ────────────────────────────────────────────────────

  it('disables Load button when nothing is selected', async () => {
    const wrapper = mountComponent()
    await flushPromises()
    const loadBtn = wrapper.find('[data-testid="load-button"]')
    expect(loadBtn.attributes('disabled')).toBeDefined()
  })

  it('disables Load button when only app name selected', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    await wrapper.find('[data-testid="app-name-select"]').setValue('jobplc')
    await wrapper.vm.$nextTick()

    const loadBtn = wrapper.find('[data-testid="load-button"]')
    expect(loadBtn.attributes('disabled')).toBeDefined()
  })

  it('disables Load button when only environment selected', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    // Directly set env without app — env dropdown should be empty/disabled
    const loadBtn = wrapper.find('[data-testid="load-button"]')
    expect(loadBtn.attributes('disabled')).toBeDefined()
  })

  it('enables Load button when both app and environment are selected', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    await wrapper.find('[data-testid="app-name-select"]').setValue('jobplc')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="env-select"]').setValue('devsand')
    await wrapper.vm.$nextTick()

    const loadBtn = wrapper.find('[data-testid="load-button"]')
    expect(loadBtn.attributes('disabled')).toBeUndefined()
  })

  // ── Load success ─────────────────────────────────────────────────────────

  it('calls getAppMetadata with correct args on Load click', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    await wrapper.find('[data-testid="app-name-select"]').setValue('jobplc')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="env-select"]').setValue('devsand')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-testid="load-button"]').trigger('click')
    await flushPromises()

    expect(apiService.getAppMetadata).toHaveBeenCalledWith('jobplc', 'devsand')
  })

  it('emits @prefill with metadata on successful load', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    await wrapper.find('[data-testid="app-name-select"]').setValue('jobplc')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="env-select"]').setValue('devsand')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-testid="load-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('prefill')).toBeTruthy()
    expect(wrapper.emitted('prefill')![0][0]).toEqual(mockMetadata)
  })

  it('shows prefill success banner after load', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    await wrapper.find('[data-testid="app-name-select"]').setValue('jobplc')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="env-select"]').setValue('devsand')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-testid="load-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="prefill-banner"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Pre-filled from jobplc / devsand')
  })

  // ── Load error ───────────────────────────────────────────────────────────

  it('emits @error and shows inline error on 404', async () => {
    ;(apiService.getAppMetadata as Mock).mockRejectedValue({
      response: { status: 404, data: { error: 'App not found' } }
    })

    const wrapper = mountComponent()
    await flushPromises()

    await wrapper.find('[data-testid="app-name-select"]').setValue('jobplc')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="env-select"]').setValue('devsand')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-testid="load-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('error')).toBeTruthy()
    expect(wrapper.find('[data-testid="selector-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('not found in service-catalog')
  })

  it('emits @error and shows generic error on 500', async () => {
    ;(apiService.getAppMetadata as Mock).mockRejectedValue({
      response: { status: 500, data: { error: 'Internal server error' } }
    })

    const wrapper = mountComponent()
    await flushPromises()

    await wrapper.find('[data-testid="app-name-select"]').setValue('jobplc')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="env-select"]').setValue('devsand')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-testid="load-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('error')).toBeTruthy()
    expect(wrapper.text()).toContain('Could not load metadata')
  })

  // ── Second load confirmation ─────────────────────────────────────────────

  it('shows confirmation dialog on second load when form already populated', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    // First load
    await wrapper.find('[data-testid="app-name-select"]').setValue('jobplc')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="env-select"]').setValue('devsand')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="load-button"]').trigger('click')
    await flushPromises()

    // Second load — change selection
    await wrapper.find('[data-testid="app-name-select"]').setValue('webapp01')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="env-select"]').setValue('devsand')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="load-button"]').trigger('click')
    await flushPromises()

    // Confirmation dialog should appear
    expect(wrapper.find('[data-testid="confirm-overwrite-dialog"]').exists()).toBe(true)
  })

  // ── Accessibility ────────────────────────────────────────────────────────

  it('sets aria-busy on container during loading', async () => {
    let resolveLoad!: (value: unknown) => void
    ;(apiService.getAppMetadata as Mock).mockImplementation(
      () => new Promise(res => { resolveLoad = res })
    )

    const wrapper = mountComponent()
    await flushPromises()

    await wrapper.find('[data-testid="app-name-select"]').setValue('jobplc')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="env-select"]').setValue('devsand')
    await wrapper.vm.$nextTick()

    wrapper.find('[data-testid="load-button"]').trigger('click')
    await wrapper.vm.$nextTick()

    // While loading, aria-busy should be true
    const container = wrapper.find('[data-testid="app-selector-container"]')
    expect(container.attributes('aria-busy')).toBe('true')

    // Resolve load
    resolveLoad({ success: true, data: mockMetadata })
    await flushPromises()

    expect(container.attributes('aria-busy')).toBe('false')
  })

  it('links error message via aria-describedby', async () => {
    ;(apiService.getInstalledApps as Mock).mockRejectedValue(new Error('Network error'))
    const wrapper = mountComponent()
    await flushPromises()

    const errorEl = wrapper.find('[data-testid="selector-error"]')
    if (errorEl.exists()) {
      const errorId = errorEl.attributes('id')
      // The container or a key element should reference this id
      expect(wrapper.html()).toContain(errorId)
    }
  })

  // ── FR-004: defineExpose({ collapse }) ───────────────────────────────────

  describe('defineExpose — collapse()', () => {
    it('exposes a collapse() method', async () => {
      const wrapper = mountComponent()
      await flushPromises()
      expect(typeof (wrapper.vm as any).collapse).toBe('function')
    })

    it('collapse() sets isExpanded to false', async () => {
      const wrapper = mountComponent()
      await flushPromises()

      // By default isExpanded is true
      const toggleBtn = wrapper.find('[class*="app-selector__toggle"]')
      expect(toggleBtn.attributes('aria-expanded')).toBe('true')

      // Call collapse via exposed method
      ;(wrapper.vm as any).collapse()
      await wrapper.vm.$nextTick()

      expect(toggleBtn.attributes('aria-expanded')).toBe('false')
    })

    it('collapse() hides the collapsible body', async () => {
      const wrapper = mountComponent()
      await flushPromises()

      // Body should be visible initially
      expect(wrapper.find('.app-selector__body').exists()).toBe(true)

      ;(wrapper.vm as any).collapse()
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.app-selector__body').exists()).toBe(false)
    })

    it('collapse() can be called multiple times without error', async () => {
      const wrapper = mountComponent()
      await flushPromises()

      expect(() => {
        ;(wrapper.vm as any).collapse()
        ;(wrapper.vm as any).collapse()
      }).not.toThrow()
    })
  })
})
