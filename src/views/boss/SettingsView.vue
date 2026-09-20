<template>
  <div class="settings-page">
    <PageHeader
      title="系统设置"
      sub="公司信息、品牌图标、桌面快捷方式、数据备份与云同步"
      :badge="APP_VERSION"
      badge-tone="muted"
    >
      <template #actions>
        <!-- 一键展开 / 收起：模块多时不必一个个点 -->
        <div class="collapse-bar">
          <button class="ghost-btn sm" type="button" @click="expandAll">全部展开</button>
          <button class="ghost-btn sm" type="button" @click="collapseAll">全部收起</button>
        </div>
      </template>
    </PageHeader>

    <!-- 公司信息 -->
    <CollapseCard v-model="panels.company" title="公司信息">
      <div class="form">
        <input v-model="company.name" class="f-input" placeholder="公司名称" />
        <input v-model="company.address" class="f-input" placeholder="公司地址" />
        <input v-model="company.phone" class="f-input" placeholder="联系电话" />
        <button class="primary-btn full" type="button" @click="saveCompany">保存公司信息</button>
      </div>
    </CollapseCard>

    <!-- 品牌与图标：登录页标志 / 各角色头像 / 网页版快捷图标 -->
    <BrandSettingsPanel v-model:open="panels.brand" />

    <!-- 应用图标与桌面快捷方式：换图标 + 发送到桌面（第十六轮） -->
    <AppIconPanel v-model:open="panels.appicon" />

    <!-- 数据备份与恢复 -->
    <CollapseCard v-model="panels.backup" title="数据备份与恢复">
      <div class="btn-row">
        <button class="primary-btn" type="button" @click="exportBackup">⬇️ 导出备份</button>
        <button class="ghost-btn" type="button" @click="triggerImport">⬆️ 导入恢复</button>
        <input ref="fileInput" type="file" accept="application/json" style="display:none" @change="onImport" />
      </div>
      <p class="tip">备份文件命名：erp-backup-YYYYMMDD.json</p>
    </CollapseCard>

    <!-- 示例数据 -->
    <CollapseCard v-model="panels.demo" title="示例数据">
      <p class="tip block-tip">
        新装系统时数据库为空，各页面会显示「暂无数据」。载入示例数据可一键生成
        商品、供应商、客户、采购单、销售单与出入库记录，便于查看完整业务效果；
        确认开始录入真实数据前，可一键清空。
      </p>
      <div class="btn-row">
        <button class="primary-btn" type="button" :disabled="seeding" @click="loadDemo">
          {{ seeding ? '生成中…' : '✨ 载入示例数据' }}
        </button>
        <button class="danger-btn" type="button" @click="clearData">🗑️ 清空业务数据</button>
      </div>
      <p class="tip" v-if="hasData">
        当前已有 {{ counts.products }} 个商品、{{ counts.purchaseOrders }} 张采购单、{{ counts.saleOrders }} 张销售单
      </p>
      <p class="tip" v-else>当前暂无业务数据</p>
    </CollapseCard>

    <!-- 价格规则：加价比例 -->
    <CollapseCard v-model="panels.price" title="价格规则（加价比例）">
      <p class="tip block-tip">
        只用维护<b>成本价</b>，批发价与零售价由这里统一推算：
        <b>批发价 = 成本 × (1 + 批发加价率)</b>，<b>零售价 = 成本 × (1 + 零售加价率)</b>。
        设定后点「一键应用到全部商品」，全库价格立即按各自成本重算；
        之后新建商品只填成本，两个售价会自动带出来。
      </p>
      <div class="form">
        <label class="f-row">
          <span class="f-label">批发加价率 %</span>
          <input v-model.number="rule.wholesaleRate" class="f-input" type="number" min="0" step="0.5" />
        </label>
        <label class="f-row">
          <span class="f-label">零售加价率 %</span>
          <input v-model.number="rule.retailRate" class="f-input" type="number" min="0" step="0.5" />
        </label>
        <label class="f-row">
          <span class="f-label">计算结果取整</span>
          <select v-model="rule.rounding" class="f-input">
            <option value="yuan">整元（推荐）</option>
            <option value="ten">整十元</option>
            <option value="none">保留两位小数</option>
          </select>
        </label>
        <label class="f-check">
          <input v-model="rule.autoFill" type="checkbox" />
          新建商品时按规则自动填入批发价 / 零售价
        </label>

        <p class="rule-preview">
          试算：成本 ¥{{ sampleCost.toLocaleString() }} →
          批发 <b>¥{{ previewWholesale.toLocaleString() }}</b>，
          零售 <b>¥{{ previewRetail.toLocaleString() }}</b>
        </p>

        <button class="primary-btn full" type="button" @click="saveRule">保存价格规则</button>
        <button class="ghost-btn full" type="button" :disabled="applying" @click="applyRuleToAll">
          {{ applying ? '重算中…' : '⚡ 一键应用到全部商品' }}
        </button>
        <p class="tip">
          一键应用会覆盖全部商品的批发价与零售价（按每件商品自己的成本重新计算），成本价与库存不受影响。
        </p>
      </div>
    </CollapseCard>

    <!-- 打印设置：纸张与表头 -->
    <CollapseCard v-model="panels.print" title="打印设置">
      <p class="tip block-tip">
        单据默认按 <b>A5 横版（A4 纸的一半）</b> 打印，也可切换为 <b>A4 竖版</b>；
        明细超过一页容量自动分页，每页重复表头并标注页码。表头内容在此统一维护。
      </p>
      <div class="form">
        <label class="f-row">
          <span class="f-label">纸张</span>
          <select v-model="print.paper" class="f-input">
            <option v-for="opt in paperOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </label>
        <input v-model="print.companyName" class="f-input" placeholder="公司抬头（打印表头）" />
        <input v-model="print.subtitle" class="f-input" placeholder="副标题，如「送货凭证」（选填）" />
        <input v-model="print.companyAddress" class="f-input" placeholder="公司地址（选填）" />
        <input v-model="print.companyPhone" class="f-input" placeholder="公司电话（选填）" />
        <input v-model="print.footNote" class="f-input" placeholder="页脚文字（选填）" />
        <label class="f-row">
          <span class="f-label">每页行数</span>
          <input v-model.number="print.rowsPerPage" class="f-input" type="number" min="0" placeholder="0 = 按纸张自动" />
        </label>
        <label class="f-check">
          <input v-model="print.showSign" type="checkbox" />
          显示签章栏
        </label>
        <div class="f-cols">
          <span class="f-cols-title">打印字段（勾选后才会出现在单据明细表里）</span>
          <div class="f-cols-list">
            <label v-for="c in print.columns" :key="c.key" class="f-col">
              <input v-model="c.on" type="checkbox" />
              {{ c.label }}
            </label>
          </div>
        </div>
        <p class="tip">字段改名与排序：在单据详情页点「打印 → ⚙ 表头设置」里调整。</p>
        <button class="primary-btn full" type="button" @click="savePrint">保存打印设置</button>
      </div>
    </CollapseCard>

    <!-- 库房管理 -->
    <CollapseCard v-model="panels.warehouse" title="库房管理">
      <p class="tip">
        库房由你自己设定（总仓 / 门店 / 京东仓……）。入库、出库、调拨、盘点都在「库存管理 → 库存作业」里选择库房，
        库存明细会按库房分列显示每个库房的数量。
      </p>
      <button class="ghost-btn full" type="button" @click="router.push('/warehouse?tab=locations')">
        🏬 去管理库房（{{ locationCount }} 个）
      </button>
    </CollapseCard>

    <!-- 操作日志（第十九轮起归纳到系统设置） -->
    <CollapseCard v-model="panels.audit" title="📜 操作日志">
      <p class="tip block-tip">
        全站关键操作留痕（建单、入库、出库、收款、改价、权限变更等），可按动作与关键词检索。
      </p>
      <AuditLogPanel />
    </CollapseCard>

    <!-- 云同步：数据加密后存进 GitHub 仓库，仓库同时用来托管 Pages 页面 -->
    <CollapseCard v-model="panels.sync" title="☁️ 云同步（GitHub）">
      <div class="sync-stat">
        <div class="ss-item">
          <span class="ss-label">数据空间</span>
          <b class="ss-value">{{ dataRows }} 条</b>
        </div>
        <div class="ss-item">
          <span class="ss-label">上次同步</span>
          <b class="ss-value">{{ lastSyncText }}</b>
        </div>
        <div class="ss-item">
          <span class="ss-label">连接状态</span>
          <b class="ss-value" :class="cfgReady ? 'c-ok' : 'c-warn'">{{ cfgReady ? '已配置' : '未配置' }}</b>
        </div>
      </div>

      <div class="btn-row">
        <button class="primary-btn" type="button" :disabled="syncing" @click="upload">
          {{ syncing ? '同步中…' : '☁️ 同步到云端' }}
        </button>
        <button class="ghost-btn" type="button" :disabled="syncing" @click="pull">
          🔄 从云端恢复
        </button>
        <button class="ghost-btn" type="button" @click="showCfg = !showCfg">
          ⚙️ {{ showCfg ? '收起设置' : '同步设置' }}
        </button>
      </div>
      <p class="tip">
        上传＝把本机数据加密后存进仓库；恢复＝用云端快照<b>覆盖</b>本机数据，操作前请确认本机没有未上传的改动。
      </p>

      <div v-if="showCfg" class="cfg">
        <div class="cfg-grid">
          <label class="f">
            <span>GitHub 用户名</span>
            <input v-model="cfg.owner" class="f-input" placeholder="如 zhangsan" autocomplete="off" />
          </label>
          <label class="f">
            <span>仓库名</span>
            <input v-model="cfg.repo" class="f-input" placeholder="如 my-erp" autocomplete="off" />
          </label>
          <label class="f">
            <span>分支</span>
            <input v-model="cfg.branch" class="f-input" placeholder="main" autocomplete="off" />
          </label>
          <label class="f">
            <span>快照路径</span>
            <input v-model="cfg.path" class="f-input" placeholder="data/erp-snapshot.json" autocomplete="off" />
          </label>
          <label class="f">
            <span>Access Token</span>
            <input v-model="cfg.token" class="f-input" type="password" placeholder="ghp_…（需 Contents 读写权限）" autocomplete="off" />
          </label>
          <label class="f">
            <span>同步口令</span>
            <input v-model="cfg.passphrase" class="f-input" type="password" placeholder="至少 6 位，另一台设备恢复时要填同一个" autocomplete="new-password" />
          </label>
        </div>

        <div class="btn-row">
          <button class="primary-btn sm" type="button" @click="saveCfg">保存同步设置</button>
          <button class="ghost-btn sm" type="button" :disabled="testing" @click="testConn">
            {{ testing ? '测试中…' : '测试连接' }}
          </button>
          <button class="ghost-btn sm" type="button" @click="resetCfg">清除本机配置</button>
        </div>

        <p class="tip" v-if="pagesLink">
          页面地址：<a class="lnk" :href="pagesLink" target="_blank" rel="noopener">{{ pagesLink }}</a>
        </p>
        <p class="tip block-tip">
          <b>安全说明：</b>数据先用你的口令做 AES-GCM 加密再上传，仓库里存的只是密文，
          没有口令连你自己也无法还原；口令本身不上传。Token 与口令只保存在本机浏览器里，
          换设备或清理浏览器数据后需要重新填写。
        </p>
      </div>
    </CollapseCard>

    <!-- 退出登录 -->
    <section class="block">
      <button class="danger-btn full" type="button" @click="logout">退出登录</button>
    </section>

    <!-- 版本号：移动端 PageHeader 被整体隐藏，固定在页尾保证任何屏幕都看得到 -->
    <p class="version-footer">
      {{ APP_NAME }} · <b>{{ APP_VERSION }}</b> · 发布 {{ APP_RELEASE_DATE }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import { db } from '../../db'
import { seedDemoData, clearBusinessData } from '../../utils/demoData'
import {
  loadConfig, saveConfig, clearConfig, validateConfig, checkAuth, pagesUrl,
  guessFromLocation, type SyncConfig
} from '../../utils/cloudSync'
import { useSyncStore } from '../../stores/sync'
import { useUserStore } from '../../stores/user'
import {
  getPrintSettings,
  savePrintSettings,
  PAPER_MM,
  type PaperSize,
  type PrintSettings
} from '../../utils/printSettings'
import PageHeader from '../../components/ui/PageHeader.vue'
import CollapseCard from '../../components/ui/CollapseCard.vue'
import BrandSettingsPanel from '../../components/BrandSettingsPanel.vue'
import AppIconPanel from '../../components/AppIconPanel.vue'
import AuditLogPanel from '../../components/AuditLogPanel.vue'
import { APP_VERSION, APP_RELEASE_DATE, APP_NAME } from '../../version'
import {
  getPriceRule, savePriceRule, calcWholesale, calcRetail, type PriceRule
} from '../../utils/priceRule'

const router = useRouter()
const syncStore = useSyncStore()
const userStore = useUserStore()

const company = ref({ name: '', address: '', phone: '' })
const rule = ref<PriceRule>(getPriceRule())
const applying = ref(false)
/** 试算用的样例成本，方便直观看到加价后的价格 */
const sampleCost = ref(2000)

const previewWholesale = computed(() => calcWholesale(sampleCost.value, rule.value))
const previewRetail = computed(() => calcRetail(sampleCost.value, rule.value))

/**
 * 设置页各模块的展开状态（第十三轮）
 * 默认只展开「公司信息」，其余收成一行标题，页面不再被表单撑得很长；
 * 展开状态记在 localStorage，下次进来保持原来的样子。
 */
const PANEL_KEYS = [
  'company', 'brand', 'appicon', 'backup', 'demo', 'price', 'print', 'warehouse', 'audit', 'sync'
] as const
type PanelKey = typeof PANEL_KEYS[number]
const PANEL_STORAGE_KEY = 'erp_settings_panels'

function defaultPanels(): Record<PanelKey, boolean> {
  return {
    company: true, brand: false, appicon: false, backup: false, demo: false,
    price: false, print: false, warehouse: false, audit: false, sync: false
  }
}

function readPanels(): Record<PanelKey, boolean> {
  const base = defaultPanels()
  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as Partial<Record<PanelKey, boolean>>
    for (const k of PANEL_KEYS) {
      if (typeof saved[k] === 'boolean') base[k] = saved[k] as boolean
    }
    return base
  } catch {
    return base
  }
}

const panels = reactive(readPanels())
watch(panels, () => {
  try {
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(panels))
  } catch {
    /* 隐私模式 / 配额满：本次会话内仍然生效，只是不持久化 */
  }
})

function expandAll(): void {
  for (const k of PANEL_KEYS) panels[k] = true
}
function collapseAll(): void {
  for (const k of PANEL_KEYS) panels[k] = false
}

async function saveRule(): Promise<void> {
  const r: PriceRule = {
    wholesaleRate: Number(rule.value.wholesaleRate) || 0,
    retailRate: Number(rule.value.retailRate) || 0,
    rounding: rule.value.rounding,
    autoFill: rule.value.autoFill
  }
  savePriceRule(r)
  rule.value = getPriceRule()
  showToast('价格规则已保存')
}

/** 把规则一次性套到全库所有商品上 */
async function applyRuleToAll(): Promise<void> {
  const total = await db.products.count()
  if (!total) { showToast('库中还没有商品'); return }
  await showConfirmDialog({
    title: '一键应用到全部商品',
    message: `将按各自成本价重算全部 ${total} 个商品的批发价与零售价（成本价不变）。是否继续？`
  })
  applying.value = true
  try {
    const list = await db.products.toArray()
    for (const p of list) {
      await db.products.update(p.id!, {
        wholesalePrice: calcWholesale(p.purchasePrice, rule.value),
        retailPrice: calcRetail(p.purchasePrice, rule.value)
      })
    }
    await saveRule()
    showToast(`已重算 ${list.length} 个商品的价格`)
  } finally {
    applying.value = false
  }
}

const print = ref<PrintSettings>(getPrintSettings())
const paperOptions = (Object.keys(PAPER_MM) as PaperSize[]).map(v => ({
  value: v,
  label: PAPER_MM[v].label
}))
const fileInput = ref<HTMLInputElement | null>(null)
const syncing = ref(false)
const lastSyncAt = ref('')

// ---- 云同步配置 ----
const showCfg = ref(false)
const testing = ref(false)
const dataRows = ref(0)
const cfg = ref<SyncConfig>(loadConfig())
const cfgReady = computed(() => validateConfig(cfg.value).ok)
const pagesLink = computed(() => pagesUrl(cfg.value))
const lastSyncText = computed(() => {
  const raw = lastSyncAt.value
  if (!raw) return '从未同步'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

async function saveCfg(): Promise<void> {
  const v = validateConfig(cfg.value)
  if (!v.ok) { showToast(v.message); return }
  saveConfig({ ...cfg.value })
  showToast('同步设置已保存到本机')
}

async function testConn(): Promise<void> {
  const v = validateConfig(cfg.value)
  if (!v.ok) { showToast(v.message); return }
  testing.value = true
  try {
    const res = await checkAuth({ ...cfg.value })
    showToast(res.message)
  } finally {
    testing.value = false
  }
}

async function resetCfg(): Promise<void> {
  const ok = await showConfirmDialog({
    title: '清除同步配置',
    message: '将删除本机保存的 Token 与口令（不会影响云端已有快照）。确定继续？'
  }).then(() => true).catch(() => false)
  if (!ok) return
  clearConfig()
  cfg.value = loadConfig()
  showToast('已清除本机同步配置')
}
const locationCount = ref(0)
const seeding = ref(false)
const hasData = ref(false)
const counts = ref({ products: 0, purchaseOrders: 0, saleOrders: 0 })

async function refreshCounts(): Promise<void> {
  const [products, purchaseOrders, saleOrders] = await Promise.all([
    db.products.count(),
    db.purchaseOrders.count(),
    db.saleOrders.count()
  ])
  counts.value = { products, purchaseOrders, saleOrders }
  hasData.value = products + purchaseOrders + saleOrders > 0
  locationCount.value = await db.locations.count()
}

onMounted(async () => {
  const saved = localStorage.getItem('erp_company')
  if (saved) company.value = JSON.parse(saved)
  lastSyncAt.value = syncStore.lastSyncAt
  // 没填过配置、而页面正跑在 GitHub Pages 上时，从网址反推用户名与仓库名
  if (!cfg.value.owner) {
    const g = guessFromLocation()
    if (g.owner) cfg.value = { ...cfg.value, ...g }
  }
  await refreshCounts()
  dataRows.value = await syncStore.dataSize()
})

async function loadDemo(): Promise<void> {
  seeding.value = true
  try {
    const res = await seedDemoData()
    showToast(res.message)
    await refreshCounts()
  } finally {
    seeding.value = false
  }
}

async function clearData(): Promise<void> {
  if (!window.confirm('将清空全部商品、库存、采购单、销售单、供应商、客户与流水记录（账号保留），且不可恢复。确定继续？')) return
  const res = await clearBusinessData()
  showToast(res.message)
  await refreshCounts()
}

function saveCompany(): void {
  localStorage.setItem('erp_company', JSON.stringify(company.value))
  showToast('已保存')
}

function savePrint(): void {
  const next: PrintSettings = {
    ...print.value,
    rowsPerPage: Number.isFinite(print.value.rowsPerPage) && print.value.rowsPerPage > 0
      ? Math.floor(print.value.rowsPerPage)
      : 0
  }
  print.value = next
  savePrintSettings(next)
  showToast('打印设置已保存')
}

async function exportBackup(): Promise<void> {
  const data = await syncStore.exportAll()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  a.href = url
  a.download = `erp-backup-${date}.json`
  a.click()
  URL.revokeObjectURL(url)
  showToast('备份已导出')
}

function triggerImport(): void {
  fileInput.value?.click()
}

async function onImport(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    const res = await syncStore.importAll(data)
    if (res.ok) showToast('数据已恢复')
    else showToast(res.message)
  } catch {
    showToast('文件解析失败')
  } finally {
    input.value = ''
  }
}

async function upload(): Promise<void> {
  if (!cfgReady.value) { showToast('请先填写并保存同步设置'); showCfg.value = true; return }
  syncing.value = true
  try {
    const res = await syncStore.uploadToCloud()
    lastSyncAt.value = syncStore.lastSyncAt
    showToast(res.message)
    dataRows.value = await syncStore.dataSize()
  } finally {
    syncing.value = false
  }
}

async function pull(): Promise<void> {
  if (!cfgReady.value) { showToast('请先填写并保存同步设置'); showCfg.value = true; return }
  // 恢复是覆盖式操作，先确认，避免误清本机未上传的数据
  const go = await showConfirmDialog({
    title: '从云端恢复',
    message: '会用云端快照覆盖本机全部数据，本机未上传的改动将丢失。确定继续吗？'
  }).then(() => true).catch(() => false)
  if (!go) return

  syncing.value = true
  try {
    const res = await syncStore.pullFromCloud()
    lastSyncAt.value = syncStore.lastSyncAt
    showToast(res.message)
    await refreshCounts()
    dataRows.value = await syncStore.dataSize()
  } finally {
    syncing.value = false
  }
}

function logout(): void {
  userStore.logout()
  router.push('/login')
}
</script>

<style scoped>
.version-footer {
  margin: 20px 0 8px;
  text-align: center;
  font-size: 12px;
  color: var(--c-muted, #94a3b8);
}
.version-footer b { color: var(--c-accent, #2f6bff); font-weight: 600; }
.settings-page { max-width: 1100px; margin: 0 auto; }
.collapse-bar { display: flex; gap: 8px; }
.collapse-bar .ghost-btn { height: 34px; padding: 0 14px; font-size: 13px; border-radius: var(--r-sm); }
.form { display: flex; flex-direction: column; gap: 10px; }
.f-input { height: 44px; border: 1px solid var(--c-border); border-radius: 10px; padding: 0 14px; font-size: 14px; outline: none; }
.btn-row { display: flex; gap: 12px; flex-wrap: wrap; }
.primary-btn { height: 44px; padding: 0 18px; border: none; border-radius: 10px; background: var(--c-accent); color: #fff; font-size: 14px; cursor: pointer; }
.primary-btn.full { width: 100%; }
.primary-btn:disabled { opacity: 0.7; }
.ghost-btn { height: 44px; padding: 0 18px; border: 1px solid var(--c-border); border-radius: 10px; background: #fff; color: var(--c-primary); font-size: 14px; cursor: pointer; }
.danger-btn { height: 44px; border: none; border-radius: 10px; background: #fff; color: var(--c-danger); border: 1px solid var(--c-danger); font-size: 14px; cursor: pointer; }
.danger-btn.full { width: 100%; }
.rule-preview {
  background: #eef6ff; color: var(--c-primary); font-size: 13px;
  padding: 10px 12px; border-radius: 8px; line-height: 1.7;
}
.rule-preview b { color: var(--c-accent); }
.tip { color: var(--c-muted); font-size: 12px; margin-top: 8px; }
.block-tip { line-height: 1.7; margin-bottom: 12px; }
.f-row { display: flex; align-items: center; gap: 10px; }
.f-label { flex: none; width: 76px; font-size: 13px; color: var(--c-muted); }
.f-row .f-input { flex: 1; min-width: 0; }
.f-check { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--c-muted); }
.f-cols { display: flex; flex-direction: column; gap: 8px; }
.f-cols-title { font-size: 12px; color: var(--c-muted); }
.f-cols-list { display: flex; flex-wrap: wrap; gap: 8px 16px; }
.f-col { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; color: var(--c-text, #1a202c); }

/* ---- 云同步 ---- */
.sync-stat { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.ss-item {
  flex: 1; min-width: 140px; background: #f7f9fc; border-radius: 10px;
  padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;
}
.ss-label { font-size: 12px; color: var(--c-muted); }
.ss-value { font-size: 15px; color: var(--c-primary); }
.ss-value.c-ok { color: #1a8a4a; }
.ss-value.c-warn { color: #d98700; }
.cfg { margin-top: 14px; border-top: 1px dashed var(--c-border); padding-top: 14px; }
.cfg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-bottom: 12px; }
.cfg .f { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--c-muted); }
.cfg .f-input { width: 100%; height: 42px; }
.cfg .btn-row { margin-bottom: 8px; }
.primary-btn.sm, .ghost-btn.sm { height: 38px; padding: 0 14px; font-size: 13px; }
.lnk { color: var(--c-accent); text-decoration: none; word-break: break-all; }
@media (max-width: 600px) {
  .ss-item { min-width: 100%; }
}
</style>
