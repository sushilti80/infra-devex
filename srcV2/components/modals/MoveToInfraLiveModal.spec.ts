import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import MoveToInfraLiveModal from './MoveToInfraLiveModal.vue'
import apiService from '@v2/services/api'

vi.mock('@v2/services/api', () => ({
  default: { getInfraLiveEnvironments: vi.fn() },
}))

const TARGETS = ['prod', 'stage', 'dev', 'int', 'sint', 'cint', 'hot', 'demo']

async function mountOpen() {
  const wrapper = mount(MoveToInfraLiveModal, {
    props: { isVisible: true, appName: 'jobplc', sourceEnvironment: 'devsand' },
  })
  await flushPromises()
  return wrapper
}

describe('MoveToInfraLiveModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(apiService.getInfraLiveEnvironments as Mock).mockResolvedValue({ success: true, data: TARGETS })
  })

  it('lists every default environment unchecked and omits the source environment', async () => {
    const wrapper = await mountOpen()
    for (const env of TARGETS) {
      expect((wrapper.find(`[data-testid="move-env-${env}"]`).element as HTMLInputElement).checked).toBe(false)
    }
    expect(wrapper.find('[data-testid="move-env-devsand"]').exists()).toBe(false)
  })

  it('disables submit until a CR number is entered and an environment is selected', async () => {
    const wrapper = await mountOpen()
    const submit = wrapper.find('[data-testid="move-submit"]')
    await wrapper.find('[data-testid="move-env-prod"]').setValue(true)
    expect(submit.attributes('disabled')).toBeDefined()
    await wrapper.find('[data-testid="move-cr-input"]').setValue('CHG1')
    expect(submit.attributes('disabled')).toBeUndefined()
  })

  it('emits only the selected environments', async () => {
    const wrapper = await mountOpen()
    await wrapper.find('[data-testid="move-cr-input"]').setValue(' CHG1 ')
    await wrapper.find('[data-testid="move-env-prod"]').setValue(true)
    await wrapper.find('[data-testid="move-env-dev"]').setValue(true)
    await wrapper.find('[data-testid="move-submit"]').trigger('click')
    expect(wrapper.emitted('submit')![0][0]).toEqual({ crNumber: 'CHG1', environments: ['prod', 'dev'] })
  })

  it('blocks submit when nothing is selected', async () => {
    const wrapper = await mountOpen()
    await wrapper.find('[data-testid="move-cr-input"]').setValue('CHG1')
    expect(wrapper.find('[data-testid="move-submit"]').attributes('disabled')).toBeDefined()
  })

  it('rejects CR numbers the API would reject and shows an error', async () => {
    const wrapper = await mountOpen()
    await wrapper.find('[data-testid="move-env-prod"]').setValue(true)
    await wrapper.find('[data-testid="move-cr-input"]').setValue('CR 123')
    expect(wrapper.find('[data-testid="move-submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="move-cr-error"]').exists()).toBe(true)
  })

  it('closes on Escape from anywhere while visible', async () => {
    const wrapper = await mountOpen()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('moves focus into the dialog on open', async () => {
    const wrapper = mount(MoveToInfraLiveModal, {
      attachTo: document.body,
      props: { isVisible: true, appName: 'jobplc', sourceEnvironment: 'devsand' },
    })
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.find('[data-testid="move-cr-input"]').element)
    wrapper.unmount()
  })
})
