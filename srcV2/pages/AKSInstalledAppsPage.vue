<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import api from '@v2/services/api'
import { useNavigationStore } from '@v2/stores/navigation'
import { useEnvironmentsStore } from '../stores/environments'
import type { AKSDeployedApp } from '@v2/types/infrastructure.types'

const navigationStore = useNavigationStore()
const envStore = useEnvironmentsStore()

// Data
const apps = ref<AKSDeployedApp[]>([])
const searchQuery = ref('')
const selectedEnvironment = ref('all')
const isLoading = ref(false)
const error = ref('')

// Computed
const filteredApps = computed(() => {
  return apps.value.filter(app => {
    const matchesSearch =
      app.appname.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      app.namespace.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      app.owner.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      app.imageName.toLowerCase().includes(searchQuery.value.toLowerCase())

    const matchesEnv =
      selectedEnvironment.value === 'all' ||
      app.environment === selectedEnvironment.value

    return matchesSearch && matchesEnv
  })
})

// Methods
const loadApps = async () => {
  isLoading.value = true
  error.value = ''

  try {
    const response = await api.getAKSApps()
    if (response.success && response.data) {
      apps.value = response.data
    } else {
      error.value = response.error || 'Failed to load AKS applications'
    }
  } catch (err: any) {
    console.error('Error loading AKS apps:', err)
    error.value = err.message || 'Failed to load AKS applications'
  } finally {
    isLoading.value = false
  }
}

const formatDate = (dateString: string): string => {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Lifecycle
onMounted(() => {
  loadApps()
})
</script>

<template>
  <div class="container mx-auto px-6 py-8 max-w-7xl">
    <!-- Header -->
    <div class="flex justify-between items-center mb-8">
      <div>
        <div class="flex items-center gap-3 mb-1">
          <span class="material-symbols-outlined text-3xl text-orange-600 dark:text-orange-400">
            cloud_upload
          </span>
          <h1 class="text-3xl font-bold text-gray-900 dark:text-white">AKS Deployed Applications</h1>
        </div>
        <p class="text-gray-600 dark:text-gray-400 ml-12">
          View all containerized applications deployed to Azure Kubernetes Service
        </p>
      </div>
      <button
        type="button"
        class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800
               border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700
               transition-colors"
        @click="navigationStore.navigateToPage('home')"
      >
        <span class="material-symbols-outlined text-lg mr-1 inline-block align-middle">arrow_back</span>
        <span class="align-middle">Back to Home</span>
      </button>
    </div>

    <!-- Search and Filters -->
    <div class="flex flex-col sm:flex-row gap-4 mb-6">
      <div class="flex-1">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search by app name, namespace, owner or image…"
          class="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                 bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
        />
      </div>
      <div class="w-full sm:w-52">
        <select
          v-model="selectedEnvironment"
          class="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                 bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
        >
          <option value="all">All Environments</option>
          <option
            v-for="env in envStore.aksEnabledEnvironments"
            :key="env.id"
            :value="env.id"
          >
            {{ env.displayName }}
          </option>
        </select>
      </div>
      <button
        type="button"
        class="px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg
               transition-colors flex items-center gap-2 whitespace-nowrap"
        @click="loadApps"
      >
        <span class="material-symbols-outlined text-lg">refresh</span>
        Refresh
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="flex justify-center items-center py-16">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      <span class="ml-3 text-gray-600 dark:text-gray-400">Loading AKS applications…</span>
    </div>

    <!-- Error State -->
    <div
      v-else-if="error"
      class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center"
    >
      <span class="material-symbols-outlined text-red-600 dark:text-red-400 text-4xl mb-2 block">error</span>
      <p class="text-red-800 dark:text-red-300 mb-4">{{ error }}</p>
      <button
        type="button"
        class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
        @click="loadApps"
      >
        Try Again
      </button>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="apps.length === 0"
      class="bg-gray-50 dark:bg-gray-800 rounded-lg p-12 text-center"
    >
      <span class="material-symbols-outlined text-gray-400 text-6xl mb-4 block">cloud_off</span>
      <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">No AKS deployments yet</h3>
      <p class="text-gray-600 dark:text-gray-400 mb-6">
        Deploy a containerized application to AKS and it will appear here.
      </p>
      <button
        type="button"
        class="px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition-colors"
        @click="navigationStore.navigateToPage('aks')"
      >
        Deploy to AKS
      </button>
    </div>

    <!-- Apps Table -->
    <div
      v-else
      class="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden"
    >
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead class="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                App / Namespace
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Environment
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Image
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Owner
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Application URL
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Managed resources
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Deployed At / Commit
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr
              v-for="app in filteredApps"
              :key="`${app.appname}-${app.environment}`"
              class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-150"
            >
              <!-- App / Namespace -->
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex flex-col">
                  <span class="text-sm font-medium text-gray-900 dark:text-white">{{ app.appname }}</span>
                  <span class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
                    <span class="material-symbols-outlined text-sm">folder_open</span>
                    {{ app.namespace }}
                  </span>
                  <span v-if="app.version" class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    v{{ app.version }}
                  </span>
                </div>
              </td>

              <!-- Environment -->
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                             bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                  {{ app.environment }}
                </span>
              </td>

              <!-- Image -->
              <td class="px-6 py-4">
                <div class="flex flex-col">
                  <span class="text-sm text-gray-900 dark:text-white font-mono truncate max-w-xs" :title="app.imageName">
                    {{ app.imageName }}
                  </span>
                  <span class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    tag: {{ app.imageTag }}
                  </span>
                </div>
              </td>

              <!-- Owner -->
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="text-sm text-gray-900 dark:text-white">{{ app.owner }}</span>
              </td>

              <!-- Generated private-gateway URL; readiness is runtime-gated, not metadata-gated. -->
              <td class="px-6 py-4 max-w-sm">
                <template v-if="app.exposureUrl">
                  <a
                    :href="app.exposureUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-sm font-medium text-orange-700 dark:text-orange-400 hover:underline break-all"
                    :aria-label="`Open private Kong URL for ${app.appname}`"
                  >
                    {{ app.exposureUrl }}
                    <span aria-hidden="true">↗</span>
                  </a>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Private Kong · Access depends on rollout readiness and approved network.
                  </p>
                </template>
                <span v-else class="text-sm text-gray-400 dark:text-gray-500">—</span>
              </td>

              <!-- Git-declared resource ownership and optional PostgreSQL database -->
              <td class="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                <div class="flex flex-col gap-1">
                  <span v-if="app.postgresDatabase?.enabled" class="font-mono">
                    PostgreSQL: {{ app.postgresDatabase.database_name }}
                  </span>
                  <span v-if="app.postgresDatabase?.enabled" class="text-xs text-gray-500 dark:text-gray-400">
                    {{ app.postgresDatabase.parent_server }} · {{ app.postgresDatabase.deletion_policy }}
                  </span>
                  <span v-if="app.gitops?.owners?.length" class="text-xs">
                    {{ app.gitops.owners.length }} Flux owner(s)
                  </span>
                  <span v-if="app.resourceInventory?.declared?.length" class="text-xs">
                    {{ app.resourceInventory.declared.length }} declared resource(s)
                  </span>
                  <span v-if="!app.gitops" class="text-xs text-amber-600 dark:text-amber-400">
                    Cleanup inventory unavailable; review required
                  </span>
                </div>
              </td>

              <!-- Deployed At / Commit -->
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex flex-col">
                  <span class="text-sm text-gray-900 dark:text-white">{{ formatDate(app.deployedAt) }}</span>
                  <span v-if="app.commitSha" class="text-xs text-gray-400 dark:text-gray-500 mt-0.5 font-mono" :title="app.commitSha">
                    {{ app.commitSha.substring(0, 7) }}
                  </span>
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
        <span class="material-symbols-outlined text-4xl mb-2 block">search_off</span>
        <p>No applications match your search criteria</p>
      </div>
    </div>
  </div>
</template>
