<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAuthStore } from '@v2/stores/auth'
import { apiService } from '@v2/services/api'

// ─── Types ────────────────────────────────────────────────────────────────────
type RequestType = 'bug' | 'feature-request' | 'agent-request'
type Severity = 'Critical' | 'High' | 'Medium' | 'Low'
type Priority = 'High' | 'Medium' | 'Low'

interface SubmitResult {
  issueUrl: string
  issueNumber: number
  correlationId: string
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
const authStore = useAuthStore()
const userEmail = computed(() => authStore.user?.email ?? '')

// ─── Tab selection ────────────────────────────────────────────────────────────
const activeType = ref<RequestType>('bug')

function selectType(t: RequestType) {
  activeType.value = t
  clearErrors()
}

// ─── Shared fields ────────────────────────────────────────────────────────────
const title = ref('')

// ─── Bug-specific fields ──────────────────────────────────────────────────────
const observedBehaviour = ref('')
const expectedBehaviour = ref('')
const stepsToReproduce = ref('')
const severity = ref<Severity>('Medium')

// ─── Feature-specific fields ──────────────────────────────────────────────────
const painPoint = ref('')
const desiredOutcome = ref('')
const featureBusinessJustification = ref('')
const priority = ref<Priority>('Medium')

// ─── Agent-specific fields ────────────────────────────────────────────────────
const agentType = ref('')
const agentBehaviour = ref('')
const agentBusinessJustification = ref('')

// ─── Submission state ─────────────────────────────────────────────────────────
const submitting = ref(false)
const submitResult = ref<SubmitResult | null>(null)
const submitError = ref<string | null>(null)
const submitErrorCid = ref<string | null>(null)

// ─── Validation errors ────────────────────────────────────────────────────────
const fieldErrors = ref<Record<string, string>>({})

function clearErrors() {
  fieldErrors.value = {}
  submitError.value = null
  submitErrorCid.value = null
}

// ─── Computed: description field for backend (first long-text field per type) ─
const description = computed<string>(() => {
  if (activeType.value === 'bug') return observedBehaviour.value
  if (activeType.value === 'feature-request') return painPoint.value
  return agentBehaviour.value
})

// ─── Validation ───────────────────────────────────────────────────────────────
const TITLE_MAX = 120

function validate(): boolean {
  const errs: Record<string, string> = {}

  if (!title.value.trim()) {
    errs.title = 'Title is required.'
  } else if (title.value.length > TITLE_MAX) {
    errs.title = `Title must be ${TITLE_MAX} characters or fewer.`
  }

  if (activeType.value === 'bug') {
    if (!observedBehaviour.value.trim()) errs.observedBehaviour = 'Observed behaviour is required.'
    if (!expectedBehaviour.value.trim()) errs.expectedBehaviour = 'Expected behaviour is required.'
  } else if (activeType.value === 'feature-request') {
    if (!painPoint.value.trim()) errs.painPoint = 'Pain point / problem statement is required.'
    if (!desiredOutcome.value.trim()) errs.desiredOutcome = 'Desired outcome is required.'
  } else {
    if (!agentBehaviour.value.trim()) errs.agentBehaviour = 'Agent behaviour description is required.'
  }

  fieldErrors.value = errs
  return Object.keys(errs).length === 0
}

// Clear field-level error when the user starts typing
watch(title, () => { if (fieldErrors.value.title) delete fieldErrors.value.title })
watch(observedBehaviour, () => { if (fieldErrors.value.observedBehaviour) delete fieldErrors.value.observedBehaviour })
watch(expectedBehaviour, () => { if (fieldErrors.value.expectedBehaviour) delete fieldErrors.value.expectedBehaviour })
watch(painPoint, () => { if (fieldErrors.value.painPoint) delete fieldErrors.value.painPoint })
watch(desiredOutcome, () => { if (fieldErrors.value.desiredOutcome) delete fieldErrors.value.desiredOutcome })
watch(agentBehaviour, () => { if (fieldErrors.value.agentBehaviour) delete fieldErrors.value.agentBehaviour })

// ─── Submit ───────────────────────────────────────────────────────────────────
function generateCorrelationId() {
  return `cid-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

async function handleSubmit() {
  submitError.value = null
  submitErrorCid.value = null
  if (!validate()) return

  submitting.value = true
  const cid = generateCorrelationId()

  try {
    const payload: Record<string, unknown> = {
      type: activeType.value,
      title: title.value.trim(),
      description: description.value.trim(),
      correlationId: cid
    }

    if (activeType.value === 'bug') {
      payload.observedBehaviour = observedBehaviour.value.trim()
      payload.expectedBehaviour = expectedBehaviour.value.trim()
      payload.stepsToReproduce = stepsToReproduce.value.trim()
      payload.severity = severity.value
    } else if (activeType.value === 'feature-request') {
      payload.painPoint = painPoint.value.trim()
      payload.desiredOutcome = desiredOutcome.value.trim()
      payload.businessJustification = featureBusinessJustification.value.trim()
      payload.priority = priority.value
    } else {
      payload.agentType = agentType.value.trim()
      payload.agentBehaviour = agentBehaviour.value.trim()
      payload.businessJustification = agentBusinessJustification.value.trim()
    }

    const response = await apiService.submitFeedback(payload) as {
      success: boolean
      issueUrl: string
      issueNumber: number
      correlationId: string
      error?: string
    }

    if (!response.success) {
      throw new Error(response.error ?? 'Unexpected error')
    }

    submitResult.value = {
      issueUrl: response.issueUrl,
      issueNumber: response.issueNumber,
      correlationId: response.correlationId
    }
  } catch (err: unknown) {
    const anyErr = err as any
    const message = anyErr?.error ?? anyErr?.message ?? 'An unexpected error occurred. Please try again.'
    submitError.value = message
    submitErrorCid.value = cid
  } finally {
    submitting.value = false
  }
}

// ─── Reset ────────────────────────────────────────────────────────────────────
function resetForm() {
  title.value = ''
  observedBehaviour.value = ''
  expectedBehaviour.value = ''
  stepsToReproduce.value = ''
  severity.value = 'Medium'
  painPoint.value = ''
  desiredOutcome.value = ''
  featureBusinessJustification.value = ''
  priority.value = 'Medium'
  agentType.value = ''
  agentBehaviour.value = ''
  agentBusinessJustification.value = ''
  activeType.value = 'bug'
  submitResult.value = null
  submitError.value = null
  submitErrorCid.value = null
  fieldErrors.value = {}
}

// ─── Tab labels ───────────────────────────────────────────────────────────────
const tabs: { id: RequestType; label: string }[] = [
  { id: 'bug', label: 'Bug Report' },
  { id: 'feature-request', label: 'Feature Request' },
  { id: 'agent-request', label: 'Agent Request' }
]
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <!-- Page header -->
    <div>
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Feedback</h1>
      <p class="mt-1 text-gray-600 dark:text-gray-400">
        Report a bug, request a feature, or propose a new agent.
        Your submission creates a GitHub Issue in the Self-Service Infra repository.
      </p>
    </div>

    <!-- ── Success state ─────────────────────────────────────────────────── -->
    <div
      v-if="submitResult"
      data-testid="success-state"
      class="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 space-y-4"
      role="status"
      aria-live="polite"
    >
      <div class="flex items-start gap-3">
        <span class="material-symbols-outlined text-green-600 dark:text-green-400 text-2xl mt-0.5" aria-hidden="true">
          check_circle
        </span>
        <div>
          <h2 class="text-lg font-semibold text-green-800 dark:text-green-300">
            Issue submitted successfully!
          </h2>
          <p class="text-green-700 dark:text-green-400 mt-1">
            GitHub Issue #{{ submitResult.issueNumber }} has been created.
          </p>
        </div>
      </div>

      <a
        :href="submitResult.issueUrl"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="issue-link"
        class="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
        :aria-label="`View GitHub Issue #${submitResult.issueNumber} (opens in new tab)`"
      >
        <span class="material-symbols-outlined text-base" aria-hidden="true">open_in_new</span>
        View Issue #{{ submitResult.issueNumber }}
      </a>

      <div>
        <button
          type="button"
          data-testid="submit-another"
          class="text-sm text-green-700 dark:text-green-400 underline hover:no-underline"
          @click="resetForm"
        >
          Submit another request
        </button>
      </div>
    </div>

    <!-- ── Form ──────────────────────────────────────────────────────────── -->
    <form
      v-else
      novalidate
      @submit.prevent="handleSubmit"
      data-testid="feedback-form"
      class="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-6"
    >
      <!-- Error banner -->
      <div
        v-if="submitError"
        data-testid="error-banner"
        role="alert"
        aria-live="assertive"
        class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex gap-3"
      >
        <span class="material-symbols-outlined text-red-600 dark:text-red-400 text-xl mt-0.5 shrink-0" aria-hidden="true">
          error
        </span>
        <div class="text-sm">
          <p class="font-medium text-red-800 dark:text-red-300">Submission failed</p>
          <p class="text-red-700 dark:text-red-400 mt-0.5">{{ submitError }}</p>
          <p v-if="submitErrorCid" class="text-red-600 dark:text-red-500 mt-1 font-mono text-xs">
            Correlation ID: {{ submitErrorCid }}
          </p>
        </div>
      </div>

      <!-- Type tabs -->
      <div>
        <div role="tablist" aria-label="Request type" class="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            role="tab"
            :id="`tab-${tab.id}`"
            :aria-selected="activeType === tab.id"
            :aria-controls="`panel-${tab.id}`"
            :data-testid="`tab-${tab.id}`"
            :class="[
              'flex-1 py-2 px-3 text-sm font-medium rounded-md transition-all',
              activeType === tab.id
                ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            ]"
            @click="selectType(tab.id)"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>

      <!-- Read-only email -->
      <div>
        <label for="feedback-email" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Your email
        </label>
        <input
          id="feedback-email"
          type="email"
          :value="userEmail"
          readonly
          data-testid="email-field"
          class="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 cursor-not-allowed"
          aria-readonly="true"
        />
      </div>

      <!-- Shared: Title -->
      <div>
        <label for="feedback-title" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Title <span aria-hidden="true" class="text-red-500">*</span>
          <span class="sr-only">(required)</span>
        </label>
        <input
          id="feedback-title"
          v-model="title"
          type="text"
          :maxlength="TITLE_MAX"
          data-testid="title-field"
          :aria-describedby="fieldErrors.title ? 'title-error' : undefined"
          :aria-invalid="!!fieldErrors.title"
          :class="[
            'w-full px-3 py-2 text-sm border rounded-lg transition-colors focus:outline-none focus:ring-2',
            fieldErrors.title
              ? 'border-red-400 focus:ring-red-300 bg-red-50 dark:bg-red-900/10'
              : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-blue-300'
          ]"
          placeholder="Brief summary of your request"
          required
        />
        <div class="flex items-center justify-between mt-1">
          <p v-if="fieldErrors.title" :id="`title-error`" role="alert" class="text-xs text-red-600 dark:text-red-400">
            {{ fieldErrors.title }}
          </p>
          <p class="text-xs text-gray-400 ml-auto">{{ title.length }}/{{ TITLE_MAX }}</p>
        </div>
      </div>

      <!-- ── Bug fields ─────────────────────────────────────────────────── -->
      <template v-if="activeType === 'bug'">
        <!-- Observed Behaviour -->
        <div>
          <label for="observed-behaviour" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Observed Behaviour <span aria-hidden="true" class="text-red-500">*</span>
            <span class="sr-only">(required)</span>
          </label>
          <textarea
            id="observed-behaviour"
            v-model="observedBehaviour"
            rows="4"
            data-testid="observed-behaviour-field"
            :aria-describedby="fieldErrors.observedBehaviour ? 'observed-behaviour-error' : undefined"
            :aria-invalid="!!fieldErrors.observedBehaviour"
            :class="[
              'w-full px-3 py-2 text-sm border rounded-lg resize-y transition-colors focus:outline-none focus:ring-2',
              fieldErrors.observedBehaviour
                ? 'border-red-400 focus:ring-red-300 bg-red-50 dark:bg-red-900/10'
                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-blue-300'
            ]"
            placeholder="Describe what actually happened…"
          />
          <p v-if="fieldErrors.observedBehaviour" id="observed-behaviour-error" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">
            {{ fieldErrors.observedBehaviour }}
          </p>
        </div>

        <!-- Expected Behaviour -->
        <div>
          <label for="expected-behaviour" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Expected Behaviour <span aria-hidden="true" class="text-red-500">*</span>
            <span class="sr-only">(required)</span>
          </label>
          <textarea
            id="expected-behaviour"
            v-model="expectedBehaviour"
            rows="4"
            data-testid="expected-behaviour-field"
            :aria-describedby="fieldErrors.expectedBehaviour ? 'expected-behaviour-error' : undefined"
            :aria-invalid="!!fieldErrors.expectedBehaviour"
            :class="[
              'w-full px-3 py-2 text-sm border rounded-lg resize-y transition-colors focus:outline-none focus:ring-2',
              fieldErrors.expectedBehaviour
                ? 'border-red-400 focus:ring-red-300 bg-red-50 dark:bg-red-900/10'
                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-blue-300'
            ]"
            placeholder="Describe what you expected to happen…"
          />
          <p v-if="fieldErrors.expectedBehaviour" id="expected-behaviour-error" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">
            {{ fieldErrors.expectedBehaviour }}
          </p>
        </div>

        <!-- Steps to Reproduce (optional) -->
        <div>
          <label for="steps-to-reproduce" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Steps to Reproduce
            <span class="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="steps-to-reproduce"
            v-model="stepsToReproduce"
            rows="3"
            data-testid="steps-to-reproduce-field"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg resize-y bg-white dark:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="1. Go to…  2. Click…  3. See error…"
          />
        </div>

        <!-- Severity -->
        <div>
          <label for="severity" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Severity
          </label>
          <select
            id="severity"
            v-model="severity"
            data-testid="severity-select"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </template>

      <!-- ── Feature fields ─────────────────────────────────────────────── -->
      <template v-else-if="activeType === 'feature-request'">
        <!-- Pain Point -->
        <div>
          <label for="pain-point" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Pain Point / Problem Statement <span aria-hidden="true" class="text-red-500">*</span>
            <span class="sr-only">(required)</span>
          </label>
          <textarea
            id="pain-point"
            v-model="painPoint"
            rows="4"
            data-testid="pain-point-field"
            :aria-describedby="fieldErrors.painPoint ? 'pain-point-error' : undefined"
            :aria-invalid="!!fieldErrors.painPoint"
            :class="[
              'w-full px-3 py-2 text-sm border rounded-lg resize-y transition-colors focus:outline-none focus:ring-2',
              fieldErrors.painPoint
                ? 'border-red-400 focus:ring-red-300 bg-red-50 dark:bg-red-900/10'
                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-blue-300'
            ]"
            placeholder="What problem are you trying to solve?"
          />
          <p v-if="fieldErrors.painPoint" id="pain-point-error" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">
            {{ fieldErrors.painPoint }}
          </p>
        </div>

        <!-- Desired Outcome -->
        <div>
          <label for="desired-outcome" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Desired Outcome <span aria-hidden="true" class="text-red-500">*</span>
            <span class="sr-only">(required)</span>
          </label>
          <textarea
            id="desired-outcome"
            v-model="desiredOutcome"
            rows="4"
            data-testid="desired-outcome-field"
            :aria-describedby="fieldErrors.desiredOutcome ? 'desired-outcome-error' : undefined"
            :aria-invalid="!!fieldErrors.desiredOutcome"
            :class="[
              'w-full px-3 py-2 text-sm border rounded-lg resize-y transition-colors focus:outline-none focus:ring-2',
              fieldErrors.desiredOutcome
                ? 'border-red-400 focus:ring-red-300 bg-red-50 dark:bg-red-900/10'
                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-blue-300'
            ]"
            placeholder="What would success look like?"
          />
          <p v-if="fieldErrors.desiredOutcome" id="desired-outcome-error" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">
            {{ fieldErrors.desiredOutcome }}
          </p>
        </div>

        <!-- Business Justification (optional) -->
        <div>
          <label for="feature-justification" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Business Justification
            <span class="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="feature-justification"
            v-model="featureBusinessJustification"
            rows="3"
            data-testid="feature-justification-field"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg resize-y bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="Why is this important to the business?"
          />
        </div>

        <!-- Priority -->
        <div>
          <label for="priority" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Priority
          </label>
          <select
            id="priority"
            v-model="priority"
            data-testid="priority-select"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </template>

      <!-- ── Agent fields ───────────────────────────────────────────────── -->
      <template v-else>
        <!-- Agent Type -->
        <div>
          <label for="agent-type" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Existing Infrastructure / Agent Type
            <span class="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="agent-type"
            v-model="agentType"
            type="text"
            data-testid="agent-type-field"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="e.g. Terraform provisioning agent, AKS deployment agent…"
          />
        </div>

        <!-- Agent Behaviour -->
        <div>
          <label for="agent-behaviour" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            What Should the Agent Do? <span aria-hidden="true" class="text-red-500">*</span>
            <span class="sr-only">(required)</span>
          </label>
          <textarea
            id="agent-behaviour"
            v-model="agentBehaviour"
            rows="4"
            data-testid="agent-behaviour-field"
            :aria-describedby="fieldErrors.agentBehaviour ? 'agent-behaviour-error' : undefined"
            :aria-invalid="!!fieldErrors.agentBehaviour"
            :class="[
              'w-full px-3 py-2 text-sm border rounded-lg resize-y transition-colors focus:outline-none focus:ring-2',
              fieldErrors.agentBehaviour
                ? 'border-red-400 focus:ring-red-300 bg-red-50 dark:bg-red-900/10'
                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-blue-300'
            ]"
            placeholder="Describe the new capability or behaviour you need…"
          />
          <p v-if="fieldErrors.agentBehaviour" id="agent-behaviour-error" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">
            {{ fieldErrors.agentBehaviour }}
          </p>
        </div>

        <!-- Business Justification (optional) -->
        <div>
          <label for="agent-justification" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Business Justification
            <span class="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="agent-justification"
            v-model="agentBusinessJustification"
            rows="3"
            data-testid="agent-justification-field"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg resize-y bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="Why does the team need this agent capability?"
          />
        </div>
      </template>

      <!-- Submit -->
      <div class="flex justify-end pt-2">
        <button
          type="submit"
          data-testid="submit-button"
          :disabled="submitting"
          class="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          :aria-busy="submitting"
        >
          <svg
            v-if="submitting"
            data-testid="submit-spinner"
            class="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>{{ submitting ? 'Submitting…' : 'Submit' }}</span>
        </button>
      </div>
    </form>
  </div>
</template>
