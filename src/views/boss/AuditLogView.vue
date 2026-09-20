<template>
  <div class="audit-page">
    <PageHeader title="操作日志" sub="全站关键操作留痕，可按动作与关键词检索" />
    <section class="block">
      <AuditLogPanel />
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 操作日志独立页（第十九轮起已归纳进「系统设置」菜单，本页保留以便旧入口 / 收藏夹仍可用）。
 * 列表逻辑与系统设置页内嵌面板共用 AuditLogPanel，行为一致。
 */
import AuditLogPanel from '../../components/AuditLogPanel.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
</script>

<style scoped>
.audit-page { max-width: 1100px; margin: 0 auto; }
</style>
