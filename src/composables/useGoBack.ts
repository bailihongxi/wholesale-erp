import type { Router } from 'vue-router'

/**
 * 二级页面「返回」的统一实现（V2.1-2.33）。
 *
 * 为什么不用裸 router.back()：
 *   详情页如果是「本次会话的第一个页面」（刷新 / PWA 恢复直达 / 分享链接打开），
 *   历史栈里没有上一条，router.back() 会退出应用或落到空白页 —— 老板实测
 *   出库明细点返回后路径异常即此因。
 *
 * 判定依据：vue-router 站内导航时会把上一条路由写进 history.state.back；
 * 刷新 / 直达时该字段为 null → 此时 replace 到该页面的逻辑父列表（各页面传入）。
 */
export function goBackOr(router: Router, fallback: string): void {
  if (window.history.state?.back != null) router.back()
  else router.replace(fallback)
}
