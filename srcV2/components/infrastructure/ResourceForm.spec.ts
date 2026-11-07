import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import ResourceForm from './ResourceForm.vue'

describe('ResourceForm', () => {
  let wrapper: VueWrapper<any>

  const mockModules = [
    {
      name: 'AppService',
      description: 'Azure App Service',
      category: 'Compute',
      supportsMultiInstance: true
    },
    {
      name: 'KeyVault',
      description: 'Azure Key Vault',
      category: 'Security',
      supportsMultiInstance: false
    },
    {
      name: 'Storage',
      description: 'Azure Storage Account',
      category: 'Storage',
      supportsMultiInstance: true
    }
  ]

  beforeEach(() => {
    wrapper = mount(ResourceForm, {
      props: {
        selectedModules: [],
        modules: mockModules
      }
    })
  })

  describe('Component Structure', () => {
    it('renders the form container', () => {
      expect(wrapper.find('.resource-form').exists()).toBe(true)
    })

    it('displays section header', () => {
      expect(wrapper.text()).toContain('Configure Resource Instances')
    })

    it('displays section description', () => {
      expect(wrapper.text()).toContain('Set instance names and manage RBAC')
    })
  })

  describe('Empty State', () => {
    it('shows empty state when no modules selected', () => {
      expect(wrapper.text()).toContain('No modules selected')
    })

    it('does not show module cards when no modules selected', () => {
      expect(wrapper.findAll('.module-config-card')).toHaveLength(0)
    })
  })

  describe('Module Rendering', () => {
    beforeEach(async () => {
      await wrapper.setProps({
        selectedModules: ['AppService', 'KeyVault']
      })
    })

    it('renders module cards for selected modules', () => {
      expect(wrapper.findAll('.module-config-card')).toHaveLength(2)
    })

    it('displays module name', () => {
      expect(wrapper.text()).toContain('AppService')
      expect(wrapper.text()).toContain('KeyVault')
    })

    it('displays module description', () => {
      expect(wrapper.text()).toContain('Azure App Service')
      expect(wrapper.text()).toContain('Azure Key Vault')
    })

    it('shows multi-instance badge for multi-instance modules', () => {
      const badges = wrapper.findAll('.module-config-card').map(card =>
        card.text().includes('Multi-Instance')
      )
      expect(badges[0]).toBe(true) // AppService
      expect(badges[1]).toBe(false) // KeyVault
    })
  })

  describe('Single Instance (Default)', () => {
    beforeEach(async () => {
      await wrapper.setProps({
        selectedModules: ['AppService']
      })
    })

    it('creates one default instance per module', () => {
      const instanceRows = wrapper.findAll('[data-testid^="instance-row-AppService-"]')
      expect(instanceRows).toHaveLength(1)
    })

    it('shows default instance name', async () => {
      const input = wrapper.find('[data-testid="instance-name-AppService-0"]')
      expect((input.element as HTMLInputElement).placeholder).toBe('AppService-1')
    })

    it('emits instance configuration on mount', () => {
      expect(wrapper.emitted('update:instances')).toBeTruthy()
      const emitted = wrapper.emitted('update:instances') as any[]
      expect(emitted[0][0]).toHaveProperty('AppService')
      expect(emitted[0][0].AppService).toHaveLength(1)
    })
  })

  describe('Multi-Instance Management', () => {
    beforeEach(async () => {
      await wrapper.setProps({
        selectedModules: ['Storage']
      })
    })

    it('shows instance counter for multi-instance modules', () => {
      expect(wrapper.text()).toContain('Number of Instances:')
    })

    it('starts with 1 instance', () => {
      const instanceRows = wrapper.findAll('[data-testid^="instance-row-Storage-"]')
      expect(instanceRows).toHaveLength(1)
    })

    it('increments instance count when clicking add button', async () => {
      const addButton = wrapper.findAll('button').find(btn =>
        btn.find('.material-symbols-outlined')?.text() === 'add'
      )
      await addButton?.trigger('click')

      const instanceRows = wrapper.findAll('[data-testid^="instance-row-Storage-"]')
      expect(instanceRows).toHaveLength(2)
    })

    it('decrements instance count when clicking remove button', async () => {
      // Add instance first
      const addButton = wrapper.findAll('button').find(btn =>
        btn.find('.material-symbols-outlined')?.text() === 'add'
      )
      await addButton?.trigger('click')

      // Then remove
      const removeButton = wrapper.findAll('button').find(btn =>
        btn.find('.material-symbols-outlined')?.text() === 'remove'
      )
      await removeButton?.trigger('click')

      const instanceRows = wrapper.findAll('[data-testid^="instance-row-Storage-"]')
      expect(instanceRows).toHaveLength(1)
    })

    it('disables decrement button when at minimum (1 instance)', () => {
      const removeButton = wrapper.findAll('button').find(btn =>
        btn.find('.material-symbols-outlined')?.text() === 'remove'
      )
      expect(removeButton?.attributes('disabled')).toBeDefined()
    })

    it('disables increment button when at maximum (10 instances)', async () => {
      const addButton = wrapper.findAll('button').find(btn =>
        btn.find('.material-symbols-outlined')?.text() === 'add'
      )

      // Add 9 more instances (total 10)
      for (let i = 0; i < 9; i++) {
        await addButton?.trigger('click')
      }

      expect(addButton?.attributes('disabled')).toBeDefined()
    })

    it('removes specific instance when clicking delete icon', async () => {
      // Add second instance
      const addButton = wrapper.findAll('button').find(btn =>
        btn.find('.material-symbols-outlined')?.text() === 'add'
      )
      await addButton?.trigger('click')

      // Find delete button for first instance
      const deleteButton = wrapper.find('[data-testid="remove-instance-Storage-0"]')
      await deleteButton.trigger('click')

      const instanceRows = wrapper.findAll('[data-testid^="instance-row-Storage-"]')
      expect(instanceRows).toHaveLength(1)
    })

    it('updates instance names correctly after adding instances', async () => {
      const addButton = wrapper.findAll('button').find(btn =>
        btn.find('.material-symbols-outlined')?.text() === 'add'
      )
      await addButton?.trigger('click')

      const input1 = wrapper.find('[data-testid="instance-name-Storage-0"]')
      const input2 = wrapper.find('[data-testid="instance-name-Storage-1"]')

      expect((input1.element as HTMLInputElement).placeholder).toBe('Storage-1')
      expect((input2.element as HTMLInputElement).placeholder).toBe('Storage-2')
    })
  })

  describe('Instance Name Validation', () => {
    beforeEach(async () => {
      await wrapper.setProps({
        selectedModules: ['AppService']
      })
    })

    it('validates instance name starts with module prefix or is exact module name', async () => {
      const input = wrapper.find('[data-testid="instance-name-AppService-0"]')
      await input.setValue('InvalidName')
      await input.trigger('input')

      const text = wrapper.text()
      expect(text.includes('Must be "AppService"') || text.includes('Must start with "AppService-"')).toBe(true)
    })

    it('validates instance name suffix length (max 3 chars)', async () => {
      const input = wrapper.find('[data-testid="instance-name-AppService-0"]')
      await input.setValue('AppService-toolong')
      await input.trigger('input')

      expect(wrapper.text()).toContain('Suffix must be 3 characters or less')
    })

    it('validates alphanumeric characters in suffix', async () => {
      const input = wrapper.find('[data-testid="instance-name-AppService-0"]')
      await input.setValue('AppService-1@#')
      await input.trigger('input')

      const text = wrapper.text()
      expect(text.includes('alphanumeric') || text.includes('Suffix must be')).toBe(true)
    })

    it('accepts valid instance name', async () => {
      const input = wrapper.find('[data-testid="instance-name-AppService-0"]')
      await input.setValue('AppService-pri')
      await input.trigger('input')

      expect(wrapper.text()).not.toContain('Must start with')
      expect(wrapper.text()).not.toContain('Suffix must be')
    })

    it('emits updated instances after name change', async () => {
      const input = wrapper.find('[data-testid="instance-name-AppService-0"]')
      await input.setValue('AppService-web')
      await input.trigger('input')

      const emitted = wrapper.emitted('update:instances') as any[]
      const lastEmit = emitted[emitted.length - 1][0]
      expect(lastEmit.AppService[0].name).toBe('AppService-web')
    })
  })

  // RBAC indicators and manager have been moved to the dedicated RBAC page (next step in the workflow)

  describe('Event Emission', () => {
    beforeEach(async () => {
      await wrapper.setProps({
        selectedModules: ['AppService', 'Storage']
      })
    })

    it('emits instances with correct structure', () => {
      const emitted = wrapper.emitted('update:instances') as any[]
      const instances = emitted[0][0]

      expect(instances).toHaveProperty('AppService')
      expect(instances).toHaveProperty('Storage')
      expect(Array.isArray(instances.AppService)).toBe(true)
      expect(instances.AppService[0]).toHaveProperty('name')
    })

    it('emits updated instances when module selection changes', async () => {
      const initialEmitCount = wrapper.emitted('update:instances')?.length || 0

      await wrapper.setProps({
        selectedModules: ['AppService', 'Storage', 'KeyVault']
      })

      const emitted = wrapper.emitted('update:instances') as any[]
      expect(emitted.length).toBeGreaterThan(initialEmitCount)
    })

    it('removes instances for deselected modules', async () => {
      await wrapper.setProps({
        selectedModules: ['AppService']
      })

      const emitted = wrapper.emitted('update:instances') as any[]
      const lastEmit = emitted[emitted.length - 1][0]

      expect(lastEmit).toHaveProperty('AppService')
      expect(lastEmit).not.toHaveProperty('Storage')
    })
  })
})
