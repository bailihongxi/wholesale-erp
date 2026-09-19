<template>
  <label class="ui-switch" :title="desc || label">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="ui-switch-track"></span>
    <span v-if="label" class="ui-switch-text">{{ label }}</span>
  </label>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean
  label?: string
  desc?: string
  disabled?: boolean
}>()
defineEmits<{ 'update:modelValue': [boolean] }>()
</script>
