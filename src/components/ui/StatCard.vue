<template>
  <!--
    同时保留 stat-card / s-label / s-value 旧类名：
    全站统计卡的观感已统一由 ui-stat 负责，但历史测试用例仍按旧类名取值，
    保留别名可避免一次改动牵动几十处断言。
  -->
  <div
    class="ui-stat stat-card"
    :class="`tone-${tone}`"
    :style="clickable ? 'cursor:pointer' : ''"
    @click="$emit('click')"
  >
    <span class="ui-stat-label s-label">
      <span v-if="icon" class="ui-stat-ico">{{ icon }}</span>{{ label }}
    </span>
    <b class="ui-stat-value s-value">{{ value }}</b>
    <span v-if="hint" class="ui-stat-hint">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  icon?: string
  hint?: string
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral'
  clickable?: boolean
}>()
defineEmits<{ click: [] }>()
</script>

<style scoped>
.ui-stat-ico { font-size: 13px; line-height: 1; }
</style>
