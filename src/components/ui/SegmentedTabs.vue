<template>
  <div class="ui-seg" :class="size" role="tablist">
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
      <span v-if="o.badge" class="ui-seg-badge">{{ o.badge > 99 ? '99+' : o.badge }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 分段 Tab（全站统一的页内导航控件）
 *
 * size：
 *  - 'md'（默认）页面级模块导航（如库存作业的六大模块）
 *  - 'sm'       Hub 页内嵌子页的页内切换，视觉上低一档，避免两层同款
 * badge：待办数量角标，例如「入库验货 ②」表示还有 2 张待收货单
 *
 * 注意：子页里不要手写 <div class="ui-seg"><button>，
 * 按钮必须带 .ui-seg-item 类，否则会退回浏览器默认按钮样式。
 */
export interface SegOption<T = string> {
  value: T
  label: string
  icon?: string
  /** 右侧待办角标（0 或不传则不显示） */
  badge?: number
}

withDefaults(
  defineProps<{
    modelValue: string
    options: SegOption[]
    size?: 'md' | 'sm'
  }>(),
  { size: 'md' }
)
defineEmits<{ 'update:modelValue': [string] }>()
</script>
