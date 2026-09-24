/**
 * 报价单实时回传（V2.1-2，窗口买票 / 售票员闭环）。
 *
 * ## 解决什么
 * 经销商提交询价单后，要等销售在后台点「确认询价单」才被允许转销售单。
 * 没有实时通道时，经销商只能靠电话问、或者关掉页面重开才看得到状态变了。
 * 有了它：销售一点确认，经销商页面秒级变成「✅ 已确认」并放开「转销售单」。
 *
 * ## 用法
 * ```ts
 * useQuoteRealtime({
 *   enabled: () => isDealer.value,
 *   customerId: () => userStore.currentUser?.id,
 *   onChange: () => pager.reload(),          // 收到变更就重新拉一次
 *   onSubscribed: () => pager.reload(),      // 订阅成功 / 断线重连后校准
 * })
 * ```
 *
 * ## 三条硬约束
 * 1. **必须先在 Supabase 后台把 `quoteOrders` 表加进 `supabase_realtime` 发布**
 *    （`alter publication supabase_realtime add table "quoteOrders";`，见
 *    `supabase/migrate_v2.1-2_realtime_quote_orders.sql`）。不加发布，订阅永远收不到事件，
 *    且不报错——页面看起来「没坏但就是不动」，最难排查。
 * 2. **订阅必须能停**：`onUnmounted` 里 `removeChannel`，否则切页面会一路泄漏连接
 *    （Free 套餐 200 峰值连接，泄漏多了整个 app 的实时功能都会挂）。
 * 3. **Realtime 只负责「开着的时候推送」**：关页期间状态变了的单子，靠下次
 *    `listQuotes` / `useReloadOnActivate` 的全量读取兜底，所以订阅成功与重连后
 *    都要主动校准一次，不能只依赖推送。
 */
import { onMounted, onUnmounted } from 'vue'
import { supabase, USE_CLOUD } from '../db/supabaseClient'
import type { QuoteOrder } from '../types'

export interface QuoteRealtimeOpts {
  /** 是否需要订阅（只有经销商要收「销售确认」的回传） */
  enabled: () => boolean
  /** 客户 id：服务端按它过滤，经销商通道只收得到自己单子的变更 */
  customerId: () => number | undefined
  /** 收到变更（INSERT / UPDATE / DELETE 都回调），一般直接重新拉列表 */
  onChange: (row: QuoteOrder) => void
  /** 订阅成功（含自动重连）后回调：建议全量拉一次，避免漏事件 */
  onSubscribed?: () => void
}

export function useQuoteRealtime(opts: QuoteRealtimeOpts): void {
  let channel: ReturnType<typeof supabase.channel> | null = null

  function stop(): void {
    if (!channel) return
    try {
      void supabase.removeChannel(channel)
    } catch {
      /* 通道已经失效时忽略， unsubscribe 失败不影响页面 */
    }
    channel = null
  }

  function start(): void {
    stop()
    const cid = Number(opts.customerId()) || 0
    // 本地 / 测试（USE_CLOUD=false）没有 Realtime 可订阅，也不能拿真实客户去连
    if (!USE_CLOUD || !cid || !opts.enabled()) return

    channel = supabase
      .channel(`quotes-dealer-${cid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quoteOrders',
          filter: `customerId=eq.${cid}`,
        },
        (payload: any) => {
          const row = (payload.new ?? payload.old) as QuoteOrder | undefined
          if (row?.id) opts.onChange(row)
        },
      )
      .subscribe((status?: string) => {
        // supabase-js 断线会自动重连，每次重连都会再次 SUBSCRIBED：
        // 断线期间的事件已经丢了，这里补一次全量读取把状态校准回来。
        if (status === 'SUBSCRIBED') opts.onSubscribed?.()
      })
  }

  onMounted(start)
  onUnmounted(stop)
}
