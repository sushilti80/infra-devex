import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ModuleSelector from './ModuleSelector.vue'
import apiService from '@v2/services/api'

// Mock modules data matching real API structure
const mockModules = [
  {
    name: 'storageV2',
    description: 'Azure Storage Account V2',
    version: '1.0.0',
    category: 'storage',
    supportsMultiInstance: false
  },
  {
    name: 'keyvault',
    description: 'Azure Key Vault for secrets management',
    version: '1.0.0',
    category: 'security',
    supportsMultiInstance: false
  },
  {
    name: 'appServiceWindows',
    description: 'Azure App Service for Windows',
    version: '1.0.0',
    category: 'compute',
    supportsMultiInstance: true
  },
  {
    name: 'serviceBus',
    description: 'Azure Service Bus for messaging',
    version: '1.0.0',
    category: 'messaging',
    supportsMultiInstance: true
  },
  {
    name: 'appConfiguration',
    description: 'Azure App Configuration',
    version: '1.0.0',
    category: 'configuration',
    supportsMultiInstance: false
  }
]

// Mock API service to prevent network calls
vi.mock('@v2/services/api', () => ({
  default: {
    getModules: vi.fn(() => Promise.resolve({
      success: true,
      data: mockModules
    }))
  }
}))

describe('ModuleSelector', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('Component Structure', () => {
    it('renders the component', () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      expect(wrapper.exists()).toBe(true)
    })

    it('displays the section title', () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      const title = wrapper.find('h3')
      expect(title.text()).toBe('Select Azure Modules')
    })

    it('displays the description', () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      const description = wrapper.find('[data-testid="module-selector-description"]')
      expect(description.exists()).toBe(true)
      expect(description.text()).toContain('Choose the Azure resources')
    })
  })

  describe('Search and Filter', () => {
    it('displays search input', () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      const searchInput = wrapper.find('[data-testid="module-search"]')
      expect(searchInput.exists()).toBe(true)
    })

    it('displays category filter dropdown', () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      const categoryFilter = wrapper.find('[data-testid="category-filter"]')
      expect(categoryFilter.exists()).toBe(true)
    })

    it('shows "All Categories" as default option', () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      const categoryFilter = wrapper.find('[data-testid="category-filter"]')
      const defaultOption = categoryFilter.find('option[value="all"]')
      expect(defaultOption.exists()).toBe(true)
      expect(defaultOption.text()).toBe('All Categories')
    })
  })

  describe('Module Grid', () => {
    it('displays module grid container', () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      const moduleGrid = wrapper.find('[data-testid="module-grid"]')
      expect(moduleGrid.exists()).toBe(true)
    })

    it('displays loading state initially', () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      const loadingState = wrapper.find('[data-testid="loading-modules"]')
      expect(loadingState.exists()).toBe(true)
    })

    it('fetches modules on mount', async () => {
      mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(apiService.getModules).toHaveBeenCalled()
    })

    it('displays module cards after loading', async () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      
      await new Promise(resolve => setTimeout(resolve, 50))
      await wrapper.vm.$nextTick()
      
      const moduleCards = wrapper.findAll('[data-testid="module-card"]')
      expect(moduleCards.length).toBe(5)
    })

    it('displays correct module information', async () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      
      await new Promise(resolve => setTimeout(resolve, 50))
      await wrapper.vm.$nextTick()
      
      const firstCard = wrapper.find('[data-testid="module-card"]')
      expect(firstCard.text()).toContain('storageV2')
      expect(firstCard.text()).toContain('Azure Storage Account V2')
    })
  })

  describe('Search Functionality', () => {
    it('filters modules by search query', async () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      
      await new Promise(resolve => setTimeout(resolve, 50))
      await wrapper.vm.$nextTick()
      
      const searchInput = wrapper.find('[data-testid="module-search"]')
      await searchInput.setValue('storage')
      await wrapper.vm.$nextTick()
      
      const moduleCards = wrapper.findAll('[data-testid="module-card"]')
      expect(moduleCards.length).toBe(1)
      expect(moduleCards[0].text()).toContain('storageV2')
    })

    it('filters modules by category', async () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      
      await new Promise(resolve => setTimeout(resolve, 50))
      await wrapper.vm.$nextTick()
      
      const categoryFilter = wrapper.find('[data-testid="category-filter"]')
      await categoryFilter.setValue('security')
      await wrapper.vm.$nextTick()
      
      const moduleCards = wrapper.findAll('[data-testid="module-card"]')
      expect(moduleCards.length).toBe(1)
      expect(moduleCards[0].text()).toContain('keyvault')
    })

    it('shows all modules when category is "all"', async () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      
      await new Promise(resolve => setTimeout(resolve, 50))
      await wrapper.vm.$nextTick()
      
      const categoryFilter = wrapper.find('[data-testid="category-filter"]')
      await categoryFilter.setValue('all')
      await wrapper.vm.$nextTick()
      
      const moduleCards = wrapper.findAll('[data-testid="module-card"]')
      expect(moduleCards.length).toBe(5)
    })
  })

  describe('Module Selection', () => {
    it('displays module as unselected by default', async () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      
      await new Promise(resolve => setTimeout(resolve, 50))
      await wrapper.vm.$nextTick()
      
      const firstCard = wrapper.find('[data-testid="module-card"]')
      expect(firstCard.classes()).not.toContain('border-blue-500')
    })

    it('displays module as selected when in selectedModules', async () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: ['storageV2']
        }
      })
      
      await new Promise(resolve => setTimeout(resolve, 50))
      await wrapper.vm.$nextTick()
      
      const firstCard = wrapper.find('[data-testid="module-card"]')
      expect(firstCard.classes()).toContain('border-blue-500')
    })

    it('emits update:selectedModules when module is clicked', async () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      
      await new Promise(resolve => setTimeout(resolve, 50))
      await wrapper.vm.$nextTick()
      
      const firstCard = wrapper.find('[data-testid="module-card"]')
      await firstCard.trigger('click')
      
      expect(wrapper.emitted('update:selectedModules')).toBeTruthy()
      expect(wrapper.emitted('update:selectedModules')?.[0]).toEqual([['storageV2']])
    })

    it('displays correct selected count', () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: ['storageV2', 'keyvault']
        }
      })
      
      const selectedCount = wrapper.find('[data-testid="selected-count"]')
      expect(selectedCount.text()).toBe('2')
    })
  })

  describe('Clear Selection', () => {
    it('displays clear button when modules are selected', () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: ['storageV2']
        }
      })
      
      const clearButton = wrapper.find('[data-testid="clear-selection"]')
      expect(clearButton.exists()).toBe(true)
    })

    it('hides clear button when no modules selected', () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      
      const clearButton = wrapper.find('[data-testid="clear-selection"]')
      expect(clearButton.exists()).toBe(false)
    })

    it('emits empty array when clear button is clicked', async () => {
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: ['storageV2', 'keyvault']
        }
      })
      
      const clearButton = wrapper.find('[data-testid="clear-selection"]')
      await clearButton.trigger('click')
      
      expect(wrapper.emitted('update:selectedModules')).toBeTruthy()
      expect(wrapper.emitted('update:selectedModules')?.[0]).toEqual([[]])
    })
  })

  describe('Error Handling', () => {
    it('handles fetch error gracefully', async () => {
      // Mock a failed API call
      vi.mocked(apiService.getModules).mockRejectedValueOnce(
        new Error('Failed to fetch modules')
      )
      
      const wrapper = mount(ModuleSelector, {
        props: {
          selectedModules: []
        }
      })
      
      await new Promise(resolve => setTimeout(resolve, 50))
      await wrapper.vm.$nextTick()
      
      // Should show empty grid or error state, not crash
      const moduleCards = wrapper.findAll('[data-testid="module-card"]')
      expect(moduleCards.length).toBe(0)
    })
  })
})
