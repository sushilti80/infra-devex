git push<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import api from '@v2/services/api'

interface Props {
  isVisible: boolean
  appName: string
  sourceEnvironment: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', payload: { crNumber: string; environments: string[] }): void
}>()

const availableEnvironments = ref<string[]>([])
const selected = ref<string[]>([])
const crNumber = ref('')
const loadError = ref('')
const dialogRef = ref<HTMLElement | null>(null)
const crInputRef = ref<HTMLInputElement | null>(null)
let previouslyFocused: HTMLElement | null = null

// Must match the server-side validation in POST /api/promote
const CR_PATTERN = /^[A-Za-z0-9._#-]{1,50}$/
const crValid = computed(() => CR_PATTERN.test(crNumber.value.trim()))
const canSubmit = computed(() => crValid.value && selected.value.length > 0)

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !dialogRef.value) return
  const focusable = dialogRef.value.querySelectorAll<HTMLElement>(
    'input:not([disabled]), button:not([disabled])'
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.isVisible,
  async (visible) => {
    if (!visible) {
      window.removeEventListener('keydown', onKeydown)
      previouslyFocused?.focus()
      previouslyFocused = null
      return
    }
    previouslyFocused = document.activeElement as HTMLElement | null
    window.addEventListener('keydown', onKeydown)
    nextTick(() => crInputRef.value?.focus())
    crNumber.value = ''
    loadError.value = ''
    try {
      const response = await api.getInfraLiveEnvironments()
      availableEnvironments.value = response.success && Array.isArray(response.data) ? response.data : []
      selected.value = []
      if (availableEnvironments.value.length === 0) loadError.value = 'No target environments available'
    } catch {
      availableEnvironments.value = []
      selected.value = []
      loadError.value = 'Failed to load target environments'
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const toggleAll = () => {
  selected.value = selected.value.length === availableEnvironments.value.length
    ? []
    : [...availableEnvironments.value]
}

const submit = () => {
  if (!canSubmit.value) return
  emit('submit', { crNumber: crNumber.value.trim(), environments: [...selected.value] })
}
</script>

<template>
  <div
    v-if="isVisible"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    data-testid="move-infra-live-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="move-infra-live-title"
  >
    <div ref="dialogRef" class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg p-6">
      <h2 id="move-infra-live-title" class="text-xl font-semibold text-gray-900 dark:text-white">
        Promote to Delivery Path
      </h2>
      <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
        {{ appName }} ({{ sourceEnvironment }}) will be copied into each selected environment in one pull request.
      </p>

      <label for="move-cr-number" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mt-4">
        Change Request (CR) number
      </label>
      <input
        id="move-cr-number"
        ref="crInputRef"
        v-model="crNumber"
        type="text"
        maxlength="50"
        data-testid="move-cr-input"
        :aria-invalid="crNumber.trim() !== '' && !crValid"
        aria-describedby="move-cr-error"
        class="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
               bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
      />
      <p
        v-if="crNumber.trim() !== '' && !crValid"
        id="move-cr-error"
        class="text-sm text-red-600 dark:text-red-400 mt-1"
        data-testid="move-cr-error"
      >
        Use only letters, numbers, and . _ # - (max 50 characters).
      </p>

      <div class="flex items-center justify-between mt-4">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Target environments</span>
        <button
          type="button"
          class="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          data-testid="move-toggle-all"
          @click="toggleAll"
        >
          {{ selected.length === availableEnvironments.length ? 'Clear all' : 'Select all' }}
        </button>
      </div>
      <p v-if="loadError" class="text-sm text-red-600 dark:text-red-400 mt-2">{{ loadError }}</p>
      <div class="grid grid-cols-4 gap-2 mt-2">
        <label
          v-for="env in availableEnvironments"
          :key="env"
          class="flex items-center gap-2 text-sm text-gray-900 dark:text-white"
        >
          <input v-model="selected" type="checkbox" :value="env" :data-testid="`move-env-${env}`" />
          {{ env }}
        </label>
      </div>

      <div class="flex justify-end gap-3 mt-6">
        <button
          type="button"
          class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          data-testid="move-cancel"
          @click="emit('close')"
        >
          Cancel
        </button>
        <button
          type="button"
          :disabled="!canSubmit"
          class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg
                 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="move-submit"
          @click="submit"
        >
          Promote to Delivery Path
        </button>
      </div>
    </div>
  </div>
</template>
