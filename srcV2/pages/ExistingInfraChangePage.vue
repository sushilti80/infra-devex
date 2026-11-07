<script setup lang="ts">
import { ref, watch } from 'vue'
import { useNavigationStore } from '@v2/stores/navigation'
import { apiService } from '@v2/services/api'
import { useAuth } from '@v2/composables/useAuth'
import { useAuthStore } from '@v2/stores/auth'
import AgentSelector from '@v2/components/agent/AgentSelector.vue'
import AgentInputForm from '@v2/components/agent/AgentInputForm.vue'
import StatusModal from '@v2/components/modals/StatusModal.vue'
import type { Agent } from '@v2/components/agent/AgentSelector.vue'

const navigationStore = useNavigationStore()
const { user } = useAuth()
const authStore = useAuthStore()

// Current step (1-3)
const currentStep = ref(1)

// Step 1: Agent Selection
const selectedAgent = ref<Agent | null>(null)
const selectedAgentName = ref<string>('')

// Step 2: Agent Inputs
const agentInputs = ref<Record<string, string>>({})
const agentInputFormRef = ref<any>(null)

// Step 3: Review & Submit
const submitting = ref(false)
const showStatusModal = ref(false)
const currentCorrelationId = ref<string>('')

// Optional parameters — triggeredBy is auto-populated from auth, purely internal
const triggeredBy = ref<string>(authStore.user?.email || '')

// Keep watcher as fallback for late-loading auth (e.g. post-redirect)
watch(user, (newUser) => {
  if (newUser?.email && !triggeredBy.value) {
    triggeredBy.value = newUser.email
  }
})

// Handle agent selection
const handleAgentSelect = (agent: Agent) => {
  selectedAgent.value = agent
}

// Navigation methods
const goToNextStep = () => {
  // Validate current step before proceeding
  if (currentStep.value === 1 && !selectedAgent.value) {
    alert('Please select an agent')
    return
  }
  
  if (currentStep.value === 2) {
    // Validate agent inputs
    if (agentInputFormRef.value && !agentInputFormRef.value.validateAll()) {
      return
    }
  }
  
  currentStep.value++
}

const goToPreviousStep = () => {
  if (currentStep.value > 1) {
    currentStep.value--
  }
}

const goToStep = (step: number) => {
  // Only allow navigation to completed steps
  if (step === 1) {
    currentStep.value = step
  } else if (step === 2 && selectedAgent.value) {
    currentStep.value = step
  } else if (step === 3 && selectedAgent.value) {
    currentStep.value = step
  }
}

// Generate correlation ID
const generateCorrelationId = () => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 6)
  return `cid-${timestamp}-${random}`
}

// Submit the change request
const submitChangeRequest = async () => {
  if (!selectedAgent.value) {
    return
  }

  try {
    submitting.value = true
    const correlationId = generateCorrelationId()

    const response = await apiService.submitAgentChange({
      agentName: selectedAgent.value.agentName,
      inputs: agentInputs.value,
      correlationId,
      triggeredBy: authStore.user?.email || triggeredBy.value || undefined,
      jiraTicket: agentInputs.value.jiraTicket || undefined
    })

    if (response.success) {
      currentCorrelationId.value = correlationId
      showStatusModal.value = true
    }
  } catch (error: any) {
    alert(error.message || 'Failed to submit change request')
  } finally {
    submitting.value = false
  }
}

// Reset form and start over
const startOver = () => {
  currentStep.value = 1
  selectedAgent.value = null
  selectedAgentName.value = ''
  agentInputs.value = {}
  showStatusModal.value = false
  currentCorrelationId.value = ''
  triggeredBy.value = authStore.user?.email || ''
}

// Status modal handlers
const closeStatusModal = () => {
  showStatusModal.value = false
  startOver()
}

const handleSuccess = () => {
  // Modal stays open showing success until user closes
}

const handleFailure = (error: string) => {
  console.error('[ExistingInfraChangePage] Agent workflow failed:', error)
}
</script>

<template>
  <div class="existing-infra-change-page">
    <!-- Page Header -->
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Existing Infrastructure Change</h1>
      <p class="text-gray-600">
        Select an agent and provide inputs to modify existing infrastructure
      </p>
    </div>

    <!-- Wizard Steps -->
    <div class="space-y-6">
      <!-- Step Indicator -->
      <div class="flex items-center justify-between mb-8">
        <div 
          v-for="step in 3" 
          :key="step"
          class="flex items-center"
          :class="{ 'flex-1': step < 3 }"
        >
          <!-- Step Circle -->
          <button
            @click="goToStep(step)"
            class="step-indicator"
            :class="{
              'step-active': currentStep === step,
              'step-completed': currentStep > step,
              'step-disabled': currentStep < step
            }"
          >
            <span v-if="currentStep > step" class="material-symbols-outlined">check</span>
            <span v-else>{{ step }}</span>
          </button>

          <!-- Step Label -->
          <div class="ml-3 text-left">
            <p class="text-xs text-gray-500">Step {{ step }}</p>
            <p class="text-sm font-medium text-gray-900">
              {{ step === 1 ? 'Select Agent' : step === 2 ? 'Configure' : 'Review' }}
            </p>
          </div>

          <!-- Connecting Line -->
          <div 
            v-if="step < 3"
            class="flex-1 h-0.5 mx-4"
            :class="currentStep > step ? 'bg-blue-600' : 'bg-gray-300'"
          ></div>
        </div>
      </div>

      <!-- Step Content -->
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <!-- Step 1: Select Agent -->
        <div v-if="currentStep === 1" class="step-content">
          <h2 class="text-xl font-semibold text-gray-900 mb-6">Agent Selection</h2>

          <div class="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div class="flex items-start">
              <span class="material-symbols-outlined text-blue-600 mr-2">info</span>
              <p class="text-sm text-blue-800">
                Choose a specialized agent that will autonomously handle your infrastructure changes. 
                The agent will discover the target infrastructure based on the inputs you provide.
              </p>
            </div>
          </div>

          <!-- Agent Selection -->
          <div class="mb-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">Select Agent</h3>
            <AgentSelector
              v-model="selectedAgentName"
              @select="handleAgentSelect"
            />
          </div>
        </div>

        <!-- Step 2: Configure Agent Inputs -->
        <div v-else-if="currentStep === 2" class="step-content">
          <div class="mb-6">
            <h2 class="text-xl font-semibold text-gray-900 mb-2">Configure Inputs</h2>
            <p class="text-sm text-gray-600">
              <span class="material-symbols-outlined text-sm align-middle mr-1">smart_toy</span>
              Agent: <span class="font-medium text-gray-900">{{ selectedAgent?.agentName }}</span>
            </p>
          </div>

          <AgentInputForm
            v-if="selectedAgent"
            ref="agentInputFormRef"
            :agent="selectedAgent"
            v-model="agentInputs"
          />
        </div>

        <!-- Step 3: Review & Submit -->
        <div v-else-if="currentStep === 3" class="step-content">
          <h2 class="text-xl font-semibold text-gray-900 mb-6">Review & Submit</h2>

          <!-- Agent Details -->
          <div class="mb-6 bg-white border border-gray-200 rounded-lg p-4">
            <div class="flex items-center mb-3">
              <span class="material-symbols-outlined text-gray-600 mr-2">smart_toy</span>
              <h3 class="text-lg font-semibold text-gray-900">Selected Agent</h3>
            </div>
            <div class="text-sm">
              <p class="font-medium text-gray-900 mb-1">{{ selectedAgent?.agentName }}</p>
              <p class="text-gray-600">{{ selectedAgent?.description }}</p>
            </div>
          </div>

          <!-- Configuration -->
          <div class="mb-6 bg-white border border-gray-200 rounded-lg p-4">
            <div class="flex items-center mb-3">
              <span class="material-symbols-outlined text-gray-600 mr-2">settings</span>
              <h3 class="text-lg font-semibold text-gray-900">Configuration</h3>
            </div>
            <div class="space-y-2 text-sm">
              <div v-for="(value, key) in agentInputs" :key="key" class="flex justify-between">
                <span class="text-gray-500">{{ key }}:</span>
                <span class="font-medium text-gray-900">{{ value || '(not provided)' }}</span>
              </div>
            </div>
          </div>

          <!-- Warning Banner -->
          <div class="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div class="flex items-start">
              <span class="material-symbols-outlined text-yellow-600 mr-2">warning</span>
              <p class="text-sm text-yellow-800">
                The agent will autonomously discover and modify the appropriate infrastructure. 
                All changes will be reviewed via pull request before being applied.
              </p>
            </div>
          </div>

          <!-- Submit Button -->
          <button
            @click="submitChangeRequest"
            :disabled="submitting"
            class="btn btn-primary btn-lg w-full"
          >
            <span v-if="!submitting" class="material-symbols-outlined">check_circle</span>
            <span v-else class="animate-spin material-symbols-outlined">progress_activity</span>
            {{ submitting ? 'Submitting...' : 'Submit to Agent' }}
          </button>
        </div>
      </div>

      <!-- Navigation Buttons -->
      <div class="flex items-center justify-between">
        <button
          v-if="currentStep > 1"
          @click="goToPreviousStep"
          class="btn btn-secondary"
        >
          <span class="material-symbols-outlined">arrow_back</span>
          Previous
        </button>
        <div v-else></div>

        <div class="flex gap-4">
          <button
            @click="navigationStore.navigateToPage('home')"
            class="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            v-if="currentStep < 3"
            @click="goToNextStep"
            class="btn btn-primary"
          >
            Next
            <span class="material-symbols-outlined">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Workflow Status Modal -->
  <StatusModal
    v-if="showStatusModal"
    :is-visible="showStatusModal"
    :correlation-id="currentCorrelationId"
    workflow-type="agent"
    @close="closeStatusModal"
    @success="handleSuccess"
    @failure="handleFailure"
    @retry="startOver"
  />
</template>

<style scoped>
.step-indicator {
  @apply w-10 h-10 rounded-full flex items-center justify-center font-semibold
         transition-all duration-200 cursor-pointer;
}

.step-active {
  @apply bg-blue-600 text-white;
}

.step-completed {
  @apply bg-blue-600 text-white hover:bg-blue-700;
}

.step-disabled {
  @apply bg-gray-200 text-gray-500 cursor-not-allowed;
}

.infrastructure-card {
  @apply bg-white border rounded-lg p-4 cursor-pointer transition-all hover:shadow-md;
}

.btn {
  @apply inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium
         transition-colors duration-200;
}

.btn-primary {
  @apply bg-blue-600 text-white hover:bg-blue-700;
}

.btn-secondary {
  @apply bg-white border border-gray-300 text-gray-700 hover:bg-gray-50;
}

.btn-lg {
  @apply px-6 py-3 text-lg;
}

.btn:disabled {
  @apply opacity-50 cursor-not-allowed;
}
</style>
