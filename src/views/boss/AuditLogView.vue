<template>
  <div class="audit-page">
    <PageHeader title="操作日志" sub="全站关键操作留痕，可按动作与关键词检索" />
    <div class="toolbar">
      <SearchInput
        v-model="keyword"
        class="tb-search"
        placeholder="搜索操作内容 / 动作"
        :debounce="0"
      />
      <select v-model="actionFilter" class="tb-select">
        <option value="">全部动作</option>
        <option v-for="a in actionOptions" :key="a" :value="a">{{ a }}</option>
      </select>
      <span class="tb-tip">共 {{ list.length }} 条 / 全部 {{ logs.length }}</span>
    </div>

    <section class="block">
      <LoadingBlock v-if="loading" :rows="7" />

      <table v-else-if="!isMobile" class="log-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>动作</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in list" :key="l.id">
            <td class="c-time">{{ fmt(l.createdAt) }}</td>
            <td>{{ operatorName(l.operatorId) }}</td>
            <td><span class="a-badge">{{ l.action }}</span></td>
            <td class="c-detail">{{ l.detail }}</td>
          </tr>
          <tr v-if="!list.length">
            <td colspan="4" class="empty">
              {{ hasFilter ? '没有匹配的日志，试试清除筛选' : '暂无操作日志' }}
            </td>
          </tr>
        </tbody>
      </table>

      <ul v-else class="log-cards">
        <li v-for="l in list" :key="l.id" class="log-card">
          <div class="lc-head">
            <span class="a-badge">{{ l.action }}</span>
            <span class="lc-time">{{ fmt(l.createdAt) }}</span>
          </div>
          <div class="lc-detail">{{ l.detail }}</div>
          <div class="lc-op">操作人：{{ operatorName(l.operatorId) }}</div>
        </li>
        <li v-if="!list.length" class="empty">
          {{ hasFilter ? '没有匹配的日志，试试清除筛选' : '暂无操作日志' }}
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import SearchInput from '../../components/SearchInput.vue'
import { useResponsive } from '../../composables/useResponsive'
import { db } from '../../db'
import { AUDIT_ACTIONS } from '../../utils/audit'
import type { AuditLog, User } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'
import LoadingBlock from '../../components/ui/LoadingBlock.vue'

const { isMobile } = useResponsive()

const logs = ref<AuditLog[]>([])
/** 首次拉数据期间骨架占位，避免先闪一下「暂无操作日志」 */
const loading = ref(true)
const users = ref<User[]>([])
const keyword = ref('')
const actionFilter = ref('')
const actionOptions = Object.values(AUDIT_ACTIONS)

const hasFilter = computed(() => !!keyword.value.trim() || !!actionFilter.value)

const list = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  let data = logs.value
  if (actionFilter.value) data = data.filter(l => l.action === actionFilter.value)
  if (kw) {
    data = data.filter(l =>
      l.action.toLowerCase().includes(kw) || l.detail.toLowerCase().includes(kw)
    )
  }
  // 最新在前
  return [...data].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
})

function operatorName(id: number): string {
  return users.value.find(u => u.id === id)?.name ?? `#${id}`
}

function fmt(s: string): string {
  return s ? s.slice(0, 16).replace('T', ' ') : '-'
}

async function reload(): Promise<void> {
  try {
    logs.value = await db.auditLogs.toArray()
    users.value = await db.users.toArray()
  } finally {
    loading.value = false
  }
}

onMounted(reload)
</script>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.tb-search { flex: 1 1 320px; min-width: 200px; }
.tb-select {
  height: 40px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm);
  padding: 0 14px; font-size: 14px; background: #fff; outline: none; color: var(--c-text);
}
.tb-tip { font-size: 12px; color: var(--c-muted, #64748b); }

.log-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.log-table th, .log-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--c-border, #e2e8f0); }
.log-table th { background: #f1f5f9; color: var(--c-primary, #1a365d); }
.c-time { color: var(--c-muted, #64748b); font-size: 13px; white-space: nowrap; }
.c-detail { color: var(--c-text, #1a202c); }
.a-badge {
  display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 6px;
  background: var(--c-bg, #f1f5f9); color: var(--c-primary, #1a365d);
}
.log-cards { list-style: none; }
.log-card { padding: 12px 4px; border-bottom: 1px solid var(--c-border, #e2e8f0); }
.log-card:last-child { border-bottom: none; }
.lc-head { display: flex; justify-content: space-between; align-items: center; }
.lc-time { font-size: 12px; color: var(--c-muted, #64748b); }
.lc-detail { font-size: 14px; margin-top: 6px; }
.lc-op { font-size: 12px; color: var(--c-muted, #64748b); margin-top: 4px; }
.empty { text-align: center; color: var(--c-muted, #64748b); padding: 20px; }
</style>
