<template>
  <!--
    开票与对公账户信息（客户 / 供应商共用，第十三轮）
    做成独立组件是为了：客户页与供应商页共用同一套字段，
    以后要加「开票邮箱」「开户支行」只需改 utils/invoice.ts 一处。
  -->
  <div class="inv-box">
    <div class="inv-head" @click="open = !open">
      <span class="inv-title">开票与打款资料</span>
      <span class="inv-tip">{{ tip }}</span>
      <span class="inv-arrow" :class="{ collapsed: !open }">▾</span>
    </div>

    <div v-show="open" class="inv-grid">
      <label v-for="f in INVOICE_FIELDS" :key="f.key" class="inv-field">
        <span class="if-label">{{ f.label }}</span>
        <input
          v-model="model[f.key]"
          class="if-input"
          type="text"
          :placeholder="f.placeholder"
          @keyup.enter="$emit('submit')"
        />
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { INVOICE_FIELDS, hasInvoice, invoiceComplete } from '../utils/invoice'
import type { InvoiceInfo } from '../types'

const model = defineModel<InvoiceInfo>({ required: true })
defineEmits<{ (e: 'submit'): void }>()

const open = ref(true)

const tip = computed(() => {
  if (invoiceComplete(model.value)) return '资料完整，可直接开票'
  if (hasInvoice(model.value)) return '已填但缺抬头/税号'
  return '未填写'
})
</script>

<style scoped>
.inv-box {
  margin-top: 12px; border: 1px solid var(--c-border); border-radius: var(--r-md);
  background: var(--c-surface-alt); overflow: hidden;
}
.inv-head {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  cursor: pointer; user-select: none;
}
.inv-title { font-size: 13px; font-weight: 600; color: var(--c-primary); }
.inv-tip { font-size: 12px; color: var(--c-muted); }
.inv-arrow { margin-left: auto; color: var(--c-muted); transition: transform .18s ease; }
.inv-arrow.collapsed { transform: rotate(-90deg); }

.inv-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  padding: 0 14px 14px;
}
.inv-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.if-label { font-size: 12px; color: var(--c-muted); }
.if-input {
  height: 40px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm);
  padding: 0 12px; font-size: 14px; outline: none; background: #fff; color: var(--c-text);
  width: 100%; box-sizing: border-box;
}
.if-input:focus { border-color: var(--c-accent); }

@media (max-width: 767px) {
  .inv-grid { grid-template-columns: 1fr; }
}
</style>
