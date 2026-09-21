import { createApp } from 'vue'
import { createPinia } from 'pinia'

/**
 * ⚠️ 不要写 `import Vant from 'vant'` + `app.use(Vant)`。
 *
 * 全项目只用到 Vant 的两个函数式弹层（showToast / showConfirmDialog），
 * 一个 `<van-*>` 组件都没有；而全量引入会把首屏主包从 ~430KB 撑到 726KB
 * （gzip 236KB），手机 4G 下就是实打实的等待。这里只按需引这两套样式，
 * 组件代码由各页面自己 `import { showToast } from 'vant'` 摇树带走。
 */
import 'vant/es/toast/style'
import 'vant/es/dialog/style'

// 全局设计系统：令牌 / 重置 / 通用组件类 / 表格规范
import './styles/theme.css'
import App from './App.vue'
import router from './router'
import { useBrand, loadBrandFromCloud } from './utils/brand'
import { applyAppIcon } from './utils/appIcon'
import { initInstall, registerServiceWorker } from './utils/installApp'
import { initIdleTasks } from './utils/idle'

const app = createApp(App)
app.use(createPinia())
app.use(router)

/**
 * 挂载与「云端设置同步」解耦（V2.0-12）。
 *
 * 以前是 `loadBrandFromCloud().finally(() => app.mount('#app'))` —— 必须等
 * 云端的系统设置回来才肯挂载。云端在新加坡，手机信号稍差就是 1~3 秒，
 * 这段时间用户只能盯着首屏的呼吸条，点哪儿都没反应。
 *
 * 现在先用本机缓存立刻挂载（品牌配置本身就是响应式的，云端回来后会自己
 * 更新，不需要重新挂载），云同步在后台跑，谁都不等谁。
 */
loadBrandFromCloud()
app.mount('#app')

/**
 * 启动即套用「已保存的应用图标」（第十六轮）。
 *
 * 不做这一步的话：用户换过图标 → 刷新页面 → 标签页又变回默认图，
 * 只有再进一次设置页才会变回来，看起来像没保存成功。
 * 放在挂载之后异步做，不拖慢首屏。
 */
function bootAppIcon(): void {
  try {
    const { config } = useBrand()
    applyAppIcon(config.value.appIcon, config.value.appIconBg).catch(() => undefined)
  } catch {
    /* 图标应用失败不影响系统使用 */
  }
}

/**
 * 安装能力与离线缓存（第十六轮）。
 *  - initInstall：监听 beforeinstallprompt / appinstalled，供设置页的「发送到桌面」使用；
 *  - registerServiceWorker：仅生产环境注册，断网后仍能打开界面。
 */
initInstall()
registerServiceWorker(import.meta.env.PROD)
bootAppIcon()

/**
 * 空闲任务：路由分包预取 + 常用主数据预热（V2.0-12）。
 *
 * 都放到「首屏真正稳定之后再干」，并且串行、可被用户操作打断，
 * 避免和当前页抢带宽/主线程 —— 之前是固定 400ms 后就开跑，
 * 首屏还在拉数据时抢网，反而更慢。
 */
initIdleTasks(router)

// 注册 Service Worker：缓存静态资源，二次打开秒开
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
