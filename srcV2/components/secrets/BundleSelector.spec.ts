import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BundleSelector from './BundleSelector.vue'
import type { BundleCatalogEntry } from '@v2/types/infrastructure.types'

const bundles: BundleCatalogEntry[] = [
  { id: 'independent', displayName: 'Independent Environments', order: 1, releaseControlled: false },
  { id: 'developer', displayName: 'Developer Bundle', order: 2, releaseControlled: false },
  { id: 'release', displayName: 'Release Bundle', order: 3, releaseControlled: true }
]

const appEnvironments = [
  { environment: 'dev', bundleId: 'developer' },
  { environment: 'staging', bundleId: 'developer' },
  { environment: 'prod', bundleId: 'release' },
  { environment: 'qa', bundleId: null }
]

function mountSelector(overrides: Partial<InstanceType<typeof BundleSelector>['$props']> = {}) {
  return mount(BundleSelector, {
    props: {
      bundles,
      appEnvironments,
      selectedBundleId: '',
      eligibility: {},
      exclusionReason: {},
      excludedCandidates: {},
      disambiguation: {},
      ...overrides
    }
  })
}

describe('BundleSelector', () => {
  it('renders only bundles with at least one matching deployed environment for the app (FR-002(f))', () => {
    const wrapper = mountSelector()
    const options = wrapper.find('[data-testid="bundle-select"]').findAll('option')
    // "independent" has zero matching appEnvironments entries and must be omitted entirely.
    const labels = options.map(o => o.text())
    expect(labels).not.toContain('Independent Environments')
    expect(labels).toContain('Developer Bundle')
    expect(labels).toContain('Release Bundle')
  })

  it('sorts available bundles by their declared order', () => {
    const wrapper = mountSelector({
      bundles: [
        { id: 'release', displayName: 'Release Bundle', order: 3, releaseControlled: true },
        { id: 'developer', displayName: 'Developer Bundle', order: 2, releaseControlled: false }
      ]
    })
    const options = wrapper.find('[data-testid="bundle-select"]').findAll('option')
    const labels = options.filter(o => o.attributes('value')).map(o => o.text())
    expect(labels).toEqual(['Developer Bundle', 'Release Bundle'])
  })

  it('emits update:selectedBundleId when a bundle is chosen', async () => {
    const wrapper = mountSelector()
    const select = wrapper.find('[data-testid="bundle-select"]')
    await select.setValue('developer')
    expect(wrapper.emitted('update:selectedBundleId')?.[0]).toEqual(['developer'])
  })

  it('shows a [RELEASE] indicator only when the selected bundle is releaseControlled', () => {
    const releaseWrapper = mountSelector({ selectedBundleId: 'release' })
    expect(releaseWrapper.find('[data-testid="bundle-release-indicator"]').exists()).toBe(true)

    const devWrapper = mountSelector({ selectedBundleId: 'developer' })
    expect(devWrapper.find('[data-testid="bundle-release-indicator"]').exists()).toBe(false)
  })

  it('renders every declared+deployed environment for the selected bundle', () => {
    const wrapper = mountSelector({
      selectedBundleId: 'developer',
      eligibility: { dev: 'eligible', staging: 'pending' }
    })
    const rows = wrapper.findAll('[data-testid="bundle-environment-status-row"]')
    expect(rows).toHaveLength(2)
    expect(wrapper.text()).toContain('dev')
    expect(wrapper.text()).toContain('staging')
  })

  it('renders an excluded environment with its reason and a disambiguation control', () => {
    const wrapper = mountSelector({
      selectedBundleId: 'developer',
      eligibility: { dev: 'eligible', staging: 'excluded' },
      exclusionReason: { staging: 'Multiple Key Vaults found; supply a vault to disambiguate.' },
      excludedCandidates: { staging: { vaults: [{ vaultDir: 'infra/staging/kv01' }, { vaultDir: 'infra/staging/kv02' }] } }
    })
    const excludedRow = wrapper.find('[data-testid="bundle-excluded-environment"]')
    expect(excludedRow.exists()).toBe(true)
    expect(excludedRow.text()).toContain('vault')
    expect(wrapper.find('[data-testid="bundle-disambiguation-select"]').exists()).toBe(true)
  })

  it('does not render a disambiguation control for an eligible environment', () => {
    const wrapper = mountSelector({
      selectedBundleId: 'developer',
      eligibility: { dev: 'eligible', staging: 'eligible' }
    })
    expect(wrapper.find('[data-testid="bundle-excluded-environment"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="bundle-disambiguation-select"]').exists()).toBe(false)
  })

  it('emits a disambiguate event with vaultDir when a vault candidate is chosen', async () => {
    const wrapper = mountSelector({
      selectedBundleId: 'developer',
      eligibility: { staging: 'excluded' },
      exclusionReason: { staging: 'Multiple Key Vaults found; supply a vault to disambiguate.' },
      excludedCandidates: { staging: { vaults: [{ vaultDir: 'infra/staging/kv01' }, { vaultDir: 'infra/staging/kv02' }] } }
    })
    const select = wrapper.find('[data-testid="bundle-disambiguation-select"]')
    await select.setValue('vault:infra/staging/kv02')
    expect(wrapper.emitted('disambiguate')?.[0]).toEqual([{ environment: 'staging', vaultDir: 'infra/staging/kv02' }])
  })

  it('emits a disambiguate event with qualifier when a qualifier candidate is chosen', async () => {
    const wrapper = mountSelector({
      selectedBundleId: 'developer',
      eligibility: { staging: 'excluded' },
      exclusionReason: { staging: 'Multiple sub-applications found; supply a qualifier to disambiguate.' },
      excludedCandidates: { staging: { qualifiers: ['svcA', 'svcB'] } }
    })
    const select = wrapper.find('[data-testid="bundle-disambiguation-select"]')
    await select.setValue('qualifier:svcB')
    expect(wrapper.emitted('disambiguate')?.[0]).toEqual([{ environment: 'staging', qualifier: 'svcB' }])
  })

  it('renders nothing environment-related when no bundle is selected yet', () => {
    const wrapper = mountSelector({ selectedBundleId: '' })
    expect(wrapper.findAll('[data-testid="bundle-environment-status-row"]')).toHaveLength(0)
  })
})
