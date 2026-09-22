import {
  getPrintSettings,
  resolveRowsPerPage,
  PAPER_MM,
  type PaperSize,
  type PrintSettings,
  type PrintColumn,
  type ColumnKey
} from './printSettings'

export interface PrintItem {
  productName: string
  /** 品牌（单独列） */
  brand?: string
  /** 产品类别，如 洗衣机 / 冰箱 / 空调 —— 客户据此判断是什么东西 */
  category?: string
  model: string
  unit: string
  quantity: number
  price: number
  subtotal: number
  /** 赠品行（第二十轮）：金额列与单价列打印为「赠品 / —」，不显示金额 */
  isGift?: boolean
}

export interface PrintOrderData {
  orderNo: string
  date: string
  /** 往来单位：采购单为供应商，销售单为客户 */
  partyName: string
  partyContact?: string
  partyPhone?: string
  partyAddress?: string
  /** 往来单位标签：供应商 / 客户 */
  partyLabel: string
  items: PrintItem[]
  totalQuantity: number
  totalAmount: number
  remark?: string
  /** 单据类型：采购单 / 销售单（送货单） */
  title: string
  /** 公司抬头名称，缺省取打印设置里的公司名 */
  companyName?: string
  /** 制单人姓名 */
  operatorName?: string
}

/** 单据类型，决定签章栏名称 */
export type DocKind = 'purchase' | 'sale'

/** 各纸张下的基础字号：纸张越小字越紧凑 */
const PAPER_FONT: Record<PaperSize, { base: string; co: string; title: string }> = {
  A5: { base: '11px', co: '16px', title: '13px' },
  A4: { base: '12.5px', co: '19px', title: '15px' }
}

function buildCss(paper: PaperSize): string {
  const mm = PAPER_MM[paper]
  const f = PAPER_FONT[paper]
  return `
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif;
    color: #1a202c; background: #fff;
  }

  /* 一页 = 一张纸：预览时按真实尺寸呈现，打印时铺满 @page */
  .page {
    width: ${mm.w}mm;
    min-height: ${mm.h}mm;
    margin: 0 auto;
    padding: 7mm 6mm;
    font-size: ${f.base};
    background: #fff;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .hd { text-align: center; padding-bottom: 6px; border-bottom: 2px solid #1a365d; }
  /* 头部一行排布：公司抬头居左、单据标题绝对居中（三列 grid，两侧 1fr 平衡） */
  .hd-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .hd-date { font-size: 11px; font-weight: 400; letter-spacing: 0; color: #475569; margin-left: 8px; }
  .hd-ono { font-size: 12px; justify-self: end; white-space: nowrap; }
  .sign .hd-page { flex: none !important; margin-left: 16px; font-size: 11px; color: #64748b; }
  .pno { margin-top: 6px; text-align: right; font-size: 11px; color: #64748b; }
  .hd-co { font-size: ${f.co}; font-weight: 700; letter-spacing: 2px; color: #1a365d; margin: 0; justify-self: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hd-title { font-size: ${f.title}; font-weight: 600; letter-spacing: 6px; margin: 0; color: #1a365d; justify-self: center; white-space: nowrap; }
  .hd-sub { font-size: ${f.base}; color: #64748b; margin: 2px 0 0; }
  .hd-info { font-size: ${f.base}; color: #64748b; margin: 2px 0 0; }

  .meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 2px 12px;
          margin: 7px 0 6px; color: #475569; }
  .meta span b { color: #1a202c; font-weight: 600; }

  .party { border: 1px solid #cbd5e1; border-radius: 5px; padding: 7px 9px; margin-bottom: 8px; }
  .party-grid { display: flex; flex-wrap: wrap; gap: 4px 18px; }
  .party-grid .f { min-width: 45%; }
  .party-grid .f i { font-style: normal; color: #64748b; margin-right: 4px; }

  table { width: 100%; border-collapse: collapse; }
  thead th {
    background: #eef2f7; color: #1a365d; font-weight: 600;
    border: 1px solid #94a3b8; padding: 5px 6px; text-align: left;
    white-space: nowrap;
  }
  tbody td { border: 1px solid #cbd5e1; padding: 5px 6px; }
  tbody tr { page-break-inside: avoid; break-inside: avoid; }
  .c-no { width: 42px; text-align: center; }
  .c-qty { width: 58px; text-align: right; }
  .c-unit { width: 42px; text-align: center; }
  .c-cat { width: 72px; }
  .c-price, .c-amt { width: 78px; text-align: right; }
  td.num, th.num { text-align: right; }

  tfoot td { border: 1px solid #94a3b8; padding: 6px; font-weight: 700; background: #f8fafc; }
  .total-label { text-align: right; }

  .remark { margin-top: 8px; color: #475569; border-left: 3px solid #cbd5e1; padding-left: 7px; }

  /* 不贴底：内容自上而下紧凑排列，避免表格与签章/页脚之间塌出大片空白 */
  .sign { margin-top: 14px; padding-top: 10px; display: flex; justify-content: space-between;
          color: #475569; }
  .sign .s { flex: 1; }
  .sign .line { display: inline-block; min-width: 90px; border-bottom: 1px solid #94a3b8; }

  .foot { margin-top: 8px; padding-top: 5px; border-top: 1px dashed #cbd5e1; text-align: center;
          color: #94a3b8; font-size: 0.92em; }

  /* 屏幕预览：画出纸张边界与阴影，方便确认分页效果 */
  @media screen {
    body { background: #eef2f7; padding: 14px; }
    .page { border: 1px solid #cbd5e1; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.1); margin-bottom: 14px; }
  }

  @page { size: ${mm.w}mm ${mm.h}mm; margin: 0; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 0; }
    .page { width: ${mm.w}mm; min-height: ${mm.h}mm; margin: 0; border: none; box-shadow: none;
            page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; break-after: auto; }
    thead { display: table-header-group; }
  }
`
}

/** 读取打印设置里的公司名；为空时回退系统设置公司名，再回退通用抬头 */
export function getCompanyName(): string {
  const ps = getPrintSettings()
  if (ps.companyName.trim()) return ps.companyName.trim()
  try {
    const saved = localStorage.getItem('erp_company')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) return parsed.name.trim()
    }
  } catch {
    // localStorage 不可用时忽略，走默认抬头
  }
  return '家电批发'
}

function esc(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

/**
 * 明细分页：首页要给「往来单位」留位置，末页要给「合计 / 大写 / 备注 / 签章」留位置。
 * 保证：每页不超容量、末页不超末页容量、行数守恒（不丢行不重复）。
 */
export function paginateItems(items: PrintItem[], cap: number): PrintItem[][] {
  if (!items.length) return [[]]
  const firstCap = Math.max(3, cap - 4)
  const lastCap = Math.max(3, cap - 5)
  if (items.length <= firstCap) return [items]

  const chunks: PrintItem[][] = []
  let i = 0
  while (i < items.length) {
    const remaining = items.length - i
    const isFirst = chunks.length === 0
    // 剩下的行能塞进末页就一次放完
    if (remaining <= (isFirst ? firstCap : lastCap)) {
      chunks.push(items.slice(i))
      break
    }
    let take: number
    if (isFirst) take = firstCap
    else if (remaining <= cap + lastCap) take = Math.ceil(remaining / 2) // 余两页时均分
    else take = cap
    take = Math.max(1, Math.min(take, remaining - 1))
    chunks.push(items.slice(i, i + take))
    i += take
  }
  return chunks
}

/** 数值列：合计行依据它们对齐 */
const NUMERIC_KEYS: ColumnKey[] = ['qty', 'price', 'amount']

const COL_CLASS: Record<ColumnKey, string> = {
  no: 'c-no',
  name: '',
  category: 'c-cat',
  model: '',
  unit: 'c-unit',
  qty: 'num c-qty',
  price: 'num c-price',
  amount: 'num c-amt'
}

/**
 * 实际参与打印的列：
 * - 只保留用户勾选的列；
 * - 不打单价时自动剔除「单价 / 金额」两列（给客户、供应商的版本不含价格）。
 */
export function visibleColumns(settings: PrintSettings, showPrice: boolean): PrintColumn[] {
  return settings.columns.filter(c => c.on && (showPrice || (c.key !== 'price' && c.key !== 'amount')))
}

function headHtml(cols: PrintColumn[]): string {
  return cols
    .map(c => `<th class="${COL_CLASS[c.key]}">${esc(c.label)}</th>`)
    .join('')
}

function rowHtml(cols: PrintColumn[], item: PrintItem, no: number): string {
  const cells = cols.map(c => {
    switch (c.key) {
      case 'no': return `<td class="${COL_CLASS.no}">${no}</td>`
      case 'name': return `<td>${esc(item.brand || item.productName)}</td>`
      case 'category': return `<td class="${COL_CLASS.category}">${esc(item.category)}</td>`
      case 'model': return `<td>${esc(item.model)}</td>`
      case 'unit': return `<td class="${COL_CLASS.unit}">${esc(item.unit)}</td>`
      case 'qty': return `<td class="${COL_CLASS.qty}">${item.quantity}</td>`
      case 'price': return item.isGift
        ? `<td class="${COL_CLASS.price}">—</td>`
        : `<td class="${COL_CLASS.price}">${money(item.price)}</td>`
      case 'amount': return item.isGift
        ? `<td class="${COL_CLASS.amount}">赠品</td>`
        : `<td class="${COL_CLASS.amount}">${money(item.subtotal)}</td>`
      default: return '<td></td>'
    }
  }).join('')
  return `<tr>${cells}</tr>`
}

/** 合计行：标签列跨到第一个数值列之前，其后依次输出数量 / 单价(空) / 金额 */
function footHtml(cols: PrintColumn[], data: PrintOrderData, showPrice: boolean): string {
  const firstNum = cols.findIndex(c => NUMERIC_KEYS.includes(c.key))
  const labelSpan = firstNum > 0 ? firstNum : cols.length
  const tail = cols.slice(labelSpan)
  if (!tail.length) {
    // 没有任何数值列时，把合计数量写在标签里，保证数量不丢
    return `<tfoot><tr><td colspan="${Math.max(1, labelSpan)}" class="total-label">合计（数量 ${data.totalQuantity}${showPrice ? `　金额 ¥${money(data.totalAmount)}` : ''}）</td></tr></tfoot>`
  }
  const cells = tail.map(c => {
    if (c.key === 'qty') return `<td class="${COL_CLASS.qty}">${data.totalQuantity}</td>`
    if (c.key === 'price') return `<td class="${COL_CLASS.price}"></td>`
    if (c.key === 'amount') return `<td class="${COL_CLASS.amount}">¥${money(data.totalAmount)}</td>`
    return '<td></td>'
  }).join('')
  return `<tfoot><tr><td colspan="${labelSpan}" class="total-label">合计</td>${cells}</tr></tfoot>`
}

function buildPageHtml(
  data: PrintOrderData,
  pageItems: PrintItem[],
  opt: {
    showPrice: boolean
    pageNo: number
    pageCount: number
    startNo: number
    isFirst: boolean
    isLast: boolean
    settings: PrintSettings
  }
): string {
  const { showPrice, pageNo, pageCount, startNo, isFirst, isLast, settings } = opt
  const cols = visibleColumns(settings, showPrice)
  const colCount = Math.max(1, cols.length)

  const rows = pageItems.length
    ? pageItems.map((it, i) => rowHtml(cols, it, startNo + i)).join('')
    : `<tr><td colspan="${colCount}" style="text-align:center;color:#94a3b8;padding:14px;">无明细</td></tr>`

  // 合计行：数量与金额直接落在表格底部（不再另起「合计方框」，避免重复）
  const foot = isLast ? footHtml(cols, data, showPrice) : ''

  const remark = isLast && data.remark
    ? `<div class="remark">备注：${esc(data.remark)}</div>`
    : ''

  const signNames = data.partyLabel === '供应商'
    ? ['制单人', '采购主管', '供应商确认']
    : ['制单人', '仓库发货', '客户签收']
  const signRow = isLast && settings.showSign
    ? `<div class="sign">${signNames.map(n => `<span class="s">${n}：<span class="line"></span></span>`).join('')}</div>`
    : ''

  // 页码每页都要有：原先它挂在末页的签章行里，导致多页单据的前几页
  // 翻出来不知道是第几页，装订时极易串行。这里独立成一行的页脚。
  const pageTag = `<div class="pno">第 ${pageNo} / ${pageCount} 页</div>`

  const party = isFirst
    ? `<div class="party"><div class="party-grid">
         <span class="f"><i>${esc(data.partyLabel)}</i>${esc(data.partyName) || '—'}</span>
         ${data.partyContact ? `<span class="f"><i>联系人</i>${esc(data.partyContact)}</span>` : ''}
         ${data.partyPhone ? `<span class="f"><i>电话</i>${esc(data.partyPhone)}</span>` : ''}
         ${data.partyAddress ? `<span class="f"><i>地址</i>${esc(data.partyAddress)}</span>` : ''}
       </div></div>`
    : ''

  const hdInfo = [settings.companyAddress, settings.companyPhone]
    .filter(Boolean)
    .map(esc)
    .join('　')

  return `<section class="page">
    <div class="hd">
      <div class="hd-row">
        <span class="hd-co">${esc(settings.companyName.trim() || data.companyName || getCompanyName())} <span class="hd-date">${esc(data.date)}</span></span>
        <span class="hd-title">${esc(data.title)}</span>
        <span class="hd-ono">单号：<b>${esc(data.orderNo)}</b></span>
      </div>
      ${settings.subtitle ? `<p class="hd-sub">${esc(settings.subtitle)}</p>` : ''}
      ${hdInfo ? `<p class="hd-info">${hdInfo}</p>` : ''}
    </div>

    <div class="meta">
      ${data.operatorName ? `<span>制单：<b>${esc(data.operatorName)}</b></span>` : ''}
    </div>

    ${party}

    <table>
      <thead><tr>${headHtml(cols)}</tr></thead>
      <tbody>${rows}</tbody>
      ${foot}
    </table>

    ${remark}
    ${signRow}

    <div class="foot">${esc(settings.footNote)}</div>
    ${pageTag}
  </section>`
}

/** 生成完整打印文档（含分页、纸张尺寸、可编辑表头） */
export function buildOrderPrintHTML(
  data: PrintOrderData,
  showPrice: boolean,
  settings: PrintSettings = getPrintSettings()
): string {
  const cap = resolveRowsPerPage(settings)
  const chunks = paginateItems(data.items, cap)
  const pageCount = chunks.length

  let startNo = 1
  const pages = chunks.map((pageItems, i) => {
    const html = buildPageHtml(data, pageItems, {
      showPrice,
      pageNo: i + 1,
      pageCount,
      startNo,
      isFirst: i === 0,
      isLast: i === pageCount - 1,
      settings
    })
    startNo += pageItems.length
    return html
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)} ${esc(data.orderNo)}</title>
<style>${buildCss(settings.paper)}</style>
</head>
<body>
${pages}
</body>
</html>`
}

export function buildPurchaseOrderHTML(
  data: PrintOrderData,
  showPrice: boolean,
  settings?: PrintSettings
): string {
  return buildOrderPrintHTML(
    { ...data, partyLabel: data.partyLabel || '供应商', title: data.title || '采购单' },
    showPrice,
    settings
  )
}

export function buildSaleOrderHTML(
  data: PrintOrderData,
  showPrice: boolean,
  settings?: PrintSettings
): string {
  return buildOrderPrintHTML(
    { ...data, partyLabel: data.partyLabel || '客户', title: data.title || '销售单（送货单）' },
    showPrice,
    settings
  )
}
