<template>
  <!--
    全站统一分页条。所有商品类列表都必须用它，保证交互一致：
    ← → 翻页、页码窗口、每页条数下拉、直接跳页。
    页面只需要 v-model:page 与 :total 两个必填项。
  -->
  <nav v-if="total > 0 || always" class="pager" aria-label="分页">
    <span class="pager-info">
      共 <b>{{ total }}</b> 条
      <template v-if="pageCount > 1"> · 第 {{ page }} / {{ pageCount }} 页</template>
    </span>

    <label v-if="sizeOptions.length" class="pager-size">
      每页
      <select :value="size" @change="onSize">
        <option v-for="s in sizeOptions" :key="s" :value="s">{{ s }}</option>
      </select>
      条
    </label>

    <div class="pager-btns">
      <button
        class="pager-btn"
        type="button"
        :disabled="page <= 1"
        aria-label="上一页"
        @click="emitPage(page - 1)"
      >‹</button>

      <button
        v-for="p in windowPages"
        :key="p"
        class="pager-btn"
        :class="{ active: p === page }"
        type="button"
        :aria-current="p === page ? 'page' : undefined"
        @click="emitPage(p)"
      >{{ p }}</button>

      <button
        class="pager-btn"
        type="button"
        :disabled="page >= pageCount"
        aria-label="下一页"
        @click="emitPage(page + 1)"
      >›</button>
    </div>

    <span v-if="showJump" class="pager-jump">
      跳至
      <input
        type="number"
        min="1"
        :max="pageCount"
        class="jump-input"
        :value="jumpValue"
        @keyup.enter="onJump"
        @blur="onJump"
      />
      页
    </span>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    page: number
    pageCount: number
    total: number
    size?: number
    /** 可选的每页条数；留空则不显示下拉，遵循调用方指定的粒度 */
    sizeOptions?: number[]
    showJump?: boolean
    /** 无数据时也显示（列表加载中保持布局稳定） */
    always?: boolean
  }>(),
  { size: 20, sizeOptions: () => [], showJump: false, always: false }
)

const emit = defineEmits<{
  (e: 'update:page', v: number): void
  (e: 'update:size', v: number): void
}>()

const jumpValue = ref<number | null>(null)
watch(() => props.page, () => { jumpValue.value = null })

/**
 * 页码窗口：始终显示当前页附近最多 5 个页码，
 * 首末页用「1 … n」的方式补齐，避免 100 页时按钮铺满一行。
 */
const windowPages = computed<number[]>(() => {
  const n = props.pageCount
  const cur = Math.min(Math.max(1, props.page), n)
  const span = 5
  if (n <= span) return Array.from({ length: n }, (_, i) => i + 1)
  let start = Math.max(1, cur - 2)
  let end = Math.min(n, start + span - 1)
  if (end - start < span - 1) start = Math.max(1, end - span + 1)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
})

function emitPage(p: number): void {
  const next = Math.min(Math.max(1, p), Math.max(1, props.pageCount))
  if (next !== props.page) emit('update:page', next)
}

function onJump(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(v) || v < 1) { jumpValue.value = null; return }
  emitPage(Math.floor(v))
  jumpValue.value = null
}

function onSize(e: Event): void {
  const v = Number((e.target as HTMLSelectElement).value)
  if (Number.isFinite(v)) emit('update:size', v)
}
</script>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding: 10px 4px;
  font-size: 13px;
  color: var(--c-muted);
}
.pager-info b { color: var(--c-primary); }
.pager-size { display: inline-flex; align-items: center; gap: 6px; }
.pager-size select {
  height: 30px; border: 1px solid var(--c-border); border-radius: 6px;
  padding: 0 6px; font-size: 13px; background: #fff; color: var(--c-text);
}
.pager-btns { display: inline-flex; gap: 4px; }
.pager-btn {
  min-width: 30px; height: 30px; padding: 0 6px;
  border: 1px solid var(--c-border); border-radius: 6px;
  background: #fff; color: var(--c-text); font-size: 13px; cursor: pointer;
}
.pager-btn:hover:not(:disabled) { border-color: var(--c-accent); color: var(--c-accent); }
.pager-btn.active {
  background: var(--c-accent); border-color: var(--c-accent); color: #fff; font-weight: 600;
}
.pager-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pager-jump { display: inline-flex; align-items: center; gap: 6px; }
.jump-input {
  width: 52px; height: 30px; text-align: center;
  border: 1px solid var(--c-border); border-radius: 6px; font-size: 13px;
}
</style>
