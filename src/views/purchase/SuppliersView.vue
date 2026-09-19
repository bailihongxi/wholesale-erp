<template>
  <div class="page">
    <PageHeader title="供应商管理" sub="供应商资料、结算方式与开票信息" />

    <div class="toolbar">
      <SearchInput
        v-model="keyword"
        class="tb-search"
        placeholder="搜索名称 / 联系人 / 电话 / 开票抬头 / 税号"
        :debounce="0"
      />
      <button class="add-btn" type="button" @click="openNew">＋ 新增供应商</button>
    </div>

    <div class="block">
      <h3 class="block-title">供应商列表（{{ list.length }}<span v-if="hasKeyword"> / 共 {{ suppliers.length }}</span>）</h3>

      <LoadingBlock v-if="loading" :rows="5" />

      <ul v-else class="list">
        <li v-for="s in list" :key="s.id" class="item" @click="openEdit(s)">
          <div class="i-row">
            <span class="i-name">{{ s.name }}</span>
            <span
              class="ui-badge inv-badge"
              :class="invoiceComplete(s) ? 'ok' : (hasInvoice(s) ? 'warn' : 'muted')"
            >
              {{ invoiceComplete(s) ? '开票资料完整' : (hasInvoice(s) ? '开票资料不全' : '未填开票资料') }}
            </span>
          </div>
          <div class="i-sub">{{ s.contact }} · {{ s.phone }} · {{ s.paymentTerm || '未设账期' }}</div>
          <div v-if="invoiceSummary(s)" class="i-inv">{{ invoiceSummary(s) }}</div>
          <div v-if="s.address" class="i-addr">地址：{{ s.address }}</div>
          <div v-if="s.remark" class="i-remark">备注：{{ s.remark }}</div>
        </li>
        <li v-if="!list.length" class="empty">
          {{ hasKeyword ? '没有匹配的供应商，试试清除搜索' : '暂无供应商，点击右上角新增' }}
        </li>
      </ul>
    </div>

    <div v-if="showForm" class="form-card">
      <h4 class="fc-title">{{ editingId ? '编辑供应商' : '新增供应商' }}</h4>

      <div class="sec-label">基础资料</div>
      <div class="form-grid">
        <input v-model="form.name" class="f-input" placeholder="名称 *" />
        <input v-model="form.contact" class="f-input" placeholder="联系人" />
        <input v-model="form.phone" class="f-input" placeholder="电话" />
        <input v-model="form.address" class="f-input" placeholder="地址" />
        <input v-model="form.paymentTerm" class="f-input" placeholder="账期（如：月结30天）" />
      </div>

      <!-- 开票与对公账户：与客户页共用同一组件 -->
      <InvoiceFieldset v-model="invoice" />

      <div class="sec-label">备注</div>
      <textarea v-model="form.remark" class="f-area" rows="2" placeholder="备注（选填）：结算约定 / 开票要求等"></textarea>

      <div class="form-actions">
        <button class="save" type="button" @click="save">保存</button>
        <button class="cancel" type="button" @click="showForm = false">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { showToast } from 'vant'
import { usePurchaseStore } from '../../stores/purchase'
import { db } from '../../db'
import { hasInvoice, invoiceComplete, invoiceOf, invoiceSummary, emptyInvoice } from '../../utils/invoice'
import type { Supplier, InvoiceInfo } from '../../types'
import InvoiceFieldset from '../../components/InvoiceFieldset.vue'
import SearchInput from '../../components/SearchInput.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import LoadingBlock from '../../components/ui/LoadingBlock.vue'

const purchaseStore = usePurchaseStore()
const suppliers = ref<Supplier[]>([])
const showForm = ref(false)
const editingId = ref<number | null>(null)
const loading = ref(true)
const keyword = ref('')
const form = ref({ name: '', contact: '', phone: '', address: '', paymentTerm: '', remark: '' })
const invoice = ref<InvoiceInfo>(emptyInvoice())

const hasKeyword = computed(() => !!keyword.value.trim())

const list = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return suppliers.value
  return suppliers.value.filter(s =>
    s.name.toLowerCase().includes(kw) ||
    (s.contact ?? '').toLowerCase().includes(kw) ||
    (s.phone ?? '').toLowerCase().includes(kw) ||
    (s.invoiceTitle ?? '').toLowerCase().includes(kw) ||
    (s.taxNo ?? '').toLowerCase().includes(kw)
  )
})

async function reload(): Promise<void> {
  try {
    suppliers.value = await purchaseStore.listSuppliers()
  } finally {
    loading.value = false
  }
}

function openNew(): void {
  editingId.value = null
  form.value = { name: '', contact: '', phone: '', address: '', paymentTerm: '', remark: '' }
  invoice.value = emptyInvoice()
  showForm.value = true
}

function openEdit(s: Supplier): void {
  editingId.value = s.id ?? null
  form.value = {
    name: s.name,
    contact: s.contact,
    phone: s.phone,
    address: s.address,
    paymentTerm: s.paymentTerm,
    remark: s.remark ?? ''
  }
  invoice.value = invoiceOf(s)
  showForm.value = true
}

async function save(): Promise<void> {
  if (!form.value.name.trim()) {
    showToast('请填写名称')
    return
  }
  // 备注与开票资料必须一起写回，否则编辑会被清空（第十三轮修复）
  const payload: Omit<Supplier, 'id'> = {
    name: form.value.name.trim(),
    contact: form.value.contact,
    phone: form.value.phone,
    address: form.value.address,
    paymentTerm: form.value.paymentTerm,
    remark: form.value.remark.trim(),
    invoiceTitle: invoice.value.invoiceTitle.trim(),
    taxNo: invoice.value.taxNo.trim(),
    invoiceAddress: invoice.value.invoiceAddress.trim(),
    invoicePhone: invoice.value.invoicePhone.trim(),
    bankName: invoice.value.bankName.trim(),
    bankAccount: invoice.value.bankAccount.trim()
  }
  if (editingId.value) {
    await db.suppliers.update(editingId.value, payload)
    showToast('已更新')
  } else {
    await purchaseStore.createSupplier(payload)
    showToast('已添加')
  }
  showForm.value = false
  await reload()
}

onMounted(reload)
</script>

<style scoped>
.toolbar { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.tb-search { flex: 1 1 320px; min-width: 200px; }
.add-btn {
  height: 40px; padding: 0 18px; border: none; border-radius: var(--r-sm);
  background: var(--c-accent); color: #fff; cursor: pointer; white-space: nowrap;
}
.block-title { font-size: 15px; color: var(--c-primary); margin-bottom: 10px; }

.list { list-style: none; }
.item {
  background: #fff; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px;
  box-shadow: 0 2px 10px rgba(26,54,93,0.06); cursor: pointer;
}
.i-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.i-name { font-weight: 600; color: var(--c-primary); }
.i-sub { font-size: 13px; color: var(--c-muted); margin-top: 4px; }
.i-inv { font-size: 12px; color: var(--c-text-2); margin-top: 4px; }
.i-addr, .i-remark { font-size: 12px; color: var(--c-muted); margin-top: 2px; }

.ui-badge { font-size: 11px; padding: 1px 8px; border-radius: 10px; white-space: nowrap; }
.inv-badge.ok { background: #ecfdf5; color: #10b981; }
.inv-badge.warn { background: #fff7ed; color: #f59e0b; }
.inv-badge.muted { background: #f1f5f9; color: #94a3b8; }

.form-card {
  background: #fff; border-radius: 12px; padding: 16px; margin-top: 14px;
  box-shadow: 0 2px 10px rgba(26,54,93,0.06);
}
.fc-title { font-size: 15px; color: var(--c-primary); }
.form-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.f-input {
  height: 40px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm);
  padding: 0 14px; font-size: 14px; outline: none; background: #fff; color: var(--c-text);
  width: 100%; box-sizing: border-box;
}
.f-input:focus { border-color: var(--c-accent); }
.sec-label { font-size: 12px; color: var(--c-muted); margin: 12px 0 6px; }
.f-area {
  width: 100%; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm);
  padding: 8px 12px; font-size: 14px; outline: none; background: #fff; color: var(--c-text);
  font-family: inherit; resize: vertical; box-sizing: border-box;
}
.f-area:focus { border-color: var(--c-accent); }
.form-actions { display: flex; gap: 10px; margin-top: 14px; }
.save { flex: 1; height: 40px; border: none; border-radius: var(--r-sm); background: var(--c-accent); color: #fff; cursor: pointer; }
/* 取消按钮：橘红实底白字（全站规范 2026-09-20） */
.cancel { height: 40px; padding: 0 18px; border: 1px solid var(--c-amber); border-radius: var(--r-sm); background: var(--c-amber); color: #fff; font-weight: 600; cursor: pointer; }
.cancel:hover { background: var(--c-amber-hover); border-color: var(--c-amber-hover); }
.empty { color: var(--c-muted); text-align: center; padding: 20px; }

@media (max-width: 767px) {
  .form-grid { grid-template-columns: 1fr; }
}
</style>
