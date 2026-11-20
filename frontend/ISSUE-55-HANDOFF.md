# #55 维修工作台前端交接

## 范围与依据

- 舒玺悦负责的前端部分：`/assignments` 页面、本人任务列表，以及状态、创建时地点快照、优先级、报修提交时间展示。状态筛选按冻结基线 §13.1 提供；分页遵循 §5.3 的游标契约。
- 依据 [Issue #55](https://github.com/MyeeeeR1kooo/CampusFix/issues/55)、冻结基线 §3.1/3.3、§5.3、§13.1–13.3 和 `GET /api/tickets` 契约。对应 FR-04；为 UC-03 提供查看和进入详情的入口，不代替 #56 开始处理/提交结果验收。
- 分支从最新 `technician-flow@4ea7ad2` 建立，已包含 #52/#53 集成更新；本轮不合并或修改 main。

## 请求与展示

- 复用 `api.listTickets`，仅传 `status`（可省略）、`cursor`（可省略）、`limit: 20`；所有请求沿用共享客户端的同源会话和 AbortSignal。
- 本人归属由后端认证会话限定：`tickets/reads.py` 在分页前应用 `Ticket.current_assignee_id == actor.id`。前端不做另一套归属过滤，不发送管理员专用 `current_assignee_id` 或 actor/role 参数。
- 保留当前仍分派给该维修人员的已关闭工单；不擅自排除历史记录。
- 行内显示 `title`、原始 `code`、`status`、`location_label_snapshot`、`priority` 和 `created_at`。Reported 表示报修创建时间，不是分派时间；工单编号不被拆解或改写。
- 点击标题复用 `/tickets/:id` 详情页，详情原有返回链接回到 `/assignments`。
- 状态筛选在提交/清除时回到第一页；Previous/Next 只消费服务端游标，不虚构总数或页码。加载、无任务、无匹配和错误重试可区分。
- 页面保留 Technician 角色门；401 走共享会话清理并返回登录页，服务端 403 展示拒绝页面。角色门只是导航表现，不能替代后端授权。

共享 `GET /api/tickets` 仍供 Reporter 和 Admin 合法使用；本轮不改变其权限。未登录请求必须被服务端拒绝，其他角色进入 Technician 页面被前端拒绝，工单数据访问始终按冻结角色可见范围处理。不会为迎合页面名称而把共享列表改成 Technician 专用接口。

## 验证

- 新增 `src/test/technicianWorkbench.test.tsx` 11 项：A/B 任务隔离和不可见详情、四类状态及历史工单展示、字段映射、筛选及参数、跨页/返回和筛选重置、空状态、加载与错误重试、未登录和非维修角色拒绝、服务端拒绝后的数据隐藏、会话过期、退出换号后的缓存隔离。
- 定向测试（工作台 + App）：36 项通过。最终完整前端回归：18 个文件、307 项通过；TypeScript、生产构建、`git diff --check` 通过。
- 本地浏览器 Mock 实测：未登录访问 `/assignments` 返回登录页；维修人员 A 登录后看到本人四张任务；筛选 Assigned、进入详情和返回列表正常；默认桌面视口布局已目视检查。
- 既有 Router future flags、sessionCache 的 act 提示和 Zod 构建注释警告仍存在。
- 未运行：本轮真实 FastAPI/PostgreSQL 联调、手机视口和完整三角色 E2E。Mock 可见性测试不代替真实后端授权/数据库证据，后续由林志涛协同验证；本轮不关闭整条 #55。

## 文件与协作

- 新增 `src/features/technician/MyAssignmentsPage.tsx`、`src/test/technicianWorkbench.test.tsx` 和本交接文件。
- 共享 `src/app/App.tsx` 只挂载已声明的 `/assignments` 路由并同步页面说明；`src/test/App.test.tsx` 更新该页面及 Technician 默认落点断言，需与张越后续路由和登录测试改动协调。
- 未修改 queryClient、认证上下文、API 契约、生成类型、冻结基线、后端、依赖或共享样式。
- 新任务列表复用现有公共组件；#56 的处理和结果照片表单保持单独任务边界。
