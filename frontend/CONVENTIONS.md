# 前端目录与接口约定（#48 交付物）

脚手架只搭一次，两人共用。这份文件就是"共用"的具体内容：目录归谁、请求怎么走、类型从哪里来、
Mock 往哪里挂。改任何一条都要在 Issue 里说，不要直接改代码就完事。

负责人：**张越**（脚手架、路由表、请求封装、目录规范、Mock 挂载点）｜
**舒玺悦**（Mock 层、公共组件库、管理员与维修端页面）。
分工要求两人**不互相改对方的文件**——下面每一条都按这个边界划。

依据只有两个：**P0 冻结基线**（§8.2 同源、§13.1 九个页面、§13.2 状态管理、§13.3 交互与错误处理）
和 **#46 的 API 契约**。旧 PRD 已作废（`b8ed6e6`），不要再引用它；本仓库里没有的 `API_SPEC.md`
`UI_SPEC.md` 等本地文档也不是团队契约。

## 1. 目录归属

| 路径 | 归谁 | 内容 |
| --- | --- | --- |
| `src/api/generated/` | 机器生成 | `npm run gen:api` 的产物。**不手改，也不许在 `src/api/` 之外 import 这个路径** |
| `src/api/index.ts` | 张越 | 类型接缝：应用层唯一可以拿到契约类型的地方 |
| `src/api/client.ts` | 张越 | 唯一的 `fetch` 调用点；信封解析、`ApiError`、401 回调注册 |
| `src/api/endpoints.ts` | 张越 | 一个操作一个函数，路径与查询串严格按契约 |
| `src/api/mockBridge.ts` | 张越 | Mock **挂载点**：开关 + `MockResponder` 接口 |
| `src/mocks/` | 舒玺悦 | Mock 数据、responder、启动挂载和开发演示；不进 `api/` |
| `src/app/App.tsx` | 张越 | 路由表 + provider 顺序 + 角色门 |
| `src/app/{ErrorBoundary,ProtectedRoute,StatePages}.tsx` | 张越 | 壳层与状态页 |
| `src/lib/queryClient.ts` | 张越 | QueryClient、query key 工厂、§13.3 的 409 行为 |
| `src/lib/{errors,labels}.ts` | 张越 | 错误分类；以生成枚举为 key 的展示词表 |
| `src/components/` | 舒玺悦 | 公共组件库：表格、筛选器、状态标签、时间线、确认弹窗、分页 |
| `src/components/{AppLayout,Field,Icon}.tsx` | 张越（临时） | 壳层与登录页当前必需的三件；舒玺悦接手后由她搬走 |
| `src/features/<domain>/` | 该域的负责人 | `auth`/`tickets` 张越｜`dispatch`/`technician`/`locations`/`analytics`/`users` 舒玺悦 |
| `src/hooks/` | 谁先需要谁写 | 第二个使用者若要改语义，开 Issue |
| `src/test/` | 各自测各自 | `AGENTS.md` §6 规定前端证据只放这里 |

### #48 公共组件接口（舒玺悦）

统一从 `src/components/index.ts` 导入；组件不请求接口、不推断权限，不另存服务端状态。

| 文件 / 导出 | 接口与责任 |
| --- | --- |
| `DataTable.tsx` / `DataTable<T>` | `rows`, `columns`, `rowKey`, `caption`；支持 loading/error/empty，移动端沿用 `data-label` 卡片样式 |
| `FilterBar.tsx` / `FilterBar` | 有名称的筛选表单，`children`, `onSubmit`, `onReset`, `busy`；字段由调用页用现有 Field + RHF/Zod 提供 |
| `StatusBadge.tsx` / `StatusBadge`, `PriorityBadge` | 接收生成类型中的 status/priority，沿用 labels 的文字、图标和色调 |
| `Timeline.tsx` / `Timeline` | 接收 API 已授权过滤的 `TimelineEntry[]`，按时间/kind/id 排序；事件和留言不混用 key |
| `ConfirmDialog.tsx` / `ConfirmDialog` | 受控 `open`, `onConfirm`, `onCancel`, `pending`；确认期间防重复、焦点约束、Escape、关闭后优先恢复原触发元素；原元素无法聚焦时使用可选 `fallbackFocusRef`（目标应支持编程聚焦）；业务表单通过 children 注入 |
| `Pagination.tsx` / `Pagination` | `nextCursor`, `hasPrevious`, `onNext(cursor)`, `onPrevious`, `busy`；只认识游标，不虚构总数/页数 |
| `src/mocks/preview/` | #48 开发演示：两个独立页面消费同一公共库，不替代后续业务页面 |

开发 Mock 在 `src/main.tsx` 渲染前经 `src/mocks/bootstrap.ts` 挂到现有 bridge；仅 DEV 且
`VITE_USE_MOCK=1` 时加载。`src/api/`、路由、生成文件和伙伴现有组件保持原有实现。

`src/routes/` 暂时为空：路由表在 `app/App.tsx` 里，它同时是 provider 树。要拆成独立模块由张越提
Issue，不在页面 PR 里顺手做。

`features/users/`（账户管理，#49）的路由已经声明，页面还没有；先渲染 `UnbuiltPage` 并写明归属。

`src/styles/components.css` 已随脚手架预置公共组件库的视觉层，包括 TSX 尚不存在的组件（状态轨
道、工单卡片等）：这些小节不是死代码。舒玺悦实现 `src/components/` 时按既有类名取用，覆盖不到
的在对应小节补，不另起样式来源。

## 2. 类型：只有一个来源

- 契约类型来自 `docs/api/openapi.yaml`，用 `npm run gen:api` 生成。**不得手写第二套**枚举、字段
  或分页形状——§13.2 就是这么定的，#48 的验收项也写着"无手写重复定义"。
- 应用层只从 `src/api`（即 `src/api/index.ts`）取类型。这条限制是为了让 #46 冻结时**只改一个文件**：
  重新生成 → `index.ts` 报错 → 修那里，而不是全仓库搜索谁 import 了某个类型。
- `src/lib/labels.ts` 里每张表都是 `Record<枚举, 文案>`。枚举改名或增减会**编译失败**，不会在页面上
  渲染出 `undefined`。`STATUS_ORDER` 之类的顺序表直接从这些表 `Object.keys()` 派生，不再抄一遍枚举。
- `src/test/{endpoints,labels,errors}.test.ts` 从生成文件的**文本**里读出枚举和路径做清点。这样测试
  对照的是契约，不是某个测试作者记得的清单；清点本身也断言了数量，避免正则匹配不到东西时"全绿"。

## 3. 请求约定

- **禁止**在 `src/api/client.ts` 之外调用 `fetch`。会话凭据是 HttpOnly cookie，SPA 不持有 token，
  因此请求里**不得**手工塞 actor、role 或 `X-Actor`。
- 成功体就是契约声明的那个对象，**没有** `{ user }` / `{ data }` 之类的包裹：登录返回裸 `User`，
  统计返回裸 `Analytics`。`logout` 是 204，不解析正文。
- `TicketFields.code` 是服务端生成的展示用编号 `CF-YYYYMMDD-NNNNNN`。前 8 位是**创建时刻的
  Asia/Shanghai 本地日期**（`841a011` 把这条写进了契约，与统计趋势同一时区），不是 UTC，也不保证与
  `created_at` 换算后的 UTC 日相同。前端**只原样渲染**：不切片、不反推日期、不做时区换算、不拿它排序
  当日工单。要显示时间请用 `created_at` / `closed_at`。
- 失败一律是 `ApiError`，带 `code`（八选一）、`message`、`requestId`、`fieldErrors[]`。判断用
  `isConflict` / `isNotFound` / `isDenied` / `isUnauthorized`，不要比字符串。
- 分页只有 `cursor` + `limit`，响应只有 `items` + `next_cursor`（没有 `total`、没有 `page`、没有
  `offset`）。筛选走 `buildQuery()`：空值不下发。
- `FieldError` 是数组 `{field, message, type}`，`field` 是点分路径。`ApiError.fields` 已经把它归一成
  `{字段: 文案}`，直接喂给 React Hook Form 即可，不要在页面里再解析一遍。
- 写请求需要允许的 `Origin`（`ORIGIN_NOT_ALLOWED` → 403）。浏览器自己带，前端**不要手工设置**。
  开发态在 `:5173` 上跑，需要 #45 把 `ALLOWED_ORIGINS` 配上这个来源；被 403 挡住时去 Issue 里说，
  不要在前端绕过去。

## 4. Mock 挂载点

```ts
installMock(async (req) => {
  if (req.method === "GET" && req.path.startsWith("/api/tickets")) {
    return jsonResponse({ items: [...], next_cursor: null });
  }
  return null;            // 交回真实后端
});
```

- 开关是环境变量 `VITE_USE_MOCK=1`，**逐请求**读取，所以测试里可以翻。开关关掉、或没装 responder
  时，请求照原样打到 `/api`——这是 #48 的验收项。
- responder 必须返回 `Response`（或 `null` 放行），不能返回普通对象。理由：返回 `Response` 才会继续
  走 `toApiError`、204 规则和解包这一条**与真实后端相同**的路径；返回裸对象会让 Mock 测到一套后端
  并不产出的线格式。
- 数据形状按 `src/api` 的生成类型来。契约尚未冻结时按草案，字段对不上就在 #46 里提，不要私下改形状。
- 挂载点在 `client.ts` 的 `fetch` 之前，因此挂上 TanStack Query 之后开关语义不变。

## 5. 路由表与权限

`App.tsx` 声明基线 §13.1 的全部九个页面。本分支只实现 `/login`；其余渲染 `UnbuiltPage`，页面上写明
该路由归谁，避免"空页面看起来像好页面"。

角色门（`RequireRole` / `RequireSession`）只是导航表现，**不是权限控制**：`AGENTS.md` §6 明确禁止把
隐藏按钮或路由守卫当授权，每个决定都由服务端按会话重新做出。前端因此**不得**依赖路由守卫来保护
数据——服务端 401/403 才是边界。

## 6. 错误处理（§13.3，写在两处，不在页面里）

- **401**：`client.ts` 是唯一看见所有响应的地方，它调用 `AuthContext` 注册的 `endSession()`；
  清空后 `RequireSession` 自然把用户带回 `/login`。页面不需要、也不应该自己写跳转。
  迟到的 401 只属于发出它的世代：`client.ts` 在请求发出时打会话世代戳，世代已推进（边界已发生）
  就不再触发 `endSession`——mutation 没有 signal、无法取消，防旧写操作的迟到 401 踢掉新会话
  全靠这条守卫（#68 评审）。
- **会话边界**（退出、401、换账户登录）统一走 `AuthContext`：除了登录状态，还要先 `cancelQueries`
  再 `clear()` 清空查询缓存——上一账户的缓存数据与在途请求不得进入下一个会话（#68 评审）。
  页面和 Mock 预览不得自带第二套清理；`App.tsx` 里 `QueryClientProvider` 必须包在 `AuthProvider`
  外面，`AuthContext` 才拿得到 client。
- **409**（§13.3 v1.1 澄清，已随 #71 评审记录进基线）：`lib/queryClient.ts` 的 `MutationCache.onError`
  按这条 mutation **是不是工单状态动作**分流，而"是不是"由 mutation 自己声明：携带 `expected_version` 的状态动作必须带
  `meta: ticketActionMeta`（从 `lib/queryClient.ts` 导入），命中则提示 §13.3 的"工单已被他人更新"
  并 `invalidateQueries(detail(id))`。`TICKET_VERSION_CONFLICT` 即便漏带 meta 也按工单处理——只有
  工单状态动作产出它。其他资源（例如地点创建/编辑的唯一组合冲突，契约同样声明 409 / CONFLICT）：
  **直接展示服务端 `message`**，不冒充工单文案、不重取工单详情。
  工单创建（如地点停用）和终态留言的 409 也展示服务端 `message`，不触发此处的详情刷新；
  创建和留言不得携带 `ticketActionMeta`。当前 `DetailPreviewPage` 的取消操作已携带该标记。
  **禁止**按 variables 里有没有 `id`/`ticketId` 来猜资源类型——地点编辑也带 `id`（地点的），
  猜把它当成工单，#71 评审修的就是这个。约定不变：工单动作的 variables 必须带 `id` 或 `ticketId`
  （指明是哪个工单），否则只能提示、无法自动重取。
  也不许改成按 `field_errors` 分流：共享的 `Conflict` 组件里 `field_errors` 示例是空数组，那条分支永远不执行。
  上述 409 分流只处理当前会话：上一会话提交的 mutation 迟到失败时，先忽略回调，不提示也不刷新当前会话。
- `VALIDATION_ERROR` 的 `field_errors` 显示在对应控件旁边，页面级摘要另给一条；不要混成一个红条。
- 分类只有契约里的八个 code。以前的 `VERSION_CONFLICT`、`ACCESS_DENIED`、`INVALID_STATE_TRANSITION`
  都不是契约值，看到它们说明有人在手写。

## 7. 并行开发

舒玺悦开始时无需后端：装 Mock、按 `src/api` 的类型取数即可开发四张页面。

- 需要新字段：**先改契约**（#46 里提），不要改 `src/api/index.ts` 来迁就页面——那等于开第二套真相。
- 需要新的公共组件形态：先补本文件 §1 的表格再动手。
- 需要 Query key：用 `lib/queryClient.ts` 里的 `queryKeys`，不要各页自行拼字符串——两个页面拼错一个
  字，失效就静默失效。

## 8. 这次没有带上的东西

- `Dockerfile` / `nginx.conf` / compose：归 #45（那条分支已经在跑了）。
- 登录行为本身（哪些账户能进、会话语义）：归 #47。这里只把 RHF + Zod 的表单接法立起来。§13.1
  给登录页列的演示账户说明与紧急渠道提示，等 #45 的种子账户和 #47 的文案就位后补上。
- 演示账户说明的口径（张越 2026-10-08 定，方案 A）：登录页只列 `backend/app/seed.py` 的三个种子邮箱
  与角色，**不印密码**——密码由 `SEED_REPORTER_PASSWORD` / `SEED_TECHNICIAN_PASSWORD` /
  `SEED_ADMIN_PASSWORD` 注入，`.env.example` 故意留空并要求自行虚构，任何固定密码都不存在。
- 紧急渠道提示按基线 §2.2「第一版不处理的事项」那句写：紧急安全事故、医疗事件和报警使用学校现有紧急渠道，不由 CampusFix 处理。
  面板只列种子的邮箱，规则是「跟随 `backend/app/seed.py`」而不是「跟随某个文档」：种子建哪
  三个地址，面板就列哪三个，`src/test/demoAccounts.test.mjs` 每次运行都拿两侧实文比对。
  曾有「契约 example 用 `reporter@example.invalid`（`openapi.yaml:72`），种子用
  `demo-reporter@example.invalid`」的差异，2026-10-08 由人类决定**不动冻结契约**、改种子
  口径（PR #82，`backend/app/seed.py:21-23`）；根 `README.md:169-171` 的表格随后更新。
  `docs/verification/2026-10-07-docker/` 里带 `demo-*` 的是当时的实跑记录，不回写。
  Mock 模式是另一套账号（`src/mocks/fixtures.ts` 的 `*@campusfix.test`），
  `README.md` 与 `ISSUE-48-HANDOFF.md` 已写明它与种子凭据无关。
- Mock 数据与公共组件库：舒玺悦已接入；使用方法与验证范围见 [ISSUE-48-HANDOFF.md](./ISSUE-48-HANDOFF.md)。
