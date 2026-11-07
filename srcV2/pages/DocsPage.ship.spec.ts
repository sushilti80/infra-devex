/** DocsPage — Ship from Repo section (target of the AC-011-3 link); hidden while no environment has the flag. */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import DocsPage from './DocsPage.vue'
import { useEnvironmentsStore } from '@v2/stores/environments'
import { useNavigationStore } from '@v2/stores/navigation'

const env = (shipFromRepo?: boolean) => ({
  id: 'x', displayName: 'X', subscriptionId: 's', enabled: true,
  features: { customInfra: true, templates: true, aks: true, ...(shipFromRepo === undefined ? {} : { shipFromRepo }) }
})

function mountDocs(flag?: boolean) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useEnvironmentsStore().environments = [env(flag)]
  return { w: mount(DocsPage, { global: { plugins: [pinia] } }), nav: useNavigationStore() }
}

describe('DocsPage — Ship from Repo section', () => {
  it('is not rendered (section or nav link) while the flag is off/absent', () => {
    for (const flag of [undefined, false]) {
      const { w } = mountDocs(flag)
      expect(w.find('#ship-from-repo').exists()).toBe(false)
      expect(w.find('a[href="#ship-from-repo"]').exists()).toBe(false)
    }
  })

  it('documents languages, $PORT, limits and the no-CI flow when enabled, with a sidebar link', () => {
    const { w } = mountDocs(true)
    const section = w.get('[data-testid="docs-ship-section"]')
    expect(section.attributes('id')).toBe('ship-from-repo')
    const t = section.text()
    expect(t).toContain('Supported languages')
    expect(t).toContain('Node.js')
    expect(t).toContain('$PORT')
    expect(t).toContain('Limits')
    expect(t).toMatch(/no change to your repository is required/i)
    expect(t).toMatch(/Dockerfile in your repository is ignored/)
    expect(w.find('a[href="#ship-from-repo"]').exists()).toBe(true)
  })

  it('the section button opens the ship page', async () => {
    const { w, nav } = mountDocs(true)
    await w.findAll('#ship-from-repo button').find(b => b.text() === 'Open Ship from Repo')!.trigger('click')
    expect(nav.currentPage).toBe('ship')
  })
})
