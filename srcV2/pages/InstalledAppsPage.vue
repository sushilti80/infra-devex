<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import api from '@v2/services/api'
import StatusModal from '@v2/components/modals/StatusModal.vue'
import MoveToInfraLiveModal from '@v2/components/modals/MoveToInfraLiveModal.vue'
import type { InstalledApp } from '@v2/types/infrastructure.types'
import { useEnvironmentsStore } from '../stores/environments'
import { useNavigationStore } from '../stores/navigation'

const envStore = useEnvironmentsStore()
const navigationStore = useNavigationStore()

// Computed
const prefillEnabled = computed(() =>
  import.meta.env.VITE_ENABLE_CATALOG_PREFILL !== 'false'
)

// Data
const apps = ref<InstalledApp[]>([])
const searchQuery = ref('')
const selectedEnvironment = ref('all')
const isLoading = ref(false)
const error = ref('')
const hasInitializedEnvironmentFilter = ref(false)

// StatusModal state
const showStatusModal = ref(false)
const currentCorrelationId = ref('')
const currentWorkflowType = ref<'delete' | 'promote' | 'create-repo'>('delete')

// Computed
const filteredApps = computed(() => {
  return apps.value.filter(app => {
    const matchesSearch =
      app.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      (app.description && app.description.toLowerCase().includes(searchQuery.value.toLowerCase())) ||
      app.owner.toLowerCase().includes(searchQuery.value.toLowerCase())

    const matchesEnv = selectedEnvironment.value === 'all' ||
                       app.environment === selectedEnvironment.value

    return matchesSearch && matchesEnv
  })
})

// Methods
const loadApps = async () => {
  isLoading.value = true
  error.value = ''

  try {
    const response = await api.getInstalledApps()

    if (response.success && response.data) {
      apps.value = response.data
    } else {
      error.value = response.error || 'Failed to load applications'
    }
  } catch (err: any) {
    console.error('Error loading apps:', err)
    error.value = err.message || 'Failed to load applications'
  } finally {
    isLoading.value = false
  }
}

const getAzureSubscriptionId = (environment: string): string => {
  return envStore.getSubscriptionId(environment)
}

const viewInAzurePortal = (app: InstalledApp) => {
  const subscriptionId = getAzureSubscriptionId(app.environment)
  const resourceGroupName = `${app.name}-${app.environment}-wus-rg-1`
  const azurePortalUrl = `https://portal.azure.com/#@/resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/overview`

  window.open(azurePortalUrl, '_blank')
}

const promoteTarget = ref<InstalledApp | null>(null)

const handlePromote = (app: InstalledApp) => {
  promoteTarget.value = app
}

const submitPromote = ({ crNumber, environments }: { crNumber: string; environments: string[] }) => {
  const app = promoteTarget.value
  if (!app) return
  promoteTarget.value = null

  currentCorrelationId.value = `prm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
  currentWorkflowType.value = 'promote'
  showStatusModal.value = true

  api.promoteInfrastructure({
    projectName: app.name,
    environment: app.environment,
    environments,
    crNumber,
    correlationId: currentCorrelationId.value
  }).catch(err => {
    console.error('Error promoting app:', err)
    alert('Failed to promote application')
  })
}

const handleDelete = (app: InstalledApp) => {
  const confirmed = confirm(
    `Are you sure you want to delete ${app.name} in ${app.environment}?\n\n` +
    'This action will create a PR to delete the infrastructure. ' +
    'Once approved and merged, all resources will be destroyed.'
  )

  if (!confirmed) return

  currentCorrelationId.value = `del-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
  currentWorkflowType.value = 'delete'
  showStatusModal.value = true

  // Call API to delete
  api.deleteInfrastructure({
    projectName: app.name,
    environment: app.environment,
    correlationId: currentCorrelationId.value
  }).catch(err => {
    console.error('Error deleting app:', err)
    alert('Failed to delete application')
  })
}

const handleLabel = async (app: InstalledApp) => {
  const labelType = prompt('Enter label (live or experiment):')?.toLowerCase()
  if (!labelType || !['live', 'experiment'].includes(labelType)) {
    alert('Invalid label. Must be "live" or "experiment".')
    return
  }

  try {
    await api.labelApp({
      projectName: app.name,
      environment: app.environment,
      labelType: labelType
    })

    alert(`Successfully labeled ${app.name} as ${labelType}`)
    await loadApps() // Refresh list
  } catch (err: any) {
    console.error('Error labeling app:', err)
    alert('Failed to label application')
  }
}

const handleAddRepo = async (app: InstalledApp) => {
  const templateRepo = 'organization/ApiTemplate'
  const confirmed = confirm(
    `Create a code repository for ${app.name} using the standard template ${templateRepo}?`
  )
  if (!confirmed) return

  const jiraNumber = prompt(
    'Jira number (optional; leave blank if none):'
  ) || ''

  currentCorrelationId.value = `cre-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
  currentWorkflowType.value = 'create-repo'
  showStatusModal.value = true

  try {
    await api.addCodeRepo({
      projectName: app.name,
      templateRepo: templateRepo,
      jiraNumber: jiraNumber,
      correlationId: currentCorrelationId.value
    })
  } catch (err: any) {
    console.error('Error adding repo:', err)
    alert('Failed to add code repository')
    closeStatusModal()
  }
}

const formatDate = (dateString: string): string => {
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

const closeStatusModal = () => {
  showStatusModal.value = false
  currentCorrelationId.value = ''
}

const handleSuccess = async () => {
  closeStatusModal()
  await loadApps() // Refresh the list
}

const handleFailure = () => {
  closeStatusModal()
}

function handleEditInfra(app: InstalledApp): void {
  navigationStore.navigateToPage('custom', {
    appName: app.name,
    environment: app.environment
  })
}

// Lifecycle
onMounted(() => {
  loadApps()
})

// Environments load asynchronously; keep the filter on 'all' until they arrive
// so the edit icon (gated by filteredApps) isn't hidden by a stale env selection
watch(
  () => envStore.enabledEnvironments.length,
  (length) => {
    if (length > 0 && !hasInitializedEnvironmentFilter.value) {
      selectedEnvironment.value = 'all'
      hasInitializedEnvironmentFilter.value = true
    }
  }
)
</script>

<template>
  <div class="container mx-auto px-6 py-8 max-w-7xl">
    <!-- Header -->
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Installed Applications</h1>
        <p class="text-gray-600 dark:text-gray-400 mt-2">
          View and manage your provisioned infrastructure
        </p>
      </div>
    </div>

    <!-- Search and Filters -->
    <div class="flex flex-col sm:flex-row gap-4 mb-6">
      <div class="flex-1">
        <input
          v-model="searchQuery"
          type="text"
          data-testid="search-input"
          placeholder="Search applications..."
          class="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                 bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      <div class="w-full sm:w-48">
        <select
          v-model="selectedEnvironment"
          data-testid="environment-filter"
          class="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                 bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="all">All Environments</option>
          <option
            v-for="env in envStore.enabledEnvironments"
            :key="env.id"
            :value="env.id"
          >
            {{ env.displayName }}
          </option>
        </select>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="flex justify-center items-center py-12">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      <span class="ml-3 text-gray-600 dark:text-gray-400">Loading applications...</span>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800
                                  rounded-lg p-6 text-center">
      <i class="fas fa-exclamation-circle text-red-600 dark:text-red-400 text-3xl mb-2"></i>
      <p class="text-red-800 dark:text-red-300">{{ error }}</p>
      <button
        @click="loadApps"
        class="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg
               transition-colors duration-200"
      >
        Try Again
      </button>
    </div>

    <!-- Empty State -->
    <div v-else-if="apps.length === 0" class="bg-gray-50 dark:bg-gray-800 rounded-lg p-12 text-center">
      <i class="fas fa-inbox text-gray-400 text-5xl mb-4"></i>
      <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        No applications found
      </h3>
      <p class="text-gray-600 dark:text-gray-400 mb-6">
        Get started by deploying your first application
      </p>
      <button
        @click="$emit('navigate', 'custom')"
        class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg
               transition-colors duration-200 font-medium"
      >
        Deploy New Application
      </button>
    </div>

    <!-- Apps Table -->
    <div v-else class="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden" data-testid="apps-table">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead class="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Project Abbr / Env.
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Version
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Service Name
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Owner
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Created / Age
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr
              v-for="app in filteredApps"
              :key="`${app.name}-${app.environment}`"
              class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-150"
            >
              <!-- Project / Environment -->
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex flex-col">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-gray-900 dark:text-white">
                      {{ app.name }}
                    </span>
                    <span
                      v-if="app.lifecycle"
                      :class="[
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                        app.lifecycle === 'production'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                      ]"
                    >
                      <i :class="[
                        'fas mr-1',
                        app.lifecycle === 'production' ? 'fa-check-circle' : 'fa-flask'
                      ]"></i>
                      {{ app.lifecycle }}
                    </span>
                  </div>
                  <div class="flex items-center text-sm text-gray-500 dark:text-gray-400 mt-1">
                    <i class="fas fa-server mr-1.5"></i>
                    {{ app.environment }}
                  </div>
                </div>
              </td>

              <!-- Version -->
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="text-sm text-gray-900 dark:text-white">
                  {{ app.version || '1.0' }}
                </span>
              </td>

              <!-- Description -->
              <td class="px-6 py-4">
                <span class="text-sm text-gray-900 dark:text-white line-clamp-2">
                  {{ app.description || 'No description available' }}
                </span>
              </td>

              <!-- Owner -->
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="text-sm text-gray-900 dark:text-white">
                  {{ app.owner }}
                </span>
              </td>

              <!-- Created / Age -->
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex flex-col">
                  <span class="text-sm text-gray-900 dark:text-white">
                    {{ formatDate(app.deployedAt) }}
                  </span>
                  <span class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {{ app.age || 'N/A' }}
                  </span>
                </div>
              </td>

              <!-- Actions -->
              <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <!-- For 'production' apps: Only show Azure Portal button -->
                <div v-if="app.lifecycle === 'production'" class="flex items-center justify-end">
                  <button
                    @click="viewInAzurePortal(app)"
                    title="View in Azure Portal"
                    class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-700
                           dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20
                           rounded-lg transition-colors duration-200"
                  >
                    <i class="fas fa-cloud"></i>
                    <span>View in Azure Portal</span>
                  </button>
                </div>

                <!-- For non-Live apps: Show all action buttons -->
                <div v-else class="flex items-center justify-end gap-2">
                  <!-- View in Azure Portal -->
                  <button
                    @click="viewInAzurePortal(app)"
                    title="View in Azure Portal"
                    class="p-2 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300
                           hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors duration-200"
                  >
                    <i class="fas fa-cloud"></i>
                  </button>

                  <!-- Promote -->
                  <button
                    v-if="app.lifecycle === 'experimental' || app.lifecycle === 'development'"
                    @click="handlePromote(app)"
                    title="Promote to Delivery Path"
                    class="p-2 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300
                           hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors duration-200"
                  >
                    <i class="fas fa-arrow-up"></i>
                  </button>
                  <span
                    v-else
                    class="p-2 text-gray-400 dark:text-gray-600 cursor-not-allowed"
                    title="Already in production"
                  >
                    <i class="fas fa-check-circle"></i>
                  </span>

                  <!-- Label -->
                  <button
                    @click="handleLabel(app)"
                    title="Label Live/Experiment"
                    class="p-2 text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300
                           hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors duration-200"
                  >
                    <i class="fas fa-tag"></i>
                  </button>

                  <!-- Add Code Repo -->
                  <button
                    @click="handleAddRepo(app)"
                    title="Add Code Repository"
                    class="p-2 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300
                           hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors duration-200"
                  >
                    <i class="fas fa-code-branch"></i>
                  </button>

                  <!-- Delete -->
                  <button
                    @click="handleDelete(app)"
                    title="Delete Application"
                    class="p-2 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300
                           hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors duration-200"
                  >
                    <i class="fas fa-trash"></i>
                  </button>

                  <!-- Edit Infrastructure -->
                  <button
                    v-if="prefillEnabled"
                    @click="handleEditInfra(app)"
                    title="Edit Infrastructure"
                    :aria-label="`Edit infrastructure for ${app.name} in ${app.environment}`"
                    class="p-2 text-yellow-600 hover:text-yellow-700 dark:text-yellow-400 dark:hover:text-yellow-300
                           hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-lg transition-colors duration-200"
                  >
                    <i class="fas fa-pencil-alt"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- No Results -->
      <div
        v-if="filteredApps.length === 0 && apps.length > 0"
        class="p-8 text-center text-gray-500 dark:text-gray-400"
      >
        <i class="fas fa-search text-3xl mb-2"></i>
        <p>No applications match your search criteria</p>
      </div>
    </div>

    <MoveToInfraLiveModal
      :is-visible="promoteTarget !== null"
      :app-name="promoteTarget?.name ?? ''"
      :source-environment="promoteTarget?.environment ?? ''"
      @close="promoteTarget = null"
      @submit="submitPromote"
    />

    <!-- StatusModal -->
    <StatusModal
      v-if="showStatusModal"
      :is-visible="showStatusModal"
      :correlation-id="currentCorrelationId"
      :workflow-type="currentWorkflowType"
      @close="closeStatusModal"
      @success="handleSuccess"
      @failure="handleFailure"
    />
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
