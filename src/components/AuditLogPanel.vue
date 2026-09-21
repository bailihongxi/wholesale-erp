<template>
  <div class="audit-panel">
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
      <span class="tb-tip">共 {{ pager.total.value }} 条</span>
    </div>

    <LoadingBlock v-if="pager.loading.value" :rows="7" />

    <table v-else-if="!isMobile" class="data-table log-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>操作人</th>
          <th>动作</th>
          <th>详情</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in pager.paged.value" :key="l.id">
          <td class="c-time">{{ fmt(l.createdAt) }}</td>
          <td>{{ operatorName(l.operatorId) }}</td>
          <td><span class="a-badge">{{ l.action }}</span></td>
          <td class="c-detail">{{ l.detail }}</td>
        </tr>
        <tr v-if="!pager.total.value">
          <td colspan="4" class="empty">
            {{ hasFilter ? '没有匹配的日志，试试清除筛选' : '暂无操作日志' }}
          </td>
        </tr>
      </tbody>
    </table>

    <ul v-else class="zebra-list log-cards">
      <li v-for="l in pager.paged.value" :key="l.id" class="log-card">
        <div class="lc-head">
          <span class="a-badge">{{ l.action }}</span>
          <span class="lc-time">{{ fmt(l.createdAt) }}</span>
        </div>
        <div class="lc-detail">{{ l.detail }}</div>
        <div class="lc-op">操作人：{{ operatorName(l.operatorId) }}</div>
      </li>
      <li v-if="!pager.total.value" class="empty">
        {{ hasFilter ? '没有匹配的日志，试试清除筛选' : '暂无操作日志' }}
      </li>
    </ul>

    <TablePager
      v-if="pager.total.value"
      v-model:page="page"
      :page-count="pager.pageCount.value"
      :total="pager.total.value"
      :size="pager.size.value"
      show-jump
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 操作日志面板（可复用）。
 * 独立页 AuditLogView 与系统设置页的「操作日志」折叠卡片共用同一份列表逻辑，
 * 保证搜索 / 筛选 / 分页行为完全一致。
 */
import { ref, computed, onMounted } from 'vue'
import { useServerPager } from '../composables/useServerPager'
import { serverPage } from '../db/serverPage'
import TablePager from './TablePager.vue'
import SearchInput from './SearchInput.vue'
import { useResponsive } from '../composables/useResponsive'
import { db } from '../db'
import { AUDIT_ACTIONS } from '../utils/audit'
import type { AuditLog, User } from '../types'
import LoadingBlock from './ui/LoadingBlock.vue'

const { isMobile } = useResponsive()

const users = ref<User[]>([])
const keyword = ref('')
const actionFilter = ref('')
const actionOptions = Object.values(AUDIT_ACTIONS)

const hasFilter = computed(() => !!keyword.value.trim() || !!actionFilter.value)

// 服务端分页：只拉当前页 + 总数，不再进页面就 toArray() 全量日志。
// 日志表增长最快，全量拉取是首屏卡顿的主要来源之一。
const pager = useServerPager<AuditLog>({
  watch: [keyword, actionFilter],
  loader: (pg, size) =>
    serverPage<AuditLog>(db.auditLogs, {
      page: pg,
      pageSize: size,
      eq: actionFilter.value ? { action: actionFilter.value } : {},
      search: { fields: ['action', 'detail'], keyword: keyword.value },
      orderBy: 'createdAt',
      ascending: false,
    }),
})
const page = computed({ get: () => pager.page.value, set: v => pager.go(v) })


function operatorName(id: number): string {
  return users.value.find(u => u.id === id)?.name ?? `#${id}`
}

function fmt(s: string): string {
  return s ? s.slice(0, 16).replace('T', ' ') : '-'
}

// 操作员名字仍需一次性取回（用户表小且长期缓存）；日志本体已走服务端分页
onMounted(async () => {
  try {
    users.value = await db.users.toArray()
  } catch {
    /* 库未就绪时保持空表，不让骨架卡住 */
  }
})
</script>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.tb-search { flex: 1 1 320px; min-width: 200px; }
.tb-select {
  height: 40px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm);
  padding: 0 14px; font-size: 14px; background: #fff; outline: none; color: var(--c-text);
}
.tb-tip { font-size: 12px; color: var(--c-muted, #64748b); }

/* 表格外观交给全站 .data-table（含斑马纹与圆角），这里只留字号 */
.log-table { font-size: 14px; }
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
