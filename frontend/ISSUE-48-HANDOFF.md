# #48 舒玺悦交接：Mock 与公共组件

本次基于 [Issue #48](https://github.com/MyeeeeR1kooo/CampusFix/issues/48) 和
[PR #68](https://github.com/MyeeeeR1kooo/CampusFix/pull/68) 的 `ce323d7` 脚手架实现。
交付范围是 Mock 层、六类公共组件、两个开发演示页及验证证据。正式调度、维修、统计、地点和账户页面仍属于各自后续 Issue。

## 启动与演示

在 `frontend/` 中执行（PowerShell）：

```powershell
npm ci
$env:VITE_USE_MOCK='1'
npm run dev
```

- 正式脚手架入口：`http://localhost:5173/login`。登录成功仍进入对应的 `UnbuiltPage`，未替换伙伴的业务路由。
- 组件列表演示页：`http://localhost:5173/mock-preview.html#/queue`。
- 组件详情演示页：在列表点击标题，或打开 `http://localhost:5173/mock-preview.html#/detail/1`。
- 演示页可选择虚构账号登录；普通登录表单则使用下表邮箱。共同密码为 **`campusfix-mock`**，只用于内存 Mock，与后端种子密码无关。
- Reporter A 列表第二页可找到待审核工单，打开详情后可演示确认弹窗和撤销；退出后用其他角色重新登录，能看到当前 Mock 中的更新。
- 刷新页面会重建数据和清除模拟会话；不使用 localStorage、真实 Cookie 或真实个人数据。
- 切换真实后端：停止开发进程，执行 `$env:VITE_USE_MOCK='0'; npm run dev`。请求继续通过原有 `/api` 代理。

| 邮箱 | 角色/用途 |
| --- | --- |
| `reporter01@campusfix.test` | Reporter A，工单 1–8 |
| `reporter02@campusfix.test` | Reporter B，工单 9–10 |
| `technician01@campusfix.test` | Technician A，工单 3–6，含关闭历史 |
| `technician02@campusfix.test` | Technician B，工单 10 |
| `admin01@campusfix.test` | Admin，全部数据 |
| `inactive@campusfix.test` | 停用 Technician，登录返回 401 |

如果终端只有 Node、没有 npm，但已安装依赖，可以用以下等价入口：

```powershell
$env:VITE_USE_MOCK='1'
node node_modules/vite/bin/vite.js
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
```

## 契约与 Mock 行为

所有 API 数据类型从 `src/api/index.ts` 导入，没有新增手写 API 类型副本或修改生成物。启动顺序是
`main.tsx → startDevelopmentMock → installMock → App/AuthProvider → /api/me`。
`DEV` 和 `VITE_USE_MOCK=1` 同时成立才加载 fixture，生产构建不打包 fixture/responder。

初始数据包含八种状态、六类类别、三档优先级、多个楼宇、停用地点和内部备注。每次状态动作均改变后续读取结果，递增版本并追加对应事件。

| 接口组（共 22 个操作） | 行为 |
| --- | --- |
| 登录、退出、当前用户（3） | 裸 User、204 无正文、8 小时模拟会话、失效返回 401 |
| 工单创建/列表/详情（3） | multipart 创建、角色可见性、七类 AND 筛选、时间边界、游标分页 |
| 审核、分派、开始、提交结果、确认、返工、撤销（7） | 状态/归属/角色/版本检查；冲突 409；必填字段错误 422；更新事件/负责人/关闭时间 |
| 留言（1） | 公开/内部备注，非 Admin 不下发内部内容，终态禁止新增，不修改状态/版本 |
| 附件下载（1） | 图片字节、工单可见性；上传随创建和提交结果完成，不增加独立上传接口 |
| 有效地点、管理地点列表/创建/修改（4） | 启停、组合唯一、历史地点快照不随编辑变化 |
| 账户列表/启停（2） | Reporter/Technician 筛选，禁止管理 Admin，停用后不能登录 |
| 统计（1） | 从当前内存工单重新聚合六组数据，上海自然日 30 天趋势及零值 |

失败返回真正的 `Response` 和统一 `ErrorResponse`，继续经过原有 `ApiError`、401 handler、409 QueryClient 逻辑。
Mock 开启时未知 `/api/` 路径返回 404，避免拼错路径时意外访问真实后端；关闭开关后不拦截任何请求。

`createMockApi({ now, emptyTickets })` 可用于独立测试，实例间状态隔离；`expireSession()` 用于重现会话过期。
分页按 `created_at DESC, id DESC`，游标绑定用户、路径和筛选，不提供 `total/page/offset`。
图片检查数量、大小、内容签名及浏览器解码；全部校验成功后才提交内存修改。返工保留已有结果图片额度。

## 公共组件接入

统一从 `src/components` 导入，具体 props 见 [CONVENTIONS.md](./CONVENTIONS.md) 的公共组件接口表及各组件导出的 Props。

- `DataTable<T>`：调用方提供列渲染、rowKey；支持加载、错误/重试、空结果；手机沿用原样式变为卡片。
- `FilterBar`：调用方通过 RHF/Zod 或组件状态提供字段，应用/重置筛选时同时清空游标历史。
- `StatusBadge` / `PriorityBadge`：直接使用契约枚举及既有展示词表，保留文字和图形。
- `Timeline`：接收 API 已授权过滤的条目，按时间/kind/id 排序；不得用它替代服务端内部备注过滤。
- `ConfirmDialog`：调用方控制开关和 mutation；支持异步防重复、错误保留、Tab 焦点约束、Escape、背景 inert 和关闭后焦点恢复。通过 children 放入业务字段。
- `Pagination`：父页面保存游标历史，`onNext` 接收原样游标；无下一页时禁用 Next。

`QueuePreviewPage` 与 `DetailPreviewPage` 都直接复用 `DataTable`、状态标签和优先级标签。
列表页另外复用筛选器/分页，详情页复用时间线/确认弹窗。它们有独立路由和实际 API 调用，不是仅用于测试的虚构消费者。
演示入口仅由 Vite 开发服务器提供，默认生产构建仍只有既有 `index.html`。

## 验证记录

验证日期：2026-10-04。本机使用 Node 24，按现有 package-lock 安装，没有升级依赖。

| 检查 | 结果 |
| --- | --- |
| 原脚手架基线 | 7 文件 / 126 测试通过 |
| 完整前端测试 | 10 文件 / 168 测试通过（新增 42，含自查补充的 3 项回归） |
| TypeScript | `tsc -b` 通过 |
| 生产构建 | Vite build 通过；产物不含 Mock 账号、游标实现或 responder |
| 契约生成 | 从 `base-auth` 的 `0ba628b` 原稿在临时目录重新生成，与已提交类型正文完全一致，digest 为 `f126bda3e32b`；未修改生成文件 |
| 浏览器冒烟 | 本机 Edge：1366px 桌面和 390px 手机宽度、两个演示页、焦点循环/Escape、撤销、真实图片解码与字节下载、损坏图片回滚、脚手架登录/退出均通过；无 pageerror |
| 视觉检查 | 已检查桌面、手机、确认弹窗截图；修正手机筛选字段继承的桌面 flex-basis，未出现水平溢出 |
| 范围检查 | `git diff --check` 通过；API、生成类型、原业务路由、依赖锁文件和后端均未改动 |

新证据分别位于 `src/test/mockApi.test.ts`（29）、`components.test.tsx`（8）、`mockPages.test.tsx`（5）。
Mock API 测试覆盖 FR-01–12 / UC-01–05 的前端替身行为和失败路径，不替代这些需求的后端/E2E 验收。

### 自查修复（2026-10-04）

自查发现以下三处问题，均先以新增测试复现失败，再修复；修复后 168 项测试、`tsc -b`、Vite build 均通过。

| 问题 | 修复 | 本轮修改文件 |
| --- | --- | --- |
| Mock 用 trim 改写首尾空白，也会在长度校验前缩短输入 | 必填检查保留，原文和换行原样保存，长度检查使用原始内容 | `src/mocks/protocol.ts`、`src/test/mockApi.test.ts` |
| q 筛选可能跨编号与标题的拼接边界命中 | 分别匹配 code 或 title，再合并判断 | `src/mocks/responder.ts`、`src/test/mockApi.test.ts` |
| 撤销 409 后刷新出不可撤销的新状态，已打开弹窗仍可重复点击确认 | 详情刷新期间以及 allowed_actions 不再包含 CANCEL 时禁用确认，显示当前动作已失效的说明 | `src/mocks/preview/DetailPreviewPage.tsx`、`src/test/mockPages.test.tsx` |

本节同步修改 `ISSUE-48-HANDOFF.md`；本轮共涉及上述 6 个文件，未扩展 API、业务状态或正式页面范围。

### #46 日期契约对齐（2026-10-06）

按 `base-auth@841a011` 的 P0 基线 §5.1 / OpenAPI 说明，工单编号日期与统计趋势日期均取 `Asia/Shanghai` 自然日。修复种子工单及新建工单从 UTC 时间戳截取日期的问题；两处编号生成和统计趋势共用 `shanghaiDate`，由明确指定时区的 `Intl.DateTimeFormat` 转换。创建、更新及事件时间仍保留 UTC ISO 字符串。

- 新增 6 项 API 回归，覆盖上海午夜前后、跨月、跨年、种子编号、趋势计数与 UTC 时间戳。修复前 4 项失败、2 项通过；修复后 Mock API 35 项及完整前端 174 项（10 文件）全部通过。
- `tsc -b`、Vite 生产构建和 `git diff --check` 通过，产物未包含 Mock 标记；在临时前端副本中使用最新契约生成类型（摘要 `779110f98c95`）进行 TypeScript 兼容检查也通过。
- 本轮只修改 `src/mocks/fixtures.ts`、`src/mocks/responder.ts`、`src/test/mockApi.test.ts` 和本交接文档，提交到原 PR #69。未修改 API、后端、生成类型或依赖；未重跑浏览器和真实后端/E2E。

## 实际修改文件

| 文件 | 作用 |
| --- | --- |
| `src/mocks/fixtures.ts` | 虚构账号、地点和多状态工单 |
| `src/mocks/protocol.ts` | Response/错误、输入校验、游标 |
| `src/mocks/responder.ts` | 22 操作的有状态内存实现 |
| `src/mocks/bootstrap.ts` | DEV 条件挂载 |
| `src/main.tsx` | 渲染前等待挂载，消除首次会话探测竞态 |
| `src/components/DataTable.tsx` | 共享表格 |
| `src/components/FilterBar.tsx` | 共享筛选表单 |
| `src/components/StatusBadge.tsx` | 状态/优先级标签 |
| `src/components/Timeline.tsx` | 时间线 |
| `src/components/ConfirmDialog.tsx` | 确认弹窗 |
| `src/components/Pagination.tsx` | 游标分页 |
| `src/components/index.ts` | 公共导出 |
| `mock-preview.html` | 独立开发入口 |
| `src/mocks/preview/main.tsx` | 演示入口的 DEV 守卫 |
| `src/mocks/preview/PreviewApp.tsx` | 复用认证与查询 provider、示例账号切换 |
| `src/mocks/preview/QueuePreviewPage.tsx` | 列表演示消费者 |
| `src/mocks/preview/DetailPreviewPage.tsx` | 详情演示消费者 |
| `src/styles/components.css` | 现有样式小节补充换行、按钮间距和演示容器 |
| `src/styles/responsive.css` | 手机筛选栏字段高度与按钮布局修正 |
| `src/test/mockApi.test.ts` | Mock 行为/失败路径/共享错误链路测试 |
| `src/test/components.test.tsx` | 六类组件与键盘测试 |
| `src/test/mockPages.test.tsx` | 两页复用、角色缓存隔离、脚手架挂载/401 |
| `CONVENTIONS.md` | 组件接口与 Mock 归属同步 |
| `README.md` | 启动方法与完成状态同步 |
| `ISSUE-48-HANDOFF.md` | 本交接记录 |

## 未验证项与后续交接

- 未连接真实 FastAPI/PostgreSQL，未运行真实三角色后端/E2E、Cookie/Origin 安全或数据库事务测试；本次不涉及后端实现。
- Mock 拦截位置是现有 API client，不接管原生 `<img src="/api/...">`。开发时需要展示上传图，应通过 `api.downloadAttachment` 获取 Blob，再创建/释放 Object URL。下载 URL 字段仍保持契约规定的受保护相对路径。
- 内存 Mock 只模拟当前浏览器页面的会话；刷新重置，不提供跨页面/跨标签会话持久化。文件校验使用浏览器解码，与后端文件解码器不是同一实现。
- #46 尚未合并。已核对最新 `base-auth@841a011`，其中分派目标无效的 `422 / VALIDATION_ERROR`、`technician_id` 字段错误及 `AssignValidationError` 别名沿用 `ee45906` 的约定；编号日期已按最新说明修复。契约中的两处 403 声明/清单矛盾已记录在 [#65 review](https://github.com/MyeeeeR1kooo/CampusFix/pull/65#pullrequestreview-5418130475)。已提交生成类型仍为伙伴脚手架的原稿摘要 `f126bda3e32b`；最新类型仅在临时副本验证兼容，待契约评审后与接口负责人统一更新。
- React Router 的既有 future-flag 提示、Zod 的 Rollup 注释提示不影响测试和构建；本次没有为消除提示调整依赖或脚手架配置。
- 本次变更基于 `reporter-flow` 的脚手架提交 `ce323d7`，通过独立分支 `codex/48-mock-shared-components` 交付。#68 合并前以 `reporter-flow` 为 PR 目标分支，合并后可调整到 `main`。开始时工作区干净；全部变更均为本次任务，原有 `AppLayout`、`Field`、`Icon` 和伙伴文件实现保留。本次不包含合并或部署。
