<template>
  <section class="page">
    <!-- Page Heading -->
    <div class="page-header">
      <h1 class="text-4xl font-black text-gray-900 dark:text-white"></h1>
      <p class="text-lg text-gray-600 dark:text-gray-400 mt-2">
        Use pre-configured templates for common scenarios
      </p>
    </div>

    <div class="form-container max-w-4xl mx-auto">
      <!-- Template Selection Card -->
      <div class="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 mb-8">
        <form @submit.prevent="handleSubmit" class="space-y-6">
          <!-- Template Selector -->
          <div>
            <label
              for="template-select"
              class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
            >
              Select Template
            </label>
            <select
              id="template-select"
              v-model="templateName"
              required
              class="w-full px-4 h-12 rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            >
              <option value="" disabled>Choose a template</option>
              <option v-for="template in templates" :key="template.name" :value="template.name">
                {{ template.description }}
              </option>
            </select>
          </div>

          <!-- Template Details Box -->
          <div
            v-if="selectedTemplate"
            class="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-6 border border-gray-100 dark:border-gray-800"
          >
            <h3 class="text-gray-900 dark:text-white font-bold text-lg mb-2">
              Template Details
            </h3>
            <p class="text-gray-600 dark:text-gray-400 text-sm leading-relaxed mb-6">
              {{ selectedTemplate.description }}
            </p>

            <!-- Included Modules -->
            <div class="flex flex-col gap-3">
              <span class="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Included Modules
              </span>
              <div class="flex flex-wrap gap-2">
                <span
                  v-for="module in selectedTemplate.modules"
                  :key="module"
                  class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                >
                  <span class="material-symbols-outlined text-sm mr-1">settings</span>
                  {{ module }}
                </span>
              </div>
            </div>
          </div>

          <!-- Form Fields Row 1 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label
                for="template-project-name"
                class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
              >
                Project Abbreviation <span class="text-xs text-gray-500">(max 8 chars)</span>
              </label>
              <input
                type="text"
                id="template-project-name"
                v-model="projectName"
                maxlength="8"
                required
                placeholder="e.g., myapp"
                class="w-full px-4 h-10 rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <label
                for="template-environment"
                class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
              >
                Environment
              </label>
              <select
                id="template-environment"
                v-model="environment"
                required
                class="w-full px-4 h-10 rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              >
                <option value="">Select Environment</option>
                <option
                  v-for="env in envStore.templateEnvironments"
                  :key="env.id"
                  :value="env.id"
                >
                  {{ env.displayName }}
                </option>
              </select>
            </div>
          </div>

          <!-- Form Fields Row 2 -->
          <div>
            <label
              for="template-descriptive-name"
              class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
            >
              Service Name
            </label>
            <input
              type="text"
              id="template-descriptive-name"
              v-model="descriptiveName"
              required
              placeholder="e.g., Customer Portal API"
              class="w-full px-4 h-10 rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>

          <!-- Form Fields Row 3 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label
                for="template-owner"
                class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
              >
                Owner
              </label>
              <input
                type="text"
                id="template-owner"
                v-model="owner"
                required
                placeholder="e.g., team-name"
                class="w-full px-4 h-10 rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <label
                for="template-jira"
                class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
              >
                Jira/CR Number <span class="text-xs text-gray-500">(Optional)</span>
              </label>
              <input
                type="text"
                id="template-jira"
                v-model="jira"
                placeholder="e.g., CR-1234"
                class="w-full px-4 h-10 rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          <!-- Project Age -->
          <div>
            <label
              for="template-age"
              class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
            >
              Project Lifetime
            </label>
            <select
              id="template-age"
              v-model.number="projectAge"
              required
              class="w-full px-4 h-10 rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            >
              <option value="" disabled>Select project lifetime</option>
              <option :value="3">3 days</option>
              <option :value="30">1 month</option>
              <option :value="90">3 months</option>
            </select>
          </div>

          <!-- Form Actions -->
          <div class="flex gap-4 pt-6 border-t border-gray-200 dark:border-gray-800">
            <button
              type="button"
              @click="cancel"
              class="px-6 h-10 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="isSubmitting"
              class="px-6 h-10 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <span v-if="!isSubmitting" class="material-symbols-outlined text-lg">
                cloud_upload
              </span>
              <span v-if="isSubmitting">Deploying...</span>
              <span v-else>Deploy Template</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </section>

  <!-- Status Modal -->
  <StatusModal
    v-if="showStatusModal"
    :is-visible="showStatusModal"
    :correlation-id="currentCorrelationId"
    workflow-type="template"
    @close="closeStatusModal"
    @success="handleSuccess"
    @failure="handleFailure"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useNavigationStore } from '../stores/navigation'
import { useWorkflowStore } from '../stores/workflow'
import api from '../services/api'
import StatusModal from '../components/modals/StatusModal.vue'
import type { Template } from '@v2/types/infrastructure.types'
import { useEnvironmentsStore } from '../stores/environments'

// Stores
const navigationStore = useNavigationStore()
const workflowStore = useWorkflowStore()
const envStore = useEnvironmentsStore()

// Form state - using individual refs instead of formData object
const templateName = ref('')
const projectName = ref('')
const descriptiveName = ref('')
const environment = ref(envStore.templateEnvironments[0]?.id || 'sand')
const owner = ref('')
const jira = ref('')
const projectAge = ref(30)

// UI state
const isSubmitting = ref(false)
const isLoadingTemplates = ref(false)
const validationErrors = ref<Record<string, string>>({})
const templates = ref<Template[]>([])

// Status modal state
const showStatusModal = ref(false)
const currentCorrelationId = ref('')

// Computed selectedTemplate
const selectedTemplate = computed(() => {
  return templates.value.find((t) => t.name === templateName.value)
})

// Load templates from API on mount - matches vanilla JS loadTemplates()
onMounted(async () => {
  console.log('[TemplateDeployPage] Component mounted, loading templates...')
  await loadTemplates()
})

async function loadTemplates() {
  try {
    isLoadingTemplates.value = true
    console.log('[TemplateDeployPage] Fetching templates from /api/templates...')

    const response = await api.getTemplates()

    // Backend returns { success: true, data: [...] } format
    if (response?.success && Array.isArray(response.data)) {
      templates.value = response.data
      console.log(`[TemplateDeployPage] Loaded ${response.data.length} templates`, response.data)
    } else {
      console.warn('[TemplateDeployPage] Invalid response format:', response)
      templates.value = []
    }
  } catch (error) {
    console.error('[TemplateDeployPage] Failed to load templates:', error)
    templates.value = []
  } finally {
    isLoadingTemplates.value = false
  }
}

// Generate correlation ID - matches vanilla JS format exactly
function generateCorrelationId(): string {
  return `cid-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
}

// Validate form
function validateForm(): boolean {
  validationErrors.value = {}

  if (!templateName.value) {
    validationErrors.value.templateName = 'Template is required'
  }
  if (!projectName.value) {
    validationErrors.value.projectName = 'Project abbreviation is required'
  }
  if (projectName.value && projectName.value.length > 8) {
    validationErrors.value.projectName = 'Project abbreviation cannot exceed 8 characters'
  }
  if (!descriptiveName.value) {
    validationErrors.value.descriptiveName = 'Service name is required'
  }
  if (!environment.value) {
    validationErrors.value.environment = 'Environment is required'
  }
  if (!owner.value) {
    validationErrors.value.owner = 'Owner is required'
  }

  return Object.keys(validationErrors.value).length === 0
}

// Submit form - matches vanilla JS setupTemplateForm logic exactly
async function handleSubmit() {
  if (!validateForm()) return

  isSubmitting.value = true

  try {
    // Generate correlation ID (matches vanilla JS)
    const correlationId = generateCorrelationId()
    currentCorrelationId.value = correlationId

    console.log('[TemplateDeployPage] Submitting template deployment request:', {
      templateName: templateName.value,
      projectName: projectName.value,
      descriptiveName: descriptiveName.value,
      environment: environment.value,
      owner: owner.value,
      jira: jira.value,
      projectAge: projectAge.value,
      correlationId
    })

    // Prepare request data (matches vanilla JS requestData structure exactly)
    const requestData = {
      templateName: templateName.value,
      projectName: projectName.value,
      project_desc: descriptiveName.value || 'No description provided', // Matches vanilla JS field name
      environment: environment.value,
      owner: owner.value,
      jira: jira.value || '', // Optional CR/JIRA number
      projectAge: projectAge.value,
      correlationId
    }

    // Show status modal immediately (like vanilla JS shows modal before API call)
    showStatusModal.value = true

    // Track workflow in store (enables polling)
    workflowStore.trackWorkflow(correlationId, 'pending')

    // Call API (POST /api/template) - matches vanilla JS fetch call
    const response = await api.provisionTemplate(requestData)

    console.log('[TemplateDeployPage] Template deployment response:', response)

    if (response) {
      // Reset form on success (matches vanilla JS: templateForm.reset())
      resetForm()

      // Workflow polling is handled automatically by StatusModal component
      // which watches the workflowStore (similar to vanilla JS pollWorkflowStatus)
    } else {
      throw new Error('Failed to trigger template deployment workflow')
    }
  } catch (error: any) {
    console.error('[TemplateDeployPage] Failed to deploy template:', error)
    validationErrors.value.submit = error.message || 'Failed to submit request'
    showStatusModal.value = false
  } finally {
    isSubmitting.value = false
  }
}

// Reset form (matches vanilla JS templateForm.reset())
function resetForm() {
  templateName.value = ''
  projectName.value = ''
  descriptiveName.value = ''
  environment.value = envStore.templateEnvironments[0]?.id || 'sand'
  owner.value = ''
  jira.value = ''
  projectAge.value = 30
  validationErrors.value = {}
}

// Cancel and go back
function cancel() {
  navigationStore.navigateToPage('home')
}

// Handle status modal close
function closeStatusModal() {
  showStatusModal.value = false
  // Navigate to installed apps after successful deployment
  navigationStore.navigateToPage('apps')
}

// Handle deployment success
function handleSuccess(data: any) {
  console.log('[TemplateDeployPage] Deployment successful:', data)
}

// Handle deployment failure
function handleFailure(error: string) {
  console.error('[TemplateDeployPage] Deployment failed:', error)
  validationErrors.value.submit = error
}
</script>

<style scoped>
/* Minimal custom styles - most styling handled by Tailwind classes */

/* Smooth transitions for interactive elements */
input:focus,
select:focus,
textarea:focus {
  transition: all 0.2s ease-in-out;
}

/* Smooth transition for template preview appearance */
.template-preview-enter-active,
.template-preview-leave-active {
  transition: all 0.3s ease;
}

.template-preview-enter-from,
.template-preview-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
