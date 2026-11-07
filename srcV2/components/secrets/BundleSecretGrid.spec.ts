import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BundleSecretGrid from './BundleSecretGrid.vue'

const environments = ['dev', 'staging']

function mountGrid(overrides: Partial<InstanceType<typeof BundleSecretGrid>['$props']> = {}) {
  return mount(BundleSecretGrid, {
    props: {
      secretNames: [''],
      environments,
      gridValues: {},
      isCellValid: () => true,
      ...overrides
    }
  })
}

describe('BundleSecretGrid', () => {
  it('shows an empty-state message instead of a table when there are no eligible environments yet (spec.md §2.7)', () => {
    const wrapper = mountGrid({ environments: [] })
    expect(wrapper.find('[data-testid="bundle-secret-grid"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="bundle-grid-empty"]').exists()).toBe(true)
  })

  it('renders a semantic table with one column header per eligible environment (NFR-USA-001/A3)', () => {
    const wrapper = mountGrid()
    const grid = wrapper.find('[data-testid="bundle-secret-grid"]')
    expect(grid.element.tagName).toBe('TABLE')
    const headers = grid.findAll('thead th').map(h => h.text())
    expect(headers).toContain('dev')
    expect(headers).toContain('staging')
  })

  it('renders one row per secret name', () => {
    const wrapper = mountGrid({ secretNames: ['API_KEY', 'DATABASE_URL'] })
    const rows = wrapper.findAll('[data-testid="bundle-secret-row"]')
    expect(rows).toHaveLength(2)
  })

  it('renders a row-header cell containing the secret name for accessible row identification', () => {
    const wrapper = mountGrid({ secretNames: ['API_KEY'] })
    const rowHeader = wrapper.find('[data-testid="bundle-secret-row"] th[scope="row"]')
    expect(rowHeader.exists()).toBe(true)
  })

  it('renders an independent value+confirmation input pair per secret-name/environment cell, with associated labels (spec.md §2.7)', () => {
    const wrapper = mountGrid({ secretNames: ['API_KEY'] })
    const valueInput = wrapper.find('[data-testid="bundle-cell-value-0-dev"]')
    const confirmInput = wrapper.find('[data-testid="bundle-cell-confirmation-0-dev"]')
    expect(valueInput.exists()).toBe(true)
    expect(confirmInput.exists()).toBe(true)
    // Each input must have a programmatically-associated (possibly visually-hidden) label.
    expect(wrapper.find(`label[for="${valueInput.attributes('id')}"]`).exists()).toBe(true)
    expect(wrapper.find(`label[for="${confirmInput.attributes('id')}"]`).exists()).toBe(true)
  })

  it('populates value/confirmation inputs from gridValues, independently per environment (FR-006(d))', () => {
    const wrapper = mountGrid({
      secretNames: ['API_KEY'],
      gridValues: {
        API_KEY: {
          dev: { value: 'dev-secret', confirmation: 'dev-secret' },
          staging: { value: 'staging-secret', confirmation: 'staging-secret' }
        }
      }
    })
    expect((wrapper.find('[data-testid="bundle-cell-value-0-dev"]').element as HTMLInputElement).value).toBe('dev-secret')
    expect((wrapper.find('[data-testid="bundle-cell-value-0-staging"]').element as HTMLInputElement).value).toBe('staging-secret')
  })

  it('emits update-cell with the secret name, environment, field, and value when a value input changes', async () => {
    const wrapper = mountGrid({ secretNames: ['API_KEY'] })
    await wrapper.find('[data-testid="bundle-cell-value-0-dev"]').setValue('new-value')
    expect(wrapper.emitted('update-cell')?.[0]).toEqual([{ secretName: 'API_KEY', environment: 'dev', field: 'value', value: 'new-value' }])
  })

  it('emits update-cell with field "confirmation" when a confirmation input changes', async () => {
    const wrapper = mountGrid({ secretNames: ['API_KEY'] })
    await wrapper.find('[data-testid="bundle-cell-confirmation-0-dev"]').setValue('new-value')
    expect(wrapper.emitted('update-cell')?.[0]).toEqual([{ secretName: 'API_KEY', environment: 'dev', field: 'confirmation', value: 'new-value' }])
  })

  it('does not emit update-cell for a blank, not-yet-named row (nothing to key values by)', async () => {
    const wrapper = mountGrid({ secretNames: [''] })
    await wrapper.find('[data-testid="bundle-cell-value-0-dev"]').setValue('x')
    expect(wrapper.emitted('update-cell')).toBeUndefined()
  })

  it('shows a mismatch message when isCellValid reports false for a cell (FR-006(c))', () => {
    const wrapper = mountGrid({
      secretNames: ['API_KEY'],
      gridValues: { API_KEY: { dev: { value: 'a', confirmation: 'b' } } },
      isCellValid: (secretName, environment) => !(secretName === 'API_KEY' && environment === 'dev')
    })
    const cell = wrapper.find('[data-testid="bundle-cell-0-dev"]')
    expect(cell.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="bundle-cell-value-0-dev"]').attributes('aria-invalid')).toBe('true')
  })

  it('does not show a mismatch message for a valid or untouched cell', () => {
    const wrapper = mountGrid({ secretNames: ['API_KEY'] })
    const cell = wrapper.find('[data-testid="bundle-cell-0-dev"]')
    expect(cell.find('[role="alert"]').exists()).toBe(false)
  })

  it('emits rename-row with the row index and new name when the secret-name input changes', async () => {
    const wrapper = mountGrid({ secretNames: ['', ''] })
    await wrapper.findAll('[data-testid="bundle-secret-name-input"]')[1].setValue('NEW_NAME')
    expect(wrapper.emitted('rename-row')?.[0]).toEqual([{ index: 1, name: 'NEW_NAME' }])
  })

  it('emits add-row when the add-secret button is clicked', async () => {
    const wrapper = mountGrid()
    await wrapper.find('[data-testid="bundle-add-secret"]').trigger('click')
    expect(wrapper.emitted('add-row')).toHaveLength(1)
  })

  it('disables the add-secret button at the 20-row cap', () => {
    const wrapper = mountGrid({ secretNames: Array.from({ length: 20 }, (_, i) => `SECRET_${i}`) })
    expect((wrapper.find('[data-testid="bundle-add-secret"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('emits remove-row with the row index when a row Remove button is clicked', async () => {
    const wrapper = mountGrid({ secretNames: ['API_KEY', 'DATABASE_URL'] })
    const removeButtons = wrapper.findAll('[data-testid="bundle-remove-secret"]')
    await removeButtons[1].trigger('click')
    expect(wrapper.emitted('remove-row')?.[0]).toEqual([1])
  })

  it('disables every row Remove button when only one secret-name row remains', () => {
    const wrapper = mountGrid({ secretNames: [''] })
    const removeButtons = wrapper.findAll('[data-testid="bundle-remove-secret"]')
    expect(removeButtons).toHaveLength(1)
    expect((removeButtons[0].element as HTMLButtonElement).disabled).toBe(true)
  })
})
