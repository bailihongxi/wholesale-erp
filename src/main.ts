import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Vant from 'vant'
import 'vant/lib/index.css'
// 全局设计系统：令牌 / 重置 / 通用组件类 / 表格规范
import './styles/theme.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(Vant)
app.mount('#app')

/**
 * 路由分包预取。
 *
 * 各页面的组件都是 `() => import(...)` 懒加载的，第一次点进某页要现下载
 * 那个 chunk，表现就是「点菜单 → 白一下 → 页面才出来」。
 * 所以首屏挂载后，趁浏览器空闲把其余页面的 chunk 全部拉下来缓存：
 * 用户真正点击时直接命中缓存，不再有下载造成的空窗。
 *
 * 放在 main.ts（而不是 router）里，测试 import router 时不会触发。
 */
function prefetchRoutes(): void {
  const loaders = router
    .getRoutes()
    .map(r => (r.components?.default ?? null))
    .filter((c): c is () => Promise<unknown> => typeof c === 'function')

  let i = 0
  const step = (): void => {
    // 一次只取一个，避免和服务端/浏览器抢带宽拖慢当前页
    const loader = loaders[i++]
    if (!loader) return
    loader().then(schedule, schedule)
  }
  const schedule = (): void => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
      .requestIdleCallback
    if (typeof ric === 'function') ric(step)
    else setTimeout(step, 120)
  }
  schedule()
}

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => setTimeout(prefetchRoutes, 400))
}
