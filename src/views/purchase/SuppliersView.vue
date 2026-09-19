<template>
  <div class="page">
    <PageHeader title="供应商管理" sub="供应商资料与结算方式" />
    <div class="toolbar">
      <h3 class="ct">供应商</h3>
      <button class="add-btn" type="button" @click="openNew">＋ 新增</button>
    </div>

    <ul class="list">
      <li v-for="s in suppliers" :key="s.id" class="item" @click="openEdit(s)">
        <div class="i-name">{{ s.name }}</div>
        <div class="i-sub">{{ s.contact }} · {{ s.phone }} · {{ s.paymentTerm }}</div>
      </li>
      <li v-if="!suppliers.length" class="empty">暂无供应商，点击右上角新增</li>
    </ul>

    <div v-if="showForm" class="form-card">
      <h4>{{ editingId ? '编辑供应商' : '新增供应商' }}</h4>
      <input v-model="form.name" class="f-input" placeholder="名称 *" />
      <input v-model="form.contact" class="f-input" placeholder="联系人" />
      <input v-model="form.phone" class="f-input" placeholder="电话" />
      <input v-model="form.address" class="f-input" placeholder="地址" />
      <input v-model="form.paymentTerm" class="f-input" placeholder="账期（如：月结30天）" />
      <div class="form-actions">
        <button class="save" type="button" @click="save">保存</button>
        <button class="cancel" type="button" @click="showForm = false">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { showToast } from 'vant'
import { usePurchaseStore } from '../../stores/purchase'
import { db } from '../../db'
import type { Supplier } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'

const purchaseStore = usePurchaseStore()
const suppliers = ref<Supplier[]>([])
const showForm = ref(false)
const editingId = ref<number | null>(null)
const form = ref({ name: '', contact: '', phone: '', address: '', paymentTerm: '' })

async function reload(): Promise<void> {
  suppliers.value = await purchaseStore.listSuppliers()
}

function openNew(): void {
  editingId.value = null
  form.value = { name: '', contact: '', phone: '', address: '', paymentTerm: '' }
  showForm.value = true
}
function openEdit(s: Supplier): void {
  editingId.value = s.id ?? null
  form.value = {
    name: s.name, contact: s.contact, phone: s.phone,
    address: s.address, paymentTerm: s.paymentTerm
  }
  showForm.value = true
}

async function save(): Promise<void> {
  if (!form.value.name) {
    showToast('请填写名称')
    return
  }
  if (editingId.value) {
    await db.suppliers.update(editingId.value, { ...form.value })
    showToast('已更新')
  } else {
    await purchaseStore.createSupplier({ ...form.value, remark: '' })
    showToast('已添加')
  }
  showForm.value = false
  await reload()
}

onMounted(reload)
</script>

<style scoped>
.page { max-width: 720px; margin: 0 auto; }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.ct { font-size: 16px; color: var(--c-primary); }
.add-btn { height: 40px; padding: 0 16px; border: none; border-radius: 10px; background: var(--c-accent); color: #fff; cursor: pointer; }
.list { list-style: none; }
.item { background: #fff; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; box-shadow: 0 2px 10px rgba(26,54,93,0.06); cursor: pointer; }
.i-name { font-weight: 600; color: var(--c-primary); }
.i-sub { font-size: 13px; color: var(--c-muted); margin-top: 4px; }
.form-card { background: #fff; border-radius: 12px; padding: 16px; margin-top: 14px; box-shadow: 0 2px 10px rgba(26,54,93,0.06); display: flex; flex-direction: column; gap: 10px; }
.form-card h4 { font-size: 15px; color: var(--c-primary); }
.f-input { height: 44px; border: 1px solid var(--c-border); border-radius: 10px; padding: 0 14px; font-size: 14px; outline: none; }
.form-actions { display: flex; gap: 10px; }
.save { flex: 1; height: 44px; border: none; border-radius: 10px; background: var(--c-accent); color: #fff; cursor: pointer; }
.cancel { height: 44px; padding: 0 16px; border: 1px solid var(--c-border); border-radius: 10px; background: #fff; cursor: pointer; }
.empty { color: var(--c-muted); text-align: center; padding: 20px; }
</style>
