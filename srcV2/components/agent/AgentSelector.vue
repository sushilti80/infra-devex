<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiService } from '@v2/services/api'

export interface Agent {
  agentName: string
  description: string
  category: string
  inputs: Array<{
    name: string
    required: boolean
    description: string
  }>
}

interface Props {
  modelValue?: string
}

interface Emits {
  (e: 'update:modelValue', value: string): void
  (e: 'select', agent: Agent): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const agents = ref<Agent[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const searchQuery = ref('')

const filteredAgents = computed(() => {
  if (!searchQuery.value) return agents.value

  const query = searchQuery.value.toLowerCase()
  return agents.value.filter(agent =>
    agent.agentName.toLowerCase().includes(query)
  )
})

const selectAgent = (agent: Agent) => {
  emit('update:modelValue', agent.agentName)
  emit('select', agent)
}

const isSelected = (agentName: string) => {
  return props.modelValue === agentName
}

const getCategoryColor = (category: string) => {  if (!category) return 'bg-gray-100 text-gray-800'
    const colors: Record<string, string> = {
    'messaging': 'bg-purple-100 text-purple-800',
    'storage': 'bg-blue-100 text-blue-800',
    'compute': 'bg-green-100 text-green-800',
    'database': 'bg-orange-100 text-orange-800'
  }
  return colors[category.toLowerCase()] || 'bg-gray-100 text-gray-800'
}

onMounted(async () => {
  try {
    loading.value = true
    const response = await apiService.getAgents()

    if (response.success && response.data) {
      agents.value = response.data
    } else {
      error.value = 'Failed to load agents'
    }
  } catch (err: any) {
    error.value = err.message || 'An error occurred while loading agents'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="agent-selector">
    <!-- Search Bar -->
    <div class="mb-6">
      <div class="relative">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          search
        </span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search agents..."
          class="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <div class="text-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p class="text-gray-600">Loading agents...</p>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
      <span class="material-symbols-outlined text-red-600 text-4xl mb-2">error</span>
      <p class="text-red-800">{{ error }}</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredAgents.length === 0" class="text-center py-12">
      <span class="material-symbols-outlined text-gray-400 text-6xl mb-4">search_off</span>
      <p class="text-gray-600">No agents found matching your search</p>
    </div>

    <!-- Agent Cards Grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="agent in filteredAgents"
        :key="agent.agentName"
        @click="selectAgent(agent)"
        class="agent-card relative bg-white border rounded-lg p-6 cursor-pointer transition-all hover:shadow-md"
        :class="{
          'border-blue-500 ring-2 ring-blue-500 ring-opacity-50': isSelected(agent.agentName),
          'border-gray-200 hover:border-blue-300': !isSelected(agent.agentName)
        }"
      >
        <!-- Selection Indicator -->
        <div
          v-if="isSelected(agent.agentName)"
          class="absolute top-4 right-4 bg-blue-500 rounded-full p-1"
        >
          <span class="material-symbols-outlined text-white text-xl">check_circle</span>
        </div>

        <!-- Agent Icon -->
        <div class="flex items-start mb-4">
          <div class="bg-blue-100 rounded-lg p-3 mr-4">
            <span class="material-symbols-outlined text-blue-600 text-2xl">smart_toy</span>
          </div>
          <div class="flex-1">
            <h3 class="text-lg font-semibold text-gray-900 mb-1">{{ agent.agentName }}</h3>
            <span
              class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
              :class="getCategoryColor(agent.category)"
            >
              {{ agent.category }}
            </span>
          </div>
        </div>

        <!-- Description -->
        <p class="text-sm text-gray-600 mb-4">{{ agent.description }}</p>

        <!-- Inputs Info -->
        <div class="flex items-center justify-between text-xs text-gray-500">
          <div class="flex items-center">
            <span class="material-symbols-outlined text-sm mr-1">input</span>
            <span>{{ agent.inputs.length }} parameters</span>
          </div>
          <div class="flex items-center">
            <span class="material-symbols-outlined text-sm mr-1">star</span>
            <span>{{ agent.inputs.filter(i => i.required).length }} required</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Selected Agent Info -->
    <div v-if="modelValue" class="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
      <div class="flex items-center">
        <span class="material-symbols-outlined text-blue-600 mr-2">info</span>
        <p class="text-sm text-blue-800">
          Selected agent: <strong>{{ modelValue }}</strong>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-card {
  transition: all 0.2s ease;
}

.agent-card:hover {
  transform: translateY(-2px);
}
</style>
