<template>
  <!-- 编辑模块本体：v-if 由父组件的 showEdit 驱动。
       电脑端：作为详情页里的普通卡片内联排布（与详情页其它 .block 同宽、无橘色边框）。
       手机端：整屏覆盖（position:fixed），内容区独立滚动，底部「取消 / 保存」常驻。
       返回语义统一交给详情页自身的橘色「返回」键（编辑时它被 v-if 收起，模块一关即回来），
       所以这里只放「取消 / 保存修改」两键。 -->
  <div v-if="modelValue" class="edit-page">
    <div class="edit-scroll">
      <slot />
    </div>

    <div class="edit-footer">
      <button class="btn-cancel" type="button" :disabled="saving" @click="$emit('cancel')">{{ cancelText }}</button>
      <button class="btn-save" type="button" :disabled="saving" @click="$emit('save')">{{ saving ? savingText : saveText }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 是否显示编辑模块（通常绑定父组件的 showEdit） */
    modelValue: boolean
    /** 保存中：禁用两个按钮 */
    saving?: boolean
    /** 取消按钮文案 */
    cancelText?: string
    /** 保存按钮文案 */
    saveText?: string
    /** 保存中的按钮文案 */
    savingText?: string
  }>(),
  {
    saving: false,
    cancelText: '取消',
    saveText: '保存修改',
    savingText: '保存中...'
  }
)

// 注意：模板里用的是 $emit，这里不要写成 `const emit = defineEmits(...)` ——
// tsconfig 开了 noUnusedLocals，未使用的 emit 变量会让 vue-tsc 构建失败。
defineEmits<{
  (e: 'cancel'): void
  (e: 'save'): void
}>()
</script>

<style scoped>
/* 编辑模块：直接融进详情页版面（去掉销售单旧版 4px 橘色大边框 + 内缩 12px 的「弹窗感」）。
   里面传进来的 .block 卡片沿用全局 .block（同宽 / 同圆角 / 同阴影）。 */
.edit-page { padding: 0; background: transparent; }
.edit-scroll { /* 电脑端内联：无特殊定位 */ }

/* 底部操作条：跟着卡片走（同宽 / 同圆角 / 同阴影），只有「取消 / 保存修改」两键 */
.edit-footer {
  display: flex; gap: 12px; padding: 12px 20px;
  background: #fff; border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 12px; box-shadow: 0 2px 10px rgba(26, 54, 93, 0.06);
}
.edit-footer button { height: 46px; border-radius: 10px; font-size: 15px; font-weight: 600; border: none; cursor: pointer; }
.edit-footer .btn-cancel { flex: 1; background: #ef4444; color: #fff; }
.edit-footer .btn-save { flex: 2; background: var(--c-accent, #2563eb); color: #fff; }
.edit-footer button:disabled { opacity: 0.55; cursor: not-allowed; }

/* ── 手机端（≤767px）：整屏覆盖，内容区独立滚动，底部「取消 / 保存」常驻 ──
   电脑端不固定：编辑模块作为详情页里的普通卡片内联排布。 */
@media (max-width: 767px) {
  .edit-page {
    position: fixed; inset: 0; z-index: 90;
    display: flex; flex-direction: column;
    padding: 0; border: none; border-radius: 0;
    background: var(--c-bg); overflow: hidden;
  }
  .edit-scroll {
    flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
    padding-bottom: 8px;
  }
  .edit-page :deep(.block) { margin: 10px; padding: 14px; }
  .edit-page :deep(.block:first-child) { margin-top: 12px; }
  .edit-footer {
    flex: none; gap: 10px;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
    border: none; border-top: 1px solid #e8eaef; border-radius: 0;
    box-shadow: 0 -2px 12px rgba(22, 50, 92, 0.08);
  }
  .edit-footer .btn-cancel { flex: 1; }
  .edit-footer .btn-save { flex: 1; }
  .edit-footer button { height: 48px; }
}

/* ── 编辑内容区样式（作用于 slot 内的详情卡片 / 可编辑卡片列表） ──
   用 :deep() 才能作用到父组件通过 slot 传进来的内容。
   全部以 .edit-page 为作用域前缀，引入本组件不会污染页面其它区域。 */
.edit-page :deep(.block-title) { font-size: 15px; color: var(--c-primary, #1a365d); margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px; }
.edit-page :deep(.block-title .bar) { width: 3px; height: 16px; background: var(--c-accent, #2563eb); border-radius: 2px; }
.edit-page :deep(.d-no) { font-size: 18px; color: var(--c-primary, #1a365d); margin: 0; }
.edit-page :deep(.d-meta) { margin-top: 12px; font-size: 13px; display: grid; grid-template-columns: auto 1fr; gap: 6px; align-items: start; }
/* 全局 .d-meta i 给了 62px 固定宽（详情页那几行靠它对齐），编辑页只有「备注」两字，
   沿用会白白空出 36px —— 这里收回成按文字宽度。 */
.edit-page :deep(.d-meta i) { display: inline-block; width: auto; color: var(--c-muted, #64748b); font-style: normal; }
.edit-page :deep(.rm-label) { padding-top: 9px; line-height: 1.15; }
.edit-page :deep(.edit-remark-input) {
  display: block; width: 100%; min-height: 56px; max-height: 240px;
  border: 1px solid var(--c-border, #e2e8f0); border-radius: 8px;
  padding: 8px 12px; font-size: 14px; line-height: 1.5;
  font-family: inherit; color: var(--c-primary, #1a365d);
  resize: none; overflow-y: auto; outline: none;
}
.edit-page :deep(.edit-remark-input:focus) { border-color: var(--c-accent, #2563eb); }

/* 可编辑明细卡片列表（数量 / 单价 输入框带「数量 / 单价」标签，触摸目标 ≥44px） */
.edit-page :deep(.ec-list) { list-style: none; margin: 0; padding: 0; }
.edit-page :deep(.ec-item) {
  padding: 10px 12px; margin-bottom: 8px;
  background: #f8fafc; border: 1px solid var(--c-border); border-radius: 10px;
}
.edit-page :deep(.ec-item:last-child) { margin-bottom: 0; }
.edit-page :deep(.ec-top) { display: flex; align-items: center; gap: 8px; }
.edit-page :deep(.ec-name) { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: var(--c-primary); overflow-wrap: anywhere; }
.edit-page :deep(.ec-idx) { flex: none; min-width: 18px; font-size: 12px; color: var(--c-muted); font-variant-numeric: tabular-nums; }
.edit-page :deep(.ec-amount) { flex: none; font-size: 15px; font-weight: 700; color: var(--c-primary); }
.edit-page :deep(.ec-row) { display: flex; gap: 10px; margin-top: 10px; }
.edit-page :deep(.ec-field) {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px;
  height: 44px; padding: 0 10px;
  background: #fff; border: 1px solid var(--c-border-strong); border-radius: 8px;
}
.edit-page :deep(.ec-field:focus-within) { border-color: var(--c-accent); box-shadow: 0 0 0 2px var(--c-accent-soft); }
.edit-page :deep(.ec-field i), .edit-page :deep(.ec-field em) { flex: none; font-style: normal; font-size: 12px; color: var(--c-muted); }
.edit-page :deep(.ec-input) {
  flex: 1; min-width: 0; height: 100%; border: none; outline: none; background: transparent;
  font-size: 15px; text-align: right; color: var(--c-primary);
}

/* 编辑态合计条（手机端没有表格 tfoot，用这条补上） */
.edit-page :deep(.mc-total) {
  display: flex; align-items: center; gap: 8px;
  margin-top: 10px; padding-top: 10px; font-size: 13px; color: var(--c-muted);
  border-top: 1px dashed var(--c-border);
}
.edit-page :deep(.mc-total .mt-qty) { font-weight: 600; color: var(--c-primary); }
.edit-page :deep(.mc-total .mt-amount) { margin-left: auto; font-size: 17px; font-weight: 700; color: var(--c-danger); }

/* ── 电脑端（≥768px）：可编辑卡片一行排完 ──
   序号 + 商品名 + 数量 + 单价 + 金额 同排一行（原来是上下两行：上行名称/金额，下行两输入框）。
   做法是用 display:contents 把 .ec-top 这层「拆开」，让序号 / 商品名 / 金额直接参与本行
   flex 排布；金额靠 order:1 挪到最右。手机端依旧靠 .ec-top / .ec-row 保持上下两行 ——
   两端共用同一份 DOM，不另开模板。 */
@media (min-width: 768px) {
  .edit-page :deep(.ec-list) { display: block; }
  .edit-page :deep(.ec-item) {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 8px; padding: 8px 12px;
  }
  .edit-page :deep(.ec-item:last-child) { margin-bottom: 0; }
  .edit-page :deep(.ec-item .ec-top) { display: contents; }
  .edit-page :deep(.ec-item .ec-name) {
    flex: 1; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .edit-page :deep(.ec-item .ec-row) { flex: none; margin-top: 0; gap: 8px; }
  .edit-page :deep(.ec-item .ec-field) { flex: none; width: 152px; height: 40px; padding: 0 8px; }
  .edit-page :deep(.ec-item .ec-amount) {
    order: 1; margin-left: 0; flex: none; min-width: 112px; text-align: right;
  }
  .edit-page :deep(.mc-total) {
    margin-top: 12px; padding: 12px 14px;
    background: var(--c-bg, #f8fafc); border: 1px solid var(--c-border);
    border-radius: 10px;
  }
  .edit-page :deep(.mc-total .mt-amount) { font-size: 19px; }
}
</style>
