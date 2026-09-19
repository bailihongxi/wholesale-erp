<template>
  <div class="customers-page">
    <PageHeader title="客户管理" sub="客户资料、等级与往来记录" />
    <!-- 工具栏：搜索 + 筛选 + 新增 -->
    <div class="toolbar">
      <SearchInput
        v-model="keyword"
        class="tb-search"
        placeholder="搜索客户名称 / 联系人 / 电话 / 开票抬头 / 税号"
        :debounce="0"
      />
      <select v-model="filterType" class="tb-select">
        <option value="all">全部客户</option>
        <option value="dealer">仅看经销商</option>
        <option value="wholesale">仅看普通客户</option>
      </select>
      <button class="add-btn" type="button" @click="openNew">＋ 新增客户</button>
    </div>

    <!-- 列表 -->
    <div class="block">
      <h3 class="block-title">客户列表（{{ list.length }}<span v-if="hasKeyword"> / 共 {{ customers.length }}</span>）</h3>

      <LoadingBlock v-if="loading" :rows="6" />

      <ul v-else-if="isMobile" class="card-list">
        <li v-for="c in list" :key="c.id" class="cust-card" @click="openEdit(c)">
          <div class="c-head">
            <span class="c-name">{{ c.name }}</span>
            <span v-if="c.loginPhone" class="badge dealer">经销商</span>
          </div>
          <div class="c-sub">{{ c.level }} 级 · {{ c.contact }} · {{ c.phone }}</div>
          <div v-if="c.loginPhone" class="c-login">登录号：{{ c.loginPhone }}</div>
          <div class="c-inv">
            <span class="ui-badge" :class="invoiceComplete(c) ? 'ok' : (hasInvoice(c) ? 'warn' : 'muted')">
              {{ invoiceComplete(c) ? '开票资料完整' : (hasInvoice(c) ? '开票资料不全' : '未填开票资料') }}
            </span>
            <span v-if="invoiceSummary(c)" class="c-inv-txt">{{ invoiceSummary(c) }}</span>
          </div>
        </li>
        <li v-if="!list.length" class="empty">
          {{ hasKeyword ? '没有匹配的客户，试试清除搜索' : '暂无客户，点击右上角新增' }}
        </li>
      </ul>

      <table v-else class="cust-table">
        <thead>
          <tr>
            <th>客户名称</th>
            <th>等级</th>
            <th>联系人</th>
            <th>联系电话</th>
            <th>账期</th>
            <th>经销商账号</th>
            <th class="center">开票资料</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in list" :key="c.id">
            <td>
              <span class="c-name">{{ c.name }}</span>
              <span v-if="c.loginPhone" class="badge dealer">经销商</span>
            </td>
            <td>{{ c.level }}</td>
            <td>{{ c.contact || '-' }}</td>
            <td>{{ c.phone || '-' }}</td>
            <td>{{ c.paymentTerm || '-' }}</td>
            <td>{{ c.loginPhone || '-' }}</td>
            <td class="center">
              <span
                class="ui-badge inv-badge"
                :class="invoiceComplete(c) ? 'ok' : (hasInvoice(c) ? 'warn' : 'muted')"
                :title="invoiceSummary(c)"
              >
                {{ invoiceComplete(c) ? '完整' : (hasInvoice(c) ? '不全' : '未填') }}
              </span>
            </td>
            <td><button class="link-btn" type="button" @click="openEdit(c)">编辑</button></td>
          </tr>
          <tr v-if="!list.length">
            <td colspan="8" class="empty">
              {{ hasKeyword ? '没有匹配的客户，试试清除搜索' : '暂无客户，点击右上角新增' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 新增 / 编辑表单 -->
    <div v-if="showForm" class="block form-card">
      <h3 class="block-title">{{ editingId ? '编辑客户' : '新增客户' }}</h3>

      <div class="sec-label">基础资料</div>
      <div class="form-grid">
        <input v-model="form.name" class="f-input" placeholder="客户名称 *" />
        <input v-model="form.level" class="f-input" placeholder="客户等级（如 A / B / C）" />
        <input v-model="form.contact" class="f-input" placeholder="联系人" />
        <input v-model="form.phone" class="f-input" placeholder="联系电话" />
        <input v-model="form.address" class="f-input" placeholder="地址" />
        <input v-model="form.paymentTerm" class="f-input" placeholder="账期（如 月结30天）" />
      </div>

      <!-- 开票与对公账户（客户 / 供应商共用组件） -->
      <InvoiceFieldset v-model="invoice" />

      <div class="sec-label">备注</div>
      <textarea v-model="form.remark" class="f-area" rows="2" placeholder="备注（选填）：结算约定 / 开票要求等"></textarea>

      <label class="dealer-toggle">
        <input v-model="form.isDealer" type="checkbox" />
        设为经销商（开通独立登录账号，可查看产品目录与批发价）
      </label>
      <div v-if="form.isDealer" class="form-grid dealer-grid">
        <input v-model="form.loginPhone" class="f-input" placeholder="经销商登录手机号 *" />
        <input v-model="form.loginPassword" class="f-input" placeholder="经销商登录密码 *" />
      </div>

      <div class="form-actions">
        <button class="save" type="button" :disabled="saving" @click="save">保存</button>
        <button class="cancel" type="button" @click="showForm = false">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { showToast } from 'vant'
import SearchInput from '../../components/SearchInput.vue'
import { useSalesStore } from '../../stores/sales'
import { useResponsive } from '../../composables/useResponsive'
import { db } from '../../db'
import { hasInvoice, invoiceComplete, invoiceOf, invoiceSummary, emptyInvoice } from '../../utils/invoice'
import type { Customer, InvoiceInfo } from '../../types'
import InvoiceFieldset from '../../components/InvoiceFieldset.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import LoadingBlock from '../../components/ui/LoadingBlock.vue'

const salesStore = useSalesStore()
const { isMobile } = useResponsive()

const customers = ref<Customer[]>([])
const keyword = ref('')
const filterType = ref<'all' | 'dealer' | 'wholesale'>('all')
const showForm = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const form = ref({
  name: '', contact: '', phone: '', level: 'A', address: '',
  paymentTerm: '', remark: '', isDealer: false, loginPhone: '', loginPassword: ''
})
/** 开票与打款资料单独一个对象，新增 / 编辑统一用它回填 */
const invoice = ref<InvoiceInfo>(emptyInvoice())

const hasKeyword = computed(() => !!keyword.value.trim())

// 先按关键词过滤，再按「经销商 / 普通客户」筛选
const list = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  let data = customers.value
  if (kw) {
    data = data.filter(c =>
      c.name.toLowerCase().includes(kw) ||
      (c.contact ?? '').toLowerCase().includes(kw) ||
      (c.phone ?? '').toLowerCase().includes(kw) ||
      // 开票抬头 / 税号也能搜，方便「按要开票的公司名」找客户
      (c.invoiceTitle ?? '').toLowerCase().includes(kw) ||
      (c.taxNo ?? '').toLowerCase().includes(kw)
    )
  }
  if (filterType.value === 'dealer') data = data.filter(c => !!c.loginPhone)
  if (filterType.value === 'wholesale') data = data.filter(c => !c.loginPhone)
  return data
})

const loading = ref(true)

async function reload(): Promise<void> {
  try {
    customers.value = await salesStore.listCustomers()
  } finally {
    loading.value = false
  }
}

function openNew(): void {
  editingId.value = null
  form.value = {
    name: '', contact: '', phone: '', level: 'A', address: '',
    paymentTerm: '', remark: '', isDealer: false, loginPhone: '', loginPassword: ''
  }
  invoice.value = emptyInvoice()
  showForm.value = true
}

function openEdit(c: Customer): void {
  editingId.value = c.id ?? null
  form.value = {
    name: c.name,
    contact: c.contact,
    phone: c.phone,
    level: c.level,
    address: c.address,
    paymentTerm: c.paymentTerm,
    remark: c.remark ?? '',
    isDealer: !!c.loginPhone,
    loginPhone: c.loginPhone ?? '',
    loginPassword: c.loginPassword ?? ''
  }
  // 老数据没有开票字段也能安全回填（缺字段按空串）
  invoice.value = invoiceOf(c)
  showForm.value = true
}

async function save(): Promise<void> {
  if (!form.value.name.trim()) {
    showToast('请填写客户名称')
    return
  }
  if (form.value.isDealer && !form.value.loginPhone.trim()) {
    showToast('设为经销商时，登录手机号必填')
    return
  }
  // remark 与开票资料必须一起写回，否则编辑会把它清空（第十三轮修复）
  const payload: Omit<Customer, 'id'> = {
    name: form.value.name.trim(),
    contact: form.value.contact,
    phone: form.value.phone,
    address: form.value.address,
    level: form.value.level || 'A',
    creditLimit: 0,
    paymentTerm: form.value.paymentTerm,
    loginPhone: form.value.isDealer ? form.value.loginPhone.trim() : '',
    loginPassword: form.value.isDealer ? form.value.loginPassword : '',
    status: 'active',
    remark: form.value.remark.trim(),
    invoiceTitle: invoice.value.invoiceTitle.trim(),
    taxNo: invoice.value.taxNo.trim(),
    invoiceAddress: invoice.value.invoiceAddress.trim(),
    invoicePhone: invoice.value.invoicePhone.trim(),
    bankName: invoice.value.bankName.trim(),
    bankAccount: invoice.value.bankAccount.trim()
  }
  saving.value = true
  try {
    if (editingId.value) {
      await db.customers.update(editingId.value, payload)
      showToast('已更新客户')
    } else {
      await salesStore.createCustomer(payload)
      showToast('已新增客户')
    }
    showForm.value = false
    await reload()
  } finally {
    saving.value = false
  }
}

onMounted(reload)
</script>

<style scoped>
.toolbar { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.tb-search { flex: 1 1 320px; min-width: 200px; }
.tb-select, .add-btn {
  height: 40px; border-radius: var(--r-sm); font-size: 14px; cursor: pointer; outline: none;
}
.tb-select { border: 1px solid var(--c-border-strong); padding: 0 14px; background: #fff; color: var(--c-text); }
.add-btn { border: none; padding: 0 18px; background: var(--c-accent, #2563eb); color: #fff; white-space: nowrap; }


.card-list { list-style: none; }
.cust-card { padding: 12px 4px; border-bottom: 1px solid var(--c-border, #e2e8f0); cursor: pointer; }
.cust-card:last-child { border-bottom: none; }
.c-head { display: flex; align-items: center; gap: 8px; }
.c-name { font-weight: 600; color: var(--c-primary, #1a365d); }
.badge.dealer { background: var(--c-accent, #2563eb); color: #fff; font-size: 11px; padding: 1px 8px; border-radius: 10px; }
.c-sub { font-size: 13px; color: var(--c-muted, #64748b); margin-top: 4px; }
.c-login { font-size: 12px; color: var(--c-success, #16a34a); margin-top: 2px; }
.c-inv { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.c-inv-txt { font-size: 12px; color: var(--c-muted, #64748b); }
.ui-badge { font-size: 11px; padding: 1px 8px; border-radius: 10px; white-space: nowrap; }
.ui-badge.ok, .inv-badge.ok { background: #ecfdf5; color: #10b981; }
.ui-badge.warn, .inv-badge.warn { background: #fff7ed; color: #f59e0b; }
.ui-badge.muted, .inv-badge.muted { background: #f1f5f9; color: #94a3b8; }

.sec-label { font-size: 12px; color: var(--c-muted, #64748b); margin: 12px 0 6px; }
.f-area {
  width: 100%; border: 1px solid var(--c-border, #e2e8f0); border-radius: 10px;
  padding: 8px 12px; font-size: 14px; outline: none; background: #fff; color: var(--c-text);
  font-family: inherit; resize: vertical; box-sizing: border-box;
}
.f-area:focus { border-color: var(--c-accent, #2563eb); }

.cust-table { width: 100%; border-collapse: collapse; }
.cust-table th, .cust-table td { padding: 11px 12px; text-align: left; border-bottom: 1px solid var(--c-border, #e2e8f0); font-size: 14px; }
.cust-table th { background: #f1f5f9; color: var(--c-primary, #1a365d); }
.cust-table tbody tr:hover { background: #f8fafc; }
.link-btn { border: none; background: none; color: var(--c-accent, #2563eb); cursor: pointer; font-size: 14px; }

.form-card { display: block; }
.form-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.dealer-grid { grid-template-columns: repeat(2, 1fr); margin-top: 10px; }
.f-input {
  height: 44px; border: 1px solid var(--c-border, #e2e8f0); border-radius: 10px;
  padding: 0 14px; font-size: 14px; outline: none; background: #fff; color: var(--c-text, #1a202c);
}
.dealer-toggle { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; color: var(--c-muted, #64748b); cursor: pointer; }
.form-actions { display: flex; gap: 10px; margin-top: 14px; }
.save { flex: 1; height: 44px; border: none; border-radius: 10px; background: var(--c-accent, #2563eb); color: #fff; cursor: pointer; }
.save:disabled { opacity: 0.7; }
/* 取消按钮：橘红实底白字（全站规范 2026-09-20） */
.cancel { height: 44px; padding: 0 18px; border: 1px solid var(--c-amber, #f97316); border-radius: 10px; background: var(--c-amber, #f97316); color: #fff; font-weight: 600; cursor: pointer; }
.cancel:hover { background: var(--c-amber-hover, #ea580c); border-color: var(--c-amber-hover, #ea580c); }
.empty { text-align: center; color: var(--c-muted, #64748b); padding: 20px; }

@media (max-width: 767px) {
  .form-grid, .dealer-grid { grid-template-columns: 1fr; }
}
</style>
