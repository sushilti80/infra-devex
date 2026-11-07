<template>
  <div class="resource-form">
    <!-- Section Header -->
    <div class="mb-6">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        Configure Resource Instances
      </h3>
      <p class="text-sm text-gray-600 dark:text-gray-400">
        Set instance names and manage RBAC relationships for your selected modules.
      </p>
    </div>

    <!-- No modules selected state -->
    <div v-if="selectedModules.length === 0" class="text-center py-12 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
      <span class="material-symbols-outlined text-gray-400 text-5xl mb-3">
        tune
      </span>
      <p class="text-gray-600 dark:text-gray-400">
        No modules selected. Please go back and select modules first.
      </p>
    </div>

    <!-- Module Configuration Cards -->
    <div v-else class="space-y-6">
      <div
        v-for="moduleName in selectedModules"
        :key="moduleName"
        class="module-config-card border border-gray-200 dark:border-gray-700 rounded-lg p-6 bg-white dark:bg-gray-800"
      >
        <!-- Module Header -->
        <div class="flex items-start justify-between mb-4">
          <div class="flex-1">
            <h4 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ moduleName }}
            </h4>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ getModuleDescription(moduleName) }}
            </p>
          </div>

          <!-- Multi-Instance Support Badge -->
          <span
            v-if="supportsMultiInstance(moduleName)"
            class="px-3 py-1 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
          >
            Multi-Instance
          </span>
        </div>

        <!-- Instance Configuration -->
        <div class="space-y-3">
          <!-- Instance Count Control (for multi-instance modules) -->
          <div v-if="supportsMultiInstance(moduleName)" class="flex items-center gap-4 mb-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
              Number of Instances:
            </label>
            <div class="flex items-center gap-2">
              <button
                type="button"
                @click="decrementInstances(moduleName)"
                :disabled="getInstanceCount(moduleName) <= 1"
                class="px-3 py-1 text-sm font-medium rounded border border-gray-300 dark:border-gray-600
                       hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed
                       text-gray-700 dark:text-gray-300"
              >
                <span class="material-symbols-outlined text-sm">remove</span>
              </button>
              <span class="px-4 py-1 text-sm font-semibold text-gray-900 dark:text-white">
                {{ getInstanceCount(moduleName) }}
              </span>
              <button
                type="button"
                @click="incrementInstances(moduleName)"
                :disabled="getInstanceCount(moduleName) >= 10"
                class="px-3 py-1 text-sm font-medium rounded border border-gray-300 dark:border-gray-600
                       hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed
                       text-gray-700 dark:text-gray-300"
              >
                <span class="material-symbols-outlined text-sm">add</span>
              </button>
            </div>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              (Max 10 instances)
            </span>
          </div>

          <!-- Instance List -->
          <div class="space-y-2">
            <div
              v-for="(instance, index) in getInstances(moduleName)"
              :key="`${moduleName}-${index}`"
              :data-testid="`instance-row-${moduleName}-${index}`"
              class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg
                     hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
            >
              <!-- Instance Number -->
              <div class="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                <span class="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  {{ index + 1 }}
                </span>
              </div>

              <!-- Instance Name Input -->
              <div class="flex-1">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Instance Name
                </label>
                <input
                  v-model="instance.name"
                  @input="validateInstanceName(moduleName, index, $event)"
                  :data-testid="`instance-name-${moduleName}-${index}`"
                  type="text"
                  :placeholder="`${moduleName}-${index + 1}`"
                  class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                         focus:ring-2 focus:ring-blue-500 focus:border-transparent
                         placeholder-gray-400 dark:placeholder-gray-500"
                  :class="{ 'border-red-500': instance.nameError }"
                />
                <p v-if="instance.nameError" class="mt-1 text-xs text-red-600 dark:text-red-400">
                  {{ instance.nameError }}
                </p>
              </div>

              <!-- Remove Instance (only for multi-instance modules with > 1 instance) -->
              <button
                v-if="supportsMultiInstance(moduleName) && getInstanceCount(moduleName) > 1"
                type="button"
                @click="removeInstance(moduleName, index)"
                :data-testid="`remove-instance-${moduleName}-${index}`"
                class="flex-shrink-0 p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20
                       rounded-lg transition-colors"
                title="Remove instance"
              >
                <span class="material-symbols-outlined text-sm">delete</span>
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'

// Props
const props = defineProps<{
  selectedModules: string[]
  modules: Array<{
    name: string
    description: string
    category: string
    supportsMultiInstance: boolean
  }>
  /** Optional prefilled instances from metadata restore (editing mode) */
  prefillInstances?: Record<string, Array<{ name: string }>>
}>()

// Emits
const emit = defineEmits<{
  'update:instances': [instances: Record<string, Array<{ name: string }>>]
}>()

// Module instance configuration
interface ModuleInstance {
  name: string
  nameError?: string
}

const moduleInstances = ref<Record<string, ModuleInstance[]>>({})

// Emit instances to parent (declared early for use in other functions)
const emitInstances = () => {
  emit('update:instances', moduleInstances.value)
}

// Initialize instances for selected modules
const initializeInstances = () => {
  props.selectedModules.forEach(moduleName => {
    if (!moduleInstances.value[moduleName]) {
      // Use prefilled instances if available (editing mode), otherwise create default
      const prefilled = props.prefillInstances?.[moduleName]
      if (prefilled && prefilled.length > 0) {
        moduleInstances.value[moduleName] = prefilled.map(inst => ({ name: inst.name }))
      } else {
        // Create default instance (no suffix for single instance)
        moduleInstances.value[moduleName] = [
          { name: moduleName }
        ]
      }
    }
  })

  // Remove instances for deselected modules
  Object.keys(moduleInstances.value).forEach(moduleName => {
    if (!props.selectedModules.includes(moduleName)) {
      delete moduleInstances.value[moduleName]
    }
  })

  emitInstances()
}

// Re-initialize when prefillInstances prop is supplied (e.g. editing mode loads after modules)
watch(() => props.prefillInstances, (newPrefill) => {
  if (!newPrefill) return
  props.selectedModules.forEach(moduleName => {
    const prefilled = newPrefill[moduleName]
    if (prefilled && prefilled.length > 0) {
      moduleInstances.value[moduleName] = prefilled.map(inst => ({ name: inst.name }))
    }
  })
  emitInstances()
}, { immediate: false })

// Watch for changes in selected modules
watch(() => props.selectedModules, () => {
  initializeInstances()
}, { immediate: true })

// Get module description
const getModuleDescription = (moduleName: string): string => {
  const module = props.modules.find(m => m.name === moduleName)
  return module?.description || ''
}

// Check if module supports multi-instance
const supportsMultiInstance = (moduleName: string): boolean => {
  const module = props.modules.find(m => m.name === moduleName)
  return module?.supportsMultiInstance || false
}

// Get instances for a module
const getInstances = (moduleName: string): ModuleInstance[] => {
  return moduleInstances.value[moduleName] || []
}

// Get instance count
const getInstanceCount = (moduleName: string): number => {
  return getInstances(moduleName).length
}

// Increment instances
const incrementInstances = (moduleName: string) => {
  const currentCount = getInstanceCount(moduleName)
  if (currentCount < 10) {
    // When going from 1 to 2 instances, rename first instance to add suffix
    if (currentCount === 1 && moduleInstances.value[moduleName][0].name === moduleName) {
      moduleInstances.value[moduleName][0].name = `${moduleName}-1`
    }

    // Add new instance with suffix
    moduleInstances.value[moduleName].push({
      name: `${moduleName}-${currentCount + 1}`
    })
    emitInstances()
  }
}

// Decrement instances
const decrementInstances = (moduleName: string) => {
  const currentCount = getInstanceCount(moduleName)
  if (currentCount > 1) {
    moduleInstances.value[moduleName].pop()

    // When going back to single instance, remove suffix
    if (currentCount === 2) {
      const firstInstance = moduleInstances.value[moduleName][0]
      if (firstInstance.name.match(/-1$/)) {
        firstInstance.name = moduleName
      }
    }

    emitInstances()
  }
}

// Remove specific instance
const removeInstance = (moduleName: string, index: number) => {
  if (getInstanceCount(moduleName) > 1) {
    moduleInstances.value[moduleName].splice(index, 1)
    emitInstances()
  }
}

// Validate instance name
const validateInstanceName = (moduleName: string, index: number, event: Event) => {
  const input = event.target as HTMLInputElement
  const value = input.value.trim()
  const instance = moduleInstances.value[moduleName][index]
  const instanceCount = getInstanceCount(moduleName)

  // Validation rules
  if (!value) {
    instance.nameError = 'Instance name is required'
  } else if (instanceCount === 1) {
    // For single instance, allow just the module name or module name with suffix
    if (value === moduleName) {
      // Perfect - just the module name
      instance.nameError = undefined
    } else if (value.startsWith(`${moduleName}-`)) {
      // Also allow suffix for single instance
      const suffix = value.substring(`${moduleName}-`.length)
      if (suffix.length > 3) {
        instance.nameError = 'Suffix must be 3 characters or less'
      } else if (!/^[a-z0-9-]+$/i.test(suffix)) {
        instance.nameError = 'Suffix must be alphanumeric with hyphens'
      } else {
        instance.nameError = undefined
      }
    } else {
      instance.nameError = `Must be "${moduleName}" or start with "${moduleName}-"`
    }
  } else {
    // For multiple instances, require suffix
    if (!value.startsWith(`${moduleName}-`)) {
      instance.nameError = `Must start with "${moduleName}-"`
    } else {
      const suffix = value.substring(`${moduleName}-`.length)
      if (suffix.length > 3) {
        instance.nameError = 'Suffix must be 3 characters or less'
      } else if (!/^[a-z0-9-]+$/i.test(value)) {
        instance.nameError = 'Only alphanumeric and hyphens allowed'
      } else {
        instance.nameError = undefined
      }
    }
  }

  emitInstances()
}

// Initialize on mount
onMounted(() => {
  initializeInstances()
})
</script>

<style scoped>
.resource-form {
  @apply w-full;
}

.module-config-card {
  @apply transition-shadow hover:shadow-md;
}
</style>
