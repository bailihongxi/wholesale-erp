import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * V2.1-1.4 硬性规范（见 docs/页面模块顺序规范.md）：
 * 凡同时有「已选商品明细」与「选择/搜索商品」的页面，
 * **已选明细必须排在商品选择模块之前（页面上方）**，两端同序。
 *
 * 这里用静态扫描锁死，避免以后新增/改动页面又把顺序写反
 * （调拨、盘点两页历史上就是反的，V2.1-1.4 已修正）。
 */
function fileOf(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8')
}

const pages = [
  { name: '采购开单', file: 'src/views/purchase/PurchaseCreateView.vue' },
  { name: '销售开单', file: 'src/views/sales/SalesCreateView.vue' },
  { name: '报价单新建', file: 'src/views/sales/QuotesView.vue' },
  { name: '预采询价新建', file: 'src/views/purchase/PurchaseQuotesView.vue' },
  { name: '库存调拨', file: 'src/views/warehouse/TransferView.vue' },
  { name: '库存盘点', file: 'src/views/warehouse/CountView.vue' }
]

describe('模块顺序：已选明细在上、选择商品在下', () => {
  for (const p of pages) {
    it(`${p.name}：明细模块排在 ProductPicker 之前`, () => {
      const src = fileOf(p.file)
      const pickerAt = src.indexOf('<ProductPicker')
      const detailAt = src.indexOf('明细')
      expect(pickerAt, `${p.name} 未找到 ProductPicker`).toBeGreaterThan(-1)
      expect(detailAt, `${p.name} 未找到明细模块`).toBeGreaterThan(-1)
      // 选择器必须出现在明细之后（即在页面更靠下的位置）
      expect(
        pickerAt,
        `${p.name}：ProductPicker(${pickerAt}) 必须排在「明细」(${detailAt}) 之后`
      ).toBeGreaterThan(detailAt)
    })
  }

  it('空态文案不再写「上方」（选择器已在明细下方）', () => {
    for (const p of ['src/views/warehouse/TransferView.vue', 'src/views/warehouse/CountView.vue']) {
      const src = fileOf(p)
      expect(src, p).not.toContain('请在上方商品列表')
      expect(src, p).toContain('请在下方商品列表')
    }
  })

  it('规范文档存在且写明了硬规定', () => {
    const doc = fileOf('docs/页面模块顺序规范.md')
    expect(doc).toContain('已选明细')
    expect(doc).toContain('必须排在商品选择模块之前')
    expect(doc).toContain('ProductPicker')
    // 6 个页面都要在文档里登记，新增页面时记得补
    for (const p of pages) {
      expect(doc, `文档未登记 ${p.file}`).toContain(p.file.replace('src/views/', ''))
    }
  })
})
