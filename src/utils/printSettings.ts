/**
 * 打印设置：纸张尺寸 + 可自行编辑的表头 / 页脚。
 *
 * 需求背景：
 * - 单据按「A4 纸的一半」（A5）打印，也支持切换 A4 / A3；
 * - 明细超过一页容量时自动分页，每页重复表头并带页码；
 * - 表头（公司抬头 / 地址 / 电话 / 副标题 / 页脚 / 签章）可由用户自行编辑。
 *
 * 设置持久化在 localStorage，所有单据共用一份。
 */

export type PaperSize = 'A5' | 'A4'

/**
 * 纸张物理尺寸（mm），方向按老板要求固定：
 * - **A5 横版** = A4 的一半（210 × 148），用于日常送货单 / 出库单；
 * - **A4 竖版** = 210 × 297，用于明细较多需要完整归档的单据。
 */
export const PAPER_MM: Record<PaperSize, { w: number; h: number; label: string }> = {
  A5: { w: 210, h: 148, label: 'A5 横版（A4 的一半）' },
  A4: { w: 210, h: 297, label: 'A4 竖版' }
}

/** 每页可容纳的明细行数（默认按纸张推荐，用户可覆盖） */
export const PAPER_ROWS: Record<PaperSize, number> = {
  A5: 6,
  A4: 14
}

/** 明细表可选字段 */
export type ColumnKey = 'no' | 'name' | 'category' | 'model' | 'unit' | 'qty' | 'price' | 'amount'

export interface PrintColumn {
  key: ColumnKey
  /** 列标题，可自行修改 */
  label: string
  /** 是否打印该列 */
  on: boolean
}

/** 默认字段与顺序（数量/单价/金额为数值列，合计行按此对齐） */
export function defaultColumns(): PrintColumn[] {
  return [
    { key: 'no', label: '序号', on: true },
    { key: 'name', label: '商品名称', on: true },
    { key: 'category', label: '类别', on: true },
    { key: 'model', label: '型号', on: true },
    { key: 'unit', label: '单位', on: true },
    { key: 'qty', label: '数量', on: true },
    { key: 'price', label: '单价', on: true },
    { key: 'amount', label: '金额', on: true }
  ]
}

const VALID_KEYS: ColumnKey[] = ['no', 'name', 'category', 'model', 'unit', 'qty', 'price', 'amount']

/** 读取到的字段配置做清洗：只保留合法字段，补齐缺失字段，去掉重复 */
function normalizeColumns(raw: unknown): PrintColumn[] {
  const base = defaultColumns()
  if (!Array.isArray(raw)) return base
  const picked: PrintColumn[] = []
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue
    const key = (c as { key?: unknown }).key as ColumnKey
    if (!VALID_KEYS.includes(key)) continue
    if (picked.some(p => p.key === key)) continue
    picked.push({
      key,
      label: typeof (c as { label?: unknown }).label === 'string' && (c as { label: string }).label.trim()
        ? (c as { label: string }).label.trim()
        : base.find(b => b.key === key)!.label,
      on: (c as { on?: unknown }).on !== false
    })
  }
  // 补齐用户配置里没有的字段（新增字段时自动追加到末尾，默认开启）
  for (const b of base) {
    if (!picked.some(p => p.key === b.key)) picked.push({ ...b })
  }
  return picked
}

export interface PrintSettings {
  /** 纸张尺寸，默认 A5（A4 的一半） */
  paper: PaperSize
  /** 表头公司抬头 */
  companyName: string
  /** 抬头下的副标题，如「送货单 / 出库凭证」说明行 */
  subtitle: string
  /** 公司地址 */
  companyAddress: string
  /** 公司电话 */
  companyPhone: string
  /** 页脚说明文字 */
  footNote: string
  /** 是否显示签章栏 */
  showSign: boolean
  /** 每页明细行数；0 表示按纸张自动 */
  rowsPerPage: number
  /** 明细表字段：可勾选、改名、调顺序 */
  columns: PrintColumn[]
}

const STORAGE_KEY = 'erp_print_settings'

export function defaultPrintSettings(): PrintSettings {
  return {
    paper: 'A5',
    companyName: '',
    subtitle: '',
    companyAddress: '',
    companyPhone: '',
    footNote: '本单据由系统生成，如有疑问请及时与开票方联系。',
    showSign: true,
    rowsPerPage: 0,
    columns: defaultColumns()
  }
}

/** 读取设置；缺省项自动补全，损坏时回退默认值 */
export function getPrintSettings(): PrintSettings {
  const base = defaultPrintSettings()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PrintSettings>
      return {
        paper: parsed.paper === 'A4' || parsed.paper === 'A5' ? parsed.paper : base.paper,
        companyName: typeof parsed.companyName === 'string' ? parsed.companyName : base.companyName,
        subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : base.subtitle,
        companyAddress: typeof parsed.companyAddress === 'string' ? parsed.companyAddress : base.companyAddress,
        companyPhone: typeof parsed.companyPhone === 'string' ? parsed.companyPhone : base.companyPhone,
        footNote: typeof parsed.footNote === 'string' ? parsed.footNote : base.footNote,
        showSign: typeof parsed.showSign === 'boolean' ? parsed.showSign : base.showSign,
        rowsPerPage: Number.isFinite(parsed.rowsPerPage) && (parsed.rowsPerPage as number) > 0
          ? Math.floor(parsed.rowsPerPage as number)
          : base.rowsPerPage,
        columns: normalizeColumns(parsed.columns)
      }
    }
  } catch {
    // localStorage 不可用或内容损坏时走默认值
  }
  return base
}

export function savePrintSettings(s: PrintSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // 忽略写入失败（隐私模式等）
  }
}

/** 计算实际每页行数：用户指定优先，否则按纸张推荐 */
export function resolveRowsPerPage(s: PrintSettings): number {
  return s.rowsPerPage > 0 ? s.rowsPerPage : PAPER_ROWS[s.paper]
}
