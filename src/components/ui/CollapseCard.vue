<template>
  <!--
    可折叠卡片（第十三轮）
    ------------------------------------------------------------
    系统设置这类「一堆小模块堆一屏」的页面，用它可以把每个模块收成一行标题，
    点标题回弹展开 / 收起，页面不再被表单撑得老长。

    用法：
      <CollapseCard v-model="open.company" title="公司信息">
        ...内容...
      </CollapseCard>

    约定：
      - 内容用 CSS 折叠而非 v-if，**DOM 始终保留**，既不影响已有测试用例，也不丢表单里填了一半的内容；
      - 折叠动画走 max-height + opacity，尊重「减少动效」偏好；
      - 标题支持键盘操作（Enter / 空格），并带 aria-expanded。
  -->
  <section class="ui-card block cc" :class="{ 'is-collapsed': !open }">
    <div
      class="cc-head"
      role="button"
      tabindex="0"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
      @keyup.enter="toggle"
      @keyup.space.prevent="toggle"
    >
      <span class="cc-arrow" :class="{ collapsed: !open }" aria-hidden="true">▾</span>
      <h3 class="block-title cc-title">{{ title }}</h3>
      <span v-if="desc" class="cc-desc">{{ desc }}</span>
      <slot name="extra" />
    </div>

    <div class="cc-body" :class="{ collapsed: !open }">
      <div class="cc-inner">
        <slot />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  /** 标题右侧的补充说明 */
  desc?: string
  /** 是否展开（v-model） */
  modelValue: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

/** 模板里统一用 open 这个语义名，对外仍是一对 modelValue / update:modelValue */
const open = computed(() => props.modelValue)
function toggle(): void {
  emit('update:modelValue', !props.modelValue)
}
</script>

<style scoped>
.cc { overflow: hidden; }
.cc.is-collapsed { padding-bottom: 0; }

.cc-head {
  display: flex; align-items: center; gap: 10px; cursor: pointer;
  user-select: none; outline: none;
}
.cc-head:focus-visible { box-shadow: inset 0 0 0 2px var(--c-accent-soft); border-radius: var(--r-sm); }
.cc-title { margin: 0; }
.cc-desc { font-size: 12px; color: var(--c-muted); }

.cc-arrow {
  flex: 0 0 auto; width: 18px; font-size: 15px; line-height: 1;
  text-align: center; color: var(--c-text-2, #6b7280);
  transition: transform .22s cubic-bezier(.34, 1.56, .64, 1); /* 轻微回弹 */
}
.cc-head:hover .cc-arrow { color: var(--c-accent); }
.cc-arrow.collapsed { transform: rotate(-90deg); }

.cc-body {
  max-height: 3200px; opacity: 1; overflow: hidden;
  transition: max-height .28s ease, opacity .2s ease;
}
.cc-body.collapsed { max-height: 0; opacity: 0; }
.cc-inner { padding-top: 12px; }

@media (prefers-reduced-motion: reduce) {
  .cc-arrow, .cc-body { transition: none; }
}
</style>
