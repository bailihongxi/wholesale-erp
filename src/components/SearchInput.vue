<template>
  <!--
    统一搜索框：全项目所有「搜索」输入框都必须使用本组件。
    自带清除按钮（×），仅在有输入内容时显示；点击立即清空并触发搜索，
    同时按 Esc 也能清空，提交/回车立即搜索。
  -->
  <div class="search-wrap" :class="{ 'is-round': round }">
    <!-- 有输入内容时放大镜淡出：既让位给文字，也避免与首字重叠 -->
    <span class="search-icon" :class="{ faded: model.length > 0 }" aria-hidden="true">🔍</span>
    <input
      ref="inputEl"
      v-model="model"
      class="search-field"
      type="search"
      autocomplete="off"
      :placeholder="placeholder"
      @input="onInput"
      @keyup.enter="emitSearch"
      @keydown.esc.prevent="clear"
    />
    <button
      v-show="model.length > 0"
      class="clear-btn"
      type="button"
      title="清除"
      aria-label="清除搜索关键词"
      @click="clear"
    >
      ×
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 搜索关键词（v-model 绑定） */
    modelValue: string
    placeholder?: string
    /** 输入防抖毫秒数，0 表示立即触发。默认 300ms */
    debounce?: number
    /** 仅回车 / 清除时触发搜索（V2.2-1.1）。默认 false 保持「边输边搜」；
        大列表（如商品档案 6000+）逐字符搜索会整页跳动，传 true 后输入只更新关键词、
        按回车（手机键盘确认键）或点 × 清除才真正搜索 */
    searchOnEnter?: boolean
    round?: boolean
  }>(),
  {
    placeholder: '搜索',
    debounce: 300,
    searchOnEnter: false,
    round: false
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'search', value: string): void
  (e: 'clear'): void
}>()

const inputEl = ref<HTMLInputElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

const model = ref(props.modelValue)

// 外部变更（如筛选条件重置）时同步回输入框
watch(
  () => props.modelValue,
  v => {
    if (v !== model.value) model.value = v
  }
)

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

function emitSearch(): void {
  clearTimer()
  emit('update:modelValue', model.value)
  emit('search', model.value)
}

function onInput(): void {
  emit('update:modelValue', model.value)
  // 仅回车模式：输入阶段不触发搜索（回车走 emitSearch、清除走 clear）
  if (props.searchOnEnter) return
  clearTimer()
  if (props.debounce <= 0) {
    emit('search', model.value)
    return
  }
  timer = setTimeout(() => emit('search', model.value), props.debounce)
}

/** 清空关键词：立即触发一次空搜索，并把焦点还给输入框 */
function clear(): void {
  clearTimer()
  model.value = ''
  emit('update:modelValue', '')
  emit('search', '')
  emit('clear')
  inputEl.value?.focus()
}
</script>

<style scoped>
.search-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 100%;
}
.search-icon {
  position: absolute;
  left: 12px;
  font-size: 13px;
  opacity: 0.5;
  pointer-events: none;
  transition: opacity .15s ease;
}
/* 输入后放大镜淡出（用户反馈：图标压住输入的文字） */
.search-icon.faded { opacity: 0; }
/* ⚠️ 双类选择器提高特异性：全局 input 基线一旦把类型排除写成 :not() 链，
   特异性会高于单类 scoped 规则，这里 34px 左内边距的意图就会被覆盖 → 放大镜压字。 */
.search-wrap .search-field {
  width: 100%;
  height: 44px;
  /* 左侧留给放大镜、右侧留给清除按钮，避免文字被压住 */
  padding: 0 40px 0 34px;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 10px;
  font-size: 14px;
  outline: none;
  background: #fff;
  color: var(--c-text, #1a202c);
  box-sizing: border-box;
}
.is-round .search-field {
  border-radius: 22px;
}
.search-wrap .search-field:focus {
  border-color: var(--c-accent, #2563eb);
}
/* 去掉浏览器原生搜索清除图标，避免与自定义清除按钮重复 */
.search-field::-webkit-search-cancel-button,
.search-field::-webkit-search-decoration {
  -webkit-appearance: none;
  appearance: none;
}
.clear-btn {
  position: absolute;
  right: 8px;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: #cbd5e1;
  color: #fff;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.clear-btn:hover {
  background: #94a3b8;
}
</style>
