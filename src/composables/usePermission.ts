import { computed } from 'vue'
import { useUserStore } from '../stores/user'
import type { Role } from '../types'

/**
 * 权限组合式：根据当前登录角色暴露统一的可见性判断。
 * 遵循 PRD 与开发计划中的「权限铁律」：
 *  - 销售：看不到进价（purchasePrice）
 *  - 库房：看不到任何价格
 *  - 经销商：只看到批发价（在独立目录页处理）
 *  - 老板：全部可见
 */
export function usePermission() {
  const userStore = useUserStore()
  const role = computed<Role | null>(() => userStore.role)

  const isBoss = computed(() => role.value === 'boss')
  const isWarehouse = computed(() => role.value === 'warehouse')
  const isDealer = computed(() => role.value === 'dealer')
  const isSales = computed(() => role.value === 'sales')

  // 库房看不到任何价格
  const canSeeAnyPrice = computed(() => role.value !== 'warehouse')

  // 进价（采购价）仅老板 / 采购 / 财务可见，销售不可见
  const canSeePurchasePrice = computed(() =>
    ['boss', 'purchaser', 'finance'].includes(role.value ?? '')
  )

  return {
    role,
    isBoss,
    isWarehouse,
    isDealer,
    isSales,
    canSeeAnyPrice,
    canSeePurchasePrice
  }
}
