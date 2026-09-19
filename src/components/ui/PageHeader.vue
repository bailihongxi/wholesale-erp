<template>
  <header class="ui-page-head">
    <div class="ui-page-main">
      <h3 class="ui-page-title">
        {{ title }}
        <span v-if="badge" class="ui-badge" :class="`badge-${badgeTone}`">{{ badge }}</span>
      </h3>
      <p v-if="sub" class="ui-page-sub">{{ sub }}</p>
    </div>
    <div v-if="$slots.actions" class="ui-page-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    sub?: string
    /** 标题右侧的状态小标签，例如「收货入库」「已完成」 */
    badge?: string
    badgeTone?: 'success' | 'warning' | 'danger' | 'info' | 'muted'
  }>(),
  { badgeTone: 'info' }
)
</script>

<style scoped>
.ui-page-main {
  min-width: 0;
  flex: 1;
}
.ui-page-title .ui-badge {
  margin-left: 8px;
  vertical-align: 2px;
}
</style>
