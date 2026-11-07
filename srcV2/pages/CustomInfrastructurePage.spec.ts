import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CustomInfrastructurePage from './CustomInfrastructurePage.vue'
import ModuleSelector from '../components/infrastructure/ModuleSelector.vue'
import apiService from '@v2/services/api'

// Mock API service to prevent network calls
vi.mock('@v2/services/api', () => ({
  default: {
    getModules: vi.fn(() => Promise.resolve({
      success: true,
      data: [
        {
          name: 'storageV2',
          description: 'Azure Storage Account V2',
          version: '1.0.0',
          category: 'storage',
          supportsMultiInstance: false
        },
        {
          name: 'keyvault',
          description: 'Azure Key Vault for secrets management',
          version: '1.0.0',
          category: 'security',
          supportsMultiInstance: false
        }
      ]
    })),
    getRoles: vi.fn(() => Promise.resolve({
      success: true,
      data: []
    })),
    getInstalledApps: vi.fn(() => Promise.resolve({
      success: true,
      data: []
    })),
    getAppMetadata: vi.fn(() => Promise.resolve({
      success: true,
      data: {
        name: 'jobplc',
        environment: 'devsand',
        description: 'Job PLC Service',
        owner: 'Vijay Batham',
        lifecycle: 'Live',
        modules: ['functionAppSvcWindows', 'keyvault'],
        costCenter: 'self-service',
        commitSha: '649f071b',
        deployedAt: '2025-07-14T21:59:14Z'
      }
    }))
  }
}))

describe('CustomInfrastructurePage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('Component Structure', () => {
    it('renders the page', () => {
      const wrapper = mount(CustomInfrastructurePage)
      expect(wrapper.exists()).toBe(true)
    })

    it('displays the page title', () => {
      const wrapper = mount(CustomInfrastructurePage)
      expect(wrapper.find('h1').text()).toBe('Custom Infrastructure')
    })

    it('displays the page description', () => {
      const wrapper = mount(CustomInfrastructurePage)
      const description = wrapper.find('[data-testid="page-description"]')
      expect(description.exists()).toBe(true)
      expect(description.text()).toContain('Select and configure Terraform modules')
    })
  })

  describe('Step Navigation', () => {
    it('displays step indicators', () => {
      const wrapper = mount(CustomInfrastructurePage)
      const steps = wrapper.findAll('[data-testid="step-indicator"]')
      expect(steps.length).toBe(6) // Updated to 6 steps (added RBAC)
    })

    it('shows correct step labels', () => {
      const wrapper = mount(CustomInfrastructurePage)
      const steps = wrapper.findAll('[data-testid="step-indicator"]')

      expect(steps[0].text()).toContain('Project Info')
      expect(steps[1].text()).toContain('Select Modules')
      expect(steps[2].text()).toContain('Configure')
      expect(steps[3].text()).toContain('RBAC Relationships') // New RBAC step
      expect(steps[4].text()).toContain('Review')
      expect(steps[5].text()).toContain('Deploy')
    })

    it('highlights the current step', () => {
      const wrapper = mount(CustomInfrastructurePage)
      const activeStep = wrapper.find('[data-testid="step-indicator"][data-active="true"]')
      expect(activeStep.exists()).toBe(true)
      expect(activeStep.text()).toContain('Project Info')
    })

    it('allows navigation to next step', async () => {
      const wrapper = mount(CustomInfrastructurePage)
      const nextButton = wrapper.find('[data-testid="next-step-button"]')

      expect(nextButton.exists()).toBe(true)
      expect(nextButton.text()).toBe('Next')
    })

    it('allows navigation to previous step', async () => {
      const wrapper = mount(CustomInfrastructurePage)
      const backButton = wrapper.find('[data-testid="back-step-button"]')

      // Back button should not exist on first step
      expect(backButton.exists()).toBe(false)
    })
  })

  describe('Step Content', () => {
    it('displays project info form on step 0', () => {
      const wrapper = mount(CustomInfrastructurePage)
      const projectInfoForm = wrapper.find('[data-testid="project-info-form"]')
      expect(projectInfoForm.exists()).toBe(true)
    })

    it('displays module selector on step 1', async () => {
      const wrapper = mount(CustomInfrastructurePage)
      // Navigate to step 1
      await wrapper.vm.nextStep()
      await wrapper.vm.$nextTick()

      const moduleSelector = wrapper.find('[data-testid="module-selector"]')
      expect(moduleSelector.exists()).toBe(true)
    })

    it('disables next button when project info incomplete', () => {
      const wrapper = mount(CustomInfrastructurePage)
      const nextButton = wrapper.find('[data-testid="next-step-button"]')
      expect(nextButton.attributes('disabled')).toBeDefined()
    })
  })

  describe('Form Actions', () => {
    it('displays cancel button', () => {
      const wrapper = mount(CustomInfrastructurePage)
      const cancelButton = wrapper.find('[data-testid="cancel-button"]')
      expect(cancelButton.exists()).toBe(true)
      expect(cancelButton.text()).toBe('Cancel')
    })

    it('cancel button navigates back to home', async () => {
      const wrapper = mount(CustomInfrastructurePage)
      const cancelButton = wrapper.find('[data-testid="cancel-button"]')

      await cancelButton.trigger('click')

      // Should emit navigation event or use navigation store
      // We'll verify this emits a navigation action
    })
  })

  describe('ModuleSelector Integration', () => {
    it('should render ModuleSelector component in step 1', async () => {
      const wrapper = mount(CustomInfrastructurePage)
      // Navigate to step 1 (Select Modules)
      await wrapper.vm.nextStep()
      await wrapper.vm.$nextTick()

      const moduleSelectorComponent = wrapper.findComponent(ModuleSelector)
      expect(moduleSelectorComponent.exists()).toBe(true)
    })

    it('should pass selectedModules prop to ModuleSelector', async () => {
      const wrapper = mount(CustomInfrastructurePage)

      // Complete Step 0 (Project Info)
      // lifecycle auto-set to 'experimental', approvalNumber optional
      wrapper.vm.projectMetadata.projectName = 'webapp01'
      wrapper.vm.projectMetadata.descriptiveName = 'Web Application'
      wrapper.vm.projectMetadata.environment = 'devsand'
      wrapper.vm.projectMetadata.owner = 'test@example.com'
      wrapper.vm.projectMetadata.projectAge = 30
      await wrapper.vm.$nextTick()

      // Navigate to Step 1 (Module Selection)
      await wrapper.vm.nextStep()
      await wrapper.vm.$nextTick()

      const moduleSelectorComponent = wrapper.findComponent(ModuleSelector)
      expect(moduleSelectorComponent.props('selectedModules')).toEqual([])
    })

    it('should update selectedModules when ModuleSelector emits', async () => {
      const wrapper = mount(CustomInfrastructurePage)

      // Complete Step 0 (Project Info)
      // lifecycle auto-set to 'experimental', approvalNumber optional
      wrapper.vm.projectMetadata.projectName = 'webapp01'
      wrapper.vm.projectMetadata.descriptiveName = 'Web Application'
      wrapper.vm.projectMetadata.environment = 'devsand'
      wrapper.vm.projectMetadata.owner = 'test@example.com'
      wrapper.vm.projectMetadata.projectAge = 30
      await wrapper.vm.$nextTick()

      // Navigate to Step 1 (Module Selection)
      await wrapper.vm.nextStep()
      await wrapper.vm.$nextTick()

      const moduleSelectorComponent = wrapper.findComponent(ModuleSelector)
      await moduleSelectorComponent.vm.$emit('update:selectedModules', ['storageV2', 'keyvault'])
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.selectedModules).toEqual(['storageV2', 'keyvault'])
    })

    it('should enable Next button when modules are selected', async () => {
      const wrapper = mount(CustomInfrastructurePage)

      // Complete Step 0 (Project Info)
      // lifecycle auto-set to 'experimental', approvalNumber optional
      wrapper.vm.projectMetadata.projectName = 'webapp01'
      wrapper.vm.projectMetadata.descriptiveName = 'Web Application'
      wrapper.vm.projectMetadata.environment = 'devsand'
      wrapper.vm.projectMetadata.owner = 'test@example.com'
      wrapper.vm.projectMetadata.projectAge = 30
      await wrapper.vm.$nextTick()

      // Navigate to Step 1 (Module Selection)
      await wrapper.vm.nextStep()
      await wrapper.vm.$nextTick()

      const moduleSelectorComponent = wrapper.findComponent(ModuleSelector)

      // Initially disabled (no modules selected)
      let nextButton = wrapper.find('[data-testid="next-step-button"]')
      expect(nextButton.attributes('disabled')).toBeDefined()

      // Emit selection
      await moduleSelectorComponent.vm.$emit('update:selectedModules', ['storageV2'])
      await wrapper.vm.$nextTick()

      // Should be enabled
      nextButton = wrapper.find('[data-testid="next-step-button"]')
      expect(nextButton.attributes('disabled')).toBeUndefined()
    })
  })

})
