import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SecretsPage from './SecretsPage.vue'
import apiService from '@v2/services/api'

vi.mock('@v2/services/api', () => ({
  default: {
    getSecretApps: vi.fn(),
    getSecrets: vi.fn(),
    submitSecret: vi.fn(),
    setVaultNameOverride: vi.fn()
  }
}))

const app = { name: 'mlops', environment: 'dev', tier: 'non-production' as const }

const vaults = [
  { vaultDir: 'infrastructure/mlops/dev/keyvault01', vaultName: 'mlops-dev-kv-1', resourceGroup: null },
  { vaultDir: 'infrastructure/mlops/dev/keyvault02', vaultName: 'mlops-dev-kv-2', resourceGroup: null }
]

function envCheckbox(wrapper: ReturnType<typeof mount>, environment: string) {
  return wrapper.find(`input[type="checkbox"][value="${environment}"]`)
}

async function checkEnvironment(wrapper: ReturnType<typeof mount>, environment: string) {
  await envCheckbox(wrapper, environment).setValue(true)
  await flushPromises()
}

// secrets-environment-bundles (spec.md §2.7): the legacy free-multi-select flow this whole
// pre-existing test file exercises now lives behind the "All Environments" tab — "Bundles" is the
// new default tab. Every pre-existing test switches tabs first so its assertions keep exercising
// the exact same (unchanged) legacy DOM/behavior as before the tabs were introduced.
async function switchToAllEnvironmentsTab(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('[data-testid="nav-tab-all-environments"]').trigger('click')
  await flushPromises()
}

describe('SecretsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(apiService.getSecretApps as Mock).mockResolvedValue({ success: true, data: [app] })
    ;(apiService.getSecrets as Mock).mockResolvedValue({
      success: true,
      data: [{ name: 'DATABASE_URL', vaultDir: vaults[0].vaultDir, vaultName: vaults[0].vaultName, lastUpdated: null }],
      vaults,
      correlationId: 'cid-list'
    })
  })

  it('renders environment options grouped by tier heading (FR-001)', async () => {
    ;(apiService.getSecretApps as Mock).mockResolvedValue({
      success: true,
      data: [
        { name: 'mlops', environment: 'prod', tier: 'production' },
        { name: 'mlops', environment: 'dev', tier: 'non-production' },
        { name: 'mlops', environment: 'hub', tier: 'unclassified' }
      ]
    })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)

    const legends = wrapper.findAll('legend').map(l => l.text())
    expect(legends).toEqual(['Production', 'Non-Production', 'Other'])
    expect(envCheckbox(wrapper, 'prod').exists()).toBe(true)
    expect(envCheckbox(wrapper, 'dev').exists()).toBe(true)
    expect(envCheckbox(wrapper, 'hub').exists()).toBe(true)
  })

  it('does not render a tier group with zero entries', async () => {
    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)

    // Fixture app is 'non-production' only — no Production/Other fieldset should render.
    const legends = wrapper.findAll('legend').map(l => l.text())
    expect(legends).toEqual(['Non-Production'])
  })

  it('proactively fetches secret metadata once an environment checkbox is selected (FR-002/FR-004)', async () => {
    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)

    expect(apiService.getSecretApps).toHaveBeenCalledWith('live')
    // No environment is auto-selected any more — the developer explicitly checks one.
    expect(apiService.getSecrets).not.toHaveBeenCalled()

    await checkEnvironment(wrapper, 'dev')

    expect(apiService.getSecrets).toHaveBeenCalledWith('mlops', 'dev', 'live', undefined, undefined)
    // Two vaults resolve, so the dropdown is rendered with both options + placeholder.
    expect(wrapper.find('#secret-vault').exists()).toBe(true)
    expect(wrapper.find('#secret-vault').findAll('option')).toHaveLength(3) // placeholder + 2 vaults
    expect((wrapper.find('#secret-vault').element as HTMLSelectElement).disabled).toBe(false)
  })

  it('shows the vault name in a disabled dropdown when exactly one vault resolves', async () => {
    const singleVault = [{ vaultDir: 'infrastructure/mlops/dev/keyvault01', vaultName: 'mlops-dev-kv-1', resourceGroup: null }]
    ;(apiService.getSecrets as Mock).mockResolvedValue({
      success: true,
      data: [{ name: 'DATABASE_URL', vaultDir: singleVault[0].vaultDir, vaultName: singleVault[0].vaultName, lastUpdated: null }],
      vaults: singleVault,
      correlationId: 'cid-single'
    })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')

    const vaultSelect = wrapper.find('#secret-vault')
    expect(vaultSelect.exists()).toBe(true)
    expect(vaultSelect.findAll('option')).toHaveLength(1)
    expect(vaultSelect.findAll('option')[0].text()).toBe('mlops-dev-kv-1')
    expect((vaultSelect.element as HTMLSelectElement).disabled).toBe(true)
    expect((vaultSelect.element as HTMLSelectElement).value).toBe(singleVault[0].vaultDir)
  })

  it('does not expose the repository path when the vault name cannot be resolved', async () => {
    const unresolvedVault = [{ vaultDir: 'infrastructure/commhub/dev/keyvault', vaultName: null, resourceGroup: null }]
    ;(apiService.getSecrets as Mock).mockResolvedValue({
      success: true,
      data: [],
      vaults: unresolvedVault,
      correlationId: 'cid-unresolved'
    })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')

    const vaultOption = wrapper.find('#secret-vault option')
    expect(vaultOption.text()).toBe('Key Vault name unavailable')
    expect(vaultOption.text()).not.toContain(unresolvedVault[0].vaultDir)
  })

  describe('vault-resolution-override self-heal control', () => {
    const unresolvedVault = [{ vaultDir: 'infrastructure/commhub/dev/keyvault', vaultName: null, resourceGroup: null }]

    async function mountWithUnresolvedVault() {
      ;(apiService.getSecrets as Mock).mockResolvedValue({
        success: true,
        data: [],
        vaults: unresolvedVault,
        correlationId: 'cid-unresolved'
      })
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)
      await checkEnvironment(wrapper, 'dev')
      return wrapper
    }

    it('does not show the "Set name manually" control when the vault name resolves', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)
      await checkEnvironment(wrapper, 'dev')

      expect(wrapper.text()).not.toContain('Set name manually')
    })

    it('shows a "Set name manually" control only when the selected vault has no resolved name', async () => {
      const wrapper = await mountWithUnresolvedVault()

      expect(wrapper.text()).toContain('Set name manually')
    })

    it('submits the corrected name, refetches the vault list, and hides the form on success', async () => {
      ;(apiService.setVaultNameOverride as Mock).mockResolvedValue({ success: true, data: {}, correlationId: 'cid-override' })
      const wrapper = await mountWithUnresolvedVault()

      await wrapper.find('button[aria-label="Set name manually"]').trigger('click')
      await wrapper.find('#vault-override-name').setValue('commhub-dev-kv')

      // Once saved, resolveSecretMetadata() is called again — this time the vault resolves.
      ;(apiService.getSecrets as Mock).mockResolvedValue({
        success: true,
        data: [],
        vaults: [{ vaultDir: unresolvedVault[0].vaultDir, vaultName: 'commhub-dev-kv', resourceGroup: null }],
        correlationId: 'cid-resolved'
      })

      await wrapper.find('button[data-testid="vault-override-save"]').trigger('click')
      await flushPromises()

      expect(apiService.setVaultNameOverride).toHaveBeenCalledWith(expect.objectContaining({
        vaultDir: unresolvedVault[0].vaultDir,
        name: 'commhub-dev-kv',
        appName: 'mlops',
        environment: 'dev',
        target: 'live'
      }))
      expect(wrapper.find('#vault-override-name').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Set name manually')
    })

    it('shows an inline error and keeps the form editable when submission fails', async () => {
      ;(apiService.setVaultNameOverride as Mock).mockRejectedValue({ response: { data: { error: 'vaultDir does not match a discovered vault' } } })
      const wrapper = await mountWithUnresolvedVault()

      await wrapper.find('button[aria-label="Set name manually"]').trigger('click')
      await wrapper.find('#vault-override-name').setValue('commhub-dev-kv')
      await wrapper.find('button[data-testid="vault-override-save"]').trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('vaultDir does not match a discovered vault')
      expect(wrapper.find('#vault-override-name').exists()).toBe(true)
    })
  })

  it('re-fetches the app list when the target selector changes', async () => {
    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    ;(apiService.getSecretApps as Mock).mockClear()
    ;(apiService.getSecretApps as Mock).mockResolvedValue({ success: true, data: [{ name: 'sandapp', environment: 'sand' }] })

    await wrapper.find('#secret-target').setValue('sand')
    await flushPromises()

    expect(apiService.getSecretApps).toHaveBeenCalledWith('sand')
    expect((wrapper.find('#secret-app-name').element as HTMLSelectElement).value).toBe('sandapp')
  })

  it('re-fetches vaults when the target changes but the selected app/environment remain available', async () => {
    ;(apiService.getSecretApps as Mock).mockResolvedValue({
      success: true,
      // Same app/environment exists for both targets in this test.
      data: [app]
    })
    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')
    ;(apiService.getSecrets as Mock).mockClear()

    await wrapper.find('#secret-target').setValue('sand')
    await flushPromises()

    expect(apiService.getSecrets).toHaveBeenCalledWith('mlops', 'dev', 'sand', undefined, undefined)
    expect(wrapper.find('#secret-vault').exists()).toBe(true)
  })

  it('requires a valid Jira/CR ticket before submission', async () => {
    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')

    await wrapper.find('#secret-jira').setValue('not-a-ticket')
    await wrapper.find('#secret-name-0').setValue('api-token')
    await wrapper.find('#secret-value-0').setValue('one')
    await wrapper.find('#secret-confirmation-0').setValue('one')
    await wrapper.find('form').trigger('submit')

    expect(apiService.submitSecret).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Use a format like JIRA-1234 or CR-5678.')
  })

  it('blocks submission until the confirmation value matches', async () => {
    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')

    await wrapper.find('#secret-jira').setValue('JIRA-1234')
    await wrapper.find('#secret-name-0').setValue('api-token')
    await wrapper.find('#secret-value-0').setValue('one')
    await wrapper.find('#secret-confirmation-0').setValue('two')
    await wrapper.find('form').trigger('submit')

    expect(apiService.submitSecret).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Values do not match.')
  })

  it('rejects duplicate secret names within the same batch', async () => {
    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')

    await wrapper.find('#secret-jira').setValue('JIRA-1234')
    await wrapper.find('#secret-name-0').setValue('api-token')
    await wrapper.find('#secret-value-0').setValue('one')
    await wrapper.find('#secret-confirmation-0').setValue('one')

    await wrapper.find('button.border-blue-600').trigger('click') // Add Secret
    await wrapper.find('#secret-name-1').setValue('api-token')
    await wrapper.find('#secret-value-1').setValue('two')
    await wrapper.find('#secret-confirmation-1').setValue('two')

    await wrapper.find('form').trigger('submit')

    expect(apiService.submitSecret).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Duplicate secret name in this submission.')
  })

  it('adds and removes secret rows, capping at 20 and floor of 1', async () => {
    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)

    const addButton = wrapper.find('button.border-blue-600')
    for (let i = 0; i < 19; i++) {
      await addButton.trigger('click')
    }
    expect(wrapper.findAll('input[id^="secret-name-"]')).toHaveLength(20)
    expect(addButton.attributes('disabled')).toBeDefined()

    for (let i = 0; i < 19; i++) {
      await wrapper.findAll('button').filter(b => b.text() === 'Remove')[0].trigger('click')
    }
    expect(wrapper.findAll('input[id^="secret-name-"]')).toHaveLength(1)
  })

  it('submits a single-environment batch and shows the pull request result', async () => {
    ;(apiService.submitSecret as Mock).mockResolvedValue({
      success: true,
      correlationId: 'cid-test',
      prNumber: 42,
      prUrl: 'https://github.com/example/pull/42',
      secretCount: 2,
      results: [{ environment: 'dev', success: true, prNumber: 42, prUrl: 'https://github.com/example/pull/42', secretCount: 2 }]
    })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')

    await wrapper.find('#secret-jira').setValue('JIRA-1234')
    await wrapper.find('#secret-name-0').setValue('api-token')
    await wrapper.find('#secret-value-0').setValue('one')
    await wrapper.find('#secret-confirmation-0').setValue('one')

    await wrapper.find('button.border-blue-600').trigger('click')
    await wrapper.find('#secret-name-1').setValue('db-password')
    await wrapper.find('#secret-value-1').setValue('two')
    await wrapper.find('#secret-confirmation-1').setValue('two')

    await wrapper.find('#secret-vault').setValue(vaults[0].vaultDir)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiService.submitSecret).toHaveBeenCalledWith({
      target: 'live',
      appName: 'mlops',
      environments: ['dev'],
      vaultDir: vaults[0].vaultDir,
      qualifier: undefined,
      jiraTicket: 'JIRA-1234',
      secrets: [
        { secretName: 'api-token', secretValue: 'one' },
        { secretName: 'db-password', secretValue: 'two' }
      ],
      confirmedProductionWrite: false
    })
    // StatusModal teleports to body, so terminal state is asserted on the document.
    expect(document.body.textContent).toContain('2 secrets encrypted and PR #42 opened for review.')
    expect(document.body.querySelector('a[href="https://github.com/example/pull/42"]')).not.toBeNull()
    // Form resets to a single empty row and clears the environment selection after success.
    expect(wrapper.findAll('input[id^="secret-name-"]')).toHaveLength(1)
    expect(envCheckbox(wrapper, 'dev').element.checked).toBe(false)
  })

  it('shows the submitting/loading state immediately on click, before the vault re-resolution call resolves', async () => {
    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')

    await wrapper.find('#secret-jira').setValue('JIRA-1234')
    await wrapper.find('#secret-name-0').setValue('api-token')
    await wrapper.find('#secret-value-0').setValue('one')
    await wrapper.find('#secret-confirmation-0').setValue('one')
    await wrapper.find('#secret-vault').setValue(vaults[0].vaultDir)

    // Simulate a slow live Key Vault re-resolution on submit (the reported 5-6s window).
    let resolveGetSecrets!: (value: unknown) => void
    ;(apiService.getSecrets as Mock).mockImplementation(
      () => new Promise(resolve => { resolveGetSecrets = resolve })
    )

    await wrapper.find('form').trigger('submit')

    const submitButton = wrapper.find('button[type="submit"]')
    expect(submitButton.attributes('disabled')).toBeDefined()
    expect(submitButton.text()).toBe('Encrypting and opening pull request...')
    expect(apiService.submitSecret).not.toHaveBeenCalled()

    resolveGetSecrets({ success: true, data: [], vaults: [vaults[0]], qualifiers: [] })
    await flushPromises()

    expect(apiService.submitSecret).toHaveBeenCalled()
  })

  it('lets a developer select multiple environments and fans out in one submission (FR-002/FR-004)', async () => {
    ;(apiService.getSecretApps as Mock).mockResolvedValue({
      success: true,
      data: [
        { name: 'mlops', environment: 'dev', tier: 'non-production' },
        { name: 'mlops', environment: 'qa', tier: 'non-production' }
      ]
    })
    ;(apiService.getSecrets as Mock).mockResolvedValue({
      success: true,
      data: [],
      vaults: [vaults[0]],
      qualifiers: []
    })
    ;(apiService.submitSecret as Mock).mockResolvedValue({
      success: true,
      correlationId: 'cid-fanout',
      secretCount: 1,
      results: [
        { environment: 'dev', success: true, prNumber: 10, prUrl: 'https://github.com/example/pull/10' },
        { environment: 'qa', success: true, prNumber: 11, prUrl: 'https://github.com/example/pull/11' }
      ]
    })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')
    await checkEnvironment(wrapper, 'qa')

    await wrapper.find('#secret-jira').setValue('JIRA-1234')
    await wrapper.find('#secret-name-0').setValue('api-token')
    await wrapper.find('#secret-value-0').setValue('one')
    await wrapper.find('#secret-confirmation-0').setValue('one')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiService.submitSecret).toHaveBeenCalledWith(expect.objectContaining({
      environments: expect.arrayContaining(['dev', 'qa'])
    }))
    expect(document.body.textContent).toContain('2 environments updated successfully.')
  })

  it('excludes an ambiguous-vault environment from the batch without blocking the others (FR-003)', async () => {
    ;(apiService.getSecretApps as Mock).mockResolvedValue({
      success: true,
      data: [
        { name: 'mlops', environment: 'dev', tier: 'non-production' },
        { name: 'mlops', environment: 'qa', tier: 'non-production' }
      ]
    })
    ;(apiService.getSecrets as Mock).mockImplementation((appName: string, environment: string) => {
      if (environment === 'qa') {
        return Promise.resolve({ success: true, data: [], vaults: [vaults[0], vaults[1]], qualifiers: [] })
      }
      return Promise.resolve({ success: true, data: [], vaults: [vaults[0]], qualifiers: [] })
    })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')
    await checkEnvironment(wrapper, 'qa')

    expect(wrapper.text()).toContain('Multiple Key Vaults found; submit individually.')

    await wrapper.find('#secret-jira').setValue('JIRA-1234')
    await wrapper.find('#secret-name-0').setValue('api-token')
    await wrapper.find('#secret-value-0').setValue('one')
    await wrapper.find('#secret-confirmation-0').setValue('one')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    // Only the unambiguous 'dev' environment is submitted; 'qa' is excluded (FR-003(c)/(f)).
    expect(apiService.submitSecret).toHaveBeenCalledWith(expect.objectContaining({ environments: ['dev'] }))
  })

  it('shows a one-click production write confirmation before submitting (FR-007)', async () => {
    ;(apiService.getSecretApps as Mock).mockResolvedValue({
      success: true,
      data: [{ name: 'mlops', environment: 'prod', tier: 'production' }]
    })
    ;(apiService.submitSecret as Mock).mockResolvedValue({
      success: true,
      correlationId: 'cid-prod',
      prNumber: 99,
      prUrl: 'https://github.com/example/pull/99',
      secretCount: 1,
      results: [{ environment: 'prod', success: true, prNumber: 99, prUrl: 'https://github.com/example/pull/99' }]
    })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'prod')

    await wrapper.find('#secret-jira').setValue('JIRA-1234')
    await wrapper.find('#secret-name-0').setValue('api-token')
    await wrapper.find('#secret-value-0').setValue('one')
    await wrapper.find('#secret-confirmation-0').setValue('one')
    await wrapper.find('#secret-vault').setValue(vaults[0].vaultDir)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    // No API call yet — the confirmation dialog must appear first (FR-007(a)).
    expect(apiService.submitSecret).not.toHaveBeenCalled()
    const dialog = wrapper.find('[data-testid="confirm-production-write-dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('prod')

    await wrapper.find('[data-testid="confirm-production-write-yes"]').trigger('click')
    await flushPromises()

    expect(apiService.submitSecret).toHaveBeenCalledWith(expect.objectContaining({ confirmedProductionWrite: true }))
  })

  it('cancelling the production write confirmation makes no API call (FR-007(c))', async () => {
    ;(apiService.getSecretApps as Mock).mockResolvedValue({
      success: true,
      data: [{ name: 'mlops', environment: 'prod', tier: 'production' }]
    })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'prod')

    await wrapper.find('#secret-jira').setValue('JIRA-1234')
    await wrapper.find('#secret-name-0').setValue('api-token')
    await wrapper.find('#secret-value-0').setValue('one')
    await wrapper.find('#secret-confirmation-0').setValue('one')
    await wrapper.find('#secret-vault').setValue(vaults[0].vaultDir)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    await wrapper.find('[data-testid="confirm-production-write-cancel"]').trigger('click')
    await flushPromises()

    expect(apiService.submitSecret).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="confirm-production-write-dialog"]').exists()).toBe(false)
  })

  it('does not show the production confirmation when only non-production environments are selected', async () => {
    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')

    ;(apiService.submitSecret as Mock).mockResolvedValue({
      success: true,
      correlationId: 'cid-nonprod',
      prNumber: 5,
      prUrl: 'https://github.com/example/pull/5',
      secretCount: 1,
      results: [{ environment: 'dev', success: true, prNumber: 5, prUrl: 'https://github.com/example/pull/5' }]
    })

    await wrapper.find('#secret-jira').setValue('JIRA-1234')
    await wrapper.find('#secret-name-0').setValue('api-token')
    await wrapper.find('#secret-value-0').setValue('one')
    await wrapper.find('#secret-confirmation-0').setValue('one')
    await wrapper.find('#secret-vault').setValue(vaults[0].vaultDir)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid="confirm-production-write-dialog"]').exists()).toBe(false)
    expect(apiService.submitSecret).toHaveBeenCalledWith(expect.objectContaining({ confirmedProductionWrite: false }))
  })

  it('a maximum of 10 environments can be selected per submission (FR-002(e))', async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ name: 'mlops', environment: `env${i}`, tier: 'non-production' as const }))
    ;(apiService.getSecretApps as Mock).mockResolvedValue({ success: true, data: many })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)

    for (let i = 0; i < 10; i++) {
      await checkEnvironment(wrapper, `env${i}`)
    }
    expect(wrapper.text()).toContain('Maximum 10 environments per submission.')
    expect((envCheckbox(wrapper, 'env10').element as HTMLInputElement).disabled).toBe(true)
  })

  it('separates application and environment selection, scoped per app', async () => {
    const secondEnvApp = { ...app, environment: 'sand' }
    const otherApp = { name: 'webapp01', environment: 'dev', tier: 'non-production' as const }
    ;(apiService.getSecretApps as Mock).mockResolvedValue({
      success: true,
      data: [app, secondEnvApp, otherApp]
    })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)

    const appSelect = wrapper.find('#secret-app-name')
    expect(appSelect.exists()).toBe(true)
    expect(appSelect.findAll('option[value="mlops"]')).toHaveLength(1)
    expect(envCheckbox(wrapper, 'dev').exists()).toBe(true)
    expect(envCheckbox(wrapper, 'sand').exists()).toBe(true)

    await appSelect.setValue('webapp01')
    await flushPromises()

    // Environment selection resets and is scoped to the newly selected app.
    expect(envCheckbox(wrapper, 'sand').exists()).toBe(false)
    expect(envCheckbox(wrapper, 'dev').exists()).toBe(true)
    expect(apiService.getSecrets).not.toHaveBeenCalled()

    await checkEnvironment(wrapper, 'dev')
    expect(apiService.getSecrets).toHaveBeenCalledWith('webapp01', 'dev', 'live', undefined, undefined)
  })

  it('deduplicates environments when an app has multiple qualifier entries for the same env (Bug 3 fix)', async () => {
    ;(apiService.getSecretApps as Mock).mockResolvedValue({
      success: true,
      data: [
        { name: 'idm', environment: 'cint', qualifier: 'notif' },
        { name: 'idm', environment: 'cint', qualifier: 'autobk' },
        { name: 'idm', environment: 'dev' }
      ]
    })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)

    expect(envCheckbox(wrapper, 'cint').exists()).toBe(true)
    expect(wrapper.findAll('input[type="checkbox"][value="cint"]')).toHaveLength(1)
    expect(envCheckbox(wrapper, 'dev').exists()).toBe(true)
  })

  it('keeps a shared parent vault selectable beside a nested application vault', async () => {
    const parentVault = { vaultDir: 'infrastructure/idm/keyvault', vaultName: 'idm-shared', resourceGroup: null }
    const nestedVault = {
      vaultDir: 'infrastructure/idm/_idmapplications/notif/dev/keyvault',
      vaultName: 'idm-notif-dev',
      resourceGroup: null,
      qualifier: 'notif'
    }
    ;(apiService.getSecretApps as Mock).mockResolvedValue({
      success: true,
      data: [{ name: 'idm', environment: 'dev', qualifier: 'notif' }]
    })
    ;(apiService.getSecrets as Mock).mockResolvedValue({
      success: true,
      data: [],
      vaults: [parentVault, nestedVault],
      qualifiers: ['notif']
    })
    ;(apiService.submitSecret as Mock).mockResolvedValue({
      success: true,
      prNumber: 7,
      secretCount: 1,
      results: [{ environment: 'dev', success: true, prNumber: 7 }]
    })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')

    await wrapper.find('#secret-jira').setValue('JIRA-1234')
    await wrapper.find('#secret-name-0').setValue('api-token')
    await wrapper.find('#secret-value-0').setValue('one')
    await wrapper.find('#secret-confirmation-0').setValue('one')

    expect(apiService.getSecrets).toHaveBeenCalledWith('idm', 'dev', 'live', undefined, undefined)
    expect(wrapper.find('#secret-vault').exists()).toBe(true)
    expect(wrapper.find('#secret-qualifier').exists()).toBe(false)

    await wrapper.find('#secret-vault').setValue(parentVault.vaultDir)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiService.getSecrets).toHaveBeenLastCalledWith('idm', 'dev', 'live', undefined, undefined)
    expect(apiService.submitSecret).toHaveBeenLastCalledWith(expect.objectContaining({
      vaultDir: parentVault.vaultDir,
      qualifier: undefined
    }))
  })

  it('resolves a root-vault environment with multiple sibling qualifiers by picking the Key Vault directly, without also requiring a sub-application (real idm/dev shape: root + idmprtl + notif)', async () => {
    const rootVault = { vaultDir: 'infrastructure/idm/dev/keyvault', vaultName: 'idm-dev-uks-kv-1', resourceGroup: null }
    const idmprtlVault = { vaultDir: 'infrastructure/idm/_idmapplications/idmprtl/dev/keyvault', vaultName: 'idmprtl-dev-uks-kv-1', resourceGroup: null, qualifier: 'idmprtl' }
    const notifVault = { vaultDir: 'infrastructure/idm/_idmapplications/notif/dev/keyvault', vaultName: 'notif-dev-uks-kv-1', resourceGroup: null, qualifier: 'notif' }
    ;(apiService.getSecretApps as Mock).mockResolvedValue({
      success: true,
      data: [{ name: 'idm', environment: 'dev' }]
    })
    ;(apiService.getSecrets as Mock).mockRejectedValue({
      response: { data: { success: false, error: 'Multiple sub-app qualifiers found; qualifier is required', qualifiers: ['idmprtl', 'notif'], vaults: [idmprtlVault, notifVault, rootVault] } }
    })
    ;(apiService.submitSecret as Mock).mockResolvedValue({
      success: true,
      prNumber: 9,
      secretCount: 1,
      results: [{ environment: 'dev', success: true, prNumber: 9 }]
    })

    const wrapper = mount(SecretsPage)
    await flushPromises()
    await switchToAllEnvironmentsTab(wrapper)
    await checkEnvironment(wrapper, 'dev')

    await wrapper.find('#secret-jira').setValue('JIRA-1234')
    await wrapper.find('#secret-name-0').setValue('api-token')
    await wrapper.find('#secret-value-0').setValue('one')
    await wrapper.find('#secret-confirmation-0').setValue('one')

    expect(wrapper.find('#secret-vault').findAll('option').map(o => o.text())).toEqual(
      expect.arrayContaining(['idm-dev-uks-kv-1'])
    )

    await wrapper.find('#secret-vault').setValue(rootVault.vaultDir)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiService.submitSecret).toHaveBeenLastCalledWith(expect.objectContaining({
      vaultDir: rootVault.vaultDir,
      qualifier: undefined
    }))
  })

  describe('grouped Application selector with nested qualifiers', () => {
    // idm: 4 qualifiers (mixed with an unqualified 'shared' entry -> root-only option expected).
    // exampleApplications: qualified-only (no root-only option expected). webapp01: flat (unqualified).
    const groupedApps = [
      { name: 'idm', environment: 'cint', qualifier: 'autobk', tier: 'non-production' as const },
      { name: 'idm', environment: 'dev', qualifier: 'autobk', tier: 'non-production' as const },
      { name: 'idm', environment: 'cint', qualifier: 'notif', tier: 'non-production' as const },
      { name: 'idm', environment: 'uniquenotif', qualifier: 'notif', tier: 'non-production' as const },
      { name: 'idm', environment: 'cint', qualifier: 'idmprtl', tier: 'non-production' as const },
      { name: 'idm', environment: 'cint', qualifier: 'allctmpr', tier: 'non-production' as const },
      { name: 'idm', environment: 'shared', tier: 'non-production' as const },
      { name: 'exampleApplications', environment: 'dev', qualifier: 'core', tier: 'non-production' as const },
      { name: 'webapp01', environment: 'dev', tier: 'non-production' as const }
    ]

    beforeEach(() => {
      ;(apiService.getSecretApps as Mock).mockResolvedValue({ success: true, data: groupedApps })
    })

    it('renders one option per qualifier under a single optgroup for a root app with 4 qualifiers', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      const idmGroup = wrapper.find('optgroup[label="idm"]')
      expect(idmGroup.exists()).toBe(true)
      const qualifierOptions = idmGroup.findAll('option').filter(o => o.attributes('value') !== 'idm::')
      expect(qualifierOptions).toHaveLength(4)
      expect(new Set(qualifierOptions.map(o => o.attributes('value'))).size).toBe(4)
    })

    it('renders a flat, non-composite option for a root app with no qualified entries', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      const flatOptions = wrapper.findAll('option[value="webapp01"]')
      expect(flatOptions).toHaveLength(1)
      expect(flatOptions[0].element.closest('optgroup')).toBeNull()
    })

    it('renders a root-only option for a root app with mixed qualified and unqualified entries', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      expect(wrapper.find('option[value="idm::"]').exists()).toBe(true)
    })

    it('renders no root-only option for a root app with only qualified entries', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      expect(wrapper.find('option[value="exampleApplications::"]').exists()).toBe(false)
    })

    it('scopes the environment list to the selected qualifier synchronously, without an API round-trip', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)
      ;(apiService.getSecrets as Mock).mockClear()

      await wrapper.find('#secret-app-name').setValue('idm::autobk')

      // Scoping is already correct on the same DOM-flush tick as the selection itself.
      expect(apiService.getSecrets).not.toHaveBeenCalled()
      expect(envCheckbox(wrapper, 'cint').exists()).toBe(true)
      expect(envCheckbox(wrapper, 'dev').exists()).toBe(true)
      expect(envCheckbox(wrapper, 'uniquenotif').exists()).toBe(false)
      expect(envCheckbox(wrapper, 'shared').exists()).toBe(false)
    })

    it('shows an environment unique to a sibling qualifier only when that qualifier is selected', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      await wrapper.find('#secret-app-name').setValue('idm::autobk')
      expect(envCheckbox(wrapper, 'uniquenotif').exists()).toBe(false)

      await wrapper.find('#secret-app-name').setValue('idm::notif')
      expect(envCheckbox(wrapper, 'uniquenotif').exists()).toBe(true)
    })

    it('scopes the environment list to unqualified entries only when the root-only option is selected', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      await wrapper.find('#secret-app-name').setValue('idm::')

      expect(envCheckbox(wrapper, 'shared').exists()).toBe(true)
      expect(envCheckbox(wrapper, 'cint').exists()).toBe(false)
      expect(envCheckbox(wrapper, 'uniquenotif').exists()).toBe(false)
    })

    it("loadApps()'s auto-select leaves the environment list showing the union across all qualifiers (unresolved state)", async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      // idm is auto-selected as the first app; no explicit selector choice was made yet.
      expect(envCheckbox(wrapper, 'cint').exists()).toBe(true)
      expect(envCheckbox(wrapper, 'uniquenotif').exists()).toBe(true)
      expect(envCheckbox(wrapper, 'shared').exists()).toBe(true)
    })

    it('resets environment selection when switching between qualifier options', async () => {
      ;(apiService.getSecrets as Mock).mockResolvedValue({ success: true, data: [], vaults: [vaults[0]], qualifiers: [] })
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      await wrapper.find('#secret-app-name').setValue('idm::autobk')
      await checkEnvironment(wrapper, 'cint')
      expect(envCheckbox(wrapper, 'cint').element.checked).toBe(true)

      await wrapper.find('#secret-app-name').setValue('idm::notif')
      await flushPromises()

      expect(envCheckbox(wrapper, 'cint').element.checked).toBe(false)
    })

    it('resets qualifier state when switching from a qualified selection to an unrelated flat app', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      await wrapper.find('#secret-app-name').setValue('idm::autobk')
      expect(envCheckbox(wrapper, 'cint').exists()).toBe(true)

      await wrapper.find('#secret-app-name').setValue('webapp01')

      // webapp01 has no 'cint' environment; if selectedQualifier/isRootOnlySelected leaked over,
      // filteredEnvironmentOptions would still be scoped to idm's qualifier and render nothing.
      expect(envCheckbox(wrapper, 'dev').exists()).toBe(true)
      expect(envCheckbox(wrapper, 'cint').exists()).toBe(false)
    })

    it('passes the pre-selected qualifier to api.getSecrets for multi-environment eligibility resolution', async () => {
      ;(apiService.getSecrets as Mock).mockResolvedValue({ success: true, data: [], vaults: [vaults[0]], qualifiers: [] })
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      await wrapper.find('#secret-app-name').setValue('idm::autobk')
      await checkEnvironment(wrapper, 'cint')
      await checkEnvironment(wrapper, 'dev')

      expect(apiService.getSecrets).toHaveBeenCalledWith('idm', 'cint', 'live', undefined, 'autobk')
      expect(apiService.getSecrets).toHaveBeenCalledWith('idm', 'dev', 'live', undefined, 'autobk')
    })
  })

  // secrets-app-selector-qualifiers (spec.json acceptance_criteria/functional_test_scenarios).
  // Extends the existing suite rather than duplicating the Bug-3-fix/shared-parent-vault tests above.
  describe('grouped Application selector by root app + qualifier (FR-001..FR-005)', () => {
    const idmMixedFixture = [
      { name: 'idm', environment: 'cint', qualifier: 'autobk' },
      { name: 'idm', environment: 'cint', qualifier: 'notif' },
      { name: 'idm', environment: 'cint', qualifier: 'idmprtl' },
      { name: 'idm', environment: 'cint', qualifier: 'allctmpr' },
      { name: 'idm', environment: 'dev' }
    ]
    const exampleFixture = [{ name: 'exampleApplications', environment: 'dev', qualifier: 'shared' }]
    const flatFixture = [{ name: 'webapp01', environment: 'dev', tier: 'non-production' as const }]

    it('renders one option per qualifier under a single optgroup (4 IDM qualifiers)', async () => {
      ;(apiService.getSecretApps as Mock).mockResolvedValue({ success: true, data: idmMixedFixture })
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      expect(wrapper.find('optgroup[label="idm"]').exists()).toBe(true)
      for (const qualifier of ['autobk', 'notif', 'idmprtl', 'allctmpr']) {
        expect(wrapper.findAll(`option[value="idm::${qualifier}"]`)).toHaveLength(1)
      }
    })

    it('renders exactly one flat, non-composite option for a root app with no qualified entries', async () => {
      ;(apiService.getSecretApps as Mock).mockResolvedValue({ success: true, data: flatFixture })
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      expect(wrapper.findAll('option[value="webapp01"]')).toHaveLength(1)
    })

    it('renders a root-only option for a root app with mixed qualified and unqualified entries', async () => {
      ;(apiService.getSecretApps as Mock).mockResolvedValue({ success: true, data: idmMixedFixture })
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      expect(wrapper.find('option[value="idm::"]').exists()).toBe(true)
    })

    it('renders no root-only option for a root app with only qualified entries (exampleApplications)', async () => {
      ;(apiService.getSecretApps as Mock).mockResolvedValue({ success: true, data: exampleFixture })
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      expect(wrapper.find('option[value="exampleApplications::"]').exists()).toBe(false)
      expect(wrapper.find('option[value="exampleApplications::shared"]').exists()).toBe(true)
    })

    it('selecting a qualifier option scopes the environment selector to that exact {app, qualifier}', async () => {
      const notifOnlyEnvFixture = [
        { name: 'idm', environment: 'cint', qualifier: 'autobk' },
        { name: 'idm', environment: 'notif-only-env', qualifier: 'notif' }
      ]
      ;(apiService.getSecretApps as Mock).mockResolvedValue({ success: true, data: notifOnlyEnvFixture })
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      const appSelect = wrapper.find('#secret-app-name')
      await appSelect.setValue('idm::autobk')
      await flushPromises()
      expect(envCheckbox(wrapper, 'notif-only-env').exists()).toBe(false)
      expect(envCheckbox(wrapper, 'cint').exists()).toBe(true)

      await appSelect.setValue('idm::notif')
      await flushPromises()
      expect(envCheckbox(wrapper, 'notif-only-env').exists()).toBe(true)
    })

    it('selecting the root-only option filters environments to unqualified entries only', async () => {
      ;(apiService.getSecretApps as Mock).mockResolvedValue({ success: true, data: idmMixedFixture })
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      const appSelect = wrapper.find('#secret-app-name')
      await appSelect.setValue('idm::')
      await flushPromises()
      expect(envCheckbox(wrapper, 'dev').exists()).toBe(true)
      expect(envCheckbox(wrapper, 'cint').exists()).toBe(false)
    })

    it("loadApps()'s auto-select leaves the unresolved (union-by-app.name) state, never root-only", async () => {
      ;(apiService.getSecretApps as Mock).mockResolvedValue({ success: true, data: idmMixedFixture })
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      // Unresolved state must keep today's union-by-app.name behavior (Bug 3 fix), not root-only filtering.
      expect(envCheckbox(wrapper, 'cint').exists()).toBe(true)
      expect(envCheckbox(wrapper, 'dev').exists()).toBe(true)
    })

    it('passes the pre-selected qualifier to api.getSecrets for multi-environment fan-out (Round 2 fix)', async () => {
      const twoEnvFixture = [
        { name: 'idm', environment: 'dev', qualifier: 'autobk' },
        { name: 'idm', environment: 'cint', qualifier: 'autobk' }
      ]
      ;(apiService.getSecretApps as Mock).mockResolvedValue({ success: true, data: twoEnvFixture })
      ;(apiService.getSecrets as Mock).mockResolvedValue({
        success: true,
        data: [],
        vaults: [{ vaultDir: 'infrastructure/idm/_idmapplications/autobk/keyvault', vaultName: 'idm-autobk-kv', resourceGroup: null }],
        qualifiers: ['autobk'],
        correlationId: 'cid-multi-qualifier'
      })

      const wrapper = mount(SecretsPage)
      await flushPromises()
      await switchToAllEnvironmentsTab(wrapper)

      const appSelect = wrapper.find('#secret-app-name')
      await appSelect.setValue('idm::autobk')
      await flushPromises()

      await checkEnvironment(wrapper, 'dev')
      await checkEnvironment(wrapper, 'cint')

      expect(apiService.getSecrets).toHaveBeenCalledWith('idm', 'dev', 'live', undefined, 'autobk')
      expect(apiService.getSecrets).toHaveBeenCalledWith('idm', 'cint', 'live', undefined, 'autobk')
    })
  })

  // secrets-environment-bundles (spec.md §2.7): the new default "Bundles" tab — BundleSelector.vue
  // and BundleSecretGrid.vue wired end-to-end via useBundleSubmission, plus the shared production
  // write confirmation and StatusModal conventions reused from the legacy flow above.
  describe('bundle mode (secrets-environment-bundles)', () => {
    const bundleAppFixture = [
      { name: 'mlops', environment: 'dev', tier: 'non-production' as const, bundleId: 'core' },
      { name: 'mlops', environment: 'qa', tier: 'non-production' as const, bundleId: 'core' },
      { name: 'mlops', environment: 'prod', tier: 'production' as const, bundleId: 'core' }
    ]
    const bundleCatalogFixture = [{ id: 'core', displayName: 'Core Bundle', order: 1, releaseControlled: false }]
    const bundleVault = [{ vaultDir: 'infrastructure/mlops/dev/keyvault01', vaultName: 'mlops-kv', resourceGroup: null }]

    beforeEach(() => {
      ;(apiService.getSecretApps as Mock).mockResolvedValue({
        success: true,
        data: bundleAppFixture,
        bundles: bundleCatalogFixture
      })
      ;(apiService.getSecrets as Mock).mockResolvedValue({
        success: true,
        data: [],
        vaults: bundleVault,
        correlationId: 'cid-bundle'
      })
    })

    async function selectBundle(wrapper: ReturnType<typeof mount>, bundleId = 'core') {
      await wrapper.find('[data-testid="bundle-select"]').setValue(bundleId)
      await flushPromises()
    }

    /** Fills the Jira field, a single "api-key" secret-name row, and a matching value +
     * confirmation cell per environment (keyed by environment name). */
    async function fillBundleGrid(wrapper: ReturnType<typeof mount>, jira: string, valuesByEnvironment: Record<string, string>) {
      await wrapper.find('[data-testid="bundle-jira"]').setValue(jira)
      await wrapper.find('[data-testid="bundle-secret-name-input"]').setValue('api-key')
      for (const [environment, value] of Object.entries(valuesByEnvironment)) {
        await wrapper.find(`[data-testid="bundle-cell-value-0-${environment}"]`).setValue(value)
        await wrapper.find(`[data-testid="bundle-cell-confirmation-0-${environment}"]`).setValue(value)
      }
    }

    it('defaults to the Bundles tab on mount, with the legacy form not rendered', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()

      expect(wrapper.find('[data-testid="nav-tab-bundles"]').attributes('aria-selected')).toBe('true')
      expect(wrapper.find('[data-testid="nav-tab-all-environments"]').attributes('aria-selected')).toBe('false')
      expect(wrapper.find('[data-testid="bundle-select"]').exists()).toBe(true)
      expect(wrapper.find('#secret-jira').exists()).toBe(false)
    })

    it('only lists bundles with at least one deployed environment for the selected app (FR-002(f))', async () => {
      ;(apiService.getSecretApps as Mock).mockResolvedValue({
        success: true,
        data: bundleAppFixture,
        bundles: [...bundleCatalogFixture, { id: 'unused', displayName: 'Unused Bundle', order: 2, releaseControlled: false }]
      })
      const wrapper = mount(SecretsPage)
      await flushPromises()

      const optionLabels = wrapper.find('[data-testid="bundle-select"]').findAll('option').map(o => o.text())
      expect(optionLabels).toContain('Core Bundle')
      expect(optionLabels).not.toContain('Unused Bundle')
    })

    it('resolves eligibility for every member environment when a bundle is selected (AC3)', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()

      await selectBundle(wrapper)

      expect(apiService.getSecrets).toHaveBeenCalledWith('mlops', 'dev', 'live', undefined, undefined)
      expect(apiService.getSecrets).toHaveBeenCalledWith('mlops', 'qa', 'live', undefined, undefined)
      expect(apiService.getSecrets).toHaveBeenCalledWith('mlops', 'prod', 'live', undefined, undefined)
      expect(wrapper.findAll('[data-testid="bundle-environment-status-row"]')).toHaveLength(3)
    })

    it('scopes bundle environments and requests to the selected sub-app qualifier', async () => {
      ;(apiService.getSecretApps as Mock).mockResolvedValue({
        success: true,
        data: [
          { name: 'idm', environment: 'dev', qualifier: 'autobk', tier: 'non-production', bundleId: 'core' },
          { name: 'idm', environment: 'cint', qualifier: 'autobk', tier: 'non-production', bundleId: 'core' },
          { name: 'idm', environment: 'notif-only', qualifier: 'notif', tier: 'non-production', bundleId: 'core' }
        ],
        bundles: bundleCatalogFixture
      })
      const wrapper = mount(SecretsPage)
      await flushPromises()

      await wrapper.find('#secret-app-name').setValue('idm::autobk')
      await selectBundle(wrapper)

      expect(apiService.getSecrets).toHaveBeenCalledWith('idm', 'dev', 'live', undefined, 'autobk')
      expect(apiService.getSecrets).toHaveBeenCalledWith('idm', 'cint', 'live', undefined, 'autobk')
      expect(apiService.getSecrets).not.toHaveBeenCalledWith('idm', 'notif-only', 'live', undefined, 'autobk')
      expect(wrapper.findAll('[data-testid="bundle-environment-status-row"]').map(row => row.text())).toEqual(
        expect.arrayContaining([expect.stringContaining('dev'), expect.stringContaining('cint')])
      )
      expect(wrapper.text()).not.toContain('notif-only')
    })

    it('renders the secret grid with one column per eligible environment once a bundle resolves', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await selectBundle(wrapper)

      const grid = wrapper.find('[data-testid="bundle-secret-grid"]')
      expect(grid.exists()).toBe(true)
      expect(grid.findAll('th').map(th => th.text())).toEqual(expect.arrayContaining(['dev', 'qa', 'prod']))
    })

    it('surfaces an excluded environment with a disambiguation control, and re-resolves only that environment on selection (FR-004(g))', async () => {
      ;(apiService.getSecrets as Mock).mockImplementation((_appName: string, environment: string) => {
        if (environment === 'qa') {
          return Promise.resolve({
            success: true,
            data: [],
            vaults: [
              { vaultDir: 'infrastructure/mlops/qa/keyvault01', vaultName: 'mlops-qa-kv-1', resourceGroup: null },
              { vaultDir: 'infrastructure/mlops/qa/keyvault02', vaultName: 'mlops-qa-kv-2', resourceGroup: null }
            ],
            correlationId: 'cid-qa'
          })
        }
        return Promise.resolve({ success: true, data: [], vaults: bundleVault, correlationId: 'cid-ok' })
      })

      const wrapper = mount(SecretsPage)
      await flushPromises()
      await selectBundle(wrapper)

      expect(wrapper.find('[data-testid="bundle-excluded-environment"]').exists()).toBe(true)
      ;(apiService.getSecrets as Mock).mockClear()

      await wrapper.find('[data-testid="bundle-disambiguation-select"]').setValue('vault:infrastructure/mlops/qa/keyvault02')
      await flushPromises()

      expect(apiService.getSecrets).toHaveBeenCalledTimes(1)
      expect(apiService.getSecrets).toHaveBeenCalledWith('mlops', 'qa', 'live', 'infrastructure/mlops/qa/keyvault02', undefined)
    })

    it('submits a bundle with independent per-environment values, confirming the production write first', async () => {
      ;(apiService.submitSecret as Mock).mockResolvedValue({
        success: true,
        correlationId: 'cid-bundle-submit',
        bundleId: 'core',
        prNumber: 55,
        prUrl: 'https://github.com/example/pull/55',
        includedEnvironments: ['dev', 'qa', 'prod'],
        excludedEnvironments: [],
        secretCount: 3
      })

      const wrapper = mount(SecretsPage)
      await flushPromises()
      await selectBundle(wrapper)

      await fillBundleGrid(wrapper, 'JIRA-9999', { dev: 'dev-value', qa: 'qa-value', prod: 'prod-value' })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      // A production-tier member environment gates on the shared confirmation dialog, same as
      // the legacy flow (FR-007), before any submitSecret call fires.
      expect(apiService.submitSecret).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="confirm-production-write-dialog"]').exists()).toBe(true)

      await wrapper.find('[data-testid="confirm-production-write-yes"]').trigger('click')
      await flushPromises()

      expect(apiService.submitSecret).toHaveBeenCalledWith(expect.objectContaining({
        target: 'live',
        appName: 'mlops',
        bundleId: 'core',
        jiraTicket: 'JIRA-9999',
        environmentSecrets: expect.arrayContaining([
          expect.objectContaining({ environment: 'dev', secrets: [{ secretName: 'api-key', secretValue: 'dev-value' }] }),
          expect.objectContaining({ environment: 'qa', secrets: [{ secretName: 'api-key', secretValue: 'qa-value' }] }),
          expect.objectContaining({ environment: 'prod', secrets: [{ secretName: 'api-key', secretValue: 'prod-value' }] })
        ])
      }))
      // StatusModal teleports to body, so terminal state is asserted on the document.
      expect(document.body.textContent).toContain('PR #55')
      expect(document.body.querySelector('a[href="https://github.com/example/pull/55"]')).not.toBeNull()
      // Bundle form resets after a successful submission.
      expect((wrapper.find('[data-testid="bundle-select"]').element as HTMLSelectElement).value).toBe('')
    })

    it('shows a failure message and leaves the form untouched when the submission fails', async () => {
      ;(apiService.submitSecret as Mock).mockResolvedValue({
        success: false,
        correlationId: 'cid-bundle-fail',
        bundleId: 'core',
        includedEnvironments: [],
        excludedEnvironments: [],
        secretCount: 0,
        error: 'PR creation failed'
      })

      const wrapper = mount(SecretsPage)
      await flushPromises()
      await selectBundle(wrapper)

      await fillBundleGrid(wrapper, 'JIRA-1111', { dev: 'dev-value', qa: 'qa-value', prod: 'prod-value' })

      await wrapper.find('form').trigger('submit')
      await flushPromises()
      await wrapper.find('[data-testid="confirm-production-write-yes"]').trigger('click')
      await flushPromises()

      expect(document.body.textContent).toContain('PR creation failed')
      // Unlike a success, the in-progress selection/grid state is preserved so the user can retry.
      expect((wrapper.find('[data-testid="bundle-select"]').element as HTMLSelectElement).value).toBe('core')
      expect((wrapper.find('[data-testid="bundle-jira"]').element as HTMLInputElement).value).toBe('JIRA-1111')
    })

    it('mismatched value/confirmation cells block submission and surface a validation message (FR-006(c))', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await selectBundle(wrapper)

      await wrapper.find('[data-testid="bundle-jira"]').setValue('JIRA-2222')
      await wrapper.find('[data-testid="bundle-secret-name-input"]').setValue('api-key')
      await wrapper.find('[data-testid="bundle-cell-value-0-dev"]').setValue('one')
      await wrapper.find('[data-testid="bundle-cell-confirmation-0-dev"]').setValue('two')

      expect(wrapper.text()).toContain('Values do not match.')
      expect((wrapper.find('[data-testid="bundle-submit"]').element as HTMLButtonElement).disabled).toBe(true)
    })

    it('resets the bundle selection and grid when leaving the Bundles tab, and clears legacy state when leaving All Environments', async () => {
      const wrapper = mount(SecretsPage)
      await flushPromises()
      await selectBundle(wrapper)
      await wrapper.find('[data-testid="bundle-secret-name-input"]').setValue('api-key')

      await wrapper.find('[data-testid="nav-tab-all-environments"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="bundle-secret-grid"]').exists()).toBe(false)

      await wrapper.find('[data-testid="nav-tab-bundles"]').trigger('click')
      await flushPromises()

      expect((wrapper.find('[data-testid="bundle-select"]').element as HTMLSelectElement).value).toBe('')
      expect(wrapper.find('[data-testid="bundle-secret-grid"]').exists()).toBe(false)
    })

    it('does not gate on the production confirmation dialog when the bundle has no production-tier member environment', async () => {
      ;(apiService.getSecretApps as Mock).mockResolvedValue({
        success: true,
        data: bundleAppFixture.filter(entry => entry.environment !== 'prod'),
        bundles: bundleCatalogFixture
      })
      ;(apiService.submitSecret as Mock).mockResolvedValue({
        success: true,
        correlationId: 'cid-bundle-nonprod',
        bundleId: 'core',
        prNumber: 61,
        prUrl: 'https://github.com/example/pull/61',
        includedEnvironments: ['dev', 'qa'],
        excludedEnvironments: [],
        secretCount: 2
      })

      const wrapper = mount(SecretsPage)
      await flushPromises()
      await selectBundle(wrapper)

      await fillBundleGrid(wrapper, 'JIRA-3333', { dev: 'dev-value', qa: 'qa-value' })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid="confirm-production-write-dialog"]').exists()).toBe(false)
      expect(apiService.submitSecret).toHaveBeenCalledWith(expect.objectContaining({ bundleId: 'core' }))
    })
  })
})
