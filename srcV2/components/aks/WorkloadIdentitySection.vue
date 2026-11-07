<template>
  <div class="border-t border-gray-200 dark:border-gray-700 pt-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
        <span class="material-symbols-outlined text-blue-600">lock_person</span>
        External Resource Access
      </h2>
    </div>

    <p class="text-sm text-gray-500 dark:text-gray-400 mb-3">
      Your app is automatically provisioned with a managed identity
      <code class="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">{{ appname }}-uami</code>.
      Use
      <code class="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">DefaultAzureCredential()</code>
      in your code. Grant it access to external Azure resources below — no secrets needed.
    </p>

    <!-- Identity info banner -->
    <div
      class="mb-4 flex gap-3 rounded-lg border border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-950 p-4"
    >
      <span class="material-symbols-outlined text-blue-600 dark:text-blue-400 mt-0.5 shrink-0">info</span>
      <div class="text-sm text-blue-800 dark:text-blue-200">
        <p class="font-semibold mb-1">Workload Identity is always active for your app.</p>
        <p class="mb-2">
          The identity chain below is created automatically on every deployment.
          Add grants here to give this identity access to Azure resources outside the cluster.
        </p>
        <div class="font-mono text-xs space-y-0.5">
          <p>Managed Identity: <strong>{{ appname }}-uami</strong></p>
          <p>Federated Credential: <strong>{{ appname }}-uami-federated</strong></p>
          <p>Kubernetes ServiceAccount: <strong>{{ appname }}-sa</strong></p>
        </div>
      </div>
    </div>

    <!-- Roles load error -->
    <div
      v-if="rolesLoadError"
      class="mb-4 flex gap-3 rounded-lg border border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-950 p-4"
    >
      <span class="material-symbols-outlined text-red-600 dark:text-red-400 mt-0.5 shrink-0">error</span>
      <p class="text-sm text-red-800 dark:text-red-200">
        Failed to load Azure roles. Please refresh the page.
      </p>
    </div>

    <!-- Grants header -->
    <div class="flex items-center justify-between mb-2">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        Grant <code class="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">{{ appname }}-uami</code>
        access to external Azure resources:
      </p>
      <button
        type="button"
        @click="addGrant"
        class="flex items-center gap-1 text-sm text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 font-medium"
      >
        <span class="material-symbols-outlined text-base">add_circle</span>
        Add Access
      </button>
    </div>

    <!-- Empty state -->
    <div v-if="modelValue.length === 0" class="text-sm text-gray-400 dark:text-gray-500 italic py-2">
      No external access grants defined. Your app can still access the cluster-managed Key Vault
      via ExternalSecret above.
    </div>

    <!-- Grant rows -->
    <div
      v-for="(grant, index) in modelValue"
      :key="index"
      class="flex gap-2 mb-2 items-start"
    >
      <!-- Resource Type -->
      <div class="w-44 shrink-0">
        <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Resource Type</label>
        <select
          :value="grant.resourceType"
          @change="onResourceTypeChange(index, ($event.target as HTMLSelectElement).value)"
          class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
        >
          <option value="">-- Select type --</option>
          <option
            v-for="scope in filteredScopes"
            :key="scope.value"
            :value="scope.value"
          >
            {{ scope.name }}
          </option>
        </select>
      </div>

      <!-- Resource Name -->
      <div class="flex-1">
        <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Resource Name</label>
        <input
          :value="grant.resourceName"
          @input="updateGrant(index, 'resourceName', ($event.target as HTMLInputElement).value)"
          type="text"
          placeholder="e.g., my-keyvault"
          class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono"
        />
        <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Azure resource name (not full ARM ID)</p>
      </div>

      <!-- Role -->
      <div class="w-56 shrink-0">
        <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Role</label>
        <select
          :value="grant.role"
          @change="updateGrant(index, 'role', ($event.target as HTMLSelectElement).value)"
          :disabled="!grant.resourceType"
          class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">-- Select role --</option>
          <option
            v-for="role in rolesForGrant(index)"
            :key="role.id"
            :value="role.name"
          >
            {{ role.name }}
          </option>
        </select>
        <p v-if="!grant.resourceType" class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          Select a resource type first
        </p>
      </div>

      <!-- Remove -->
      <button
        type="button"
        @click="removeGrant(index)"
        class="mt-6 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
        title="Remove"
      >
        <span class="material-symbols-outlined text-xl">remove_circle</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { WorkloadIdentityGrant } from '@v2/types/infrastructure.types'
import api from '@v2/services/api'

const props = defineProps<{
  modelValue: WorkloadIdentityGrant[]
  appname: string
  envname: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: WorkloadIdentityGrant[]): void
}>()

interface AzureRole {
  id: string
  name: string
  description: string
  scope: string
}

interface RoleScope {
  name: string
  value: string
}

const allRoles = ref<AzureRole[]>([])
const allScopes = ref<RoleScope[]>([])
const rolesLoadError = ref(false)

onMounted(async () => {
  try {
    const response = await api.getRoles()
    if (response.success && response.data) {
      allRoles.value = response.data.roles ?? []
      allScopes.value = response.data.scopes ?? []
    } else {
      rolesLoadError.value = true
    }
  } catch {
    rolesLoadError.value = true
  }
})

// Exclude 'global' — subscription-scoped roles are not appropriate for per-app grants
const filteredScopes = computed(() =>
  allScopes.value.filter(s => s.value !== 'global')
)

function rolesForGrant(index: number): AzureRole[] {
  const grant = props.modelValue[index]
  if (!grant?.resourceType) return []
  return allRoles.value.filter(r => r.scope === grant.resourceType)
}

function onResourceTypeChange(index: number, newType: string) {
  const updated = [...props.modelValue]
  updated[index] = { ...updated[index], resourceType: newType, role: '' }
  emit('update:modelValue', updated)
}

function updateGrant(index: number, field: keyof WorkloadIdentityGrant, value: string) {
  const updated = [...props.modelValue]
  updated[index] = { ...updated[index], [field]: value }
  emit('update:modelValue', updated)
}

function addGrant() {
  emit('update:modelValue', [
    ...props.modelValue,
    { resourceType: '', resourceName: '', role: '' }
  ])
}

function removeGrant(index: number) {
  const updated = [...props.modelValue]
  updated.splice(index, 1)
  emit('update:modelValue', updated)
}
</script>
