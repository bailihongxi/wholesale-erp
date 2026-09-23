<!--
  商品明细卡片（手机端专用 · 全站可复用模板）

  ⚠️ 全站规则（V2.1-1.3 写死，详见 docs/手机端明细卡片规范.md）：
    · 电脑端（≥768px）：商品明细一律用**列表样式**（表格 .data-table / 行列表），信息密度高、可横向对照；
    · 手机端（<768px）：商品明细一律用**卡片模式**（本组件），一行一件、金额右对齐，绝不横向撑破屏幕。

  用法（页面里按设备分岔，电脑端走原有表格）：

    <section class="block">
      <ItemCards
        v-if="isMobile"
        title="商品明细"
        :items="cardRows"
        :show-price="canSeeAnyPrice"
        :total-qty="totalQty"
        :total-amount="order?.totalAmount ?? 0"
        empty-text="暂无明细"
      />
      <template v-else>
        <h4 class="block-title">商品明细（{{ items.length }}）</h4>
        <table class="data-table">…电脑端列表…</table>
      </template>
    </section>

  设计要点（每一条都是为了「手机端不撑破」）：
    · 名称独占一行 + `overflow-wrap: anywhere` —— 长型号（如 HF-250LW/TS06SJD）也能折行；
    · 「数量 单位 × 单价 =」用一行小字，金额靠 `margin-left:auto` 顶到右侧，**不用固定列宽**；
    · 容器全部 `min-width: 0`，没有 <table>、没有 640px 最小宽度，宽度永远等于屏幕；
    · 合计条虚线分隔，「合计 N 件」在左、红色合计金额在右 —— 手机端没有表格 tfoot，这条就是合计。
-->
<template>
  <div class="ui-items">
    <h4 class="block-title">{{ title }}（{{ items.length }}）</h4>

    <ul class="ui-items-list">
      <li v-for="(it, i) in items" :key="i" class="ui-items-row">
        <div class="ui-items-name">
          <span class="nm">{{ it.name }}</span>
          <span v-if="it.tag" class="ui-items-tag">{{ it.tag }}</span>
        </div>

        <div class="ui-items-calc">
          <span class="ui-items-qty">{{ it.qty }}{{ it.unit ? ' ' + it.unit : '' }}</span>
          <template v-if="showPrice && it.note">
            <span class="ui-items-note">{{ it.note }}</span>
          </template>
          <template v-else-if="showPrice">
            <span class="ui-items-op">×</span>
            <span class="ui-items-price">¥{{ money(it.price) }}</span>
            <span class="ui-items-op">=</span>
            <b class="ui-items-amount">¥{{ money(it.amount ?? (it.qty || 0) * (it.price || 0)) }}</b>
          </template>
        </div>
      </li>

      <li v-if="!items.length" class="ui-items-empty">{{ emptyText }}</li>
    </ul>

    <div v-if="items.length && showTotal" class="ui-items-total">
      <span>合计</span>
      <span class="ui-items-total-qty">{{ shownQty }} {{ qtyUnit }}</span>
      <b v-if="showPrice" class="ui-items-total-amount">¥{{ money(shownAmount) }}</b>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ItemCardRow } from '../../types'

// 行数据类型定义在 src/types/index.ts 的 ItemCardRow（页面也要 import 它做映射）

const props = withDefaults(
  defineProps<{
    /** 明细区标题（后面会自动补「（N）」，与效果图一致） */
    title?: string
    /** 明细行 */
    items: ItemCardRow[]
    /** 是否显示价格（库房 / 经销商等无权看价时传 false，只留数量） */
    showPrice?: boolean
    /** 是否显示合计条 */
    showTotal?: boolean
    /** 合计数量单位 */
    qtyUnit?: string
    /** 合计数量（不传则按明细求和；销售单这类要排除赠品的由页面传入） */
    totalQty?: number
    /** 合计金额（不传则按明细求和；一般传单据的 totalAmount） */
    totalAmount?: number
    /** 空态文案 */
    emptyText?: string
  }>(),
  {
    title: '商品明细',
    showPrice: true,
    showTotal: true,
    qtyUnit: '件',
    emptyText: '暂无明细'
  }
)

/** 千分位 + 两位小数，全站金额格式统一 */
function money(n: number | undefined): string {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const shownQty = computed(() =>
  props.totalQty !== undefined ? props.totalQty : props.items.reduce((s, it) => s + (it.qty || 0), 0)
)

const shownAmount = computed(() =>
  props.totalAmount !== undefined
    ? props.totalAmount
    : props.items.reduce((s, it) => s + Number(it.amount ?? (it.qty || 0) * (it.price || 0)), 0)
)
</script>

<style scoped>
/* 间距 / 圆角 / 配色全部取自设计令牌（theme.css），不与任何页面样式耦合。
   标题直接用全局 .block-title（自带左侧蓝色竖条），与其余卡片标题同源。 */
.ui-items { min-width: 0; }

.ui-items-list {
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 0;
}

/* 行卡片：白底 + 细描边 + 圆角，与效果图一致 */
.ui-items-row {
  min-width: 0;
  padding: 12px 14px;
  margin-bottom: 10px;
  background: var(--c-surface, #fff);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md, 10px);
}
.ui-items-row:last-child { margin-bottom: 0; }
.ui-items-row:hover { border-color: var(--c-accent); }

/* 第一行：商品名（长型号可折行，绝不横向撑破） */
.ui-items-name {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--c-primary);
  line-height: 1.4;
}
.ui-items-name .nm { min-width: 0; overflow-wrap: anywhere; }
.ui-items-tag {
  flex: none;
  font-size: 11px;
  font-weight: 400;
  color: var(--c-accent);
  background: var(--c-accent-soft, #e8f0ff);
  border-radius: 4px;
  padding: 1px 6px;
}

/* 第二行：数量 单位 × 单价 = 金额（金额靠 auto 顶到右侧，不占固定列宽） */
.ui-items-calc {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  min-width: 0;
  font-size: 13px;
  color: var(--c-muted);
}
.ui-items-qty { font-weight: 600; color: var(--c-text, #1e293b); }
.ui-items-price { font-variant-numeric: tabular-nums; }
.ui-items-op { color: var(--c-border-strong); }
.ui-items-note { color: var(--c-accent); }
.ui-items-amount {
  margin-left: auto;
  font-size: 16px;
  font-weight: 700;
  color: var(--c-primary);
  font-variant-numeric: tabular-nums;
}

/* 合计条：手机端没有表格 tfoot，这条就是合计 */
.ui-items-total {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  font-size: 13px;
  color: var(--c-muted);
  border-top: 1px dashed var(--c-border);
}
.ui-items-total-qty { font-weight: 600; color: var(--c-text, #1e293b); }
.ui-items-total-amount {
  margin-left: auto;
  font-size: 18px;
  font-weight: 700;
  color: var(--c-danger);
  font-variant-numeric: tabular-nums;
}

.ui-items-empty {
  padding: 18px;
  text-align: center;
  font-size: 13px;
  color: var(--c-muted);
}

/* 极窄屏（<360px）：把「× 单价 =」这截小字压一档，金额与数量必须留在同一行 */
@media (max-width: 359px) {
  .ui-items-row { padding: 10px 12px; }
  .ui-items-name { font-size: 14px; }
  .ui-items-calc { font-size: 12px; gap: 4px; }
  .ui-items-amount { font-size: 15px; }
  .ui-items-total-amount { font-size: 17px; }
}
</style>
