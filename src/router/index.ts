import { createRouter, createWebHashHistory } from 'vue-router'
import { useUserStore } from '../stores/user'
import { usePermissionStore } from '../stores/permission'

// 老板为最高权限角色，可进入全部业务页面；下面绝大多数路由都把 'boss' 放进允许列表，
// 以保证老板侧边栏里的每一项点进去都能真正停留（此前只写了单一角色，
// 导致老板点「采购管理 / 销售管理 / 供应商 / 财务管理」会被守卫弹回工作台）。

const routes = [
  { path: '/', redirect: '/login' },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/auth/LoginView.vue'),
    meta: { layout: 'auth' }
  },

  // ===== 老板端 =====
  { path: '/boss/home', component: () => import('../views/boss/BossHomeView.vue'), meta: { role: 'boss', title: '老板工作台' } },
  { path: '/boss/users', component: () => import('../views/boss/UsersManageView.vue'), meta: { role: 'boss', title: '员工管理' } },
  { path: '/boss/products', component: () => import('../views/boss/ProductListView.vue'), meta: { role: ['boss', 'purchaser', 'sales'], title: '商品档案' } },
  { path: '/boss/products/new', component: () => import('../views/boss/ProductEditView.vue'), meta: { role: 'boss', title: '新增商品' } },
  { path: '/boss/products/edit/:id', component: () => import('../views/boss/ProductEditView.vue'), meta: { role: 'boss', title: '编辑商品' } },
  { path: '/boss/business', component: () => import('../views/boss/BossBusinessView.vue'), meta: { role: 'boss', title: '业务中心' } },
  { path: '/boss/mine', component: () => import('../views/boss/BossMineView.vue'), meta: { role: 'boss', title: '我的' } },
  { path: '/boss/audit-logs', component: () => import('../views/boss/AuditLogView.vue'), meta: { role: 'boss', title: '操作日志' } },
  { path: '/boss/settings', component: () => import('../views/boss/SettingsView.vue'), meta: { role: 'boss', title: '系统设置' } },
  { path: '/boss/reports', component: () => import('../views/boss/BossReportsView.vue'), meta: { role: ['boss', 'finance'], title: '经营报表' } },

  // ===== 采购端 =====
  { path: '/purchase/home', component: () => import('../views/purchase/PurchaseHomeView.vue'), meta: { role: ['purchaser', 'boss'], title: '采购工作台' } },
  { path: '/purchase/orders', component: () => import('../views/purchase/PurchaseOrdersView.vue'), meta: { role: ['purchaser', 'boss'], title: '采购单' } },
  { path: '/purchase/orders/new', component: () => import('../views/purchase/PurchaseCreateView.vue'), meta: { role: ['purchaser', 'boss'], title: '新建采购单' } },
  { path: '/purchase/orders/:id', component: () => import('../views/purchase/PurchaseOrderDetailView.vue'), meta: { role: ['purchaser', 'boss'], title: '采购单详情' } },
  { path: '/purchase/suppliers', component: () => import('../views/purchase/SuppliersView.vue'), meta: { role: ['purchaser', 'boss'], title: '供应商管理' } },
  { path: '/purchase/mine', component: () => import('../views/RoleMineView.vue'), meta: { role: 'purchaser', title: '我的' } },

  // ===== 销售端 =====
  { path: '/sales/home', component: () => import('../views/sales/SalesHomeView.vue'), meta: { role: ['sales', 'boss'], title: '销售工作台' } },
  { path: '/sales/orders', component: () => import('../views/sales/SalesOrdersView.vue'), meta: { role: ['sales', 'boss'], title: '销售单' } },
  { path: '/sales/orders/new', component: () => import('../views/sales/SalesCreateView.vue'), meta: { role: ['sales', 'boss'], title: '新建销售单' } },
  { path: '/sales/orders/:id', component: () => import('../views/sales/SaleOrderDetailView.vue'), meta: { role: ['sales', 'boss'], title: '销售单详情' } },
  { path: '/sales/mine', component: () => import('../views/RoleMineView.vue'), meta: { role: 'sales', title: '我的' } },

  // ===== 财务端 =====
  { path: '/finance/home', component: () => import('../views/finance/FinanceHomeView.vue'), meta: { role: ['finance', 'boss'], title: '财务工作台' } },
  // 财务中心：把 应收应付对账 / 经营报表 / 记一笔 / 收支流水 收拢到同一入口下
  { path: '/finance', component: () => import('../views/finance/FinanceOpsView.vue'), meta: { role: ['finance', 'boss'], title: '财务管理' } },
  { path: '/finance/reconcile', component: () => import('../views/finance/ReconcileView.vue'), meta: { role: ['finance', 'boss'], title: '应收应付对账' } },
  { path: '/finance/ledger', component: () => import('../views/finance/LedgerView.vue'), meta: { role: ['finance', 'boss'], title: '记一笔' } },
  { path: '/finance/mine', component: () => import('../views/RoleMineView.vue'), meta: { role: 'finance', title: '我的' } },

  // ===== 库房端 =====
  { path: '/warehouse/home', component: () => import('../views/warehouse/WarehouseHomeView.vue'), meta: { role: ['warehouse', 'boss'], title: '库房工作台' } },
  // 库存作业中心：把入库验货 / 出库拣货 / 调拨 / 盘点 收纳到同一入口下
  { path: '/warehouse', component: () => import('../views/warehouse/WarehouseOpsView.vue'), meta: { role: ['warehouse', 'boss'], title: '库存作业' } },
  { path: '/warehouse/transfer', component: () => import('../views/warehouse/TransferView.vue'), meta: { role: ['warehouse', 'boss'], title: '调拨作业' } },
  { path: '/warehouse/count', component: () => import('../views/warehouse/CountView.vue'), meta: { role: ['warehouse', 'boss'], title: '盘点作业' } },
  { path: '/warehouse/returns', component: () => import('../views/warehouse/ReturnsView.vue'), meta: { role: ['warehouse', 'boss'], title: '退换货' } },
  { path: '/warehouse/inbound', component: () => import('../views/warehouse/InboundView.vue'), meta: { role: ['warehouse', 'boss'], title: '待收货入库' } },
  { path: '/warehouse/inbound/doc/:batchNo', component: () => import('../views/warehouse/StockDocDetailView.vue'), meta: { role: ['warehouse', 'boss'], title: '入库单明细' } },
  { path: '/warehouse/inbound/:id', component: () => import('../views/warehouse/InboundDetailView.vue'), meta: { role: ['warehouse', 'boss'], title: '入库验货' } },
  { path: '/warehouse/outbound', component: () => import('../views/warehouse/OutboundView.vue'), meta: { role: ['warehouse', 'boss'], title: '待发货出库' } },
  { path: '/warehouse/outbound/:id', component: () => import('../views/warehouse/OutboundDetailView.vue'), meta: { role: ['warehouse', 'boss'], title: '出库拣货' } },
  { path: '/warehouse/outbound/doc/:batchNo', component: () => import('../views/warehouse/StockDocDetailView.vue'), meta: { role: ['warehouse', 'boss'], title: '出库单明细' } },

  // ===== 合并后的统一页面 =====
  // 原先「库存查询」与「库存管理」功能重复，合并为统一的「库存管理」/stock；
  // 原先「经销商」与「客户管理」功能重复，合并为统一的「客户管理」/customers；
  // 原先「毛利核算」并入「经营报表」/boss/reports（报表内含日期筛选与毛利区块）。
  // 旧路径保留重定向，避免收藏夹与外部分享链接失效。
  { path: '/stock', component: () => import('../views/stock/StockManageView.vue'), meta: { role: ['boss', 'finance', 'warehouse'], title: '库存管理' } },
  { path: '/customers', component: () => import('../views/sales/CustomersView.vue'), meta: { role: ['boss', 'sales'], title: '客户管理' } },
  { path: '/boss/stock', redirect: '/stock', meta: { role: ['boss', 'finance', 'warehouse'], title: '库存管理' } },
  { path: '/warehouse/stock', redirect: '/stock', meta: { role: ['warehouse', 'boss', 'finance'], title: '库存管理' } },
  { path: '/sales/customers', redirect: '/customers', meta: { role: ['boss', 'sales'], title: '客户管理' } },
  { path: '/boss/dealers', redirect: '/customers', meta: { role: 'boss', title: '客户管理' } },
  { path: '/finance/gross-profit', redirect: '/boss/reports', meta: { role: ['boss', 'finance'], title: '毛利核算' } },

  { path: '/:pathMatch(.*)*', redirect: '/login' }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach(async (to) => {
  const userStore = useUserStore()
  if (!userStore.isLoggedIn) {
    await userStore.restoreSession()
  }
  if (to.path === '/login') return true
  if (!userStore.isLoggedIn) return '/login'

  const role = userStore.role as string
  const roleMeta = to.meta.role
  if (roleMeta) {
    const allowed = Array.isArray(roleMeta) ? roleMeta : [roleMeta]
    if (allowed.includes(role)) return true
    // 路由本身没放开该角色时，再查一次「角色权限配置」：
    // 老板给某角色额外勾了模块（例如让库房看经营报表），这里也要放行。
    const permStore = usePermissionStore()
    await permStore.ensure()
    if (permStore.canAccess(role, to.path)) return true
    return userStore.homeRouteForRole(userStore.role)
  }
  return true
})

export default router
