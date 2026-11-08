import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProjectInfoForm from './ProjectInfoForm.vue'
import { useEnvironmentsStore } from '@v2/stores/environments'
import type { EnvironmentConfig } from '@v2/stores/environments'

describe('ProjectInfoForm', () => {
  beforeEach(() => {
    // Create a fresh Pinia instance for each test
    const pinia = createPinia()
    setActivePinia(pinia)

    // Initialize environments store with mock data
    const envStore = useEnvironmentsStore()
    // Set the underlying environments array (which customInfraEnvironments is computed from)
    envStore.$patch({
      environments: [
        {
          id: 'devsand',
          displayName: 'Development Sandbox',
          subscriptionId: 'sub-1',
          description: 'Dev environment',
          enabled: true,
          features: { customInfra: true, templates: true, aks: false }
        },
        {
          id: 'sand',
          displayName: 'Sandbox',
          subscriptionId: 'sub-2',
          description: 'Sandbox environment',
          enabled: true,
          features: { customInfra: true, templates: true, aks: false }
        }
      ] as EnvironmentConfig[]
    })
  })

  const defaultModelValue = {
    projectName: '',
    descriptiveName: '',
    environment: '',
    owner: '',
    lifecycle: '',
    projectAge: 30,
    approvalNumber: ''
  }

  describe('Component Rendering', () => {
    it('renders all form fields', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      expect(wrapper.find('#projectName').exists()).toBe(true)
      expect(wrapper.find('#descriptiveName').exists()).toBe(true)
      expect(wrapper.find('#environment').exists()).toBe(true)
      expect(wrapper.find('#owner').exists()).toBe(true)
      // lifecycle is always 'experimental', not shown in UI
      expect(wrapper.find('#projectAge').exists()).toBe(true)
      expect(wrapper.find('#approvalNumber').exists()).toBe(true)
    })

    it('displays form header with title and description', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      expect(wrapper.find('.form-header h2').text()).toBe('Project Information')
      expect(wrapper.find('.form-header p').text()).toContain('basic information')
    })

    it('marks required fields with asterisk', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const requiredLabels = wrapper.findAll('.form-label.required')
      expect(requiredLabels.length).toBe(6) // projectName, descriptiveName, environment, owner, projectAge, approvalNumber are required
    })
  })

  describe('Project Name Validation', () => {
    it('accepts valid alphanumeric project name (max 8 chars)', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#projectName')
      await input.setValue('webapp01')

      expect(wrapper.find('.error-message').exists()).toBe(false)
    })

    it('shows error for project name with spaces', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#projectName')
      await input.setValue('web app')
      await input.trigger('input')

      expect(wrapper.find('.error-message').text()).toContain('alphanumeric')
    })

    it('shows error for project name with special characters', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#projectName')
      await input.setValue('web-app!')
      await input.trigger('input')

      expect(wrapper.find('.error-message').text()).toContain('alphanumeric')
    })

    it('shows error when project name exceeds 8 characters', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#projectName')
      await input.setValue('toolongname')
      await input.trigger('input')

      expect(wrapper.find('.error-message').text()).toContain('Maximum 8 characters')
    })

    it('enforces maxlength=8 attribute', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#projectName')
      expect(input.attributes('maxlength')).toBe('8')
    })

    it('has pattern attribute for alphanumeric validation', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#projectName')
      expect(input.attributes('pattern')).toBe('[a-zA-Z0-9]+')
    })
  })

  describe('Descriptive Name Field', () => {
    it('accepts long descriptive names (max 100 chars)', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const longName = 'A'.repeat(100)
      const input = wrapper.find('#descriptiveName')
      await input.setValue(longName)

      expect((input.element as HTMLInputElement).value).toBe(longName)
    })

    it('enforces maxlength=100 attribute', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#descriptiveName')
      expect(input.attributes('maxlength')).toBe('100')
    })
  })

  describe('Environment Selection', () => {
    it('renders all environment options', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const select = wrapper.find('#environment')
      const options = select.findAll('option')

      expect(options).toHaveLength(3) // Empty + environments supplied by the store
      expect(options[1].text()).toContain('Development Sandbox')
      expect(options[2].text()).toContain('Sandbox')
    })

    it('updates modelValue when environment is selected', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const select = wrapper.find('#environment')
      await select.setValue('sand')

      const emitted = wrapper.emitted('update:modelValue')
      expect(emitted).toBeTruthy()
      expect(emitted![0][0]).toMatchObject({ environment: 'sand' })
    })
  })

  // Lifecycle Stage tests removed - lifecycle is always 'experimental' and not shown in UI

  describe('Project Age Field', () => {
    it('accepts numeric values for project age', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#projectAge')
      await input.setValue('90')

      const emitted = wrapper.emitted('update:modelValue')
      expect(emitted).toBeTruthy()
      expect(emitted![0][0]).toMatchObject({ projectAge: 90 })
    })

    it('enforces minimum value of 1', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#projectAge')
      expect(input.attributes('min')).toBe('1')
    })

    it('shows human-readable time description for 7 days', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: { ...defaultModelValue, projectAge: 7 } }
      })

      expect(wrapper.text()).toContain('~1 week')
    })

    it('shows human-readable time description for 30 days', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: { ...defaultModelValue, projectAge: 30 } }
      })

      expect(wrapper.text()).toContain('~1 month')
    })

    it('shows human-readable time description for 90 days', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: { ...defaultModelValue, projectAge: 90 } }
      })

      expect(wrapper.text()).toContain('~3 months')
    })

    it('shows human-readable time description for 365 days', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: { ...defaultModelValue, projectAge: 365 } }
      })

      expect(wrapper.text()).toContain('year')
    })
  })

  describe('Owner Field', () => {
    it('accepts email addresses', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#owner')
      await input.setValue('john.doe@company.com')

      expect((input.element as HTMLInputElement).value).toBe('john.doe@company.com')
    })

    it('shows placeholder with example email', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#owner')
      expect(input.attributes('placeholder')).toContain('Team Name or User Email')
    })
  })

  describe('Approval Number Field', () => {
    it('accepts JIRA ticket format', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#approvalNumber')
      await input.setValue('JIRA-1234')

      expect((input.element as HTMLInputElement).value).toBe('JIRA-1234')
    })

    it('accepts CR number format', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#approvalNumber')
      await input.setValue('CR-5678')

      expect((input.element as HTMLInputElement).value).toBe('CR-5678')
    })

    it('is required - has required attribute', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#approvalNumber')
      expect(input.attributes('required')).toBeDefined()
    })
  })

  describe('Model Value Binding', () => {
    it('initializes form with provided modelValue', () => {
      const initialData = {
        projectName: 'webapp01',
        descriptiveName: 'My Web App',
        environment: 'sand',
        owner: 'john@company.com',
        lifecycle: 'development',
        projectAge: 90,
        approvalNumber: 'JIRA-123'
      }

      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: initialData }
      })

      expect((wrapper.find('#projectName').element as HTMLInputElement).value).toBe('webapp01')
      expect((wrapper.find('#descriptiveName').element as HTMLInputElement).value).toBe('My Web App')
      expect((wrapper.find('#environment').element as HTMLSelectElement).value).toBe('sand')
      expect((wrapper.find('#owner').element as HTMLInputElement).value).toBe('john@company.com')
      // lifecycle field removed - always defaults to 'experimental'
      expect((wrapper.find('#projectAge').element as HTMLInputElement).value).toBe('90')
      expect((wrapper.find('#approvalNumber').element as HTMLInputElement).value).toBe('JIRA-123')
    })

    it('emits update:modelValue when any field changes', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#descriptiveName')
      await input.setValue('Updated Description')

      const emitted = wrapper.emitted('update:modelValue')
      expect(emitted).toBeTruthy()
      expect(emitted!.length).toBeGreaterThan(0)
    })

    it('does not emit update when validation fails', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const input = wrapper.find('#projectName')
      await input.setValue('invalid name!')
      await input.trigger('input')

      // Should have error
      expect(wrapper.find('.error-message').exists()).toBe(true)

      // Last emission should not include invalid value
      const emitted = wrapper.emitted('update:modelValue')
      if (emitted && emitted.length > 0) {
        const lastEmit = emitted[emitted.length - 1][0] as any
        expect(lastEmit.projectName).not.toBe('invalid name!')
      }
    })
  })

  describe('Required Field Validation', () => {
    it('marks all fields as required in HTML', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      expect(wrapper.find('#projectName').attributes('required')).toBeDefined()
      expect(wrapper.find('#descriptiveName').attributes('required')).toBeDefined()
      expect(wrapper.find('#environment').attributes('required')).toBeDefined()
      expect(wrapper.find('#owner').attributes('required')).toBeDefined()
      // lifecycle field removed - no longer in UI
      expect(wrapper.find('#projectAge').attributes('required')).toBeDefined()
      // approvalNumber is now optional - no required attribute
    })
  })

  describe('Accessibility', () => {
    it('associates labels with inputs using for/id', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const projectNameLabel = wrapper.find('label[for="projectName"]')
      const projectNameInput = wrapper.find('#projectName')

      expect(projectNameLabel.exists()).toBe(true)
      expect(projectNameInput.exists()).toBe(true)
      expect(projectNameInput.attributes('id')).toBe('projectName')
    })

    it('provides helper text for all fields', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const helperTexts = wrapper.findAll('.text-xs')
      expect(helperTexts.length).toBeGreaterThan(0)
    })
  })

  describe('Responsive Layout', () => {
    it('uses form-row class for all rows', () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      const formRows = wrapper.findAll('.form-row')
      expect(formRows.length).toBe(3) // 3 form rows (lifecycle row removed)
      formRows.forEach(row => {
        expect(row.classes()).toContain('form-row')
      })
    })
  })

  // ── FR-003: prefillData prop ────────────────────────────────────────────────
  describe('Pre-fill (FR-003)', () => {
    const prefillData = {
      name: 'jobplc',
      environment: 'devsand',
      description: 'Job PLC Service',
      owner: 'Example User',
      lifecycle: 'Live',
      modules: ['functionAppSvcWindows'],
      costCenter: 'self-service',
      commitSha: '649f071b29d6d9eec2c4cba417278735ce4d23a8',
      deployedAt: '2025-07-14T21:59:14Z'
    }

    it('accepts optional prefillData prop without error', () => {
      expect(() =>
        mount(ProjectInfoForm, {
          props: { modelValue: defaultModelValue, prefillData }
        })
      ).not.toThrow()
    })

    it('pre-fills projectName from AppMetadata.name', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      await wrapper.setProps({ prefillData })
      await wrapper.vm.$nextTick()

      const input = wrapper.find('#projectName')
      expect((input.element as HTMLInputElement).value).toBe('jobplc')
    })

    it('pre-fills descriptiveName from AppMetadata.description', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      await wrapper.setProps({ prefillData })
      await wrapper.vm.$nextTick()

      const input = wrapper.find('#descriptiveName')
      expect((input.element as HTMLInputElement).value).toBe('Job PLC Service')
    })

    it('pre-fills environment from AppMetadata.environment', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      await wrapper.setProps({ prefillData })
      await wrapper.vm.$nextTick()

      const select = wrapper.find('#environment')
      expect((select.element as HTMLSelectElement).value).toBe('devsand')
    })

    it('pre-fills owner from AppMetadata.owner', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      await wrapper.setProps({ prefillData })
      await wrapper.vm.$nextTick()

      const input = wrapper.find('#owner')
      expect((input.element as HTMLInputElement).value).toBe('Example User')
    })

    it('does NOT pre-fill projectAge', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: { ...defaultModelValue, projectAge: 30 } }
      })

      await wrapper.setProps({ prefillData })
      await wrapper.vm.$nextTick()

      const input = wrapper.find('#projectAge')
      expect((input.element as HTMLInputElement).value).toBe('30')
    })

    it('does NOT pre-fill approvalNumber', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      await wrapper.setProps({ prefillData })
      await wrapper.vm.$nextTick()

      const input = wrapper.find('#approvalNumber')
      expect((input.element as HTMLInputElement).value).toBe('')
    })

    it('does NOT pre-fill lifecycle (always experimental)', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      await wrapper.setProps({ prefillData })
      await wrapper.vm.$nextTick()

      // lifecycle is always 'experimental' regardless of prefill
      const emittedValues = wrapper.emitted('update:modelValue')
      if (emittedValues && emittedValues.length > 0) {
        const lastEmit = emittedValues[emittedValues.length - 1][0] as any
        expect(lastEmit.lifecycle).toBe('experimental')
      }
    })

    it('emits update:modelValue with pre-filled values', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      await wrapper.setProps({ prefillData })
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('update:modelValue')
      expect(emitted).toBeTruthy()
      const lastEmit = emitted![emitted!.length - 1][0] as any
      expect(lastEmit.projectName).toBe('jobplc')
      expect(lastEmit.owner).toBe('Example User')
    })

    it('pre-filled fields remain editable after pre-fill', async () => {
      const wrapper = mount(ProjectInfoForm, {
        props: { modelValue: defaultModelValue }
      })

      await wrapper.setProps({ prefillData })
      await wrapper.vm.$nextTick()

      // Edit projectName after prefill
      const input = wrapper.find('#projectName')
      await input.setValue('newname')

      expect((input.element as HTMLInputElement).value).toBe('newname')
    })
  })
})
