import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import AKSInstalledAppsPage from './AKSInstalledAppsPage.vue'
import api from '@v2/services/api'

vi.mock('@v2/services/api', () => ({
  default: { getAKSApps: vi.fn() }
}))

describe('AKS Installed Apps — Kong endpoint', () => {
  it('displays an opt-in private endpoint as a link without falsely marking it Ready', async () => {
    vi.mocked(api.getAKSApps).mockResolvedValue({
      success: true,
      data: [
        {
          appname: 'testk', namespace: 'testk', environment: 'devsand',
          imageName: 'hashicorp/http-echo', imageTag: '1.0.0',
          owner: 'tester', deployedAt: '2026-10-22T21:38:36Z', status: 'deployed',
          exposureMode: 'private-gateway',
          exposureUrl: 'https://testk.private.devsand.example.com',
          postgresDatabase: {
            enabled: true, database_name: 'testkdb1', parent_server: 'devsand-wus3-psql-1',
            parent_resource_group: 'devsand-wus3-psql-rg-1', managed_by: 'aso',
            reconcile_policy: 'detach-on-delete', deletion_policy: 'retain-until-approved'
          },
          gitops: {
            repository: 'organization/flux-config', cluster: 'devsand-wus3-aks-1',
            namespace: 'testk', namespaceOwned: true, appPath: 'clusters/devsand/testk',
            owners: [{ name: 'app-testk', manifest: 'app-testk.yaml', path: 'apps/testk',
              role: 'workload', prune: true }]
          }
        },
        {
          appname: 'legacy', namespace: 'legacy', environment: 'devsand',
          imageName: 'image', imageTag: '1.0.0',
          owner: 'tester', deployedAt: '2026-10-22T21:38:36Z', status: 'deployed',
          exposureMode: 'legacy',
          exposureUrl: null
        }
      ]
    })
    const wrapper = mount(AKSInstalledAppsPage, {
      global: { plugins: [createPinia()] }
    })
    await flushPromises()
    const link = wrapper.get('a[href="https://testk.private.devsand.example.com"]')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(wrapper.text()).toContain('Access depends on rollout readiness and approved network')
    expect(wrapper.findAll('a[href*="private.devsand"]')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('TLS Ready')
    expect(wrapper.text()).toContain('testkdb1')
    expect(wrapper.text()).toContain('retain-until-approved')
    expect(wrapper.text()).toContain('1 Flux owner(s)')
    wrapper.unmount()
  })
})
