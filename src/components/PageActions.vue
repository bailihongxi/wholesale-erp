<template>
  <!--
    二级页面统一操作栏。
    按业务语义区分措辞：
      · 详情页 → cancelText="返回"
      · 表单页 → cancelText="取消"
    主操作按钮（confirmText）可选，例如「确认入库」「保存」。
  -->
  <div class="page-actions">
    <button
      class="pa-btn pa-cancel"
      type="button"
      :disabled="cancelDisabled"
      @click="emit('cancel')"
    >
      {{ cancelText }}
    </button>
    <button
      v-if="confirmText"
      class="pa-btn pa-confirm"
      type="button"
      :disabled="confirmDisabled || loading"
      @click="emit('confirm')"
    >
      {{ loading ? '处理中…' : confirmText }}
    </button>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 取消/返回按钮文案。详情页传「返回」，表单页传「取消」 */
    cancelText?: string
    /** 主操作按钮文案，为空则不显示主操作按钮 */
    confirmText?: string
    /** 主操作是否禁用（如表单未填写完整） */
    confirmDisabled?: boolean
    /** 取消按钮是否禁用 */
    cancelDisabled?: boolean
    /** 主操作进行中：显示「处理中…」并禁用，防止重复提交 */
    loading?: boolean
  }>(),
  {
    cancelText: '返回',
    confirmText: '',
    confirmDisabled: false,
    cancelDisabled: false,
    loading: false
  }
)

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'confirm'): void
}>()
</script>

<style scoped>
.page-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}
.pa-btn {
  height: 46px;
  border-radius: 10px;
  font-size: 15px;
  cursor: pointer;
  box-sizing: border-box;
}
/* 有主操作时，左侧按钮占 1 份、右侧主操作占 2 份；
   只有返回/取消按钮时则铺满整行，方便单手点击（手机端） */
/* 返回 / 取消统一橘红实底白字（全站规范 2026-09-20）：
   与蓝色主操作在色相上拉开距离，避免误点提交 */
.pa-cancel {
  flex: 1;
  border: 1px solid var(--c-amber, #f97316);
  background: var(--c-amber, #f97316);
  color: #fff;
  font-weight: 600;
}
.pa-confirm {
  flex: 2;
  border: none;
  background: var(--c-accent, #2563eb);
  color: #fff;
  font-weight: 600;
}
.pa-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.pa-cancel:hover:not(:disabled) {
  background: var(--c-amber-hover, #ea580c);
  border-color: var(--c-amber-hover, #ea580c);
  color: #fff;
}
.pa-confirm:hover:not(:disabled) {
  filter: brightness(1.05);
}
</style>
