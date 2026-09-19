import { ref, onMounted, onUnmounted } from 'vue'

// 响应式断点：< 768px 为手机模式，>= 768px 为电脑模式
export const MOBILE_BREAKPOINT = 768

function currentWidth(): number {
  if (typeof window === 'undefined' || typeof window.innerWidth !== 'number') return 1280
  return window.innerWidth
}

// 模块级共享状态，保证同一页面内所有组件同步切换
const width = ref(currentWidth())
const isMobile = ref(width.value < MOBILE_BREAKPOINT)
const isDesktop = ref(!isMobile.value)

function recalculate(): void {
  width.value = currentWidth()
  isMobile.value = width.value < MOBILE_BREAKPOINT
  isDesktop.value = !isMobile.value
}

/**
 * 响应式判断组合式。
 * setup 阶段即按当前窗口宽度初始化，并监听 resize 自动切换 isMobile / isDesktop。
 * 返回共享的响应式引用，可直接用于模板与计算属性。
 */
export function useResponsive() {
  recalculate()
  onMounted(() => {
    window.addEventListener('resize', recalculate)
  })
  onUnmounted(() => {
    window.removeEventListener('resize', recalculate)
  })
  return { width, isMobile, isDesktop, recalculate, MOBILE_BREAKPOINT }
}
