<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useWorkflowPolling } from '@v2/composables/useWorkflowPolling'
import type { WorkflowStatus } from '@v2/types/infrastructure.types'

// Props interface
interface Props {
  correlationId: string
  isVisible: boolean
  workflowType?: 'custom' | 'template' | 'aks' | 'delete' | 'promote' | 'agent' | 'create-repo'
  // FR-004(f)/NFR-UX-001: 'sync' mode drives state directly for synchronous endpoints
  // (e.g. POST /api/secrets) — no useWorkflowPolling call is made in this mode.
  mode?: 'poll' | 'sync'
  syncState?: 'pending' | 'success' | 'failure'
  syncMessage?: string
  syncLink?: string
  syncLinkLabel?: string
  title?: string
  // FR-005(d) (secrets-environment-scope): optional per-environment outcome list for a sync-mode
  // submission covering more than one target (e.g. multi-environment secret fan-out). Additive
  // and opt-in — omitted by every other StatusModal consumer, so behavior elsewhere is unchanged.
  results?: Array<{ label: string; success: boolean; message?: string; link?: string }>
}

const props = withDefaults(defineProps<Props>(), {
  workflowType: 'custom',
  mode: 'poll',
  syncState: 'pending'
})

// Emits interface
interface Emits {
  (e: 'close'): void
  (e: 'success', data: WorkflowStatus): void
  (e: 'failure', error: string): void
  (e: 'retry'): void
}

const emit = defineEmits<Emits>()

// Use workflow polling composable
const { status, isPolling, startPolling, stopPolling } = useWorkflowPolling()

// Watch visibility and correlationId to start/stop polling (sync mode never polls)
watch(
  () => [props.isVisible, props.correlationId, props.workflowType, props.mode],
  ([visible, correlationId, workflowType, mode]) => {
    if (mode === 'sync') {
      stopPolling()
      return
    }
    if (visible && correlationId) {
      startPolling(correlationId as string, 'pending', workflowType as string)
    } else {
      stopPolling()
    }
  },
  { immediate: true }
)

// Watch status to emit events (poll mode only; sync mode has no async status to watch)
watch(
  () => status.value,
  (newStatus) => {
    if (props.mode === 'sync' || !newStatus) return

    if (newStatus.status === 'success') {
      emit('success', newStatus)
    } else if (newStatus.status === 'failure' || newStatus.status === 'failed') {
      emit('failure', newStatus.error || 'Workflow failed')
    }
  }
)

// Computed properties
const modalState = computed(() => {
  if (props.mode === 'sync') return props.syncState

  if (!status.value) return 'pending'

  const currentStatus = status.value.status
  if (currentStatus === 'completed') return 'success'
  if (currentStatus === 'failed') return 'failure'

  return currentStatus
})

const displayMessage = computed(() => {
  if (props.mode === 'sync') return props.syncMessage || 'Processing your request...'
  return status.value?.message || 'Your request is being processed. This may take a few minutes.'
})

const displayError = computed(() => (props.mode === 'sync' ? props.syncMessage : status.value?.error))

const modalColor = computed(() => {
  switch (modalState.value) {
    case 'pending':
      return 'blue'
    case 'in_progress':
      return 'yellow'
    case 'success':
      return 'green'
    case 'failure':
      return 'red'
    default:
      return 'blue'
  }
})

const modalIcon = computed(() => {
  switch (modalState.value) {
    case 'pending':
      return 'fa-spinner fa-spin'
    case 'in_progress':
      return 'fa-cog fa-spin'
    case 'success':
      return 'fa-check-circle'
    case 'failure':
      return 'fa-times-circle'
    default:
      return 'fa-spinner fa-spin'
  }
})

const modalTitle = computed(() => {
  const stateLabel = {
    pending: 'Starting...',
    in_progress: 'In Progress...',
    success: 'Successful!',
    failure: 'Failed',
    timeout: 'Timed Out',
    not_found: 'Not Found',
    queued: 'Queued',
    completed: 'Completed',
    failed: 'Failed'
  }[modalState.value]

  if (props.mode === 'sync') {
    return props.title ? `${props.title} ${stateLabel}` : stateLabel
  }

  const workflowTypeLabel = {
    custom: 'Custom Infrastructure',
    template: 'Template Deployment',
    aks: 'AKS Deployment',
    delete: 'Infrastructure Deletion',
    promote: 'Environment Promotion',
    agent: 'Agent Change Request',
    'create-repo': 'Code Repository Creation'
  }[props.workflowType]

  return `${workflowTypeLabel} ${stateLabel}`
})

const progressPercentage = computed(() => {
  return status.value?.percentage ?? 0
})

// Computed workflow steps that update based on progress
const workflowSteps = computed(() => {
  const progress = progressPercentage.value
  const isAKS = props.workflowType === 'aks'
  const isAgent = props.workflowType === 'agent'

  if (isAgent) {
    return [
      { label: 'Validating inputs', status: progress >= 20 ? 'completed' : progress > 0 ? 'in_progress' : 'pending' },
      { label: 'Building agent prompt', status: progress >= 40 ? 'completed' : progress >= 20 ? 'in_progress' : 'pending' },
      { label: 'Agent discovering infrastructure', status: progress >= 60 ? 'completed' : progress >= 40 ? 'in_progress' : 'pending' },
      { label: 'Building terragrunt changes', status: progress >= 80 ? 'completed' : progress >= 60 ? 'in_progress' : 'pending' },
      { label: 'Creating Pull Request', status: progress === 100 ? 'completed' : progress >= 80 ? 'in_progress' : 'pending' }
    ]
  }

  return [
    {
      label: 'Validation',
      status: progress >= 20 ? 'completed' : progress > 0 ? 'in_progress' : 'pending'
    },
    {
      label: isAKS ? 'Kustomization' : 'Terraform Planning',
      status: progress >= 40 ? 'completed' : progress >= 20 ? 'in_progress' : 'pending'
    },
    {
      label: 'GitHub Actions Execution',
      status: progress >= 60 ? 'completed' : progress >= 40 ? 'in_progress' : 'pending'
    },
    {
      label: 'Pull Request Creation',
      status: progress >= 90 ? 'completed' : progress >= 60 ? 'in_progress' : 'pending'
    },
    {
      label: 'Finalizing Deployment',
      status: progress === 100 ? 'completed' : progress >= 90 ? 'in_progress' : 'pending'
    }
  ]
})

const canClose = computed(() => {
  return modalState.value === 'success' || modalState.value === 'failure'
})

// Event handlers
function handleClose() {
  stopPolling()
  emit('close')
}

function handleRetry() {
  stopPolling()
  emit('retry')
}

function handleBackdropClick(event: MouseEvent) {
  if (canClose.value && (event.target as HTMLElement).classList.contains('modal-backdrop')) {
    handleClose()
  }
}

// Cleanup on unmount
onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="isVisible"
        class="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click="handleBackdropClick"
      >
        <Transition name="modal-slide">
          <div
            v-if="isVisible"
            class="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            @click.stop
          >
            <!-- Header -->
            <div
              class="px-6 py-4 border-b"
              :class="{
                'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800': modalColor === 'blue',
                'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800': modalColor === 'yellow',
                'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800': modalColor === 'green',
                'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800': modalColor === 'red'
              }"
            >
              <div class="flex items-center gap-3">
                <i
                  class="fas text-2xl"
                  :class="[
                    modalIcon,
                    {
                      'text-blue-600 dark:text-blue-400': modalColor === 'blue',
                      'text-yellow-600 dark:text-yellow-400': modalColor === 'yellow',
                      'text-green-600 dark:text-green-400': modalColor === 'green',
                      'text-red-600 dark:text-red-400': modalColor === 'red'
                    }
                  ]"
                ></i>
                <h3 class="text-xl font-semibold text-gray-900 dark:text-white">
                  {{ modalTitle }}
                </h3>
              </div>
            </div>

            <!-- Body -->
            <div class="px-6 py-6 space-y-6">
              <!-- Message -->
              <p class="text-gray-700 dark:text-gray-300 leading-relaxed">
                {{ displayMessage }}
              </p>

              <!-- Progress Steps (in_progress state; poll mode only) -->
              <div v-if="mode === 'poll' && modalState === 'in_progress'" class="space-y-3">
                <div
                  v-for="(step, index) in workflowSteps"
                  :key="index"
                  class="flex items-center gap-3 transition-all duration-300"
                >
                  <i
                    class="fas transition-all duration-300"
                    :class="{
                      'fa-check-circle text-green-500': step.status === 'completed',
                      'fa-spinner fa-spin text-yellow-500': step.status === 'in_progress',
                      'fa-circle text-gray-300 dark:text-gray-600': step.status === 'pending'
                    }"
                  ></i>
                  <span
                    class="text-sm transition-all duration-300"
                    :class="{
                      'text-gray-900 dark:text-white font-medium': step.status === 'in_progress',
                      'text-green-600 dark:text-green-400 font-medium': step.status === 'completed',
                      'text-gray-500 dark:text-gray-500': step.status === 'pending'
                    }"
                  >
                    {{ step.label }}
                  </span>
                </div>
              </div>

              <!-- Progress Bar (pending & in_progress; poll mode only) -->
              <div v-if="mode === 'poll' && (modalState === 'pending' || modalState === 'in_progress')" class="space-y-2">
                <div class="flex justify-between items-center text-sm">
                  <span class="text-gray-600 dark:text-gray-400">Progress</span>
                  <span class="font-medium text-gray-900 dark:text-white">{{ progressPercentage }}%</span>
                </div>
                <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                  <div
                    class="h-full transition-all duration-500 ease-out"
                    :class="{
                      'bg-blue-500': modalColor === 'blue',
                      'bg-yellow-500': modalColor === 'yellow'
                    }"
                    :style="{ width: `${progressPercentage}%` }"
                  ></div>
                </div>
              </div>

              <!-- Links (success state) -->
              <div v-if="modalState === 'success'" class="flex flex-col gap-3">
                <a
                  v-if="status?.resultUrl"
                  :href="status.resultUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                >
                  <i class="fas fa-external-link-alt"></i>
                  <span>View PR #{{ status.prNumber }}</span>
                </a>
                <a
                  v-if="status?.workflowUrl"
                  :href="status.workflowUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                >
                  <i class="fas fa-external-link-alt"></i>
                  <span>View Workflow</span>
                </a>
                <a
                  v-if="mode === 'sync' && syncLink"
                  :href="syncLink"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="sync-pr-link"
                  class="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                >
                  <i class="fas fa-external-link-alt"></i>
                  <span>{{ syncLinkLabel || 'View Pull Request' }}</span>
                </a>
              </div>

              <!-- FR-005(d): per-environment outcome list for a multi-environment fan-out submission -->
              <div v-if="mode === 'sync' && results && results.length > 1" class="space-y-2 text-left">
                <div
                  v-for="result in results"
                  :key="result.label"
                  class="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                  :class="result.success ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300' : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'"
                >
                  <span class="font-medium">{{ result.label }}</span>
                  <a v-if="result.success && result.link" :href="result.link" target="_blank" rel="noopener noreferrer" class="underline">View PR</a>
                  <span v-else-if="!result.success">{{ result.message }}</span>
                  <span v-else>Success</span>
                </div>
              </div>

              <!-- Error Details (failure state) -->
              <div
                v-if="modalState === 'failure' && displayError"
                class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4"
              >
                <p class="text-sm text-red-800 dark:text-red-300 font-mono">
                  {{ displayError }}
                </p>
              </div>

              <!-- Workflow Link (failure state) -->
              <a
                v-if="modalState === 'failure' && status?.workflowUrl"
                :href="status.workflowUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
              >
                <i class="fas fa-external-link-alt"></i>
                <span>View Workflow Logs</span>
              </a>
            </div>

            <!-- Footer -->
            <div
              class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3"
            >
              <button
                v-if="modalState === 'failure'"
                type="button"
                class="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                @click="handleRetry"
              >
                <i class="fas fa-redo mr-2"></i>
                Retry
              </button>
              <button
                v-if="canClose"
                type="button"
                class="px-6 py-2.5 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors"
                @click="handleClose"
              >
                Close
              </button>
              <button
                v-if="!canClose"
                type="button"
                disabled
                class="px-6 py-2.5 bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 font-medium rounded-lg cursor-not-allowed"
              >
                <i class="fas fa-hourglass-half mr-2"></i>
                Please Wait...
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Modal fade transition */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

/* Modal slide transition */
.modal-slide-enter-active,
.modal-slide-leave-active {
  transition: all 0.3s ease;
}

.modal-slide-enter-from {
  opacity: 0;
  transform: scale(0.9) translateY(-20px);
}

.modal-slide-leave-to {
  opacity: 0;
  transform: scale(0.9) translateY(20px);
}
</style>
