<template>
  <div class="ui-seg" role="tablist">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="ui-seg-item"
      :class="{ active: o.value === modelValue }"
      role="tab"
      :aria-selected="o.value === modelValue"
      @click="$emit('update:modelValue', o.value)"
    >
      <span v-if="o.icon" class="ui-seg-ico">{{ o.icon }}</span>{{ o.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
export interface SegOption<T = string> {
  value: T
  label: string
  icon?: string
}

defineProps<{
  modelValue: string
  options: SegOption[]
}>()
defineEmits<{ 'update:modelValue': [string] }>()
</script>
