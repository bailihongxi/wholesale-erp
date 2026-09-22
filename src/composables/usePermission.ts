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

  /** 系统内置管理员账号（hawsystem，工号 E000）：system 标记为 true */
  const isSystemAdmin = computed(() => userStore.currentUser?.system === true)

  /**
   * 单据删除权限：只有「老板」和「系统管理员」两方有，其余角色一律没有。
   *
   * 说明：系统内置管理员 hawsystem 的 role 本身就是 'boss'，所以单看角色两者是同一个；
   * 这里额外认一下 system 标记，是为了将来即便该账号角色被调整，删除权也不会丢。
   * 采购 / 销售 / 财务 / 库房 / 经销商都不具备删除权。
   */
  const canDeleteDoc = computed(() => role.value === 'boss' || isSystemAdmin.value)

  // 库房看不到任何价格
  const canSeeAnyPrice = computed(() => role.value !== 'warehouse')

  // 进价（采购价）仅老板 / 采购 / 财务可见，销售不可见
  const canSeePurchasePrice = computed(() =>
    ['boss', 'purchaser', 'finance'].includes(role.value ?? '')
  )

  return {
    role,
    isBoss,
    isSystemAdmin,
    isWarehouse,
    isDealer,
    isSales,
    canSeeAnyPrice,
    canSeePurchasePrice,
    canDeleteDoc
  }
}
