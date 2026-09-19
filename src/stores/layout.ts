import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORAGE_KEY = 'erp_sidebar_collapsed'

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 布局状态：电脑端侧边栏折叠状态，持久化到 localStorage。
 * 折叠状态在刷新后保持（验收标准之一）。
 */
export const useLayoutStore = defineStore('layout', () => {
  const sidebarCollapsed = ref(readInitial())

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, sidebarCollapsed.value ? '1' : '0')
    } catch {
      /* 忽略持久化异常（如隐私模式） */
    }
  }

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
    persist()
  }

  function setSidebarCollapsed(value: boolean): void {
    sidebarCollapsed.value = value
    persist()
  }

  return { sidebarCollapsed, toggleSidebar, setSidebarCollapsed }
})
