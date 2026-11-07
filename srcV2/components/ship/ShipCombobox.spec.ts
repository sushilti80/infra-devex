/** FT-03: ShipCombobox ARIA + keyboard behaviour. */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ShipCombobox from './ShipCombobox.vue'

const options = [
  { value: 'org/alpha', label: 'org/alpha', hint: 'private' },
  { value: 'org/beta', label: 'org/beta' },
  { value: 'other/gamma', label: 'other/gamma' }
]

function mountBox(props: Record<string, unknown> = {}) {
  return mount(ShipCombobox, {
    props: { id: 'repo', label: 'Repository', modelValue: '', options, 'onUpdate:modelValue': (v: string) => w.setProps({ modelValue: v }), ...props },
    attachTo: document.body
  })
}
let w: ReturnType<typeof mountBox>

describe('ShipCombobox (FT-03)', () => {
  it('exposes the combobox pattern: label, role, aria-expanded/controls/autocomplete', () => {
    w = mountBox()
    const input = w.get('input')
    expect(w.get('label').attributes('for')).toBe('repo')
    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-autocomplete')).toBe('list')
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(input.attributes('aria-controls')).toBe('repo-listbox')
    expect(w.get('#repo-listbox').attributes('role')).toBe('listbox')
    w.unmount()
  })

  it('opens on focus, lists options with role=option, and filters by typed text', async () => {
    w = mountBox()
    await w.get('input').trigger('focus')
    expect(w.get('input').attributes('aria-expanded')).toBe('true')
    expect(w.findAll('[role="option"]').map(o => o.text())).toEqual(['org/alphaprivate', 'org/beta', 'other/gamma'])
    await w.get('input').setValue('BET')
    expect(w.findAll('[role="option"]').map(o => o.text())).toEqual(['org/beta'])
    w.unmount()
  })

  it('ArrowDown/ArrowUp move aria-activedescendant (wrapping) and mark aria-selected', async () => {
    w = mountBox()
    const input = w.get('input')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBe('repo-opt-0')
    expect(w.get('#repo-opt-0').attributes('aria-selected')).toBe('true')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBe('repo-opt-1')
    await input.trigger('keydown', { key: 'ArrowUp' })
    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(input.attributes('aria-activedescendant')).toBe('repo-opt-2') // wrapped
    await input.trigger('keydown', { key: 'Home' })
    expect(input.attributes('aria-activedescendant')).toBe('repo-opt-0')
    await input.trigger('keydown', { key: 'End' })
    expect(input.attributes('aria-activedescendant')).toBe('repo-opt-2')
    w.unmount()
  })

  it('Enter on the active option selects it and closes the list', async () => {
    w = mountBox()
    const input = w.get('input')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('select')?.[0]).toEqual(['org/beta'])
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['org/beta'])
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(input.attributes('aria-activedescendant')).toBeUndefined()
    w.unmount()
  })

  it('Escape closes the list without selecting', async () => {
    w = mountBox()
    const input = w.get('input')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Escape' })
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(w.emitted('select')).toBeUndefined()
    w.unmount()
  })

  it('Enter with no active option commits the typed free text (pasted repo / typed branch)', async () => {
    w = mountBox({ modelValue: 'org/typed' })
    await w.get('input').trigger('keydown', { key: 'Enter' })
    expect(w.emitted('commit')?.[0]).toEqual(['org/typed'])
    expect(w.emitted('select')).toBeUndefined()
    w.unmount()
  })

  it('clicking an option (mousedown) selects it; blur commits the text', async () => {
    w = mountBox()
    await w.get('input').trigger('focus')
    await w.get('#repo-opt-1').trigger('mousedown')
    expect(w.emitted('select')?.[0]).toEqual(['org/beta'])
    await w.get('input').trigger('blur')
    expect(w.emitted('commit')).toBeTruthy()
    w.unmount()
  })

  it('shows loading and empty text and links error/helper via aria-describedby', async () => {
    w = mountBox({ loading: true })
    expect(w.text()).toContain('Loading')
    expect(w.get('input').attributes('aria-busy')).toBe('true')
    await w.setProps({ loading: false, modelValue: 'zzz', error: 'Bad', helper: 'Help', emptyText: 'No repositories found' })
    await w.get('input').trigger('focus')
    expect(w.text()).toContain('No repositories found')
    expect(w.get('input').attributes('aria-invalid')).toBe('true')
    expect(w.get('input').attributes('aria-describedby')).toBe('repo-error repo-help')
    w.unmount()
  })

  it('respects disabled', () => {
    w = mountBox({ disabled: true })
    expect(w.get('input').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('renders option text via interpolation (no HTML injection)', async () => {
    w = mountBox({ options: [{ value: 'x', label: '<img src=x onerror=alert(1)>' }] })
    await w.get('input').trigger('focus')
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain('<img src=x onerror=alert(1)>')
    w.unmount()
  })
})
