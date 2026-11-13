# Issue #51 / #54 联调验证记录（2026-10-26 执行，2026-10-30 补录）

## 记录性质与版本

本文件补录 2026-10-26 在 `reporter-flow@71b08ec834c14f6cacea2b9a5fd1126f47ea0cd8` 上实际执行的检查。2026-10-30 写入本文件时，工作分支为 `main@a5a3028`，且 `71b08ec` 是其祖先。下列测试数字来自此前会话中的命令返回与脚本输出；**补录当天没有重新运行这些测试**。本记录不把过去的结果冒充当前 HEAD 的新鲜验证，也不替代 Issue 或 PR 的最终验收。

范围：#51 报修创建、列表、详情与撤销，以及 #54 照片、授权下载与留言的前后端接入；同时检查 PR #103 的共享工单详情组件与 `App.tsx` 路由集成。

## 组件和调用路径检查

- `frontend/src/app/App.tsx` 将 `/reports`、`/reports/new` 和 `/tickets/:ticketId` 分别接到 `MyReportsPage`、`CreateRepairPage` 与共享 `TicketDetailPage`。
- 创建页复用 `LocationCascade`、`PhotoPicker` 和 `api.createTicket`；列表页通过 `api.listTickets` 使用状态筛选与游标分页。
- 共享详情页复用 `TicketStatusStrip`、`TicketActionZone`、`Timeline`，并组合 `TicketPhotoGallery` 和 `CommentComposer`。照片经受保护的 `api.downloadAttachment` 读取；留言使用 `api.createComment`，可用操作取自服务端 `allowed_actions`。
- 这些是当时对 `71b08ec` 的代码检查结果；没有新建第二套详情路由或详情动作组件。

## 实际执行结果

| 层级 | 当时执行/观察到的证据 | 结果 |
| --- | --- | --- |
| 前端回归 | `frontend/` 中运行 `npm test -- --no-cache` | 15 个测试文件、278 项测试通过 |
| 前端构建 | `frontend/` 中运行 `npm run build`，包含 `tsc -b` 与 Vite 生产构建 | 退出码 0；构建完成 |
| 后端专项 | 隔离 PostgreSQL 17.11 上运行 `test_ticket_attachment_handoff.py`、`test_ticket_creation_api.py`、`test_ticket_list_api.py`、`test_ticket_detail_api.py`、`test_comments_api.py`、`test_attachments.py` | 110 passed，1 条 Starlette/TestClient 弃用警告 |
| 本机真实 HTTP | 临时 PostgreSQL、Alembic 迁移、虚构种子、Uvicorn；`tests/e2e/reporter-flow-smoke.mjs` 访问 `http://127.0.0.1:8091` | `result: PASS`；照片 77 字节，第一页 20 条、第二页 2 条，撤销终态 `CANCELLED` |
| 真实浏览器 | 无头 Chrome 访问生产构建的 Vite preview，经同源 `/api` 代理访问临时真实后端 | Reporter 登录、地点级联、带图创建、图片解码显示、共享详情状态/时间线、公开留言、撤销及终态只读均通过；除登录前预期的 `/api/me` 401 外，无非预期 API 错误 |
| Docker 全栈 | Docker Desktop 4.96.3、Engine 29.9.2、Compose v5.6.1；独立项目 `campusfix-51-54-verify`，Web 端口 18090 | API/Web 镜像构建成功；迁移完成；PostgreSQL、API、Web healthy；`/health` 为 HTTP 200；Web 返回真实 SPA 资源 |
| Docker HTTP 冒烟 | 同一脚本经 `http://localhost:18090` 的 Web/nginx 入口访问容器 API | `result: PASS`；工单 `CF-20261026-000001`，照片 77 字节，分页 20/2，地点快照保留，终态 `CANCELLED` |

HTTP 冒烟脚本覆盖三角色登录、带图创建、列表可见范围/筛选/游标、详情和时间线、授权附件下载、公开及管理员内部留言的可见性、地点改名停用后的快照、撤销和终态新增留言 409。脚本在结束时恢复临时修改的地点。Docker 测试结束后，已通过 `docker compose -p campusfix-51-54-verify down --volumes --remove-orphans` 删除该项目的容器、网络和专属数据库/附件卷；随后列举容器及卷，结果为空。

## 证据边界与未验证项

- 本记录依据此前会话中实际返回的命令输出补录；没有随仓库保存 JUnit、Docker 日志或浏览器截图。一次性浏览器脚本位于临时目录，不是仓库内可重放测试。需要独立审计时应在目标提交重新运行并保存机器可读结果。
- 浏览器实测仅覆盖 Reporter 主流程；Admin/Technician 的相关权限由专项后端测试、前端组件测试和 HTTP 冒烟脚本覆盖，**没有在这轮 Docker 栈中逐角色重跑浏览器流程**。
- 这轮 Docker 全栈没有重跑完整后端测试集，也没有验证远端 CI、真实 HTTPS 部署或其他操作系统的浏览器。历史的 736 项后端结果属于 2026-10-24 的[另一轮记录](2026-10-24-issue51-54-frontend-e2e.md)，不能算入本轮。
- 首次尝试后端专项时，本机默认 Python 缺少 `alembic`；改用锁定依赖的隔离 Python 环境后，沙箱内 TCP 连接被拒；在获准的本机执行环境重跑后取得上述 **110 passed**。这些环境失败不是业务断言通过，也不是最终专项结果。
- Docker Desktop 因 Homebrew 系统级链接需要管理员密码，最终从官方 DMG 复制到 `/private/tmp/CampusFixDocker.app` 运行；这不是持久的系统级安装。测试栈已清理，Docker 应用副本与当时挂载的 DMG 不属于仓库交付物。

## 仓库状态与协作

本次补录仅新增本文件，不修改前后端代码、共享 `App.tsx`、API 契约、冻结基线或测试。因未修改共享实现文件，没有新的交叉修改风险。本文描述的是历史验证，不自动关闭 #51/#54，也不代表已推送、合并或发布。
