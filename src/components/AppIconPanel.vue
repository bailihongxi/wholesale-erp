<template>
  <!--
    应用图标与桌面快捷方式（第十六轮）
    改图标 → 标签页 / 收藏夹 / 桌面快捷方式同步换图；再一键发送到桌面。

    注意：这里只能用 theme.css 里的全局类（ui-btn / ui-toolbar / ui-hint …）。
    SettingsView 里的 .primary-btn / .ghost-btn / .btn-row 是**页面 scoped 样式**，
    在独立组件里不生效（用了会出现「按钮文字挤在一起」）。
  -->
  <CollapseCard v-model="openProxy" title="应用图标与桌面快捷方式">
    <p class="ap-tip">
      这里改的是<b>应用自己那张图</b>：浏览器标签页、收藏夹，以及发送到桌面后的快捷方式图标。
      改完立即生效，不用刷新。图标支持 emoji、1~6 个字，或上传一张图片。
    </p>

    <!-- ===== 预览 ===== -->
    <div class="ap-preview">
      <div class="ap-shot">
        <img v-if="previewUrl" :src="previewUrl" alt="应用图标预览" />
        <div v-else class="ap-shot-fallback">📦</div>
      </div>
      <div class="ap-shot-info">
        <div class="ap-shot-title">当前应用图标</div>
        <div class="ap-shot-sub">{{ sourceLabel }} · 底色 {{ bgLabel }}</div>
        <!-- 模拟浏览器标签页，让用户直观看到实际效果 -->
        <div class="ap-tab">
          <span class="ap-tab-dot">
            <img v-if="tabUrl" :src="tabUrl" alt="" />
          </span>
          <span class="ap-tab-text">{{ appTitle }}</span>
        </div>
      </div>
    </div>

    <!-- ===== 图标来源 ===== -->
    <div class="ap-sub">图标来源</div>
    <div class="ap-row">
      <span class="ap-label">使用</span>
      <SegmentedTabs v-model="sourceTab" :options="sourceOptions" size="sm" />
    </div>

    <template v-if="sourceTab === 'text'">
      <div class="ap-row">
        <span class="ap-label">内容</span>
        <input
          class="ui-input ap-text"
          maxlength="6"
          placeholder="例如 📦 或 批发"
          :value="textValue"
          @input="onText"
          @change="applyCurrent"
        />
      </div>
      <div class="ap-row">
        <span class="ap-label"></span>
        <div class="ap-chips">
          <button
            v-for="e in QUICK_ICONS"
            :key="e"
            class="ap-chip"
            :class="{ on: textValue === e }"
            type="button"
            @click="pickEmoji(e)"
          >
            {{ e }}
          </button>
        </div>
      </div>
    </template>

    <div v-if="sourceTab === 'image'" class="ap-row">
      <span class="ap-label">图片</span>
      <label class="ui-btn ui-btn-sm ap-upload">
        🖼 选择图片
        <input type="file" accept="image/*" @change="uploadIcon" />
      </label>
      <span class="ui-hint">建议正方形，会自动压成 256px 方图。</span>
    </div>

    <div class="ap-row">
      <span class="ap-label">底色</span>
      <div class="ap-swatches">
        <button
          v-for="b in ICON_BG_CHOICES"
          :key="b.key"
          class="ap-swatch"
          :class="{ on: cfg.appIconBg === b.key }"
          :style="swatchStyle(b.key)"
          :title="b.label"
          type="button"
          @click="pickBg(b.key)"
        ></button>
      </div>
    </div>
    <p v-if="sourceTab === 'image'" class="ui-hint ap-note">上传图片时底色不生效 —— 直接用图片本身的画面。</p>

    <div class="ui-toolbar ap-actions">
      <button class="ui-btn ui-btn-primary" type="button" @click="applyCurrent">✅ 应用到系统</button>
      <button class="ui-btn" type="button" @click="resetIcon">↺ 恢复默认图标</button>
    </div>

    <!-- ===== 发送到桌面 ===== -->
    <div class="ap-sub">发送到桌面（安装成独立应用）</div>
    <p class="ap-tip">
      安装后桌面 / 主屏幕会出现一个快捷方式，点开是全屏窗口，用起来和装好的软件一样；
      装过一次以后<b>断网也能打开</b>（界面与已保存的数据都在本机）。
      建议<b>先把上面的图标改好，再发送到桌面</b>，这样快捷方式用的就是新图标。
    </p>

    <div class="ap-install">
      <div class="ap-install-state">
        <span v-if="installed" class="ui-badge success">已安装</span>
        <span v-else-if="installReady" class="ui-badge warning">可一键安装</span>
        <span v-else class="ui-badge muted">需手动添加</span>
        <span class="ap-install-plat">{{ steps.title }}</span>
      </div>

      <div class="ui-toolbar">
        <button
          class="ui-btn ui-btn-primary"
          type="button"
          :disabled="installed || !installReady"
          @click="doInstall"
        >
          {{ installed ? '已经装好了' : installReady ? '📲 一键发送到桌面' : '📲 发送到桌面' }}
        </button>
        <button class="ui-btn" type="button" @click="showSteps = !showSteps">
          {{ showSteps ? '收起手动步骤' : '看手动步骤' }}
        </button>
      </div>

      <ol v-if="showSteps && !installed" class="ap-steps">
        <li v-for="(s, i) in steps.steps" :key="i">{{ s }}</li>
      </ol>
      <p v-if="installed" class="ui-hint ap-note">已经处于独立窗口模式，无需重复安装。</p>
    </div>
  </CollapseCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { showToast } from 'vant'
import CollapseCard from './ui/CollapseCard.vue'
import SegmentedTabs from './ui/SegmentedTabs.vue'
import { useBrand, type AppIconSetting } from '../utils/brand'
import {
  applyAppIcon, renderAppIcon, ICON_BG_CHOICES, ICON_BG_TOP, ICON_BG_BOTTOM
} from '../utils/appIcon'
import { initInstall, installReady, installed, installSteps, promptInstall } from '../utils/installApp'
import { fileToSquareDataUrl } from '../utils/image'

/** 折叠状态由系统设置页统一托管 */
const props = withDefaults(defineProps<{ open?: boolean }>(), { open: true })
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()
const openProxy = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v)
})

const { config, setAppIcon, setAppIconBg, resetAppIcon } = useBrand()
const cfg = config

const QUICK_ICONS = ['📦', '🛒', '🏪', '💼', '🧾', '👑', '🚚', '🏬']
const appTitle = '家电批发进销存 ERP'

/** 当前来源 Tab（string 以便与 SegmentedTabs 对接，用值前再收窄类型） */
const sourceTab = ref<string>(cfg.value.appIcon.type)
const sourceOptions = [
  { value: 'builtin', label: '内置图标' },
  { value: 'text', label: 'Emoji / 文字' },
  { value: 'image', label: '上传图片' }
]

const previewUrl = ref('')
const tabUrl = ref('')
const showSteps = ref(false)

const textValue = computed(() => (cfg.value.appIcon.type === 'text' ? cfg.value.appIcon.value : ''))

const sourceLabel = computed(() => {
  const t = cfg.value.appIcon.type
  if (t === 'builtin') return '内置品牌图标'
  if (t === 'image') return '自定义图片'
  return `文字「${cfg.value.appIcon.value || '空'}」`
})

const bgLabel = computed(
  () => ICON_BG_CHOICES.find(b => b.key === cfg.value.appIconBg)?.label ?? cfg.value.appIconBg
)

/** 平台引导：按当前 UA 给出对应步骤 */
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const steps = computed(() => installSteps(ua))

/** 底色小圆点：渐变用 CSS 渐变，纯色用实色 */
function swatchStyle(key: string): Record<string, string> {
  const bg = key === 'gradient' ? `linear-gradient(180deg, ${ICON_BG_TOP}, ${ICON_BG_BOTTOM})` : key
  return { background: bg }
}

async function refreshPreview(): Promise<void> {
  const big = await renderAppIcon(cfg.value.appIcon, cfg.value.appIconBg, 192)
  const small = await renderAppIcon(cfg.value.appIcon, cfg.value.appIconBg, 32)
  previewUrl.value = big
  tabUrl.value = small
}

/** 真正写到 favicon / apple-touch-icon / manifest 上 */
async function applyCurrent(): Promise<void> {
  const ok = await applyAppIcon(cfg.value.appIcon, cfg.value.appIconBg)
  if (!ok) showToast('当前浏览器不支持改图标，已保持默认')
  await refreshPreview()
}

function save(icon: AppIconSetting): void {
  setAppIcon(icon)
  refreshPreview()
  applyCurrent()
}

function onText(e: Event): void {
  // 输入过程中只更新预览（避免每敲一个字重画 4 张图），失焦时才正式应用
  setAppIcon({ type: 'text', value: (e.target as HTMLInputElement).value })
  refreshPreview()
}

function pickEmoji(e: string): void {
  save({ type: 'text', value: e })
}

function pickBg(key: string): void {
  setAppIconBg(key)
  refreshPreview()
  applyCurrent()
}

/** 切换来源：内置 / 文字立即换图；选「上传图片」等用户挑完文件再换 */
watch(sourceTab, (t) => {
  if (t === cfg.value.appIcon.type) return
  if (t === 'builtin') save({ type: 'builtin', value: '' })
  else if (t === 'text') save({ type: 'text', value: cfg.value.appIcon.value || '📦' })
})

async function uploadIcon(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const url = await fileToSquareDataUrl(file, 256)
    save({ type: 'image', value: url })
    showToast('应用图标已更新')
  } catch {
    showToast('图片读取失败，请换一张')
  } finally {
    input.value = '' // 清空，否则选同一张图不会再次触发 change
  }
}

async function resetIcon(): Promise<void> {
  resetAppIcon()
  sourceTab.value = 'builtin'
  await applyCurrent()
  showToast('已恢复默认图标')
}

async function doInstall(): Promise<void> {
  const r = await promptInstall()
  if (r === 'accepted') showToast('已开始安装，请查看桌面')
  else if (r === 'dismissed') showToast('已取消安装')
  else {
    showSteps.value = true
    showToast('请按下面的步骤手动添加')
  }
}

// 设置项一变，预览跟着变（正式应用由各交互显式触发，避免频繁重画）
watch(
  () => [cfg.value.appIcon.type, cfg.value.appIcon.value, cfg.value.appIconBg].join('|'),
  () => { refreshPreview() }
)

onMounted(() => {
  initInstall()
  refreshPreview()
})
</script>

<style scoped>
/* 说明文字：全局 .ui-hint 字号偏小，这里留出行距让它好读 */
.ap-tip {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.75;
  color: var(--c-muted);
}
.ap-tip b { color: var(--c-primary); }

.ap-preview {
  display: flex; align-items: center; gap: 18px;
  padding: 14px; margin-bottom: 6px;
  background: #f7f9fc; border: 1px solid var(--c-border, #e2e8f0); border-radius: 12px;
}
.ap-shot {
  width: 88px; height: 88px; flex: none;
  border-radius: 20px; overflow: hidden;
  box-shadow: 0 6px 18px rgba(22,50,92,0.18);
  background: #fff;
}
.ap-shot img { width: 100%; height: 100%; display: block; object-fit: cover; }
.ap-shot-fallback {
  display: flex; width: 100%; height: 100%;
  align-items: center; justify-content: center; font-size: 38px;
}
.ap-shot-info { min-width: 0; }
.ap-shot-title { font-size: 14px; font-weight: 700; color: var(--c-primary, #16325c); }
.ap-shot-sub { margin-top: 4px; font-size: 12px; color: var(--c-muted, #64748b); }
.ap-tab {
  display: inline-flex; align-items: center; gap: 8px;
  margin-top: 10px; padding: 5px 14px 5px 8px; max-width: 230px;
  background: #fff; border: 1px solid var(--c-border, #e2e8f0);
  border-radius: 999px 999px 0 0; box-shadow: 0 -2px 8px rgba(22,50,92,0.05);
}
.ap-tab-dot {
  width: 16px; height: 16px; flex: none; border-radius: 4px;
  overflow: hidden; background: #eef2f9;
  display: inline-flex; align-items: center; justify-content: center;
}
.ap-tab-dot img { width: 100%; height: 100%; display: block; object-fit: cover; }
.ap-tab-text {
  font-size: 12px; color: #475569;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.ap-sub {
  display: flex; align-items: center; gap: 8px;
  margin: 18px 0 10px; font-size: 13px; font-weight: 700; color: var(--c-primary, #16325c);
}
.ap-sub::before {
  content: ''; width: 3px; height: 13px; border-radius: 2px; background: var(--c-accent, #2f6bff);
}
.ap-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.ap-label { width: 44px; flex: none; font-size: 13px; color: var(--c-muted, #64748b); }
.ap-text { width: 180px; flex: none; }
.ap-upload input { display: none; }
.ap-note { margin: 0 0 10px; display: block; }
.ap-actions { margin: 4px 0 6px; }
.ap-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.ap-chip {
  width: 34px; height: 34px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--c-border, #e2e8f0); background: #fff; font-size: 17px; line-height: 1;
}
.ap-chip.on { border-color: var(--c-accent, #2f6bff); background: #eef4ff; }
.ap-swatches { display: flex; gap: 8px; flex-wrap: wrap; }
.ap-swatch {
  width: 26px; height: 26px; border-radius: 8px; cursor: pointer;
  border: 2px solid #fff; box-shadow: 0 0 0 1px var(--c-border, #e2e8f0);
}
.ap-swatch.on { box-shadow: 0 0 0 2px var(--c-accent, #2f6bff); }
.ap-install {
  padding: 12px 14px; border-radius: 12px;
  background: #f7f9fc; border: 1px solid var(--c-border, #e2e8f0);
}
.ap-install-state { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.ap-install-plat { font-size: 12px; color: var(--c-muted, #64748b); }
.ap-steps { margin: 10px 0 0; padding-left: 20px; font-size: 13px; line-height: 1.9; color: #475569; }
</style>
