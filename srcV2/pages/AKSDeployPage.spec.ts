import { describe, it, expect, vi } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import AKSDeployPage from './AKSDeployPage.vue'
import { useEnvironmentsStore } from '../stores/environments'
import api from '@v2/services/api'

vi.mock('@v2/services/api', () => ({
  default: { deployToAKS: vi.fn() }
}))

describe('AKSDeployPage', () => {
  it('only offers App configuration and submits App payloads before and after reset', async () => {
    const pinia = createPinia()
    const environments = useEnvironmentsStore(pinia)
    environments.environments = [{
      id: 'sandbox',
      displayName: 'Sandbox',
      subscriptionId: 'test-subscription',
      enabled: true,
      features: { aks: true, customInfra: false, templates: false }
    }]
    environments.defaultEnvironment = 'sandbox'
    const deploy = vi.mocked(api.deployToAKS).mockResolvedValue({ success: true })
    const wrapper = shallowMount(AKSDeployPage, { global: { plugins: [pinia] } })

    expect(wrapper.find('input[type="radio"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Deployment Type')
    expect(wrapper.text()).not.toContain('Agent')
    expect(wrapper.find('#agentname, #poolname, #agentTeamLabel').exists()).toBe(false)
    expect(wrapper.text()).toContain('Web App Configuration')
    expect(wrapper.text()).toContain('Application exposure via Kong Gateway')
    expect(wrapper.get('#exposureMode').find('option[value="legacy"]').text()).toBe('Legacy ingress (current default)')
    expect(wrapper.findAll('button[role="switch"]')).toHaveLength(1)
    expect((wrapper.get('#imageTag').element as HTMLInputElement).value).toBe('0.0.1')
    expect(wrapper.get('#imageTag').attributes()).toHaveProperty('required')
    await wrapper.get('#appname').setValue('my-app')
    await wrapper.get('#imageTag').setValue('1.2.3')
    await wrapper.get('#port').setValue(8080)
    await wrapper.get('#healthPath').setValue('/ready')
    await wrapper.get('button[role="switch"]').trigger('click')
    const access = [{ resourceType: 'keyvault', resourceName: 'app-vault', role: 'Key Vault Secrets User' }]
    wrapper.findComponent({ name: 'WorkloadIdentitySection' }).vm.$emit('update:modelValue', access)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(deploy).toHaveBeenCalledExactlyOnceWith({
      envname: 'sandbox',
      appname: 'my-app',
      namespace: 'my-app',
      is_web_app: true,
      image_name: 'sharedwus3acr2.azurecr.io/my-app',
      image_tag: '1.2.3',
      correlation_id: expect.stringMatching(/^aks-/),
      team_label: 'software-engineering',
      port: '8080',
      health_path: '/ready',
      exposure_mode: 'legacy',
      create_postgres_db: 'false',
      env_vars: '[]',
      secret_env_vars: '[]',
      external_secret_enabled: 'true',
      kv_secrets: '[]',
      workload_identity_grants: JSON.stringify(access)
    })
    const modal = wrapper.findComponent({ name: 'StatusModal' })
    expect(modal.props('workflowType')).toBe('aks')
    expect(modal.props('correlationId')).toBe(deploy.mock.calls[0][0].correlation_id)
    modal.vm.$emit('success', {})
    await flushPromises()

    expect((wrapper.get('#appname').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('#imageTag').element as HTMLInputElement).value).toBe('0.0.1')
    await wrapper.get('#appname').setValue('next-app')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(deploy).toHaveBeenCalledTimes(2)
    expect(deploy.mock.calls[1][0]).toMatchObject({
      appname: 'next-app',
      is_web_app: true,
      image_tag: '0.0.1',
      port: '80',
      health_path: '/healthz',
      exposure_mode: 'legacy',
      create_postgres_db: 'false',
      external_secret_enabled: 'false',
      workload_identity_grants: '[]'
    })
    wrapper.unmount()
  })
  it('offers the Kong Gateway profile only for devsand and dispatches it when selected', async () => {
    const pinia = createPinia()
    const environments = useEnvironmentsStore(pinia)
    environments.environments = [{
      id: 'devsand',
      displayName: 'Dev Sandbox',
      subscriptionId: 'test-subscription',
      enabled: true,
      features: { aks: true, customInfra: false, templates: false }
    }]
    environments.defaultEnvironment = 'devsand'
    const deploy = vi.mocked(api.deployToAKS).mockResolvedValue({ success: true })
    const wrapper = shallowMount(AKSDeployPage, { global: { plugins: [pinia] } })
    await wrapper.get('#appname').setValue('sample-api')
    await flushPromises()
    expect(wrapper.get('#exposureMode').find('option[value="private-gateway"]').text())
      .toContain('Kong Gateway')
    await wrapper.get('#exposureMode').setValue('private-gateway')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(deploy).toHaveBeenCalledWith(expect.objectContaining({
      envname: 'devsand',
      appname: 'sample-api',
      namespace: 'sample-api',
      exposure_mode: 'private-gateway'
    }))
    wrapper.unmount()
  })
  it('creates a generated PostgreSQL name when enabled in devsand', async () => {
    const pinia = createPinia()
    const environments = useEnvironmentsStore(pinia)
    environments.environments = [{
      id: 'devsand', displayName: 'Dev Sandbox', subscriptionId: 'test-subscription',
      enabled: true, features: { aks: true, customInfra: false, templates: false }
    }]
    environments.defaultEnvironment = 'devsand'
    const deploy = vi.mocked(api.deployToAKS).mockResolvedValue({ success: true })
    const wrapper = shallowMount(AKSDeployPage, { global: { plugins: [pinia] } })
    await wrapper.get('#appname').setValue('myapp')
    await wrapper.get('#createPostgresDb').setValue(true)
    expect(wrapper.get('#postgresDatabaseName').text()).toBe('myappdb1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(deploy).toHaveBeenCalledWith(expect.objectContaining({
      appname: 'myapp', envname: 'devsand', create_postgres_db: 'true'
    }))
    wrapper.unmount()
  })

  it('disables PostgreSQL for mismatched namespaces and clears previous selections', async () => {
    const pinia = createPinia()
    const environments = useEnvironmentsStore(pinia)
    environments.environments = [{
      id: 'devsand', displayName: 'Dev Sandbox', subscriptionId: 'test-subscription',
      enabled: true, features: { aks: true, customInfra: false, templates: false }
    }]
    environments.defaultEnvironment = 'devsand'
    const deploy = vi.mocked(api.deployToAKS).mockResolvedValue({ success: true })
    const wrapper = shallowMount(AKSDeployPage, { global: { plugins: [pinia] } })
    const checkbox = wrapper.get('#createPostgresDb')

    expect(checkbox.attributes()).toHaveProperty('disabled')
    await wrapper.get('#appname').setValue('sample')
    await flushPromises()
    expect(checkbox.attributes()).not.toHaveProperty('disabled')
    await checkbox.setValue(true)
    expect(wrapper.get('#postgresDatabaseName').text()).toBe('sampledb1')

    await wrapper.get('#namespace').setValue('other-namespace')
    await flushPromises()
    expect(checkbox.attributes()).toHaveProperty('disabled')
    expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.find('#postgresDatabaseName').exists()).toBe(false)
    expect(wrapper.text()).toContain('keep the namespace identical')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(deploy).toHaveBeenCalledWith(expect.objectContaining({
      create_postgres_db: 'false', namespace: 'other-namespace'
    }))
    wrapper.unmount()
  })

  it('disables PostgreSQL when the app name exceeds 60 characters', async () => {
    const pinia = createPinia()
    const environments = useEnvironmentsStore(pinia)
    environments.environments = [{
      id: 'sand', displayName: 'Sandbox', subscriptionId: 'test-subscription',
      enabled: true, features: { aks: true, customInfra: false, templates: false }
    }]
    environments.defaultEnvironment = 'sand'
    const wrapper = shallowMount(AKSDeployPage, { global: { plugins: [pinia] } })
    const checkbox = wrapper.get('#createPostgresDb')
    await wrapper.get('#appname').setValue('myapp')
    await flushPromises()
    await checkbox.setValue(true)
    expect((checkbox.element as HTMLInputElement).checked).toBe(true)
    const longName = 'a'.repeat(61)
    await wrapper.get('#appname').setValue(longName)
    await flushPromises()
    expect(checkbox.attributes()).toHaveProperty('disabled')
    expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).toContain('60 characters or fewer')
    wrapper.unmount()
  })
  it('supports the approved sand private-gateway profile', async () => {
    const pinia = createPinia()
    const environments = useEnvironmentsStore(pinia)
    environments.environments = [{
      id: 'sand',
      displayName: 'Sandbox',
      subscriptionId: 'test-subscription',
      enabled: true,
      features: { aks: true, customInfra: false, templates: false }
    }]
    environments.defaultEnvironment = 'sand'
    const deploy = vi.mocked(api.deployToAKS).mockResolvedValue({ success: true })
    const wrapper = shallowMount(AKSDeployPage, { global: { plugins: [pinia] } })
    await wrapper.get('#appname').setValue('sand-demo')
    await flushPromises()
    expect(wrapper.get('#exposureMode').find('option[value="private-gateway"]').exists()).toBe(true)
    await wrapper.get('#exposureMode').setValue('private-gateway')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(deploy).toHaveBeenCalledWith(expect.objectContaining({
      envname: 'sand', appname: 'sand-demo', namespace: 'sand-demo',
      exposure_mode: 'private-gateway'
    }))
    wrapper.unmount()
  })
})
