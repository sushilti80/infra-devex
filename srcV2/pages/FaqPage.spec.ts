import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import FaqPage from './FaqPage.vue'
import { useNavigationStore } from '../stores/navigation'
import { faqItems, useCases } from '../content/faq'

const mockIsAuthenticated = ref(false)
vi.mock('../composables/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated })
}))

function mountPage() {
  return mount(FaqPage, { global: { plugins: [createPinia()] } })
}

describe('FaqPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockIsAuthenticated.value = false
  })

  it('renders every FAQ item by default', () => {
    const wrapper = mountPage()
    expect(wrapper.findAll('[data-testid="faq-item"]')).toHaveLength(faqItems.length)
  })

  it('filters by search term', async () => {
    const wrapper = mountPage()
    await wrapper.find('[data-testid="faq-search"]').setValue('correlation')
    const items = wrapper.findAll('[data-testid="faq-item"]')
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThan(faqItems.length)
  })

  it('shows an empty state when nothing matches', async () => {
    const wrapper = mountPage()
    await wrapper.find('[data-testid="faq-search"]').setValue('zzzzzz-no-match')
    expect(wrapper.find('[data-testid="faq-empty"]').exists()).toBe(true)
  })

  it('filters by category', async () => {
    const wrapper = mountPage()
    await wrapper.find('[data-testid="chip-security"]').trigger('click')
    const expected = faqItems.filter(item => item.category === 'security').length
    expect(wrapper.findAll('[data-testid="faq-item"]')).toHaveLength(expected)
  })

  it('shows use case scenarios on the use cases tab', async () => {
    const wrapper = mountPage()
    await wrapper.find('[data-testid="tab-use-cases"]').trigger('click')
    expect(wrapper.findAll('[data-testid="use-case"]')).toHaveLength(useCases.length)
  })

  it('hides the "Try it" buttons when signed out', async () => {
    const wrapper = mountPage()
    await wrapper.find('[data-testid="tab-use-cases"]').trigger('click')
    expect(wrapper.find('[data-testid="use-case-cta"]').exists()).toBe(false)
  })

  it('navigates to the related page when signed in', async () => {
    mockIsAuthenticated.value = true
    const wrapper = mountPage()
    const navigationStore = useNavigationStore()
    await wrapper.find('[data-testid="tab-use-cases"]').trigger('click')
    await wrapper.find('[data-testid="use-case-cta"]').trigger('click')
    expect(navigationStore.currentPage).toBe(useCases[0].page)
  })
})
