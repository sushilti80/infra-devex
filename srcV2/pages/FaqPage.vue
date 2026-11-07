<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNavigationStore } from '../stores/navigation'
import { useAuth } from '../composables/useAuth'
import { faqCategories, faqItems, useCases, type FaqCategoryId } from '../content/faq'

type Tab = 'faq' | 'use-cases'

const navigationStore = useNavigationStore()
const { isAuthenticated } = useAuth()

const activeTab = ref<Tab>('faq')
const search = ref('')
const activeCategory = ref<FaqCategoryId | 'all'>('all')

const filteredItems = computed(() => {
  const term = search.value.trim().toLowerCase()
  return faqItems.filter(item => {
    if (activeCategory.value !== 'all' && item.category !== activeCategory.value) return false
    if (!term) return true
    return (
      item.question.toLowerCase().includes(term) ||
      item.answer.some(paragraph => paragraph.toLowerCase().includes(term))
    )
  })
})

const groupedItems = computed(() =>
  faqCategories
    .map(category => ({
      category,
      items: filteredItems.value.filter(item => item.category === category.id)
    }))
    .filter(group => group.items.length > 0)
)

function tabClass(tab: Tab) {
  return [
    'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
    activeTab.value === tab
      ? 'bg-blue-600 text-white'
      : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
  ]
}

function chipClass(selected: boolean) {
  return [
    'px-3 py-1 text-sm rounded-full border transition-colors',
    selected
      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 font-medium'
      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
  ]
}
</script>

<template>
  <div class="space-y-8" data-testid="faq-page">
    <div>
      <button
        type="button"
        class="mb-4 inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        @click="navigationStore.navigateToPage('home')"
      >
        <span class="material-symbols-outlined text-lg mr-2">arrow_back</span>
        Back to Home
      </button>

      <div class="flex items-center gap-3 mb-4">
        <span class="material-symbols-outlined text-4xl text-blue-600 dark:text-blue-400">help</span>
        <h1 class="text-4xl font-bold text-gray-900 dark:text-white">FAQ &amp; Use Cases</h1>
      </div>
      <p class="text-lg text-gray-600 dark:text-gray-400 max-w-4xl">
        Self-Service is a thin layer over our infrastructure-as-code pipeline: you state the intent, the portal generates the code and a Pull Request, and the normal review and deployment pipeline does the rest.
      </p>
    </div>

    <div class="flex gap-2" role="tablist">
      <button
        type="button"
        role="tab"
        data-testid="tab-faq"
        :aria-selected="activeTab === 'faq'"
        :class="tabClass('faq')"
        @click="activeTab = 'faq'"
      >
        Frequently asked questions
      </button>
      <button
        type="button"
        role="tab"
        data-testid="tab-use-cases"
        :aria-selected="activeTab === 'use-cases'"
        :class="tabClass('use-cases')"
        @click="activeTab = 'use-cases'"
      >
        Use case scenarios
      </button>
    </div>

    <!-- FAQ -->
    <section v-if="activeTab === 'faq'" class="space-y-6" data-testid="faq-panel">
      <div>
        <label for="faq-search" class="sr-only">Search the FAQ</label>
        <input
          id="faq-search"
          v-model="search"
          type="search"
          data-testid="faq-search"
          placeholder="Search questions and answers"
          class="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div class="flex flex-wrap gap-2">
        <button type="button" :class="chipClass(activeCategory === 'all')" @click="activeCategory = 'all'">All</button>
        <button
          v-for="category in faqCategories"
          :key="category.id"
          type="button"
          :data-testid="`chip-${category.id}`"
          :class="chipClass(activeCategory === category.id)"
          @click="activeCategory = category.id"
        >
          {{ category.label }}
        </button>
      </div>

      <p
        v-if="groupedItems.length === 0"
        class="p-6 text-center text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
        data-testid="faq-empty"
      >
        No matching questions. Try different keywords, or ask via Request Feature/Bugfix.
      </p>

      <div v-for="group in groupedItems" :key="group.category.id" class="space-y-3">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          {{ group.category.label }}
        </h2>
        <details
          v-for="item in group.items"
          :key="item.id"
          :open="search.trim() !== ''"
          data-testid="faq-item"
          class="group bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700"
        >
          <summary class="flex items-center justify-between gap-4 cursor-pointer px-5 py-4 font-medium text-gray-900 dark:text-white list-none">
            <span>{{ item.question }}</span>
            <span class="material-symbols-outlined text-gray-500 transition-transform group-open:rotate-180" aria-hidden="true">expand_more</span>
          </summary>
          <div class="px-5 pb-5 space-y-2 text-gray-700 dark:text-gray-300">
            <p v-for="(paragraph, index) in item.answer" :key="index">{{ paragraph }}</p>
          </div>
        </details>
      </div>
    </section>

    <!-- Use cases -->
    <section v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="use-cases-panel">
      <article
        v-for="useCase in useCases"
        :key="useCase.id"
        data-testid="use-case"
        class="flex flex-col bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6"
      >
        <div class="flex items-start gap-3 mb-3">
          <span class="material-symbols-outlined text-3xl text-blue-600 dark:text-blue-400" aria-hidden="true">{{ useCase.icon }}</span>
          <div>
            <h2 class="text-xl font-semibold text-gray-900 dark:text-white">{{ useCase.title }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ useCase.persona }}</p>
          </div>
        </div>

        <p class="text-gray-700 dark:text-gray-300 mb-4">{{ useCase.goal }}</p>

        <ol class="space-y-2 mb-4 list-decimal list-inside text-sm text-gray-700 dark:text-gray-300">
          <li v-for="(step, index) in useCase.steps" :key="index">{{ step }}</li>
        </ol>

        <div class="p-3 mb-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-300">
          <strong>Result:</strong> {{ useCase.outcome }}
        </div>

        <div class="mt-auto">
          <button
            v-if="isAuthenticated"
            type="button"
            data-testid="use-case-cta"
            class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            @click="navigationStore.navigateToPage(useCase.page)"
          >
            Try it in {{ useCase.pageLabel }}
            <span class="material-symbols-outlined text-base" aria-hidden="true">arrow_forward</span>
          </button>
          <p v-else class="text-sm text-gray-500 dark:text-gray-400">
            Sign in to use {{ useCase.pageLabel }}.
          </p>
        </div>
      </article>
    </section>
  </div>
</template>
