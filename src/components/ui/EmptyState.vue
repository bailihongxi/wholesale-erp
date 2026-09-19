<template>
  <div class="ui-empty">
    <span v-if="icon" class="ui-empty-ico">{{ icon }}</span>
    <span class="ui-empty-text">{{ text }}</span>
    <span v-if="hint" class="ui-empty-hint">{{ hint }}</span>
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ text?: string; hint?: string; icon?: string }>(),
  { text: '暂无数据', icon: '🗂️' }
)
</script>
