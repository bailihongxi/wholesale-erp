/**
 * 回到本页时自动刷新数据（V2.0-27）。
 *
 * ## 为什么需要它
 *
 * `App.vue` 用 `<keep-alive>` 无差别缓存了所有路由组件。这带来一个不易发现的坑：
 * 从列表页进新建页 → 提交 → 跳回列表页时，列表组件是从缓存里**复活（activated）**
 * 而不是**重新挂载（mounted）**，`onMounted` 里的加载逻辑**根本不会再跑一次**，
 * 于是列表还是旧数据 —— 用户看到「新建的单子不出现，必须整页刷新才出来」。
 * 详情页同理：改完再回来，看到的还是修改前的内容。
 *
 * ## 用法
 *
 * ```ts
 * async function loadList() { ... }
 * onMounted(loadList)
 * useReloadOnActivate(loadList)   // 一行即可
 * ```
 *
 * ## 行为约定
 *
 * 1. **首次挂载不触发**：keep-alive 下的组件首次挂载时 `onActivated` 也可能被调用，
 *    不加判断就会和 `onMounted` 各拉一次，首屏请求翻倍。这里用 `onDeactivated`
 *    记的「曾经离开过」标志把首次那次挡掉。
 * 2. **非 keep-alive 环境完全不触发**：测试里用 `mount()` 直接挂组件时
 *    `onActivated` / `onDeactivated` 都不会被调用，因此既有测试行为不变。
 * 3. **只管「回到本页」**：页面内的筛选、翻页、Tab 切换请各自显式调用，
 *    这个钩子不负责。
 *
 * 注：`onDeactivated` 只有在组件被缓存起来（离开本页）时才会触发，所以
 * 上面的判断与「onActivated 是否在首次挂载时触发」无关，两种 Vue 行为下都正确。
 *
 * @param reload 重新加载数据的函数（可以是 async，内部不 await）
 * @param opts.immediate 是否在首次激活时也触发（默认 false，交给 onMounted）
 */
import { onActivated, onDeactivated } from 'vue'

export function useReloadOnActivate(
  reload: () => void | Promise<void>,
  opts: { immediate?: boolean } = {},
): void {
  let leftOnce = false

  onDeactivated(() => {
    leftOnce = true
  })
  onActivated(() => {
    if (!opts.immediate && !leftOnce) return
    void reload()
  })
}
