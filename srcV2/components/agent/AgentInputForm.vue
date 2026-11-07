<script setup lang="ts">
import { ref, computed, watch } from 'vue'

export interface AgentInput {
  name: string
  required: string | boolean  // Can be "required", "optional", or boolean
  description: string
}

export interface Agent {
  agentName: string
  description: string
  inputs: AgentInput[]
}

interface Props {
  agent: Agent
  modelValue?: Record<string, string>
}

interface Emits {
  (e: 'update:modelValue', value: Record<string, string>): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const formData = ref<Record<string, string>>({})
const errors = ref<Record<string, string>>({})

// Initialize form data with empty values
watch(() => props.agent, (newAgent) => {
  if (newAgent) {
    const initialData: Record<string, string> = {}
    newAgent.inputs.forEach(input => {
      initialData[input.name] = props.modelValue?.[input.name] || ''
    })
    formData.value = initialData
  }
}, { immediate: true })

// Helper to check if input is required (handles both string and boolean)
const isRequired = (input: AgentInput): boolean => {
  if (typeof input.required === 'boolean') return input.required
  return input.required === 'required'
}

// Separate required and optional inputs
const requiredInputs = computed(() => 
  props.agent.inputs.filter(input => isRequired(input))
)

const optionalInputs = computed(() => 
  props.agent.inputs.filter(input => !isRequired(input))
)

// Update parent component when form data changes
watch(formData, (newData) => {
  emit('update:modelValue', newData)
}, { deep: true })

// Validate a specific field
const validateField = (inputName: string, value: string, required: boolean) => {
  if (required && !value.trim()) {
    errors.value[inputName] = 'This field is required'
    return false
  } else {
    delete errors.value[inputName]
    return true
  }
}

// Validate all required fields
const validateAll = () => {
  let isValid = true
  requiredInputs.value.forEach(input => {
    const value = formData.value[input.name] || ''
    if (!validateField(input.name, value, true)) {
      isValid = false
    }
  })
  return isValid
}

// Expose validation method for parent component
defineExpose({
  validateAll
})

// Format input name for display (camelCase to Title Case)
const formatInputName = (name: string) => {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim()
}
</script>

<template>
  <div class="agent-input-form">
    <!-- Validation Error Banner (shown if there are errors) -->
    <div v-if="Object.keys(errors).length > 0" class="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
      <div class="flex items-start">
        <span class="material-symbols-outlined text-red-600 mr-3">error</span>
        <div>
          <h4 class="text-sm font-semibold text-red-900 mb-1">Please fix the following errors:</h4>
          <ul class="text-sm text-red-700 list-disc list-inside">
            <li v-for="(error, field) in errors" :key="field">
              {{ formatInputName(field) }}: {{ error }}
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Required Fields Section -->
    <div v-if="requiredInputs.length > 0" class="mb-8">
      <div class="flex items-center mb-4">
        <span class="material-symbols-outlined text-red-600 mr-2">star</span>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Required Fields</h3>
      </div>

      <div class="space-y-4">
        <div
          v-for="input in requiredInputs"
          :key="input.name"
          class="form-group"
        >
          <label :for="input.name" class="form-label required">
            {{ formatInputName(input.name) }}
          </label>
          <input
            :id="input.name"
            v-model="formData[input.name]"
            type="text"
            class="form-input"
            :class="{ 'border-red-500 focus:ring-red-500': errors[input.name] }"
            :placeholder="`Enter ${formatInputName(input.name).toLowerCase()}`"
          />
          <p v-if="input.description" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ input.description }}
          </p>
          <p v-if="errors[input.name]" class="mt-1 text-sm text-red-600">
            {{ errors[input.name] }}
          </p>
        </div>
      </div>
    </div>

    <!-- Optional Fields Section -->
    <div v-if="optionalInputs.length > 0">
      <div class="flex items-center mb-4">
        <span class="material-symbols-outlined text-gray-400 mr-2">radio_button_unchecked</span>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Optional Fields</h3>
      </div>

      <div class="space-y-4">
        <div
          v-for="input in optionalInputs"
          :key="input.name"
          class="form-group"
        >
          <label :for="input.name" class="form-label">
            {{ formatInputName(input.name) }}
          </label>
          <input
            :id="input.name"
            v-model="formData[input.name]"
            type="text"
            class="form-input"
            :placeholder="`Enter ${formatInputName(input.name).toLowerCase()} (optional)`"
          />
          <p v-if="input.description" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ input.description }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-group {
  @apply space-y-2;
}

.form-label {
  @apply block text-sm font-medium text-gray-700 dark:text-gray-300;
}

.form-label.required::after {
  content: ' *';
  @apply text-red-600;
}

.form-input {
  @apply w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm
         focus:ring-2 focus:ring-blue-500 focus:border-transparent
         transition-colors duration-200
         dark:bg-gray-800 dark:border-gray-600 dark:text-white
         dark:placeholder-gray-400;
}

.form-input:disabled {
  @apply bg-gray-100 cursor-not-allowed;
}
</style>
