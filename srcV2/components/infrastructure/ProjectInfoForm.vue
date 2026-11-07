<template>
  <div class="project-info-form">
    <div class="form-header">
      <h2>Project Information</h2>
      <p class="text-gray-600 dark:text-gray-300">
        Provide basic information about your infrastructure project
      </p>
    </div>

    <form @submit.prevent="handleSubmit" class="space-y-6">
      <!-- Row 1: Project Abbreviation & Service Name -->
      <div class="form-row">
        <div class="form-group">
          <label for="projectName" class="form-label required">
            Project Abbreviation
            <span class="text-xs text-gray-500">(Max 8 chars, alphanumeric)</span>
          </label>
          <input
            id="projectName"
            v-model="formData.projectName"
            type="text"
            maxlength="8"
            pattern="[a-zA-Z0-9]+"
            required
            class="form-input"
            :class="{ 'input-error': errors.projectName }"
            placeholder="e.g., webapp01"
            @input="validateProjectName"
          />
          <p v-if="errors.projectName" class="error-message">
            {{ errors.projectName }}
          </p>
        </div>

        <div class="form-group">
          <label for="descriptiveName" class="form-label required">
            Service Name
            <span class="text-xs text-gray-500">(Max 100 chars)</span>
          </label>
          <input
            id="descriptiveName"
            v-model="formData.descriptiveName"
            type="text"
            maxlength="100"
            required
            class="form-input"
            placeholder="CustomerPortalService"
          />
        </div>
      </div>

      <!-- Row 2: Environment & Owner -->
      <div class="form-row">
        <div class="form-group">
          <label for="environment" class="form-label required">
            Environment
          </label>
          <select
            id="environment"
            v-model="formData.environment"
            required
            class="form-select"
          >
            <option value="">Select environment</option>
            <option
              v-for="env in envStore.customInfraEnvironments"
              :key="env.id"
              :value="env.id"
            >
              {{ env.displayName }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label for="owner" class="form-label required">
            Owner
            <span class="text-xs text-gray-500">(Email or identifier)</span>
          </label>
          <input
            id="owner"
            v-model="formData.owner"
            type="text"
            required
            class="form-input"
            placeholder="e.g., Team Name or User Email"
          />
        </div>
      </div>

      <!-- Row 3: Project Age & Approval Number -->
      <div class="form-row">
        <div class="form-group">
          <label for="projectAge" class="form-label required">
            Expected Lifetime (days)
          </label>
          <input
            id="projectAge"
            v-model.number="formData.projectAge"
            type="number"
            min="1"
            required
            class="form-input"
            placeholder="e.g., 90"
          />
          <p class="text-xs text-gray-500 mt-1">
            {{ projectAgeDescription }}
          </p>
        </div>

        <div class="form-group">
          <label for="approvalNumber" class="form-label required">
            Jira#
            <span class="text-xs text-gray-500">(Any JIRA or CR number is required)</span>
          </label>
          <input
            id="approvalNumber"
            v-model="formData.approvalNumber"
            type="text"
            maxlength="20"
            required
            class="form-input"
            :class="{ 'input-error': errors.approvalNumber }"
            placeholder="e.g., JIRA-1234 or CR-5678"
            @input="validateApprovalNumber"
          />
          <p v-if="errors.approvalNumber" class="error-message">
            {{ errors.approvalNumber }}
          </p>
          <p v-else class="text-xs text-gray-500 mt-1">
            Required: for audit trail and approval tracking
          </p>
        </div>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, watch } from 'vue'
import { useEnvironmentsStore } from '../../stores/environments'
import type { AppMetadata } from '@v2/types/infrastructure.types'

// Get environments store
const envStore = useEnvironmentsStore()

// Props
const props = defineProps<{
  modelValue: {
    projectName: string
    descriptiveName: string
    environment: string
    owner: string
    lifecycle: string
    projectAge: number
    approvalNumber: string
  }
  prefillData?: AppMetadata
}>()

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: typeof props.modelValue]
}>()

// Form data (reactive copy of modelValue)
const formData = reactive({ ...props.modelValue })

// Always set lifecycle to experimental
formData.lifecycle = 'experimental'

// Errors
const errors = reactive<{ projectName?: string; approvalNumber?: string }>({})

// Computed descriptions
const projectAgeDescription = computed(() => {
  const days = formData.projectAge
  if (!days) return 'How long should this infrastructure exist?'
  if (days <= 7) return `~1 week`
  if (days <= 30) return `~1 month`
  if (days <= 90) return `~3 months`
  if (days <= 180) return `~6 months`
  return `~${Math.floor(days / 365)} year(s)`
})

// Validation
const validateProjectName = () => {
  const name = formData.projectName
  errors.projectName = undefined

  if (!name) {
    return
  }

  // Alphanumeric validation
  if (!/^[a-zA-Z0-9]+$/.test(name)) {
    errors.projectName = 'Only alphanumeric characters allowed (no spaces or special chars)'
    return
  }

  // Length validation
  if (name.length > 8) {
    errors.projectName = 'Maximum 8 characters'
    return
  }

  // Emit update when valid
  emit('update:modelValue', { ...formData })
}

const validateApprovalNumber = () => {
  const number = formData.approvalNumber
  errors.approvalNumber = undefined

  if (!number) {
    return
  }

  // Format validation: JIRA-1234, CR-5678, etc.
  if (!/^[A-Z]+-\d+$/.test(number)) {
    errors.approvalNumber = 'Format must be like JIRA-1234 or CR-5678 (letters-numbers)'
    return
  }

  // Emit update when valid
  emit('update:modelValue', { ...formData })
}

// Watch all form changes and emit
const handleSubmit = () => {
  // Form submission is handled by parent
  emit('update:modelValue', { ...formData })
}

// Emit updates on any change
const emitUpdate = () => {
  if (!errors.projectName) {
    emit('update:modelValue', { ...formData })
  }
}

// Watch individual fields
watch(formData, emitUpdate, { deep: true })

// FR-003: Watch prefillData prop and apply pre-fill when it changes
watch(
  () => props.prefillData,
  (newData) => {
    if (!newData) return
    // Apply pre-fill fields (lifecycle, projectAge, approvalNumber are NOT pre-filled)
    formData.projectName = newData.name ?? formData.projectName
    formData.descriptiveName = newData.description ?? formData.descriptiveName
    formData.environment = newData.environment ?? formData.environment
    formData.owner = newData.owner ?? formData.owner
    // lifecycle always stays 'experimental' — not pre-filled
    // projectAge and approvalNumber — not pre-filled
    emit('update:modelValue', { ...formData })
  },
  { immediate: false }
)
</script>

<style scoped>
.project-info-form {
  @apply w-full;
}

.form-header {
  @apply mb-6;
}

.form-header h2 {
  @apply text-2xl font-bold text-gray-900 dark:text-white mb-2;
}

.form-row {
  @apply grid grid-cols-1 md:grid-cols-2 gap-6;
}

.form-group {
  @apply flex flex-col;
}

.form-label {
  @apply block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2;
}

.form-label.required::after {
  content: ' *';
  @apply text-red-500;
}

.form-input,
.form-select {
  @apply w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg;
  @apply bg-white dark:bg-gray-700 text-gray-900 dark:text-white;
  @apply focus:ring-2 focus:ring-blue-500 focus:border-transparent;
  @apply transition-colors;
}

.form-input.input-error {
  @apply border-red-500 focus:ring-red-500;
}

.error-message {
  @apply text-sm text-red-600 dark:text-red-400 mt-1;
}

.space-y-6 > * + * {
  @apply mt-6;
}
</style>
