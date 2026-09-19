import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '../db'
import { loadConfig, pushData, pullData } from '../utils/cloudSync'

interface BackupData {
  version: number
  exportedAt: string
  /** 表名 → 行数组。遍历 db.tables 生成，新增表无需改这里 */
  tables: Record<string, unknown[]>
}

export const useSyncStore = defineStore('sync', () => {
  const lastSyncAt = ref<string>(localStorage.getItem('erp_last_sync_at') || '')
  const isSyncing = ref(false)

  /**
   * 导出全部数据。遍历 db.tables 动态取表名，
   * 之后新增库房/调拨/盘点/退换货等表不用再改这里。
   */
  async function exportAll(): Promise<BackupData> {
    const tables: Record<string, unknown[]> = {}
    for (const t of db.tables) tables[t.name] = await t.toArray()
    return { version: 2, exportedAt: new Date().toISOString(), tables }
  }

  /** 表内数据总量（条数），用于「数据空间」展示 */
  async function dataSize(): Promise<number> {
    let n = 0
    for (const t of db.tables) n += await t.count()
    return n
  }

  // 从 JSON 导入恢复（先清空再写入）
  async function importAll(data: BackupData): Promise<{ ok: boolean; message: string }> {
    if (!data.tables) return { ok: false, message: '备份文件格式错误' }
    // 只恢复当前库里存在的表：老备份缺表、新备份多表都能兼容
    for (const t of db.tables) await t.clear()

    for (const t of db.tables) {
      const rows = data.tables[t.name]
      if (!rows || !rows.length) continue
      // 带主键的行用 bulkPut，避免自增 id 冲突导致整批失败
      await (t as any).bulkPut(rows as any[])
    }

    return { ok: true, message: '恢复成功' }
  }

  /**
   * 上传到云端：整库导出 → AES-GCM 加密 → 写入 GitHub 仓库里的快照文件。
   * 内容没变化时不产生多余提交。
   */
  async function uploadToCloud(): Promise<{ ok: boolean; message: string }> {
    if (isSyncing.value) return { ok: false, message: '正在同步中，请稍候' }
    isSyncing.value = true
    try {
      const res = await pushData(loadConfig(), exportAll)
      if (res.ok) {
        const now = res.updatedAt || new Date().toISOString()
        localStorage.setItem('erp_last_sync_at', now)
        lastSyncAt.value = now
        return {
          ok: true,
          message: res.skipped
            ? '云端已是最新，无需上传'
            : `已上传到云端（${formatBytes(res.bytes ?? 0)}）`
        }
      }
      return { ok: false, message: res.message }
    } finally {
      isSyncing.value = false
    }
  }

  /**
   * 从云端恢复：读取快照 → 解密 → 整库覆盖写入。
   * 覆盖前会把当前数据留在内存里，一旦写入失败尝试回滚。
   */
  async function pullFromCloud(): Promise<{ ok: boolean; message: string }> {
    if (isSyncing.value) return { ok: false, message: '正在同步中，请稍候' }
    isSyncing.value = true
    try {
      const res = await pullData(loadConfig())
      if (!res.ok) return { ok: false, message: res.message }

      const current = await exportAll()
      const restored = await importAll(res.data as BackupData)
      if (!restored.ok) {
        await importAll(current) // 回滚
        return { ok: false, message: restored.message }
      }
      const now = new Date().toISOString()
      localStorage.setItem('erp_last_sync_at', now)
      lastSyncAt.value = now
      return {
        ok: true,
        message: res.updatedAt
          ? `已从云端恢复（${formatTime(res.updatedAt)}的快照）`
          : '已从云端恢复'
      }
    } finally {
      isSyncing.value = false
    }
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
  }

  function formatTime(iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return {
    lastSyncAt, isSyncing, dataSize,
    exportAll, importAll, uploadToCloud, pullFromCloud
  }
})
