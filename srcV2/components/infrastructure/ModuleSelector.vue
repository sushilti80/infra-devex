<template>
  <div class="module-selector">
    <!-- Section Header -->
    <div class="mb-6">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        Select Azure Modules
      </h3>
      <p data-testid="module-selector-description" class="text-sm text-gray-600 dark:text-gray-400">
        Choose the Azure resources you need for your infrastructure. You can select multiple modules.
      </p>
    </div>

    <!-- Search and Filter Controls -->
    <div class="flex flex-col sm:flex-row gap-4 mb-6">
      <!-- Search Input -->
      <div class="flex-1">
        <div class="relative">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xl">
            search
          </span>
          <input
            v-model="searchQuery"
            data-testid="module-search"
            type="text"
            placeholder="Search modules..."
            class="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                   bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                   focus:ring-2 focus:ring-blue-500 focus:border-transparent
                   placeholder-gray-400 dark:placeholder-gray-500"
          />
        </div>
      </div>

      <!-- Category Filter -->
      <div class="sm:w-48">
        <select
          v-model="selectedCategory"
          data-testid="category-filter"
          class="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                 bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="all">All Categories</option>
          <option value="compute">Compute</option>
          <option value="storage">Storage</option>
          <option value="security">Security</option>
          <option value="database">Database</option>
          <option value="messaging">Messaging</option>
          <option value="configuration">Configuration</option>
        </select>
      </div>
    </div>

    <!-- Selection Summary -->
    <div class="flex items-center justify-between mb-4 px-2">
      <div class="text-sm text-gray-600 dark:text-gray-400">
        <span data-testid="selected-count" class="font-semibold text-blue-600 dark:text-blue-400">
          {{ selectedModules.length }}
        </span>
        {{ selectedModules.length === 1 ? 'module' : 'modules' }} selected
      </div>
      <button
        v-if="selectedModules.length > 0"
        data-testid="clear-selection"
        @click="clearSelection"
        class="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300
               font-medium transition-colors"
      >
        Clear Selection
      </button>
    </div>

    <!-- Module Grid -->
    <div data-testid="module-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <!-- Loading State -->
      <div v-if="isLoading" data-testid="loading-modules" class="col-span-full">
        <div class="flex items-center justify-center py-12">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span class="ml-3 text-gray-600 dark:text-gray-400">Loading modules...</span>
        </div>
      </div>

      <!-- Module Cards (Placeholder for now) -->
      <div v-else-if="filteredModules.length === 0" class="col-span-full">
        <div class="text-center py-12">
          <span class="material-symbols-outlined text-gray-400 text-5xl mb-3">
            search_off
          </span>
          <p class="text-gray-600 dark:text-gray-400">
            No modules found matching your search.
          </p>
        </div>
      </div>

      <!-- Module Cards will be rendered here -->
      <div
        v-for="module in filteredModules"
        :key="module.name"
        data-testid="module-card"
        :class="[
          'border rounded-lg p-4 cursor-pointer transition-all',
          isSelected(module.name)
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
        ]"
        @click="toggleModule(module.name)"
      >
        <div class="flex items-start justify-between mb-2">
          <div class="flex-1">
            <h4 class="font-semibold text-gray-900 dark:text-white">
              {{ module.name }}
            </h4>
            <span class="text-xs text-gray-500 dark:text-gray-400 uppercase">
              {{ module.category }}
            </span>
          </div>
          <div
            :class="[
              'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
              isSelected(module.name)
                ? 'border-blue-500 bg-blue-500'
                : 'border-gray-300 dark:border-gray-600'
            ]"
          >
            <span v-if="isSelected(module.name)" class="material-symbols-outlined text-white text-sm">
              check
            </span>
          </div>
        </div>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ module.description }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import apiService from '@v2/services/api'

// Props
const props = defineProps<{
  selectedModules: string[]
}>()

// Emits
const emit = defineEmits<{
  'update:selectedModules': [modules: string[]]
}>()

// State
const isLoading = ref(true)
const searchQuery = ref('')
const selectedCategory = ref('all')

// Module type from API
interface Module {
  name: string
  description: string
  version: string
  category: string
  supportsMultiInstance: boolean
}

const modules = ref<Module[]>([])

// Fetch modules from API
const fetchModules = async () => {
  try {
    isLoading.value = true
    const result = await apiService.getModules()
    // Handle API response format: { success: true, data: [...] }
    modules.value = result.data || []
  } catch (error) {
    console.error('Error fetching modules:', error)
    modules.value = []
  } finally {
    isLoading.value = false
  }
}

// Computed
const filteredModules = computed(() => {
  return modules.value.filter(module => {
    // Exclude RBAC module from manual selection - it's auto-added when relationships are defined
    if (module.name === 'RBAC') {
      return false
    }
    
    const matchesSearch = module.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
                         module.description.toLowerCase().includes(searchQuery.value.toLowerCase())
    const matchesCategory = selectedCategory.value === 'all' || module.category === selectedCategory.value
    return matchesSearch && matchesCategory
  })
})

// Methods
const isSelected = (moduleName: string): boolean => {
  return props.selectedModules.includes(moduleName)
}

const toggleModule = (moduleName: string) => {
  const newSelection = isSelected(moduleName)
    ? props.selectedModules.filter(name => name !== moduleName)
    : [...props.selectedModules, moduleName]
  
  emit('update:selectedModules', newSelection)
}

const clearSelection = () => {
  emit('update:selectedModules', [])
}

// Lifecycle
onMounted(() => {
  fetchModules()
})
</script>
