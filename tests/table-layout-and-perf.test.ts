/**
 * 表格布局与首屏性能的「防回归」测试（V2.0-12）
 *
 * 这一版修了三类问题，都属于「改坏了也不报错、只在真机上看着不对」的类型，
 * 所以专门锁进用例：
 *
 *  1. **CSS 写在 `<style>` 块外面** —— 一开始在 14 个页面里各写了一段
 *     「手机端合计行通栏」，全都写在 `</style>` 之后，等于一行都没生效，
 *     合计行只占表格一半宽、与表头错位。
 *  2. **合计行的 colspan 与表头列数对不上** —— 采购/销售开单页的数量与金额
 *     整体右移一列（数量显示在「进价」列下、金额显示在「赠品」列下）。
 *  3. **表头/表体被拆成两张独立表格** 而 tfoot 没人管 —— 三张表各算各的列宽
 *     （实测 644px / 650px / 303px），合计行直接落单成一条窄条。
 *
 * 另外还锁住首屏的两个性能约定：不被云端设置阻塞挂载、不整包引入 Vant。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')

/** 递归列出所有 .vue（这个目录下的都算项目源码） */
function allVueFiles(dir: string): string[] {
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...allVueFiles(p))
    else if (ent.name.endsWith('.vue')) out.push(p)
  }
  return out
}

/** 取出模板部分（<script> 之前） */
function templateOf(sfc: string): string {
  const i = sfc.indexOf('<script')
  return i === -1 ? sfc : sfc.slice(0, i)
}

/**
 * 把一个 tfoot 的可行列跨度算出来。
 *
 * 合计行会按 v-if / v-else 分岔（有权限看不到价格时列数会少几列），
 * v-if 与 v-else 是互斥的两条路径，必须分别算，不能相加。
 * 返回所有可能路径的跨度，只要有一条等于表头列数就算对得上。
 */
function tfootSpans(tfoot: string): number[] {
  const row = (tfoot.match(/<tr[^>]*>[\s\S]*?<\/tr>/) ?? [tfoot])[0]
  const tds = row.match(/<td[^>]*>/g) ?? []
  let main = 0
  let ifSum = 0
  let elseSum = 0
  for (const tag of tds) {
    const cs = tag.match(/colspan=["'](\d+)["']/)
    const n = cs ? Number(cs[1]) : 1
    if (/v-else/.test(tag)) elseSum += n
    else if (/v-if/.test(tag)) ifSum += n
    else main += n
  }
  const paths = [main + ifSum]
  if (elseSum) paths.push(main + elseSum)
  return paths
}

describe('样式必须写在 <style> 块里', () => {
  it('没有任何 .vue 把 CSS 写在 </style> 之后（那样等于没写）', () => {
    const offenders: string[] = []
    for (const f of allVueFiles(SRC)) {
      const s = readFileSync(f, 'utf-8')
      const i = s.lastIndexOf('</style>')
      if (i >= 0 && s.slice(i + '</style>'.length).trim()) offenders.push(relative(ROOT, f))
    }
    expect(
      offenders,
      '这些文件的 CSS 写在 </style> 外面，浏览器根本收不到 —— 请移进 <style> 块内'
    ).toEqual([])
  })
})

describe('合计行必须与表头列数一致', () => {
  it('每个带 tfoot 的表格，合计行的列跨度都等于表头列数', () => {
    const bad: string[] = []
    for (const f of allVueFiles(SRC)) {
      const tpl = templateOf(readFileSync(f, 'utf-8'))
      const tables = tpl.match(/<table[\s\S]*?<\/table>/g) ?? []
      for (const tb of tables) {
        if (!tb.includes('<tfoot')) continue
        const thCols = (tb.match(/<th\b[^>]*>/g) ?? []).length
        const tf = tb.match(/<tfoot[\s\S]*?<\/tfoot>/)
        if (!tf) continue
        const paths = tfootSpans(tf[0])
        // 有权限/无权限两条渲染路径，至少有一条要能对上
        if (!paths.includes(thCols)) {
          bad.push(`${relative(ROOT, f)}：表头 ${thCols} 列，合计行跨度 ${paths.join(' 或 ')}`)
        }
      }
    }
    expect(
      bad,
      '合计行的 colspan 与表头列数对不上，数量/金额会整体错位一列'
    ).toEqual([])
  })
})

describe('手机端表格：表头/表体/表尾必须同进同出', () => {
  const css = readFileSync(join(SRC, 'styles/theme.css'), 'utf-8')
  const mobile = css.slice(css.indexOf(':where(.app-layout.is-mobile)'))

  it('拆表头表体时，tfoot 也必须一起处理（否则合计行落单成窄条）', () => {
    expect(mobile).toContain('> :where(thead, tbody)')
    expect(
      mobile,
      '只把 thead/tbody 设成 display:table，tfoot 会落单成「匿名表」，宽度只有表格一半'
    ).toContain('> tfoot')
  })

  it('手机端合计行是通栏横条（不再试图对齐会横向滚动的列）', () => {
    expect(mobile).toMatch(/> tfoot > tr[\s\S]{0,200}display: flex/)
  })

  it('表格/表头/表体的 display 仍用 :where() 降权，页面自己的手机端样式能覆盖', () => {
    // 页面（如开单页把明细表改成卡片）必须能压过全局的 display/min-width；
    // 之前用 .app-layout.is-mobile .data-table（权重 0,3,0）把页面样式全盖住了。
    // ⚠️ 有两处例外必须提权，它们都只作用在 **tfoot** 上，与卡片模式无关
    //    （卡片模式既不渲染 tfoot、也不靠滚动容器）：
    //      · overflow-x                                  —— 见下一组用例（V2.0-14）
    //      · tfoot 的 td（内边距/边框/底色/display）    —— 见「合计行通栏」一组（V2.0-16）
    //    只要表格/表头/表体的 display 不跟着提权，卡片模式就不受影响。
    expect(mobile).toContain(':where(.app-layout.is-mobile)')
    const flat = css.replace(/\s+/g, ' ')
    const raised = (flat.match(/\.app-layout\.is-mobile \.data-table[^{}]*\{[^{}]*\}/g) ?? [])
      .filter(rule => !rule.includes('tfoot') && rule.includes('display:'))
    expect(
      raised,
      '表格/表头/表体的 display 一提权就会压过开单页的卡片模式，把明细表拆成「半表格」'
    ).toEqual([])
  })
})

/**
 * 取出 CSS 里某条规则的声明块（选择器需精确匹配 `选择器 {`）。
 *
 * ⚠️ 这里刻意用「字符串完全匹配」而不是正则拼选择器 —— 选择器里有点号、
 * 括号和 :where()，正则很容易写歪，测试本身出错比被测代码出错更隐蔽。
 */
function blockOf(css: string, selector: string): string {
  const i = css.indexOf(`${selector} {`)
  if (i < 0) return ''
  const start = css.indexOf('{', i)
  const end = css.indexOf('}', start)
  return css.slice(start + 1, end)
}

describe('手机端表格必须能横向滚动（右列被裁后就再也滑不出来了）', () => {
  const css = readFileSync(join(SRC, 'styles/theme.css'), 'utf-8')

  it('基础规则确实是 overflow: hidden —— 这正是手机端必须提权的原因', () => {
    // .data-table 的 overflow:hidden 是为 border-radius 裁剪表头背景，
    // 特异性 (0,1,0)；任何被 :where() 降到 0 的移动端规则都压不过它。
    expect(blockOf(css, '.data-table')).toContain('overflow: hidden')
  })

  it('手机端用不降权的规则把 overflow-x 提回 auto', () => {
    const b = blockOf(css, '.app-layout.is-mobile .data-table')
    expect(
      b,
      '手机端 .data-table 必须自己就是横向滚动容器，否则内容被裁在容器宽度里、无法滚动'
    ).toContain('overflow-x: auto')
    expect(b).toContain('-webkit-overflow-scrolling: touch')
  })

  it('提权规则只提 overflow，不碰 display（页面卡片模式仍能覆盖）', () => {
    const hot = blockOf(css, '.app-layout.is-mobile .data-table')
    expect(hot, '连 display 一起提权会压过开单页的卡片模式').not.toContain('display')
    expect(blockOf(css, ':where(.app-layout.is-mobile) :where(.data-table)')).toContain('display: block')
  })

  it('选商品列表只保留一层滚动容器（`.pk-scroll` 交还表格自己滚）', () => {
    const picker = readFileSync(join(SRC, 'components/ProductPicker.vue'), 'utf-8')
    const scoped = picker.slice(picker.indexOf('<style'))
    expect(
      scoped,
      '外层再留 overflow-x:auto 就是双层滚动容器嵌套，手机上手势容易两头都不动'
    ).toMatch(/@media \(max-width: 767px\)[\s\S]{0,200}\.pk-scroll \{ overflow-x: visible; \}/)
  })
})

/** 去掉注释，只保留真实代码 —— 否则「反面示例」写在注释里也会被断言误判 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 归一化空白后再取声明块 —— 选择器可能跨行书写（如 `.data-table th,\n.data-table td {`） */
function flatBlockOf(css: string, selector: string): string {
  return blockOf(css.replace(/\s+/g, ' '), selector)
}

/** 去掉 :where(...) 整段（其内部不贡献特异性，这正是「降权」的原理） */
function stripWhere(sel: string): string {
  let s = sel
  for (let guard = 0; guard < 20 && s.includes(':where('); guard++) {
    const i = s.indexOf(':where(')
    let depth = 0
    let j = i + ':where('.length - 1
    for (; j < s.length; j++) {
      if (s[j] === '(') depth++
      else if (s[j] === ')' && --depth === 0) break
    }
    s = s.slice(0, i) + s.slice(j + 1)
  }
  return s
}

/** 选择器特异性 [id, 类/属性/伪类, 元素] */
function spec(sel: string): [number, number, number] {
  const s = stripWhere(sel)
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const attrs = (s.match(/\[[^\]]*\]/g) ?? []).length
  const pseudos = (s.match(/(?<!:):[\w-]+(\([^)]*\))?/g) ?? []).length
  const classes = (s.match(/\.[\w-]+/g) ?? []).length
  const rest = s
    .replace(/#[\w-]+/g, ' ')
    .replace(/\.[\w-]+/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/(?<!:):[\w-]+(\([^)]*\))?/g, ' ')
  const elements = (rest.match(/[\w-]+/g) ?? []).length
  return [ids, classes + attrs + pseudos, elements]
}

/** a 的特异性是否严格高于 b */
function stronger(a: [number, number, number], b: [number, number, number]): boolean {
  if (a[0] !== b[0]) return a[0] > b[0]
  if (a[1] !== b[1]) return a[1] > b[1]
  return a[2] > b[2]
}

/**
 * 手机端合计行通栏（V2.0-16）
 *
 * 这一条与 V2.0-14 的 overflow-x 是**同一个坑的第二次**：
 * 全局那套「合计行通栏」规则被 `:where()` 降权成特异性 0，
 * 而基础规则 `.data-table tfoot td`（(0,1,2)）会给出 padding:12px 14px +
 * border-top:2px 深色线，`.data-table th, .data-table td`（(0,1,1)）再补一条
 * 1px 下边框 —— 于是手机端每个合计格自己画两条横线、再撑出 12px 内边距，
 * 合计行变成「一串横线夹着数字」，行高从 48px 被撑到 75px。
 *
 * 修法：把 td 层那几条从 `:where()` 里提出来提权（只提 td，
 * `> tfoot` 与 `> tfoot > tr` 继续降权，开单页卡片模式的合计行才能覆盖）。
 * 这里把「特异性必须够强」做成可计算的断言，避免下次又被包回 :where()。
 */
describe('手机端合计行通栏：不能降权到压不过基础规则', () => {
  const css = readFileSync(join(SRC, 'styles/theme.css'), 'utf-8')

  it('基础规则确实会给合计格加内边距 + 上下边框 —— 这正是必须提权的原因', () => {
    const base = flatBlockOf(css, '.data-table tfoot td')
    expect(base, '基础规则变了的话，本组用例的前提就不成立了').toContain('padding: 12px 14px')
    expect(base).toContain('border-top: 2px solid')
    expect(flatBlockOf(css, '.data-table th, .data-table td')).toContain('border-bottom: 1px solid')
  })

  it('手机端清掉合计格的内边距/边框/底色，且特异性高于基础规则', () => {
    const sel = '.app-layout.is-mobile .data-table > tfoot > tr > td'
    const body = blockOf(css, sel)
    expect(body, `找不到提权后的合计格规则 ${sel}`).not.toBe('')
    expect(body).toContain('padding: 0')
    expect(body).toContain('border: none')
    expect(body).toContain('background: none')
    expect(
      stronger(spec(sel), spec('.data-table tfoot td')),
      '这条规则一旦被 :where() 包住，padding/border/background 会被基础规则反压，' +
        '合计行又会变成「一串横线夹着数字」（实测行高 48px → 75px）'
    ).toBe(true)
  })

  it('隐藏空占位格 / 备注格的规则同样提权（否则被上面的 display:inline-block 压过）', () => {
    const rowSel = '.app-layout.is-mobile .data-table > tfoot > tr > td'
    for (const [sel, why] of [
      ['.app-layout.is-mobile .data-table > tfoot > tr > td:empty', '空占位格不隐藏会分走 flex 间隙、把金额挤偏'],
      ['.app-layout.is-mobile .data-table > tfoot > tr > td.ui-hint', '备注格不隐藏会在手机窄屏上把数字顶出屏幕']
    ] as const) {
      expect(blockOf(css, sel), `${sel} 必须声明 display: none`).toContain('display: none')
      expect(stronger(spec(sel), spec(rowSel)), `${sel} 特异性不够，会被上一条的 display:inline-block 压过：${why}`).toBe(true)
    }
  })

  it('`> tfoot` 与 `> tfoot > tr` 仍保持 :where() 降权，开单页卡片合计行才能覆盖', () => {
    expect(css).toContain(':where(.app-layout.is-mobile) :where(.data-table) > tfoot > tr {')
    expect(
      css,
      'tr 一起提权会把开单页那张「白底 + 浅灰上边框」的卡片合计行洗成蓝底粗线'
    ).not.toContain('.app-layout.is-mobile .data-table > tfoot > tr {')
  })

  it('说明格 / 备注格规则已在全局（原先「说明格不伸缩」「备注格隐藏」只写在「记一笔」页里）', () => {
    expect(css).toContain(':where(.app-layout.is-mobile) :where(.data-table) > tfoot td[colspan]')
    expect(css).toContain('.app-layout.is-mobile .data-table > tfoot > tr > td.ui-hint')
  })
})

describe('合计行通栏只允许一份实现（页面里不许再各写一遍）', () => {
  // 开单页（卡片模式）的合计行走 tr 层、且故意用「白底 + 浅灰上边框」，与本组无关。
  const ALLOW = new Set([
    'views/sales/SalesCreateView.vue',
    'views/purchase/PurchaseCreateView.vue'
  ])

  it('除开单页外，没有任何页面重复声明手机端 tfoot 的布局（display:flex / margin-left:auto）', () => {
    const bad: string[] = []
    for (const f of allVueFiles(SRC)) {
      if (ALLOW.has(relative(SRC, f))) continue
      const code = stripComments(readFileSync(f, 'utf-8'))
      for (const m of code.match(/\.data-table tfoot[^{}]*\{[^{}]*\}/g) ?? []) {
        if (/display:\s*(flex|block)/.test(m) || /margin-left:\s*auto/.test(m)) {
          bad.push(`${relative(ROOT, f)}：${m.replace(/\s+/g, ' ').slice(0, 80)}`)
        }
      }
    }
    expect(
      bad,
      '页面级的 scoped 副本特异性更高（(0,2,3)）会盖住全局规则，而它往往只管 display/width/margin、' +
        '不管 padding/border/background —— 「只改了全局却不生效」就是这么来的。' +
        '通栏规则请只写在 src/styles/theme.css 一处。'
    ).toEqual([])
  })
})

describe('首屏不能被云端设置阻塞', () => {
  const main = stripComments(readFileSync(join(SRC, 'main.ts'), 'utf-8'))

  it('先挂载，再让云同步在后台跑（不再 finally 里才 mount）', () => {
    expect(
      main,
      'loadBrandFromCloud().finally(mount) 会让用户盯着首屏呼吸条等云端往返（新加坡节点 1~3 秒）'
    ).not.toMatch(/loadBrandFromCloud\(\)\s*\.\s*finally/)
    // 挂载必须自己成行、不被 await
    expect(main).toMatch(/^\s*app\.mount\('#app'\)/m)
    expect(main).not.toMatch(/await\s+loadBrandFromCloud/)
    // 云同步仍然要发起（只是不阻塞）
    expect(main).toMatch(/loadBrandFromCloud\(\)/)
  })
})

describe('首屏不整包引入 Vant', () => {
  const main = stripComments(readFileSync(join(SRC, 'main.ts'), 'utf-8'))

  it('不 import 整个 Vant、不 app.use(Vant)、不引全量样式', () => {
    // 全项目只用到 showToast / showConfirmDialog 两个函数，一个 <van-*> 组件都没有；
    // 全量引入会把主包从 ~430KB 撑到 726KB（gzip 236KB）。
    expect(main).not.toMatch(/^\s*import\s+Vant\s+from\s+'vant'/m)
    expect(main).not.toMatch(/^\s*app\.use\(Vant\)/m)
    expect(main).not.toContain('vant/lib/index.css')
  })

  it('按需引入弹层样式（否则 toast / 确认框会没样式）', () => {
    expect(main).toContain('vant/es/toast/style')
    expect(main).toContain('vant/es/dialog/style')
  })

  it('src 里没有任何 <van-*> 组件——真用了就得把 Vant 加回来', () => {
    const used: string[] = []
    for (const f of allVueFiles(SRC)) {
      const s = readFileSync(f, 'utf-8')
      if (/<[Vv]an[A-Z-]/.test(s)) used.push(relative(ROOT, f))
    }
    expect(
      used,
      '这些文件用到了 Vant 组件，但 main.ts 已改成按需引入 —— 需要改用函数式 API 或单独 import 该组件'
    ).toEqual([])
  })
})

describe('商品分类缓存', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    const { db } = await import('../src/db')
    await db.delete()
    await db.open()
  })

  it('同一次会话里第二次取分类不再扫表；失效后会重新扫', async () => {
    const { db } = await import('../src/db')
    const { useProductStore } = await import('../src/stores/product')
    const store = useProductStore()

    await store.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调',
      spec: '', unit: '台', purchasePrice: 1800,
      wholesalePrice: 2100, retailPrice: 2300,
      warnStock: 5, status: 'active', remark: '', extra: {}
    })

    const spy = vi.spyOn(db.products, 'toArray')
    const first = await store.distinctCategories()
    expect(first).toContain('空调')
    const afterFirst = spy.mock.calls.length

    // 第二次：应当直接命中缓存（取分类要扫整张商品表，6281 行在新加坡节点要 1~2 秒）
    const second = await store.distinctCategories()
    expect(second).toEqual(first)
    expect(spy.mock.calls.length, '第二次调用没有走缓存，又扫了一遍商品表').toBe(afterFirst)

    // 清掉缓存后必须重新扫
    store.clearPickerCache()
    await store.distinctCategories()
    expect(spy.mock.calls.length).toBeGreaterThan(afterFirst)
    spy.mockRestore()
  })

  it('选商品与商品档案共用同一份分类缓存', async () => {
    const { db } = await import('../src/db')
    const { useProductStore } = await import('../src/stores/product')
    const store = useProductStore()

    await store.createProduct({
      brand: '美的', model: 'C200', category: '冰箱',
      spec: '', unit: '台', purchasePrice: 900,
      wholesalePrice: 1200, retailPrice: 1400,
      warnStock: 3, status: 'active', remark: '', extra: {}
    })

    const spy = vi.spyOn(db.products, 'toArray')
    await store.pickerCategories()
    const n = spy.mock.calls.length
    await store.distinctCategories()
    expect(spy.mock.calls.length, '两个入口各扫了一遍表').toBe(n)
    spy.mockRestore()
  })

  it('并发同时取分类只扫一次表（首屏两个组件一起要分类）', async () => {
    const { db } = await import('../src/db')
    const { useProductStore } = await import('../src/stores/product')
    const store = useProductStore()
    store.clearPickerCache()

    const spy = vi.spyOn(db.products, 'toArray')
    const [a, b] = await Promise.all([store.distinctCategories(), store.pickerCategories()])
    expect(a).toEqual(b)
    expect(spy.mock.calls.length, '并发没有去重，重复扫了商品表').toBe(1)
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------- 商品表取数瘦身
//
// 商品 6281 条、库存同样 6281 行。凡是「整表全字段拉取」的地方都在背景里多花
// 7 次 Range 请求 + 几百 KB 传输，而这些地方大多只用得到两三个字段。

describe('商品表取数瘦身', () => {
  const STORE = join(SRC, 'stores', 'product.ts')
  const src = readFileSync(STORE, 'utf-8')

  /** 取出某个 async function 的函数体（按缩进匹配的简易实现，够用且不易写错） */
  function bodyOf(fnName: string): string {
    const start = src.indexOf(`async function ${fnName}(`)
    expect(start, `${STORE} 里找不到 ${fnName}`).toBeGreaterThan(-1)
    const rest = src.slice(start)
    const end = rest.indexOf('\n  async function ', 10)
    return end === -1 ? rest : rest.slice(0, end)
  }

  it('低库存统计走窄字段扫描，不再把整张商品表全字段拉下来', () => {
    const body = bodyOf('getLowStockProducts')
    expect(body).toContain('scanNarrow')
    // 字段数必须控制住：多列弱控制为「不超过 8 列」，防止又退化成 select('*')
    const fields = (src.match(/LOW_STOCK_FIELDS\s*=\s*'([^']+)'/)?.[1] ?? '').split(',')
    expect(fields.length).toBeGreaterThan(0)
    expect(fields.length, '低库存只用到几列，别全字段拉').toBeLessThanOrEqual(8)
  })

  it('库存汇总只取 productId / quantity 两列', () => {
    const body = bodyOf('stockMap')
    expect(body).toContain("scanNarrow('productId,quantity')")
  })

  it('商品名映射走窄字段扫描', () => {
    const body = bodyOf('nameMap')
    expect(body).toContain("scanNarrow('id,brand,model')")
  })

  it('窄字段不影响本地（Dexie）语义：低库存与名称映射结果依旧正确', async () => {
    setActivePinia(createPinia())
    const { db } = await import('../src/db')
    await db.delete()
    await db.open()
    const { useProductStore } = await import('../src/stores/product')
    const store = useProductStore()

    await store.createProduct({
      brand: '海尔', model: 'BCD-520', category: '冰箱',
      spec: '', unit: '台', purchasePrice: 2000,
      wholesalePrice: 2400, retailPrice: 2600,
      warnStock: 10, status: 'active', remark: '', extra: {}
    })
    // createProduct 只回 { ok, message }，商品 id 要从表里取
    const [created] = await store.listAll()
    await db.stock.add({ productId: created.id!, quantity: 4, updatedAt: new Date().toISOString() })

    const low = await store.getLowStockProducts()
    expect(low.length).toBe(1)
    expect(low[0].product.id).toBe(created.id)
    expect(low[0].quantity).toBe(4)

    const names = await store.nameMap()
    expect(names[created.id!]).toBe('海尔 BCD-520')
  })
})

describe('库存管理页：重数据按需加载', () => {
  const file = join(SRC, 'views', 'stock', 'StockManageView.vue')
  const code = stripComments(readFileSync(file, 'utf-8'))

  it('默认 Tab（库存作业）不拉整表：由 tab 触发而不是一挂载就拉', () => {
    // 本页默认落在「库存作业」：以前进页面就 Promise.all 拉商品 + 库存两份全表
    // （几千行），只想做个入库也要先等两秒。
    expect(code).not.toMatch(/onMounted\(\s*load/)
    expect(code).toMatch(/watch\(\s*tab/)
    expect(code).toMatch(/loadHeavy/)
  })

  it('加载过一次后不再重复拉（切 Tab 回来是瞬时的）', () => {
    const body = code.slice(code.indexOf('async function loadHeavy'))
    expect(body).toMatch(/if\s*\(\s*heavyLoaded\.value\s*\)\s*return/)
  })
})

describe('老板工作台：毛利不能再走 N+1', () => {
  const dash = readFileSync(join(SRC, 'stores', 'dashboard.ts'), 'utf-8')

  it('不再对每个订单逐条查明细、对每个明细逐个查商品', () => {
    expect(dash).not.toMatch(/for \(const so of saleOrders\)[\s\S]{0,200}saleOrderItems\.where/)
    // 改成：明细一次拉完在内存分组 + bulkGet 一次取回商品
    expect(dash).toMatch(/db\.saleOrderItems\.toArray\(\)/)
    expect(dash).toMatch(/bulkGet\(/)
  })
})
