<template>
  <div
    class="app-selector"
    data-testid="app-selector-container"
    :aria-busy="isLoading ? 'true' : 'false'"
  >
    <!-- Collapsible header -->
    <button
      type="button"
      class="app-selector__toggle"
      :aria-expanded="isExpanded"
      @click="isExpanded = !isExpanded"
    >
      <span class="app-selector__toggle-icon">{{ isExpanded ? '▼' : '▶' }}</span>
      <span class="app-selector__toggle-label">Load from Existing App</span>
      <span class="text-xs text-gray-500 ml-2">(optional)</span>
    </button>

    <!-- Collapsible body -->
    <div v-if="isExpanded" class="app-selector__body">
      <!-- Prefill success banner -->
      <div
        v-if="prefillBanner"
        data-testid="prefill-banner"
        class="app-selector__banner app-selector__banner--success"
        role="status"
        aria-live="polite"
      >
        📋 Pre-filled from {{ prefillBanner.appName }} / {{ prefillBanner.environment }}
        <button
          type="button"
          class="app-selector__banner-dismiss"
          aria-label="Dismiss banner"
          @click="prefillBanner = null"
        >
          ✕
        </button>
      </div>

      <!-- App list load error -->
      <div
        v-if="loadError"
        id="app-selector-load-error"
        data-testid="selector-error"
        class="app-selector__error"
        role="alert"
        aria-describedby="app-selector-load-error"
      >
        {{ loadError }}
        <button
          v-if="showRetry"
          type="button"
          data-testid="retry-button"
          class="app-selector__retry-btn"
          @click="fetchApps"
        >
          Retry
        </button>
      </div>

      <!-- No apps found -->
      <div
        v-if="!loadError && !isAppsLoading && appNames.length === 0"
        class="app-selector__empty"
        role="status"
      >
        No apps found
      </div>

      <!-- Selector controls -->
      <div v-if="appNames.length > 0" class="app-selector__controls">
        <div class="app-selector__field">
          <label for="app-selector-name" class="app-selector__label">
            Application
          </label>
          <select
            id="app-selector-name"
            v-model="selectedAppName"
            data-testid="app-name-select"
            class="app-selector__select"
            :aria-describedby="loadError ? 'app-selector-load-error' : undefined"
            @change="onAppNameChange"
          >
            <option value="">-- Select application --</option>
            <option
              v-for="name in appNames"
              :key="name"
              :value="name"
              data-testid="app-name-option"
            >
              {{ name }}
            </option>
          </select>
        </div>

        <div class="app-selector__field">
          <label for="app-selector-env" class="app-selector__label">
            Environment
          </label>
          <select
            id="app-selector-env"
            v-model="selectedEnvironment"
            data-testid="env-select"
            class="app-selector__select"
            :disabled="!selectedAppName"
          >
            <option value="">-- Select environment --</option>
            <option
              v-for="env in filteredEnvironments"
              :key="env"
              :value="env"
              data-testid="env-option"
            >
              {{ env }}
            </option>
          </select>
        </div>

        <!-- Inline metadata fetch error -->
        <div
          v-if="metadataError"
          id="app-selector-meta-error"
          data-testid="selector-error"
          class="app-selector__error"
          role="alert"
          aria-describedby="app-selector-meta-error"
        >
          {{ metadataError }}
        </div>

        <button
          type="button"
          data-testid="load-button"
          class="app-selector__load-btn"
          :disabled="!canLoad || isLoading"
          :aria-disabled="!canLoad || isLoading"
          @click="handleLoad"
        >
          <span v-if="isLoading" class="app-selector__spinner" aria-hidden="true">⟳</span>
          {{ isLoading ? 'Loading…' : 'Load' }}
        </button>
      </div>

      <!-- Overwrite confirmation dialog -->
      <div
        v-if="showConfirmDialog"
        data-testid="confirm-overwrite-dialog"
        class="app-selector__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <p id="confirm-dialog-title">
          This will replace current data. Continue?
        </p>
        <div class="app-selector__dialog-actions">
          <button
            type="button"
            data-testid="confirm-overwrite-yes"
            class="btn-primary"
            @click="confirmOverwrite"
          >
            Yes, overwrite
          </button>
          <button
            type="button"
            data-testid="confirm-overwrite-cancel"
            class="btn-secondary"
            @click="cancelOverwrite"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import apiService from '@v2/services/api'
import type { InstalledApp, AppMetadata } from '@v2/types/infrastructure.types'

// ─── Emits ────────────────────────────────────────────────────────────────────
const emit = defineEmits<{
  prefill: [metadata: AppMetadata]
  error: [message: string]
}>()

// ─── State ────────────────────────────────────────────────────────────────────
const isExpanded = ref(true)
const isAppsLoading = ref(false)
const isLoading = ref(false)
const apps = ref<InstalledApp[]>([])
const selectedAppName = ref('')
const selectedEnvironment = ref('')
const loadError = ref<string | null>(null)
const metadataError = ref<string | null>(null)
const showRetry = ref(false)
const prefillBanner = ref<{ appName: string; environment: string } | null>(null)
const hasPrefilled = ref(false)
const showConfirmDialog = ref(false)
const pendingLoadArgs = ref<{ appName: string; environment: string } | null>(null)

// ─── Computed ─────────────────────────────────────────────────────────────────

/** Deduplicated sorted app names */
const appNames = computed<string[]>(() => {
  const names = new Set(apps.value.map(a => a.name))
  return Array.from(names).sort()
})

/** Environments for the currently selected app */
const filteredEnvironments = computed<string[]>(() => {
  if (!selectedAppName.value) return []
  return apps.value
    .filter(a => a.name === selectedAppName.value)
    .map(a => a.environment)
    .sort()
})

/** Load button is only enabled when both selects have values */
const canLoad = computed(() => !!selectedAppName.value && !!selectedEnvironment.value)

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(fetchApps)

// ─── Methods ──────────────────────────────────────────────────────────────────

async function fetchApps() {
  isAppsLoading.value = true
  loadError.value = null
  showRetry.value = false

  try {
    const response = await apiService.getInstalledApps()
    if (response?.success && Array.isArray(response.data)) {
      apps.value = response.data as InstalledApp[]
    } else {
      apps.value = []
    }
  } catch {
    apps.value = []
    loadError.value = 'Unable to load apps. Retry?'
    showRetry.value = true
    emit('error', loadError.value)
  } finally {
    isAppsLoading.value = false
  }
}

function onAppNameChange() {
  // Reset environment when app changes
  selectedEnvironment.value = ''
  metadataError.value = null
}

async function handleLoad() {
  if (!canLoad.value || isLoading.value) return

  metadataError.value = null

  // If already pre-filled, show confirmation before overwriting
  if (hasPrefilled.value) {
    pendingLoadArgs.value = {
      appName: selectedAppName.value,
      environment: selectedEnvironment.value
    }
    showConfirmDialog.value = true
    return
  }

  await doLoad(selectedAppName.value, selectedEnvironment.value)
}

function confirmOverwrite() {
  showConfirmDialog.value = false
  if (pendingLoadArgs.value) {
    doLoad(pendingLoadArgs.value.appName, pendingLoadArgs.value.environment)
    pendingLoadArgs.value = null
  }
}

function cancelOverwrite() {
  showConfirmDialog.value = false
  pendingLoadArgs.value = null
}

async function doLoad(appName: string, environment: string) {
  isLoading.value = true
  metadataError.value = null
  prefillBanner.value = null

  try {
    const response = await apiService.getAppMetadata(appName, environment)

    if (!response?.success || !response.data) {
      throw new Error('Unexpected response shape')
    }

    const metadata = response.data as AppMetadata
    hasPrefilled.value = true
    prefillBanner.value = { appName, environment }

    emit('prefill', metadata)
  } catch (err: any) {
    const status = err?.response?.status

    let message: string
    if (status === 404) {
      message = `App '${appName} / ${environment}' not found in service-catalog.`
    } else {
      message = 'Could not load metadata. Please fill in manually.'
    }

    metadataError.value = message
    emit('error', message)
  } finally {
    isLoading.value = false
  }
}

// ─── Expose ───────────────────────────────────────────────────────────────────
defineExpose({
  collapse() {
    isExpanded.value = false
  }
})
</script>

<style scoped>
.app-selector {
  @apply mb-6 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden;
}

.app-selector__toggle {
  @apply w-full flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-800
         text-left font-medium text-gray-700 dark:text-gray-200
         hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none
         focus:ring-2 focus:ring-inset focus:ring-blue-500;
}

.app-selector__toggle-icon {
  @apply text-xs text-gray-500;
}

.app-selector__toggle-label {
  @apply text-sm font-semibold;
}

.app-selector__body {
  @apply p-4 space-y-4;
}

.app-selector__banner {
  @apply flex items-center justify-between gap-2 px-4 py-2 rounded-md text-sm;
}

.app-selector__banner--success {
  @apply bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300
         border border-green-200 dark:border-green-700;
}

.app-selector__banner-dismiss {
  @apply ml-auto text-green-600 dark:text-green-400 hover:text-green-800 focus:outline-none;
}

.app-selector__error {
  @apply flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20
         text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700
         rounded-md text-sm;
}

.app-selector__retry-btn {
  @apply ml-auto text-red-600 dark:text-red-400 underline text-xs hover:text-red-800 focus:outline-none;
}

.app-selector__empty {
  @apply text-gray-500 dark:text-gray-400 text-sm;
}

.app-selector__controls {
  @apply grid grid-cols-1 md:grid-cols-3 gap-4 items-end;
}

.app-selector__field {
  @apply flex flex-col gap-1;
}

.app-selector__label {
  @apply text-sm font-medium text-gray-700 dark:text-gray-300;
}

.app-selector__select {
  @apply w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
         bg-white dark:bg-gray-700 text-gray-900 dark:text-white
         focus:ring-2 focus:ring-blue-500 focus:border-transparent
         disabled:opacity-50 disabled:cursor-not-allowed;
}

.app-selector__load-btn {
  @apply px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium
         disabled:opacity-50 disabled:cursor-not-allowed transition-colors
         focus:outline-none focus:ring-2 focus:ring-blue-500;
}

.app-selector__spinner {
  @apply inline-block animate-spin mr-1;
}

.app-selector__dialog {
  @apply fixed inset-0 bg-black/50 flex items-center justify-center z-50;
}

.app-selector__dialog > div, .app-selector__dialog > p {
  @apply bg-white dark:bg-gray-800 rounded-lg p-6 shadow-xl max-w-sm w-full mx-4;
}

.app-selector__dialog-actions {
  @apply flex gap-3 mt-4 justify-end;
}
</style>
