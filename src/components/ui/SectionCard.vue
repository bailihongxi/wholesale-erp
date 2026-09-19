<template>
  <!-- 保留 block / block-title 旧类名，与历史测试用例的取值方式兼容 -->
  <section class="ui-card block" :class="{ 'ui-card-hover': hover }">
    <div v-if="title || $slots.extra" class="ui-card-head">
      <h4 class="ui-card-title block-title">
        {{ title }}
        <span v-if="desc" class="ui-card-desc">{{ desc }}</span>
      </h4>
      <div v-if="$slots.extra" class="ui-card-extra">
        <slot name="extra" />
      </div>
    </div>
    <div class="ui-card-body" :class="{ tight }">
      <slot />
    </div>
    <div v-if="$slots.foot" class="ui-card-foot">
      <slot name="foot" />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
  desc?: string
  /** 内容区内边距收窄，放表格时用 */
  tight?: boolean
  hover?: boolean
}>()
</script>
