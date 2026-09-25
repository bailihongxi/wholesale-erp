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
      <h3 class="block-title">客户列表（{{ pager.total.value }}）</h3>

      <LoadingBlock v-if="pager.loading.value" :rows="6" />

      <ul v-else-if="isMobile" class="zebra-list card-list">
        <li v-for="c in pager.paged.value" :key="c.id" class="cust-card" @click="openEdit(c)">
          <div class="c-head">
            <span class="c-name">{{ c.name }}</span>
            <span v-if="c.loginPhone" class="badge dealer">经销商</span>
            <button class="link-btn danger" type="button" @click.stop="remove(c)" style="margin-left:auto; font-size:13px">删除</button>
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
        <li v-if="!pager.total.value" class="empty">
          {{ hasKeyword ? '没有匹配的客户，试试清除搜索' : '暂无客户，点击右上角新增' }}
        </li>
      </ul>

      <table v-else class="data-table cust-table">
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
          <tr v-for="c in pager.paged.value" :key="c.id">
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
            <td>
              <button class="link-btn" type="button" @click="openEdit(c)">编辑</button>
              <button class="link-btn danger" type="button" @click="remove(c)" style="margin-left:8px">删除</button>
            </td>
          </tr>
          <tr v-if="!pager.total.value">
            <td colspan="8" class="empty">
              {{ hasKeyword ? '没有匹配的客户，试试清除搜索' : '暂无客户，点击右上角新增' }}
            </td>
          </tr>
        </tbody>
      </table>

      <TablePager
        v-if="pager.total.value"
        v-model:page="page"
        :page-count="pager.pageCount.value"
        :total="pager.total.value"
        :size="pager.size.value"
        show-jump
      />
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
import TablePager from '../../components/TablePager.vue'
import { useServerPager } from '../../composables/useServerPager'
import { ref, computed } from 'vue'
import { showToast } from 'vant'
import SearchInput from '../../components/SearchInput.vue'
import { useSalesStore } from '../../stores/sales'
import { useResponsive } from '../../composables/useResponsive'
import { db } from '../../db'
import { escapeOr } from '../../db/cloudDb'
import { serverPage } from '../../db/serverPage'
import { hasInvoice, invoiceComplete, invoiceOf, invoiceSummary, emptyInvoice } from '../../utils/invoice'
import type { Customer, InvoiceInfo } from '../../types'
import InvoiceFieldset from '../../components/InvoiceFieldset.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import LoadingBlock from '../../components/ui/LoadingBlock.vue'

const salesStore = useSalesStore()
const { isMobile } = useResponsive()

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

// 服务端分页：只拉当前页 + 总数，不再进页面就 toArray() 全量客户。
// 关键词：名称/联系人/电话/开票抬头/税号 任一命中；类型：经销商（有登录号）/ 普通客户。
const pager = useServerPager<Customer>({
  watch: [keyword, filterType],
  loader: async (pg, size) => {
    const kw = keyword.value.trim()
    const ft = filterType.value
    const fields = ['name', 'contact', 'phone', 'invoiceTitle', 'taxNo']
    let orExpr: string | undefined
    let extraFilter: ((r: Customer) => boolean) | undefined
    if (kw || ft !== 'all') {
      const parts: string[] = []
      if (kw) {
        parts.push(`or(${fields.map(f => `${f}.ilike.*${escapeOr(kw)}*`).join(',')})`)
      }
      if (ft === 'dealer') parts.push('and(loginPhone.not.is.null,loginPhone.neq.)')
      else if (ft === 'wholesale') parts.push('or(loginPhone.is.null,loginPhone.eq.)')
      // .or() 顶层逗号是 OR，两个条件都要满足 -> 用 and(...) 包起来
      orExpr = parts.length > 1 ? `and(${parts.join(',')})` : parts[0]
      const lower = kw.toLowerCase()
      // 本地 / 测试模式没有 orExpr 语义，用同一套条件在行上过滤
      extraFilter = (r) => {
        const row = r as any
        if (kw && !fields.some(f => String(row[f] ?? '').toLowerCase().includes(lower))) return false
        if (ft === 'dealer' && !row.loginPhone) return false
        if (ft === 'wholesale' && !!row.loginPhone) return false
        return true
      }
    }
    return serverPage<Customer>(db.customers, {
      page: pg,
      pageSize: size,
      orExpr,
      extraFilter,
      orderBy: 'name',
      ascending: true,
    })
  },
})
const page = computed({ get: () => pager.page.value, set: v => pager.go(v) })


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

async function remove(c: Customer): Promise<void> {
  const { showConfirmDialog } = await import('vant')
  const { db } = await import('../../db')
  // 检查有没有关联的销售单
  const orderCount = await db.saleOrders.where({ customerId: c.id }).count()
  if (orderCount > 0) {
    showToast(`该客户有 ${orderCount} 张销售单，不能删除`)
    return
  }
  await showConfirmDialog({
    title: '删除客户',
    message: `确定删除客户「${c.name}」？删除后不可恢复。`
  })
  await db.customers.delete(c.id!)
  showToast('已删除')
  pager.reload()
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
    await pager.reload()
  } finally {
    saving.value = false
  }
}

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

/* 表格外观交给全站 .data-table（含斑马纹），这里只留业务排版 */
.cust-table th, .cust-table td { font-size: 14px; }
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
