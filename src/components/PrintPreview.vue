<template>
  <!--
    打印预览弹窗：先在页面内按真实纸张比例看清排版与分页，再决定打印。
    - 纸张：A5（A4 的一半，默认）/ A4 / A3，明细超出一页容量自动分页，每页重复表头并带页码
    - 表头：公司抬头 / 副标题 / 地址 / 电话 / 页脚 / 签章栏 可在此编辑并持久化
    - 底部固定「取消」「打印」两个按钮
  -->
  <!-- 阻塞弹窗：点击遮罩不会关闭（预览里可能正在改表头 / 核对明细）；按 ESC 可取消 -->
  <div v-if="visible" class="pp-mask">
    <div class="pp-dialog" role="dialog" aria-modal="true" :aria-label="title">
      <div class="pp-head">
        <span class="pp-title">{{ title }}</span>
        <div class="pp-head-right">
          <label class="pp-field inline">
            <span>纸张</span>
            <select v-model="paper" class="pp-select">
              <option v-for="opt in paperOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <button class="pp-btn-mini" type="button" @click="toggleEdit">
            {{ editing ? '收起表头设置' : '⚙ 表头设置' }}
          </button>
        </div>
      </div>

      <!-- 表头编辑区 -->
      <div v-if="editing" class="pp-editor">
        <div class="pp-edit-grid">
          <label class="pp-field">
            <span>公司抬头</span>
            <input v-model="form.companyName" type="text" placeholder="如：某某家电批发" />
          </label>
          <label class="pp-field">
            <span>副标题</span>
            <input v-model="form.subtitle" type="text" placeholder="如：送货凭证 / 出库单" />
          </label>
          <label class="pp-field">
            <span>公司地址</span>
            <input v-model="form.companyAddress" type="text" placeholder="选填" />
          </label>
          <label class="pp-field">
            <span>公司电话</span>
            <input v-model="form.companyPhone" type="text" placeholder="选填" />
          </label>
          <label class="pp-field wide">
            <span>页脚文字</span>
            <input v-model="form.footNote" type="text" placeholder="选填" />
          </label>
          <label class="pp-field">
            <span>每页行数</span>
            <input v-model.number="form.rowsPerPage" type="number" min="0" placeholder="0 = 按纸张自动" />
          </label>
          <label class="pp-check">
            <input v-model="form.showSign" type="checkbox" />
            显示签章栏
          </label>
        </div>

        <!-- 明细表字段：可勾选、改名、调顺序 -->
        <div class="pp-cols">
          <div class="pp-cols-title">明细表字段（勾选 / 改名 / 调顺序）</div>
          <div v-for="(c, i) in form.columns" :key="c.key" class="pp-col-row">
            <label class="pp-col-on">
              <input v-model="c.on" type="checkbox" />
            </label>
            <input v-model="c.label" class="pp-col-label" type="text" />
            <div class="pp-col-move">
              <button class="pp-btn-mini tiny" type="button" :disabled="i === 0" @click="moveCol(i, -1)">↑</button>
              <button class="pp-btn-mini tiny" type="button" :disabled="i === form.columns.length - 1" @click="moveCol(i, 1)">↓</button>
            </div>
          </div>
        </div>

        <div class="pp-edit-actions">
          <button class="pp-btn-mini" type="button" @click="resetHeader">恢复默认</button>
          <button class="pp-btn-mini primary" type="button" @click="saveHeader">保存表头</button>
        </div>
      </div>

      <div class="pp-body">
        <iframe
          ref="frameEl"
          class="pp-frame"
          :srcdoc="finalHtml"
          :title="title"
        ></iframe>
      </div>

      <div class="pp-foot">
        <label v-if="allowPriceToggle" class="pp-toggle">
          <input v-model="priceOn" type="checkbox" />
          打印含单价
        </label>
        <div class="pp-btns">
          <button class="pp-btn ghost" type="button" @click="onCancel">取消</button>
          <button class="pp-btn primary" type="button" @click="onPrint">🖨 打印</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { printIframe, printHTML } from '../utils/print'
import {
  getPrintSettings,
  savePrintSettings,
  defaultPrintSettings,
  PAPER_MM,
  type PaperSize,
  type PrintSettings
} from '../utils/printSettings'
import { buildOrderPrintHTML, type PrintOrderData } from '../utils/printTemplate'

const props = withDefaults(
  defineProps<{
    /** 是否显示预览弹窗 */
    visible: boolean
    /** 弹窗标题，如「采购单 CG20260919001」 */
    title: string
    /** 完整的单据 HTML（含 <html> 结构）。传了 orderData 时以 orderData 为准 */
    html?: string
    /** 单据原始数据：传了它，纸张/表头改动会实时重排 */
    orderData?: PrintOrderData | null
    /** 是否显示「打印含单价」开关 */
    allowPriceToggle?: boolean
    /** 是否含单价（v-model:showPrice） */
    showPrice?: boolean
  }>(),
  {
    html: '',
    orderData: null,
    allowPriceToggle: true,
    showPrice: true
  }
)

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'print'): void
  (e: 'update:showPrice', value: boolean): void
}>()

const frameEl = ref<HTMLIFrameElement | null>(null)
const priceOn = ref(props.showPrice)
const editing = ref(false)
const settings = ref<PrintSettings>(getPrintSettings())
const form = ref<PrintSettings>({ ...settings.value })

const paperOptions = (Object.keys(PAPER_MM) as PaperSize[]).map(v => ({
  value: v,
  label: PAPER_MM[v].label
}))

const paper = computed({
  get: () => settings.value.paper,
  set: (v: PaperSize) => {
    settings.value.paper = v
    // 每页行数仍为「自动」时随纸张变化；用户手动指定则保留
    if (!form.value.rowsPerPage) settings.value.rowsPerPage = 0
    savePrintSettings(settings.value)
  }
})

/** 传了 orderData 就按当前设置实时生成；否则沿用外部传入的 html */
const finalHtml = computed<string>(() => {
  if (props.orderData) {
    return buildOrderPrintHTML(props.orderData, priceOn.value, settings.value)
  }
  return props.html
})

watch(() => props.showPrice, v => { priceOn.value = v })
watch(priceOn, v => emit('update:showPrice', v))

// 每次打开预览都同步一次最新设置（可能在别处改过）
watch(() => props.visible, v => {
  if (v) {
    settings.value = getPrintSettings()
    form.value = cloneForEdit(settings.value)
    editing.value = false
  }
})

/** 深拷贝一份再编辑，避免未点保存就把设置改掉 */
function cloneForEdit(s: PrintSettings): PrintSettings {
  return { ...s, columns: s.columns.map(c => ({ ...c })) }
}

function toggleEdit(): void {
  editing.value = !editing.value
  if (editing.value) form.value = cloneForEdit(settings.value)
}

/** 字段上移 / 下移（索引交换） */
function moveCol(i: number, delta: number): void {
  const list = form.value.columns
  const j = i + delta
  if (j < 0 || j >= list.length) return
  const tmp = list[i]
  list[i] = list[j]
  list[j] = tmp
}

function saveHeader(): void {
  const next: PrintSettings = {
    ...settings.value,
    companyName: form.value.companyName,
    subtitle: form.value.subtitle,
    companyAddress: form.value.companyAddress,
    companyPhone: form.value.companyPhone,
    footNote: form.value.footNote,
    showSign: form.value.showSign,
    rowsPerPage: Number.isFinite(form.value.rowsPerPage) && form.value.rowsPerPage > 0
      ? Math.floor(form.value.rowsPerPage)
      : 0,
    columns: form.value.columns.map(c => ({
      key: c.key,
      label: String(c.label ?? '').trim() || c.label,
      on: c.on !== false
    }))
  }
  settings.value = next
  savePrintSettings(next)
  editing.value = false
}

function resetHeader(): void {
  const base = defaultPrintSettings()
  // 纸张与每页行数保持当前选择，只重置表头文案与字段
  form.value = {
    ...base,
    paper: settings.value.paper,
    rowsPerPage: settings.value.rowsPerPage
  }
}

function onCancel(): void {
  emit('cancel')
}

// 按 ESC 关闭预览（阻塞弹窗：点遮罩不会关闭，避免误触丢掉正在核对 / 编辑的内容）
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.visible) onCancel()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

function onPrint(): void {
  // 优先打印预览 iframe；浏览器不支持时回退到新窗口打印
  const ok = printIframe(frameEl.value)
  if (!ok) printHTML(finalHtml.value, props.title)
  emit('print')
}
</script>

<style scoped>
.pp-mask {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.pp-dialog {
  width: 100%;
  max-width: 900px;
  height: 100%;
  max-height: 92vh;
  background: #fff;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.35);
}
.pp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--c-border, #e2e8f0);
}
.pp-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-primary, #1a365d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pp-head-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.pp-editor {
  padding: 12px 18px;
  background: var(--c-bg, #f8fafc);
  border-bottom: 1px solid var(--c-border, #e2e8f0);
}
.pp-edit-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}
.pp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--c-muted, #64748b);
}
.pp-field.wide { grid-column: 1 / -1; }
.pp-field.inline {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.pp-field input,
.pp-select {
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 8px;
  font-size: 13px;
  color: var(--c-text, #1a202c);
  background: #fff;
  outline: none;
}
.pp-select { height: 34px; }
.pp-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--c-muted, #64748b);
  align-self: end;
  padding-bottom: 8px;
}
.pp-cols {
  margin-top: 12px;
  border-top: 1px dashed var(--c-border, #e2e8f0);
  padding-top: 10px;
}
.pp-cols-title {
  font-size: 12px;
  color: var(--c-muted, #64748b);
  margin-bottom: 8px;
}
.pp-col-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.pp-col-on { display: inline-flex; align-items: center; flex: none; }
.pp-col-label {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  background: #fff;
}
.pp-col-move { display: flex; gap: 4px; flex: none; }
.pp-btn-mini.tiny { height: 30px; padding: 0 9px; font-size: 13px; }
.pp-btn-mini:disabled { opacity: 0.4; cursor: not-allowed; }

.pp-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
}
.pp-btn-mini {
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 8px;
  background: #fff;
  color: var(--c-muted, #64748b);
  font-size: 13px;
  cursor: pointer;
}
.pp-btn-mini.primary {
  border-color: var(--c-accent, #2563eb);
  background: var(--c-accent, #2563eb);
  color: #fff;
  font-weight: 600;
}

.pp-body {
  flex: 1;
  min-height: 0;
  background: #eef2f7;
  padding: 14px;
  overflow: auto;
}
.pp-frame {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 420px;
  border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 8px;
  background: #fff;
}
.pp-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-top: 1px solid var(--c-border, #e2e8f0);
  background: #fff;
}
.pp-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--c-muted, #64748b);
  cursor: pointer;
}
.pp-btns {
  display: flex;
  gap: 10px;
  margin-left: auto;
}
.pp-btn {
  height: 42px;
  padding: 0 22px;
  border-radius: 10px;
  font-size: 14px;
  cursor: pointer;
}
/* 取消按钮：橘红实底白字（全站规范 2026-09-20） */
.pp-btn.ghost {
  border: 1px solid var(--c-amber, #f97316);
  background: var(--c-amber, #f97316);
  color: #fff;
  font-weight: 600;
}
.pp-btn.ghost:hover {
  border-color: var(--c-amber-hover, #ea580c);
  background: var(--c-amber-hover, #ea580c);
  color: #fff;
}
.pp-btn.primary {
  border: none;
  background: var(--c-accent, #2563eb);
  color: #fff;
  font-weight: 600;
}
.pp-btn.primary:hover {
  filter: brightness(1.05);
}

@media (max-width: 767px) {
  .pp-mask { padding: 0; }
  .pp-dialog { max-height: 100vh; border-radius: 0; }
  .pp-btn { padding: 0 16px; }
  .pp-edit-grid { grid-template-columns: 1fr; }
  .pp-head-right { flex-direction: column; align-items: flex-end; gap: 6px; }
}
</style>
