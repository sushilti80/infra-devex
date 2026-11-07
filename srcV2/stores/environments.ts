import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * Environment Configuration Interface
 */
export interface EnvironmentConfig {
  id: string
  displayName: string
  subscriptionId: string
  description?: string
  enabled: boolean
  features: {
    customInfra: boolean
    templates: boolean
    aks: boolean
    secrets?: boolean
    /** Ship from Repo (runtime flag from data/environments.json; absent/false = hidden) */
    shipFromRepo?: boolean
  }
}

export interface EnvironmentsResponse {
  environments: EnvironmentConfig[]
  defaultEnvironment: string
  defaultSubscriptionId: string
}

/**
 * Environments Store
 * Manages environment configuration loaded from backend API
 */
export const useEnvironmentsStore = defineStore('environments', () => {
  // State
  const environments = ref<EnvironmentConfig[]>([])
  const defaultEnvironment = ref<string>('')
  const defaultSubscriptionId = ref<string>('')
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Computed getters
  const enabledEnvironments = computed(() =>
    environments.value.filter(env => env.enabled)
  )

  const aksEnabledEnvironments = computed(() =>
    environments.value.filter(env => env.enabled && env.features.aks)
  )

  const customInfraEnvironments = computed(() =>
    environments.value.filter(env => env.enabled && env.features.customInfra)
  )

  const templateEnvironments = computed(() =>
    environments.value.filter(env => env.enabled && env.features.templates)
  )

  const secretsEnabledEnvironments = computed(() =>
    environments.value.filter(env => env.enabled && env.features.secrets)
  )

  const secretsEnabled = computed(() => secretsEnabledEnvironments.value.length > 0)

  // Ship from Repo: enabled env with both the AKS feature and the shipFromRepo flag (no hardcoded env ids)
  const shipEnvironments = computed(() =>
    environments.value.filter(env => env.enabled && env.features.aks && env.features.shipFromRepo === true)
  )

  const shipEnabled = computed(() => shipEnvironments.value.length > 0)

  const subscriptionMap = computed(() => {
    const map: Record<string, string> = {}
    environments.value.forEach(env => {
      map[env.id] = env.subscriptionId
    })
    return map
  })

  // Actions
  async function fetchEnvironments() {
    loading.value = true
    error.value = null

    try {
      const response = await fetch('/api/environments')
      const result = await response.json()

      if (result.success) {
        const data: EnvironmentsResponse = result.data
        environments.value = data.environments
        defaultEnvironment.value = data.defaultEnvironment
        defaultSubscriptionId.value = data.defaultSubscriptionId

        console.log('Loaded environments:', environments.value.length)
      } else {
        throw new Error(result.error || 'Failed to fetch environments')
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      console.error('Failed to fetch environments:', err)

      // Fail closed when the catalog endpoint is unavailable. Environment
      // definitions must come from data/environments.json via the API.
      environments.value = []
      defaultEnvironment.value = ''
      defaultSubscriptionId.value = ''
    } finally {
      loading.value = false
    }
  }

  function getSubscriptionId(envId: string): string {
    return subscriptionMap.value[envId] || defaultSubscriptionId.value
  }

  function getEnvironmentById(envId: string): EnvironmentConfig | undefined {
    return environments.value.find(env => env.id === envId)
  }

  return {
    // State
    environments,
    defaultEnvironment,
    defaultSubscriptionId,
    loading,
    error,

    // Computed
    enabledEnvironments,
    aksEnabledEnvironments,
    customInfraEnvironments,
    templateEnvironments,
    secretsEnabled,
    secretsEnabledEnvironments,
    shipEnvironments,
    shipEnabled,

    // Actions
    fetchEnvironments,
    getSubscriptionId,
    getEnvironmentById
  }
})
