/**
 * 慢请求兜底提示（V2.2-1.11）。
 *
 * 背景：supabase-js 底下的 fetch **没有超时**——网络一抖，用户看到的是
 * 一个永远在转圈的空列表，既不知道还在加载，也不知道已经失败。
 * （2026-09-29 实测：saleOrders 正常 0.44s，偶发一次 12.7s，页面全程无任何提示。）
 * 登录链路（stores/user.ts）早就用 Promise.race 做过同样的事，这里抽成通用工具，
 * 给出入库历史这类「整表跨境拉取」的链路复用。
 *
 * 设计取舍：**软超时**——到点只触发一次提示，**不取消、不 reject 原请求**。
 * 跨境请求慢是常态，粗暴中断会把「再等两秒就出来」的列表变成「加载失败」，
 * 反而更糟。真正的失败仍由调用方原有的 catch 负责报错。
 *
 * 用法：
 *   rows = await withSlowHint(store.listDocs('in'), 5000, () => showToast('网络较慢，正在加载…'))
 */
export const SLOW_HINT_MS = 5000

/** 内部信号：只用于区分「超时分支」与「请求真的失败」，不外泄 */
const SLOW = Symbol('slow-hint')

export function withSlowHint<T>(
  promise: Promise<T>,
  ms: number = SLOW_HINT_MS,
  onSlow?: () => void,
): Promise<T> {
  if (!onSlow || ms <= 0) return promise

  let timer: ReturnType<typeof setTimeout> | null = null
  const guard = new Promise<typeof SLOW>(resolve => {
    timer = setTimeout(() => resolve(SLOW), ms)
  })

  return Promise.race([promise, guard])
    .then(v => {
      // 超时分支：提示一次，然后继续等真实结果
      if ((v as unknown) === SLOW) {
        try { onSlow() } catch { /* 提示失败不能影响数据加载 */ }
        return promise
      }
      return v as T
    })
    .finally(() => {
      if (timer) clearTimeout(timer)
    })
}
