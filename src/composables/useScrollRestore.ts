/**
 * 页面滚动位置恢复工具
 * 从详情页返回列表时，自动恢复滚动位置，不用重新滚
 */

import { onActivated, onDeactivated } from 'vue'

const scrollMap = new Map<string, number>()

export function useScrollRestore(key: string) {
  onDeactivated(() => {
    // 离开页面时记录滚动位置
    scrollMap.set(key, window.scrollY)
  })

  onActivated(() => {
    // 回到页面时恢复滚动位置
    const pos = scrollMap.get(key)
    if (pos !== undefined) {
      // 等DOM渲染完再恢复
      setTimeout(() => {
        window.scrollTo(0, pos)
      }, 50)
    }
  })
}
