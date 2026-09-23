# 经销商自助门户 PRD（只开放报价单版）

| 项 | 内容 |
|---|---|
| 文档状态 | 部分已落地（V2.1-1 与 V2.1-1.1 已上线；剩余项见 §10 的「实际交付」列） |
| 基于版本 | V2.1-1.2（当前产品版本） |
| 目标版本 | V2.1-1 系列基线（原计划的「骨架封死 + 经销商分支」已合并进 V2.1-1；剩余「状态流 + Realtime」属大功能，按统一版本规则进 V2.1-2） |
| 作者 | WorkBuddy |
| 相关文档 | `docs/ERP深度开发可行性研究报告.md`、`docs/P0计划对比分析.md`、`docs/深度开发清单.md` |

---

## 1. 背景与目标

### 1.1 业务诉求
老板希望把"对外接单"搬到线上：每家经销商用**公司分配的账号**登录系统，在**报价单（询价单）**页面自助下单；公司内部销售（及权限≥销售的角色）能看到所有经销商的询价单、可直接改单，改完经销商看到"确定的询价单"；经销商满意后可自助点"转销售单"，或由销售在后台转。

### 1.2 一句话模型（老板原话）
> 经销商开询价单 = 在窗口买票；公司销售 = 售票员。
> 经销商是"低权限销售"，但**只能看见报价单**。

### 1.3 设计目标
- 经销商登录后**只能进入报价单页**，其余页面一律不可达（UI 层硬封死）。
- 经销商 A **只能看见 A 自己下的询价单**，看不见 B 的，也看不见系统内部任何数据。
- 公司内部正常销售 / 老板**能看到并处理所有经销商的询价单**（查看、改单、转销售单）。
- 经销商**只可见批发价**，绝不可见进价（沿用现有 `canSeePurchasePrice` 规则）。
- 不接受任何外部/公开注册账号——账号全部由公司后台分配。

---

## 2. 关键设计决策（已与老板逐条确认）

| # | 决策 | 说明 |
|---|---|---|
| D1 | **不用字面 `role='sales'`** | 若经销商真用 `sales` 角色登录，守卫会放行「销售工作台/销售单/客户管理」3 个模块，违反"只看得见报价单"。权限是**角色级**（按角色存，不按人），无法只限制某一个销售。 |
| D2 | **沿用既有 `dealer` 角色** | `user.ts:69` 经销商登录即设 `role='dealer'`。把它权限限到只剩 `/sales/quotes`，概念上就是"低权限销售"，但不污染真正销售。 |
| D3 | **不新增 `dealerId` 字段** | 经销商即 `customers` 表一行，其 `currentUser.id` 即客户 id。列表按 `customerId = currentUser.id` 过滤即可，A 看不见 B。 |
| D4 | **复用现有报价单页 `/sales/quotes`** | 不另建门户，在 `QuotesView.vue` 加 `role==='dealer'` 分支，工作量远小于独立门户。 |
| D5 | **只下询价单、不直接下销售单** | 经销商无 `/sales/orders` 权限；转销售单由"转销售单"按钮触发 `convertToSale`（现有引擎）。 |
| D6 | **前端过滤 ≠ 数据库隔离** | 当前 Supabase 用 anon key 直连、未开 RLS。经销商"只看见自己"是前端保证，与内部 app 同安全等级，MVP 可接受（见 §9）。 |
| D7 | **「确认」用 Realtime 实时回传，免电话** | 销售改单/不改单但点「确认询价单」→ `status` 由 `draft→sent` → 通过 Supabase Realtime（Postgres Changes）**实时推送**给该经销商的报价单页，页面即时显示「✅ 已确认」徽标并放开「转销售单」，无需经销商刷新、无需打电话。Realtime 在 Free 套餐下**免费**，且与现有 anon key 模型兼容，无需引入 Auth/RLS（见 §8.1）。 |

---

## 3. 业务模型与流程

```
[经销商登录] ──(dealer 角色)──> [/sales/quotes 报价单页]
        │
        │ ① 自助选商品(仅批发价) + 填数量 → 提交询价单
        ▼
   QuoteOrder(status='draft'，customerId=经销商自身)
        │  └─ Realtime INSERT 事件 → 销售后台即时看到新询价单（无需刷新）
        ▼
   [销售核对] 在 /sales/quotes 看到该单（无 customer 过滤，全量可见）
        │
        │ ② 数量/价格/商品不对 → 直接改单（销售角色可编辑）
        │ ③ 改完 / 不改 → 点「确认询价单」→ status: draft→sent
        ▼
   Realtime UPDATE 事件 → 经销商报价单页**实时**收到 → 即时显示「✅ 已确认」徽标、放开「转销售单」
        │   （无需经销商刷新、无需打电话告知）
        ▼
   [经销商满意] ──点击"转销售单"──> convertToSale → status='converted'
        或
   [经销商通知销售] ──销售后台点"转销售单"──> 同上
        │
        ▼
   生成 SaleOrder（customerId 同原询价单）。销售/老板可见；经销商无需看销售单。
```

**角色职责对照**

| 角色 | 能看什么 | 能做什么 |
|---|---|---|
| 经销商（dealer） | 仅自己下的报价单 | 新建询价单、查看自己的单、点"转销售单" |
| 销售（sales） | 全部报价单（含所有经销商） | 查看、改单、转销售单、看客户档案 |
| 老板（boss） | 全部 | 全部 + 权限配置 |

---

## 4. 权限设计（核心）

### 4.1 路由级封死矩阵
`router/index.ts` 的 `beforeEach` 守卫：每条业务路由带 `meta.role`，角色不在允许列表 → 弹回 `homeRouteForRole(role)`。

| 路由 | 当前 meta.role | 经销商能否进 |
|---|---|---|
| `/sales/quotes` | `['sales','boss']` | ❌ 当前不能 → **改为 `['sales','boss','dealer']`** |
| `/sales/orders`、`/sales/orders/new`、`/sales/orders/:id` | `['sales','boss']` | ❌ 保持，经销商进不去 |
| `/sales/home`、`/sales/mine` | `['sales','boss']` / `['sales']` | ❌ 保持 |
| `/customers`、`/purchase/*`、`/finance/*`、`/stock`、`/warehouse/*`、`/boss/*` | 各含对应角色，均不含 `dealer` | ❌ 全部天然封死 |

> 结论：只要给 `/sales/quotes` 加上 `dealer`，**"其余不开放"由守卫自动成立**，无需逐路由改。

### 4.2 角色-模块权限（`navConfig.ts`）
需在 `DEFAULT_ROLE_PERMS` 增加 dealer 项，并在 `navConfig` 增加 dealer 菜单：

```ts
// DEFAULT_ROLE_PERMS 增加：
dealer: ['/sales/quotes'],

// navConfig 增加：
dealer: {
  sidebar: [ { label: '报价单', icon: '📝', route: '/sales/quotes' } ],
  tabbar:  [
    { label: '报价单', icon: '📝', route: '/sales/quotes' },
    { label: '我的',   icon: '👤', route: '/sales/mine' }   // 复用销售"我的"页
  ]
}
```

### 4.3 修复登录死循环（必须）
`user.ts:398` 当前 `homeRouteForRole('dealer')` 返回 **`/dealer/catalog`**（该路由根本不存在）→ 经销商登录后被弹到不存在页 → catch-all 踢回 `/login` → **死循环**。必须改为：

```ts
case 'dealer': return '/sales/quotes'
```

---

## 5. 数据模型

### 5.1 复用 `QuoteOrder`（无需新增表/字段）
`types/index.ts:399` 已定义，关键字段：

| 字段 | 类型 | 经销商场景用法 |
|---|---|---|
| `id` | number | 单据号 |
| `customerId` | number | **隔离关键**：经销商建的单 = 自身客户 id；列表按此过滤 |
| `customerName` | string | 展示用 |
| `kind` | `'sale' \| 'purchase'` | 经销商单固定 `'sale'` |
| `status` | `'draft' \| 'sent' \| 'converted' \| 'void'` | 状态流见 §8 |
| `items` | QuoteOrderItem[] | 商品明细（仅批发价） |
| `convertedSaleOrderId` / `convertedSaleNo` | ? | 转销售单后回填，供展示 |
| `confirmedBy` / `confirmedAt` | ?（新增可选） | 销售点「确认询价单」时回填操作人/时间，供审计；不阻断流程，缺省为空 |

### 5.2 价格字段
- 经销商视图**只用 `wholesalePrice`**，隐藏 `purchasePrice`（进价）、`retailPrice`（零售）。
- `canSeePurchasePrice`（`usePermission.ts`）已排除 dealer，进价不会渲染。

### 5.3 不改动的部分
- `stockRecords`：经销商下询价单**不产生库存流水**（只有转成销售单、出库时才动库存），无需处理。
- 不新增 `dealerId`：靠 `customerId = currentUser.id` 完成归属与隔离（D3）。

---

## 6. 页面与功能改造清单（核心工作量）

**唯一主要改动文件：`src/views/sales/QuotesView.vue`**，加 `role==='dealer'` 分支（约 1 个文件，不另建门户）。

### 6.1 列表页（loader）
- 当 `role==='dealer'`：`loader` 的查询条件**追加 `customerId = currentUser.id`**（约 `QuotesView.vue:360-374` 区域）。
  - 效果：A 只看见 A 的单，B 的单被过滤。
  - 正常销售仍走无 customer 过滤分支 → 全量可见。
- 隐藏页内"销售单"Tab（若存在）及对 `/sales/orders` 的跳转入口。

### 6.2 新建询价单（form）
- 隐藏"客户"下拉（当前 `QuotesView.vue:85` 是全客户下拉 + 散客），**自动填 `form.customerId = currentUser.id`**。
- 价格锁死**批发价**：去掉零售/批发切换，统一 `priceMode='wholesale'`。
- 提交时 `kind` 写 `'sale'`，`salesId` 处理见 §12 待决策 Q1。

### 6.3 详情页（openDetail）
- `openDetail(id)` 打开前**校验归属**：该单 `customerId !== currentUser.id` 则弹回列表（防手输 id 越权）。
- 对经销商**隐藏**「✏️ 修改」「🗑 删除」按钮（`role!=='dealer'` 才显示）。
- **保留**「查看」与「➜ 转销售单」按钮（符合 D5）。
- 展示状态标签（`draft/sent/converted`），让经销商知道"售票员是否已确认"。

### 6.4 转销售单
- 经销商点"转销售单" → 调现有 `convertToSale(quoteId, salesId)`（引擎已在 `stores/quotes.ts`）。
- 转成功后 `status='converted'`，回填 `convertedSaleOrderId/SaleNo`；列表/详情显示"已转销售单"。
- 销售单本身不向经销商开放（无 `/sales/orders` 权限），经销商无需查看。

---

## 7. 路由与菜单改造（具体代码点）

| 文件:行 | 改动 |
|---|---|
| `src/router/index.ts:45` | `/sales/quotes` 的 `meta.role` 由 `['sales','boss']` → `['sales','boss','dealer']` |
| `src/router/navConfig.ts:79` `DEFAULT_ROLE_PERMS` | 增加 `dealer: ['/sales/quotes']` |
| `src/router/navConfig.ts:112` `navConfig` | 增加 `dealer` 的 `sidebar` / `tabbar`（见 §4.2） |
| `src/stores/user.ts:398` | `homeRouteForRole('dealer')` 由 `/dealer/catalog` → `/sales/quotes` |
| `src/views/sales/QuotesView.vue` | 新增 `role==='dealer'` 分支（§6） |
| `src/stores/quotes.ts` | 新增 `confirmQuote(quoteId, operatorId)`：`draft→sent` 不改明细，回填 `confirmedBy/At` + 审计（复用 `QUOTE_UPDATE` 或新增 `QUOTE_CONFIRM`） |
| `src/views/sales/QuotesView.vue`（dealer 分支） | 接入 Realtime 订阅（`supabase.channel`，§8.1）；`onUnmounted` 移除；收到 `sent` 即时显「✅ 已确认」徽标 + 放开「转销售单」 |
| **Supabase 后台（一次性运维）** | 将 `quoteOrders` 表加入 `supabase_realtime` 发布，否则订阅收不到事件 |

> 注意：`nav-permission.test.ts`（权限回归测试）需同步更新——确认 dealer 能进 `/sales/quotes`、不能进其他路由。改菜单/路由后必跑此测试（既有铁律）。

---

## 8. 报价单状态流

直接复用 `QuoteOrder.status`（`types/index.ts:407`），无需扩展枚举：

```
经销商提交 ──> draft（草稿/待报价）
      │  销售在后台看到（Realtime INSERT 即时提示）
      ▼
   销售点「确认询价单」（改单后 / 不改直接确认）──> sent（已确认/已报价 = "确定的询价单"）
      │  ↑ 此步触发 Realtime UPDATE 实时回传经销商页（见 §8.1）
      │
      ├─ 经销商/销售点"转销售单" ──> converted（已转销售单，回填 convertedSaleOrderId/SaleNo）
      │
      └─ 取消/失效 ──> void（已失效）
```

- 经销商视角：提交后看 `sent` 即代表"售票员已接单/已确认"；`converted` 代表"已转销售单，流程结束"。
- 销售视角：在 `draft`/`sent` 状态下可任意改单（数量/价格/商品），改完经销商即时可见（Realtime 推送）。
- **新增动作 `confirmQuote(quoteId, operatorId)`**：销售点「确认询价单」专用，只把 `status` 由 `draft→sent`（不改明细）。与 `updateQuote`（改明细）区分；不改单直接确认时走 `confirmQuote`。建议同时回填审计字段 `confirmedBy`/`confirmedAt`（见 §5.1）。

---

### 8.1 实时确认回传（Supabase Realtime）

**目标**：销售点「确认询价单」后，经销商页面**即时**（秒级）显示「✅ 已确认」并放开「转销售单」，省去电话通知；同时经销商提交新单时，销售后台也即时收到（反向同理）。

**可行性**：完全可行，且是 Realtime 的标准用法。三项能力（Realtime / Auth / RLS）在 Free 套餐下**全部免费**；Realtime 与现有 anon key 直连模型兼容，**无需引入 Auth/RLS**。

**接入方式**（supabase-js 已导出：`db/supabaseClient.ts:16` 的 `supabase`）：

```ts
// 经销商页（role==='dealer'）挂载时订阅自己的询价单变更
const channel = supabase
  .channel(`quotes-dealer-${currentUser.id}`)
  .on('postgres_changes', {
      event: 'UPDATE',                 // 销售改单/确认都触发 UPDATE
      schema: 'public',
      table: 'quoteOrders',            // cloudDb 表名（§5.1）
      filter: `customer_id=eq.${currentUser.id}`   // 服务端按客户过滤，只收自己的
    },
    (payload) => {
      // payload.new.status === 'sent' → 该单行 reactive 标「✅ 已确认」、放开「转销售单」
      // payload.new.status === 'converted' → 标「已转销售单」
      syncRowFromPayload(payload.new)
    }
  )
  .subscribe()

// 组件卸载时务必移除，避免泄漏
onUnmounted(() => supabase.removeChannel(channel))
```

**关键实现要点**：
1. **必须先在 Supabase 后台把 `quoteOrders` 表加入 Realtime 发布**（`supabase_realtime` publication）。这是最容易遗漏的一步——不加发布，任何订阅都收不到事件。属一次性运维操作，记入实施清单。
2. **订阅生命周期**：`onMounted` 订阅、`onUnmounted` `removeChannel`；监听 `SUBSCRIBED`/`CHANNEL_ERROR` 做重连兜底（supabase-js 默认自动重连，重连后首次建议主动 `listQuotes` 全量校准一次，避免丢事件）。
3. **过滤是服务端执行**：`filter: customer_id=eq.<id>` 由 Realtime 服务在转发前过滤，经销商通道**只收到自己行的变更**，比纯 UI 过滤更稳。但初始列表读取仍走 `customerId` 过滤的普通查询；且 anon key 在包内可被提取，技术人可开无过滤通道（同 §9 信任等级）。
4. **配额**：Free 套餐 200 万条消息/月、200 峰值连接，本场景流量极小，远不触及。
5. **关闭 app 期间的处理**：经销商若关页期间销售已确认，下次打开 `listQuotes` 读到的就是 `sent`，照常显示「已确认」——Realtime 只负责"开着时秒级推送"，兜底靠普通查询。

**双向实时**（可选增强，非 MVP 必须）：销售侧 `/sales/quotes` 订阅 `event:'INSERT'` + 全量（无 customer 过滤），经销商新提交即即时入列表；本 PRD 首版可仅靠现有 `useReloadOnActivate` 拉取，Realtime 优先保证"确认回传"这一最痛方向。

---

## 9. 安全边界与已知限制（如实告知）

1. **前端过滤 ≠ 数据库隔离**：经销商"只能看自己的单"由 `QuotesView` 的 `customerId` 过滤保证，Supabase 表仍用 anon key 直连、未开 RLS。懂技术者可绕过界面直查别的表。
2. **与本系统内部 app 同安全等级**：内部员工现在也是 anon key 直连、没 RLS。经销商是公司分配的已知商业伙伴，Catalog（产品+批发价）本就要给他看，进价已客户端剥除、他人询价靠 `customerId` 过滤——属同一信任圈，MVP 可接受。
3. **硬隔离触发条件**：仅当要对"完全不可信的外部人"开放时才需上 RLS + 真 Auth（Supabase Auth 账号 + JWT 身份），那是一次较大重构，本 PRD 不做。
4. **账号安全**：经销商密码存 `customers.loginPassword`，建议后台强制初始密码 + 提醒修改（可在员工管理/客户管理页加"重置经销商密码"入口，列为可选增强）。

---

## 10. 版本节奏（建议拆 3 个子版本）

| 子版本 | 内容 | 验证重点 | 实际交付 |
|---|---|---|---|
| **V2.1-1 骨架封死** | §7 的路由/菜单/`homeRoute` 三项配置 + 经销商登录已存在 | 经销商登录只进 `/sales/quotes`；手输其他 URL 被弹回；无死循环 | ✅ **已上线**（V2.1-1，2026-09-23） |
| **V2.1-2 经销商分支** | `QuotesView.vue` 的 `role==='dealer'` 分支：列表过滤、隐藏销售单Tab、隐藏客户下拉锁批发价、隐藏修改/删除、归属校验 | A 只看 A；批发价；无越权改/删 | ✅ **已并入 V2.1-1 交付**（老板要求两段合并；另含 V2.1-1.1 的四处修复：归属写 0、经销商无法提交报价单、详情返回键、保存禁用提示） |
| **V2.1-3 状态流 + 实时回传** | ① 新增 `confirmQuote` 动作（draft→sent，回填 confirmedBy/At）；销售「确认询价单」按钮；② 经销商页加 Realtime 订阅（§8.1），确认后即时显示「✅ 已确认」并放开「转销售单」；③ 转销售单按钮对经销商放开 + `converted` 状态展示 | 销售确认后经销商页秒级显示已确认（可断网/重连校准）；转单成功回填 | ⏳ 未做。按 2026-09-24 统一版本规则，本项属「大的功能添加」，实际发版**编号应为 V2.1-2**（本文表格编号为规划期旧编号，以 `docs/版本号规范与总表.md` 为准） |

每个子版本守既有铁律：测试只加不删、收尾 `npx vitest run` 全绿 + `npm run build` 0 错误、版本收口 5 处（`version.ts`/`package.json`/三份文档/版本断言/打 tag）、改菜单必跑 `nav-permission.test.ts`。

---

## 11. 测试点清单

| 类别 | 测试点 |
|---|---|
| 路由守卫 | 经销商访问 `/sales/quotes` 放行；访问 `/sales/orders`、`/customers`、`/purchase/*`、`/finance/*`、`/stock`、`/warehouse/*`、`/boss/*` 一律弹回 `/sales/quotes` |
| 死循环 | 经销商登录后首页正常落地，无重定向回 `/login` |
| 列表隔离 | 经销商 A 列表不含 B 的单；销售列表含全部经销商单 |
| 价格 | 经销商界面不渲染进价字段；新建单价格模式为批发价 |
| 新建 | 经销商新建单 `customerId` 自动=自身、`kind='sale'`；无客户下拉 |
| 详情 | 经销商打开非自身单被弹回列表；无"修改/删除"按钮；有"查看/转销售单" |
| 转单 | 经销商点转销售单 → `status='converted'` 且 `convertedSaleOrderId` 回填；销售单不对经销商开放 |
| 销售改单 | 销售改经销商单后，经销商刷新可见更新内容 |
| **实时回传** | 销售点「确认询价单」后，经销商页（已挂载订阅）在秒级内显示「✅ 已确认」并放开「转销售单」；模拟断网重连后 `listQuotes` 仍能校准到 `sent` |
| **确认动作** | `confirmQuote` 仅将 `draft→sent` 不改明细；`converted`/`void` 单不可再确认；审计字段 confirmedBy/At 回填 |
| **发布配置** | 实施时确认 `quoteOrders` 已加入 `supabase_realtime` 发布（可用一个最小订阅冒烟测试验证事件可达） |
| 权限回归 | `nav-permission.test.ts` 确认 dealer 菜单仅报价单 |

---

## 12. 待决策问题（开工前需老板拍板）

- **Q1 经销商建单的 `salesId` 怎么填？**
  现 `createQuote` 会把 `salesId` 写成当前用户 id（=经销商自己），语义偏。建议：经销商建单时把 `salesId` 固定写成某个内部员工（或 0/留空），避免污染"销售业绩"报表。需老板指定固定值或规则。
- **Q2 转销售单后，经销商是否需要看到"已生成销售单号"提示？**
  当前方案经销商不进 `/sales/orders`，只需在报价单页显示"已转销售单（单号 XXXX）"即可。确认是否足够。
- **Q3 经销商目录/商品是否需要搜索、分类筛选？**
  本期仅报价单页内选商品（复用现有商品选择）。若经销商商品量大，后续可加搜索。先确认本期是否够用。
- **Q4 是否允许经销商提交询价单后小改（未转单前）？**
  方案 A：提交后只读，只能等销售确认/转单；方案 B：提交后允许自己小改直到 `converted`。建议 A（流程更清晰，符合"窗口买票"）。需确认。
- **Q5 是否需要"重置经销商密码"后台入口？**
  列为可选增强，不阻塞本期。

---

## 13. 与既有规划的衔接

- 本 PRD 是老板"深度开发"路线中**最先落地的对外模块**，与 `docs/ERP深度开发可行性研究报告.md` 的"经销商自助门户"一致。
- 与"款到发货校验"（先款后货规则）不冲突：经销商转成的销售单，仍走公司现有"款到发货"流程（若后续开发）。
- 与"换货建模"（退货单号引入新销售单）正交：经销商转成的销售单，将来若发生换货，同样适用该方案。
- 不依赖 Supabase Auth / RLS（见 §9），本期零额外成本；实时回传用的 Realtime 在 Free 套餐同样免费（见 §8.1）。
