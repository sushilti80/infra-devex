<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export interface ComboOption {
  value: string
  label: string
  hint?: string
}

/**
 * Generic ARIA 1.2 combobox with list autocomplete (AC-001-2): role=combobox on the input,
 * aria-activedescendant for the highlighted option, keyboard nav (Arrow/Home/End/Enter/Escape).
 * The typed text is the value (free text allowed, e.g. a pasted repo or a branch not on the first page).
 */
const props = withDefaults(defineProps<{
  id: string
  label: string
  modelValue: string
  options: ComboOption[]
  placeholder?: string
  loading?: boolean
  disabled?: boolean
  error?: string
  helper?: string
  emptyText?: string
  maxOptions?: number
}>(), { placeholder: '', loading: false, disabled: false, error: '', helper: '', emptyText: 'No matches', maxOptions: 100 })

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'select', value: string): void
  (e: 'commit', value: string): void
}>()

const open = ref(false)
const activeIndex = ref(-1)
const listId = computed(() => `${props.id}-listbox`)
const optionId = (i: number) => `${props.id}-opt-${i}`

const filtered = computed(() => {
  const needle = props.modelValue.trim().toLowerCase()
  const list = needle ? props.options.filter(o => o.label.toLowerCase().includes(needle)) : props.options
  return list.slice(0, props.maxOptions)
})

watch(filtered, () => { activeIndex.value = -1 })

const showEmpty = computed(() => open.value && !props.loading && filtered.value.length === 0)
const describedBy = computed(() => [props.error ? `${props.id}-error` : '', props.helper ? `${props.id}-help` : ''].filter(Boolean).join(' ') || undefined)

function move(delta: number) {
  if (!filtered.value.length) return
  open.value = true
  const n = filtered.value.length
  activeIndex.value = activeIndex.value < 0 ? (delta > 0 ? 0 : n - 1) : (activeIndex.value + delta + n) % n
}

function choose(i: number) {
  const opt = filtered.value[i]
  if (!opt) return
  emit('update:modelValue', opt.value)
  emit('select', opt.value)
  open.value = false
  activeIndex.value = -1
}

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); move(1); break
    case 'ArrowUp': e.preventDefault(); move(-1); break
    case 'Home': if (open.value && filtered.value.length) { e.preventDefault(); activeIndex.value = 0 } break
    case 'End': if (open.value && filtered.value.length) { e.preventDefault(); activeIndex.value = filtered.value.length - 1 } break
    case 'Enter':
      e.preventDefault()
      if (open.value && activeIndex.value >= 0) choose(activeIndex.value)
      else { open.value = false; emit('commit', props.modelValue) }
      break
    case 'Escape':
      if (open.value) { e.preventDefault(); open.value = false; activeIndex.value = -1 }
      break
    case 'Tab': open.value = false; break
  }
}

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
  open.value = true
}

function onBlur() {
  open.value = false
  emit('commit', props.modelValue)
}
</script>

<template>
  <div class="relative">
    <label :for="id" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ label }}</label>
    <input
      :id="id"
      type="text"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="open && activeIndex >= 0 ? optionId(activeIndex) : undefined"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      :aria-busy="loading ? 'true' : undefined"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
      @input="onInput"
      @keydown="onKeydown"
      @focus="open = true"
      @blur="onBlur"
    />
    <ul
      v-show="open && filtered.length > 0"
      :id="listId"
      role="listbox"
      :aria-label="label"
      class="absolute z-20 mt-1 w-full max-h-60 overflow-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg"
    >
      <li
        v-for="(opt, i) in filtered"
        :id="optionId(i)"
        :key="opt.value"
        role="option"
        :aria-selected="i === activeIndex"
        :class="['px-3 py-2 cursor-pointer text-sm flex justify-between gap-2 text-gray-900 dark:text-white', i === activeIndex ? 'bg-blue-100 dark:bg-blue-900/40' : 'hover:bg-gray-100 dark:hover:bg-gray-700']"
        @mousedown.prevent="choose(i)"
      >
        <span>{{ opt.label }}</span>
        <span v-if="opt.hint" class="text-xs text-gray-500 dark:text-gray-400">{{ opt.hint }}</span>
      </li>
    </ul>
    <p v-if="loading" role="status" class="mt-1 text-xs text-gray-500 dark:text-gray-400">Loading…</p>
    <p v-else-if="showEmpty" role="status" class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ emptyText }}</p>
    <p v-if="helper" :id="`${id}-help`" class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ helper }}</p>
    <p v-if="error" :id="`${id}-error`" class="mt-1 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
  </div>
</template>
