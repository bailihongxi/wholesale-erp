/**
 * 云同步的单元测试：
 *  - 加密信封往返一致、错误口令解不开、每次加密结果不同（salt/iv 随机）
 *  - 配置校验与本机持久化
 *  - 整库导出覆盖全部表（含库房 / 调拨 / 盘点 / 退换货），导入后数据一致
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import {
  encryptJSON, decryptJSON, envelopeFingerprint,
  loadConfig, saveConfig, clearConfig, validateConfig,
  pagesUrl, type SyncConfig
} from '../src/utils/cloudSync'
import { useSyncStore } from '../src/stores/sync'
import { useProductStore } from '../src/stores/product'
import { db } from '../src/db'

const FULL: SyncConfig = {
  owner: 'zhangsan', repo: 'my-erp', branch: 'main',
  path: 'data/erp-snapshot.json', token: 'ghp_test', passphrase: 'secret123'
}

describe('云同步：加密信封', () => {
  it('加密后能原样解回来', async () => {
    const data = { version: 2, tables: { products: [{ id: 1, brand: '格力' }] } }
    const env = await encryptJSON(data, 'secret123')
    const back = await decryptJSON(env, 'secret123')
    expect(back).toEqual(data)
  })

  it('口令错误时解不开', async () => {
    const env = await encryptJSON({ a: 1 }, 'secret123')
    await expect(decryptJSON(env, 'wrong-pass')).rejects.toThrow()
  })

  it('同一份数据两次加密结果不同（salt / iv 随机），但内容指纹一致', async () => {
    const data = { a: 1, b: [1, 2, 3] }
    const e1 = await encryptJSON(data, 'secret123')
    const e2 = await encryptJSON(data, 'secret123')
    expect(e1.salt).not.toBe(e2.salt)
    expect(e1.iv).not.toBe(e2.iv)
    expect(envelopeFingerprint(e1)).toBe(envelopeFingerprint(e2))
  })

  it('数据变了指纹就变（用于判断是否真的需要上传）', async () => {
    const e1 = await encryptJSON({ a: 1 }, 'secret123')
    const e2 = await encryptJSON({ a: 2 }, 'secret123')
    expect(envelopeFingerprint(e1)).not.toBe(envelopeFingerprint(e2))
  })

  it('信封带有应用标记，避免误解别的文件', async () => {
    const env = await encryptJSON({ a: 1 }, 'secret123')
    expect(env.app).toBe('wholesale-erp')
    await expect(decryptJSON({ ...env, app: 'other' } as never, 'secret123')).rejects.toThrow('不是本系统的同步快照文件')
  })
})

describe('云同步：配置校验与持久化', () => {
  beforeEach(() => clearConfig())

  it('缺项逐条提示', () => {
    expect(validateConfig({ ...FULL, owner: '' }).message).toContain('用户名')
    expect(validateConfig({ ...FULL, repo: '' }).message).toContain('仓库名')
    expect(validateConfig({ ...FULL, branch: '' }).message).toContain('分支')
    expect(validateConfig({ ...FULL, path: '' }).message).toContain('快照路径')
    expect(validateConfig({ ...FULL, token: '' }).message).toContain('Token')
    expect(validateConfig({ ...FULL, passphrase: '' }).message).toContain('口令')
    expect(validateConfig({ ...FULL, passphrase: '123' }).message).toContain('至少 6 位')
    expect(validateConfig(FULL).ok).toBe(true)
  })

  it('保存到 localStorage 后能读回来，清除后回到空配置', () => {
    saveConfig(FULL)
    const back = loadConfig()
    expect(back.owner).toBe('zhangsan')
    expect(back.passphrase).toBe('secret123')
    clearConfig()
    expect(loadConfig().owner).toBe('')
  })

  it('Pages 地址按 用户名 + 仓库名 拼出', () => {
    expect(pagesUrl(FULL)).toBe('https://zhangsan.github.io/my-erp/')
    expect(pagesUrl({ ...FULL, owner: '' })).toBe('')
  })
})

describe('云同步：整库导出与恢复', () => {
  let syncStore: ReturnType<typeof useSyncStore>
  let productStore: ReturnType<typeof useProductStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    syncStore = useSyncStore()
    productStore = useProductStore()
  })

  it('导出覆盖全部表（库房/调拨/盘点/退换货都包含）', async () => {
    const dump = await syncStore.exportAll()
    const names = Object.keys(dump.tables)
    for (const t of ['locations', 'locationStock', 'transferOrders', 'stocktakes', 'returnOrders', 'products', 'stock']) {
      expect(names, `缺少表 ${t}`).toContain(t)
    }
  })

  it('导出 → 清空 → 导入，数据原样回来', async () => {
    await productStore.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调', spec: '1.5匹', unit: '台',
      purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400, warnStock: 5,
      status: 'active', remark: '', extra: {}
    })
    const dump = await syncStore.exportAll()

    await Promise.all(db.tables.map(t => t.clear()))
    expect(await db.products.count()).toBe(0)

    const res = await syncStore.importAll(dump)
    expect(res.ok).toBe(true)
    expect(await db.products.count()).toBe(1)
    const list = await productStore.search('')
    expect(list[0].brand).toBe('格力')
  })

  it('数据空间统计出总条数', async () => {
    await productStore.createProduct({
      brand: '美的', model: 'M1', category: '空调', spec: '', unit: '台',
      purchasePrice: 1, wholesalePrice: 2, retailPrice: 3, warnStock: 1,
      status: 'active', remark: '', extra: {}
    })
    expect(await syncStore.dataSize()).toBeGreaterThan(0)
  })

  it('没配置就点上传，会提示先填设置而不是静默失败', async () => {
    clearConfig()
    const res = await syncStore.uploadToCloud()
    expect(res.ok).toBe(false)
    expect(res.message).toContain('请填写')
  })
})
