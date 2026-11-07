# StatusModal.vue Specification

**Priority**: 🔴 CRITICAL  
**Status**: 🔴 NEW (Must be created from scratch)  
**Effort**: 3-4 hours  
**Dependencies**: `useWorkflowPolling` composable, GET /api/status/:correlationId

---

## Overview

The **StatusModal** displays real-time progress for asynchronous infrastructure operations (deployments, deletions, promotions). It polls the backend workflow status API and provides visual feedback with color-coded states.

**Design Reference**: 
- `/docs/vue-handoff/assets/designs/status-modal-pending.html`
- `/docs/vue-handoff/assets/designs/status-modal-in-progress.html`
- `/docs/vue-handoff/assets/designs/status-modal-success.html`

---

## Visual States

### State 1: Pending (Blue)
```
┌────────────────────────────────────────┐
│  ⟳  Workflow Starting...               │
│                                        │
│  Your request is being processed.      │
│  This may take a few minutes.          │
│                                        │
│  ████████░░░░░░░░░░░░ 35%            │
│                                        │
│                 [Please Wait...]       │
└────────────────────────────────────────┘
```

### State 2: In Progress (Yellow)
```
┌────────────────────────────────────────┐
│  ⚙️  Provisioning Infrastructure...     │
│                                        │
│  ✓ Validation complete                 │
│  ⟳ Creating resources...               │
│  ○ Configuring RBAC                    │
│                                        │
│  ████████████████░░░░ 75%             │
│                                        │
│                 [Please Wait...]       │
└────────────────────────────────────────┘
```

### State 3: Success (Green)
```
┌────────────────────────────────────────┐
│  ✓  Deployment Successful!             │
│                                        │
│  Your infrastructure has been          │
│  provisioned successfully.             │
│                                        │
│  PR #1234: https://github.com/...      │
│                                        │
│              [View Details]  [Close]   │
└────────────────────────────────────────┘
```

### State 4: Failure (Red)
```
┌────────────────────────────────────────┐
│  ✗  Deployment Failed                  │
│                                        │
│  Error: Terraform validation failed    │
│  Module 'storage' configuration        │
│  invalid.                              │
│                                        │
│  Workflow: https://github.com/...      │
│                                        │
│               [Retry]  [Close]         │
└────────────────────────────────────────┘
```

---

## Component API

### Props
```typescript
interface Props {
  correlationId: string;           // Workflow tracking ID
  isVisible: boolean;              // Modal visibility
  workflowType?: 'custom' | 'template' | 'aks' | 'delete' | 'promote';
}

// Usage:
<StatusModal
  :correlation-id="correlationId"
  :is-visible="showModal"
  workflow-type="custom"
  @close="handleClose"
  @success="handleSuccess"
/>
```

### Emits
```typescript
interface Emits {
  (e: 'close'): void;                          // User closes modal
  (e: 'success', data: WorkflowResult): void;  // Workflow succeeded
  (e: 'failure', error: string): void;         // Workflow failed
  (e: 'retry'): void;                          // User clicks retry
}
```

### Composable Integration
```typescript
// Uses existing composable from srcV2/composables/useWorkflowPolling.ts
import { useWorkflowPolling } from '@/composables/useWorkflowPolling';

const { 
  status,          // Current workflow status
  isPolling,       // Polling active flag
  startPolling,    // Start polling function
  stopPolling      // Stop polling function
} = useWorkflowPolling();
```

---

## Component Structure

```vue
<script setup lang="ts">
import { computed, watch } from 'vue';
import { useWorkflowPolling } from '@/composables/useWorkflowPolling';
import type { WorkflowStatus } from '@/types/infrastructure.types';

interface Props {
  correlationId: string;
  isVisible: boolean;
  workflowType?: 'custom' | 'template' | 'aks' | 'delete' | 'promote';
}

interface Emits {
  (e: 'close'): void;
  (e: 'success', data: WorkflowStatus): void;
  (e: 'failure', error: string): void;
  (e: 'retry'): void;
}

const props = withDefaults(defineProps<Props>(), {
  workflowType: 'custom'
});

const emit = defineEmits<Emits>();

// Use workflow polling composable
const { status, isPolling, startPolling, stopPolling } = useWorkflowPolling();

// Watch visibility and start/stop polling
watch(() => props.isVisible, (visible) => {
  if (visible && props.correlationId) {
    startPolling(props.correlationId);
  } else {
    stopPolling();
  }
}, { immediate: true });

// Watch status and emit events
watch(() => status.value, (newStatus) => {
  if (!newStatus) return;

  if (newStatus.status === 'success') {
    emit('success', newStatus);
  } else if (newStatus.status === 'failure') {
    emit('failure', newStatus.error || 'Unknown error');
  }
});

// Computed state properties
const modalState = computed(() => {
  if (!status.value) return 'pending';
  return status.value.status;
});

const modalColor = computed(() => {
  switch (modalState.value) {
    case 'pending': return 'blue';
    case 'in_progress': return 'yellow';
    case 'success': return 'green';
    case 'failure': return 'red';
    default: return 'blue';
  }
});

const modalIcon = computed(() => {
  switch (modalState.value) {
    case 'pending': return 'fa-spinner fa-spin';
    case 'in_progress': return 'fa-cog fa-spin';
    case 'success': return 'fa-check-circle';
    case 'failure': return 'fa-times-circle';
    default: return 'fa-spinner fa-spin';
  }
});

const modalTitle = computed(() => {
  const typeLabels = {
    custom: 'Custom Infrastructure',
    template: 'Template Deployment',
    aks: 'AKS Deployment',
    delete: 'Infrastructure Deletion',
    promote: 'Environment Promotion'
  };

  const stateLabels = {
    pending: 'Starting...',
    in_progress: 'In Progress...',
    success: 'Successful!',
    failure: 'Failed'
  };

  const type = typeLabels[props.workflowType];
  const state = stateLabels[modalState.value];

  return `${type} ${state}`;
});

const progressPercentage = computed(() => {
  return status.value?.percentage || 0;
});

const canClose = computed(() => {
  return modalState.value === 'success' || modalState.value === 'failure';
});

// Handlers
const handleClose = () => {
  if (canClose.value) {
    stopPolling();
    emit('close');
  }
};

const handleRetry = () => {
  stopPolling();
  emit('retry');
};

const handleBackdropClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains('modal-backdrop')) {
    handleClose();
  }
};
</script>

<template>
  <Teleport to="body">
    <Transition
      name="modal"
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isVisible"
        class="modal-backdrop fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click="handleBackdropClick"
      >
        <Transition
          name="modal-content"
          enter-active-class="transition-all duration-200"
          leave-active-class="transition-all duration-200"
          enter-from-class="opacity-0 scale-95"
          leave-to-class="opacity-0 scale-95"
        >
          <div
            class="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden"
            @click.stop
          >
            <!-- Header -->
            <div
              :class="[
                'px-6 py-4 border-b',
                modalColor === 'blue' && 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
                modalColor === 'yellow' && 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
                modalColor === 'green' && 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
                modalColor === 'red' && 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              ]"
            >
              <div class="flex items-center space-x-3">
                <i
                  :class="[
                    'fas text-2xl',
                    modalIcon,
                    modalColor === 'blue' && 'text-blue-600 dark:text-blue-400',
                    modalColor === 'yellow' && 'text-yellow-600 dark:text-yellow-400',
                    modalColor === 'green' && 'text-green-600 dark:text-green-400',
                    modalColor === 'red' && 'text-red-600 dark:text-red-400'
                  ]"
                ></i>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                  {{ modalTitle }}
                </h3>
              </div>
            </div>

            <!-- Body -->
            <div class="px-6 py-6 space-y-4">
              <!-- Message -->
              <p class="text-gray-600 dark:text-gray-300">
                {{ status?.message || 'Processing your request...' }}
              </p>

              <!-- Progress Steps (in_progress only) -->
              <div v-if="modalState === 'in_progress' && status?.steps" class="space-y-2">
                <div
                  v-for="(step, index) in status.steps"
                  :key="index"
                  class="flex items-center space-x-2 text-sm"
                >
                  <i
                    :class="[
                      'fas',
                      step.status === 'completed' && 'fa-check-circle text-green-500',
                      step.status === 'in_progress' && 'fa-spinner fa-spin text-blue-500',
                      step.status === 'pending' && 'fa-circle text-gray-300'
                    ]"
                  ></i>
                  <span
                    :class="[
                      step.status === 'completed' && 'text-gray-900 dark:text-white',
                      step.status === 'in_progress' && 'text-blue-600 dark:text-blue-400 font-medium',
                      step.status === 'pending' && 'text-gray-500 dark:text-gray-400'
                    ]"
                  >
                    {{ step.label }}
                  </span>
                </div>
              </div>

              <!-- Progress Bar (pending or in_progress) -->
              <div
                v-if="modalState === 'pending' || modalState === 'in_progress'"
                class="space-y-2"
              >
                <div class="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                  <span>Progress</span>
                  <span>{{ progressPercentage }}%</span>
                </div>
                <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div
                    class="bg-blue-600 dark:bg-blue-400 h-full transition-all duration-500 ease-out"
                    :style="{ width: `${progressPercentage}%` }"
                  ></div>
                </div>
              </div>

              <!-- Result Links (success or failure) -->
              <div v-if="status?.resultUrl" class="space-y-2">
                <a
                  :href="status.resultUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center space-x-1"
                >
                  <i class="fas fa-external-link-alt"></i>
                  <span>View PR #{{ status.prNumber }}</span>
                </a>
                <a
                  v-if="status.workflowUrl"
                  :href="status.workflowUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm text-gray-600 dark:text-gray-400 hover:underline flex items-center space-x-1"
                >
                  <i class="fas fa-external-link-alt"></i>
                  <span>View Workflow</span>
                </a>
              </div>

              <!-- Error Details (failure only) -->
              <div
                v-if="modalState === 'failure' && status?.error"
                class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3"
              >
                <p class="text-sm text-red-800 dark:text-red-200 font-mono">
                  {{ status.error }}
                </p>
              </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 flex justify-end space-x-3">
              <button
                v-if="modalState === 'failure'"
                type="button"
                class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                @click="handleRetry"
              >
                Retry
              </button>
              <button
                v-if="canClose"
                type="button"
                class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                @click="handleClose"
              >
                Close
              </button>
              <button
                v-else
                type="button"
                disabled
                class="px-4 py-2 text-sm font-medium text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 rounded-lg cursor-not-allowed"
              >
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
/* Additional animations can be added here */
</style>
```

---

## State Machine

```
┌─────────┐
│ PENDING │ (Initial state, blue spinner)
└────┬────┘
     │
     ↓ (Workflow accepted by GitHub Actions)
┌─────────────┐
│ IN_PROGRESS │ (Yellow spinner, progress bar)
└──────┬──────┘
       │
       ├─→ (Workflow succeeds) ┌─────────┐
       │                        │ SUCCESS │ (Green checkmark, PR link)
       │                        └─────────┘
       │
       └─→ (Workflow fails)    ┌─────────┐
                                │ FAILURE │ (Red X, error message)
                                └─────────┘
```

---

## Polling Logic

### API Contract
```typescript
// GET /api/status/:correlationId
interface WorkflowStatusResponse {
  status: 'pending' | 'in_progress' | 'success' | 'failure';
  percentage: number;           // 0-100
  message: string;              // User-facing message
  prNumber?: number;            // PR number if created
  resultUrl?: string;           // PR URL
  workflowUrl?: string;         // GitHub Actions URL
  error?: string;               // Error message (failure only)
  steps?: Array<{               // Progress steps (in_progress only)
    label: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}
```

### Polling Implementation
```typescript
// In useWorkflowPolling.ts composable
export function useWorkflowPolling() {
  const status = ref<WorkflowStatus | null>(null);
  const isPolling = ref(false);
  let pollingInterval: number | null = null;

  async function startPolling(correlationId: string) {
    isPolling.value = true;
    
    pollingInterval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/status/${correlationId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        status.value = data;

        // Stop polling on terminal states
        if (data.status === 'success' || data.status === 'failure') {
          stopPolling();
        }
      } catch (error) {
        console.error('Polling error:', error);
        // Continue polling on network errors
      }
    }, 2000); // Poll every 2 seconds
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    isPolling.value = false;
  }

  onUnmounted(() => {
    stopPolling();
  });

  return { status: readonly(status), isPolling: readonly(isPolling), startPolling, stopPolling };
}
```

---

## Color System

### State Colors
```typescript
const stateColors = {
  pending: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    text: 'text-blue-600 dark:text-blue-400',
    icon: 'text-blue-600 dark:text-blue-400'
  },
  in_progress: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    border: 'border-yellow-200 dark:border-yellow-800',
    text: 'text-yellow-600 dark:text-yellow-400',
    icon: 'text-yellow-600 dark:text-yellow-400'
  },
  success: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
    text: 'text-green-600 dark:text-green-400',
    icon: 'text-green-600 dark:text-green-400'
  },
  failure: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    text: 'text-red-600 dark:text-red-400',
    icon: 'text-red-600 dark:text-red-400'
  }
};
```

---

## Testing Requirements

### Unit Tests (Vitest)
```typescript
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import StatusModal from './StatusModal.vue';

describe('StatusModal.vue', () => {
  it('renders when visible', () => {
    const wrapper = mount(StatusModal, {
      props: {
        correlationId: 'test-id',
        isVisible: true
      }
    });
    expect(wrapper.find('.modal-backdrop').exists()).toBe(true);
  });

  it('does not render when not visible', () => {
    const wrapper = mount(StatusModal, {
      props: {
        correlationId: 'test-id',
        isVisible: false
      }
    });
    expect(wrapper.find('.modal-backdrop').exists()).toBe(false);
  });

  it('shows pending state initially', () => {
    const wrapper = mount(StatusModal, {
      props: {
        correlationId: 'test-id',
        isVisible: true
      }
    });
    expect(wrapper.text()).toContain('Starting...');
    expect(wrapper.find('.fa-spinner').exists()).toBe(true);
  });

  it('shows progress bar in pending/in_progress states', () => {
    const wrapper = mount(StatusModal, {
      props: {
        correlationId: 'test-id',
        isVisible: true
      }
    });
    expect(wrapper.find('.bg-gray-200').exists()).toBe(true); // Progress bar bg
  });

  it('emits close event when close button clicked', async () => {
    const wrapper = mount(StatusModal, {
      props: {
        correlationId: 'test-id',
        isVisible: true
      },
      data() {
        return {
          status: { status: 'success', percentage: 100 }
        };
      }
    });

    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('disables close button during active workflow', () => {
    const wrapper = mount(StatusModal, {
      props: {
        correlationId: 'test-id',
        isVisible: true
      },
      data() {
        return {
          status: { status: 'in_progress', percentage: 50 }
        };
      }
    });

    const button = wrapper.find('button');
    expect(button.attributes('disabled')).toBeDefined();
  });

  it('shows retry button on failure', async () => {
    const wrapper = mount(StatusModal, {
      props: {
        correlationId: 'test-id',
        isVisible: true
      },
      data() {
        return {
          status: { status: 'failure', error: 'Test error' }
        };
      }
    });

    const retryButton = wrapper.findAll('button').find(btn => btn.text() === 'Retry');
    expect(retryButton?.exists()).toBe(true);

    await retryButton?.trigger('click');
    expect(wrapper.emitted('retry')).toBeTruthy();
  });
});
```

---

## Integration Examples

### Example 1: Custom Infrastructure Page
```vue
<script setup lang="ts">
import { ref } from 'vue';
import StatusModal from '@/components/modals/StatusModal.vue';
import { generateCorrelationId } from '@/utils/helpers';

const showStatusModal = ref(false);
const currentCorrelationId = ref('');

async function handleDeployCustom(formData: CustomInfraRequest) {
  // Generate correlation ID
  currentCorrelationId.value = generateCorrelationId();
  formData.correlationId = currentCorrelationId.value;

  // Show status modal
  showStatusModal.value = true;

  // Submit deployment request
  const response = await fetch('/api/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData)
  });

  if (!response.ok) {
    // Handle error (status modal will show failure state)
  }
}

function handleSuccess(data: WorkflowStatus) {
  console.log('Deployment successful:', data);
  // Show success notification
  // Refresh infrastructure list
}

function handleFailure(error: string) {
  console.error('Deployment failed:', error);
  // Show error notification
}

function handleClose() {
  showStatusModal.value = false;
  currentCorrelationId.value = '';
}
</script>

<template>
  <div>
    <form @submit.prevent="handleDeployCustom">
      <!-- Form fields -->
      <button type="submit">Deploy</button>
    </form>

    <StatusModal
      :correlation-id="currentCorrelationId"
      :is-visible="showStatusModal"
      workflow-type="custom"
      @success="handleSuccess"
      @failure="handleFailure"
      @close="handleClose"
    />
  </div>
</template>
```

### Example 2: AKS Deployment
```vue
<script setup lang="ts">
import { ref } from 'vue';
import StatusModal from '@/components/modals/StatusModal.vue';

const showModal = ref(false);
const correlationId = ref('');

async function deployToAKS(aksData: AKSDeployRequest) {
  correlationId.value = generateCorrelationId();
  aksData.correlationId = correlationId.value;

  showModal.value = true;

  await fetch('/api/aks-deploy', {
    method: 'POST',
    body: JSON.stringify(aksData)
  });
}

function handleRetry() {
  // Retry the deployment
  showModal.value = false;
  // Re-submit form
}
</script>

<template>
  <StatusModal
    :correlation-id="correlationId"
    :is-visible="showModal"
    workflow-type="aks"
    @retry="handleRetry"
    @close="showModal = false"
  />
</template>
```

---

## Implementation Checklist

### Phase 1: Basic Structure (1 hour)
- [ ] Create `StatusModal.vue` file
- [ ] Add TypeScript interfaces
- [ ] Implement modal backdrop
- [ ] Implement modal content container
- [ ] Add Teleport to body

### Phase 2: State Management (1 hour)
- [ ] Integrate `useWorkflowPolling` composable
- [ ] Implement state machine logic
- [ ] Add computed properties for colors/icons
- [ ] Implement watch for visibility
- [ ] Handle polling start/stop

### Phase 3: UI Implementation (1 hour)
- [ ] Implement header with icon + title
- [ ] Add progress bar component
- [ ] Add progress steps list
- [ ] Add result links (PR, workflow)
- [ ] Add error message display
- [ ] Implement footer buttons

### Phase 4: Testing (1 hour)
- [ ] Write unit tests (8+ tests)
- [ ] Test state transitions
- [ ] Test polling integration
- [ ] Test event emissions
- [ ] Visual regression tests

---

## Acceptance Criteria

### Functional
- ✅ Modal shows/hides based on `isVisible` prop
- ✅ Polling starts when modal opens
- ✅ Polling stops when modal closes
- ✅ Status updates reflected in UI
- ✅ Progress bar updates correctly
- ✅ Links appear on success/failure
- ✅ Close button disabled during active workflow
- ✅ Retry button appears on failure

### Visual
- ✅ Matches design system colors
- ✅ Transitions smooth (fade + scale)
- ✅ Dark mode works
- ✅ Responsive on mobile
- ✅ Icons animated (spinners)

### Performance
- ✅ Polling interval 2 seconds
- ✅ No memory leaks (cleanup on unmount)
- ✅ Smooth progress bar animation

---

**Implementation Time**: 3-4 hours  
**Testing Time**: 1 hour  
**Total**: 4-5 hours  
**Previous Component**: SharedHeader.vue  
**Next File**: 4-design-system.md
