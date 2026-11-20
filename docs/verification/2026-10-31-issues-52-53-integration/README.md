# #52 / #53 前后端真实联调（2026-10-31）

## 结论

在 admin-flow 的 c61e42858cd86cd933f53a863358f0cd2d1e4c34 上，使用生产前端、真实 FastAPI 和独立 PostgreSQL 完成联调。浏览器共 **13 组：12 通过、1 失败**；失败项为 390px 视口的队列导航横向溢出。审核与分派业务流程通过，但本轮整体结果仍为 FAIL，不能表述为全部验收通过。

| 检查层级 | 本次实际结果 | 证据 |
| --- | --- | --- |
| Chrome 真实页面 → 同源代理 → API → PostgreSQL | 12 PASS / 1 FAIL；页面 JavaScript 异常为 0 | [browser-results.json](browser-results.json) |
| 数据库与浏览器读取结果复核 | 22 张工单状态、版本、负责人、分派记录、事件一致；当前分派唯一索引存在；账户状态恢复通过 | [database-results.json](database-results.json) |
| #52/#53 前端组件回归 | 15 passed，0 failed / skipped；使用组件测试原有 Mock | [frontend-components.xml](frontend-components.xml) |
| #53 专项与 Workflow 后端回归（包含 #52 审核） | 45 passed，0 failed / errors / skipped；使用另外的临时测试数据库 | [backend-workflow.xml](backend-workflow.xml) |
| TypeScript 检查与生产构建 | npm run build 成功；VITE_USE_MOCK=0 | [verification.json](verification.json) 中记录工具版本及构建文件摘要 |

上述检查层级不能相加为一组端到端通过数量。未重新执行历史记录中的后端 748 项全量回归。

## 浏览器场景

| 场景 | 结果及实际检查 |
| --- | --- |
| #52 审核队列 | PASS：22 张真实 API 创建的工单分为 20+2 两页，无重复；优先级筛选使用真实参数，应用筛选后清除游标 |
| #52 审核通过 | PASS：从队列打开详情与弹窗，设置 HVAC / HIGH，进入 PENDING_ASSIGNMENT，版本 1→2；详情时间线、审核队列移除与待分派队列出现一致 |
| #52 驳回 | PASS：空原因在页面拦截且没有发出审核请求；直接 API 空原因返回 422；填写原因后进入 REJECTED，时间线显示原因 |
| #52 非法优先级 | PASS：URGENT 返回 422 / VALIDATION_ERROR，不改变状态、版本或事件 |
| #52 两个管理员会话 | PASS：均基于旧版本打开弹窗，第二会话先批准；第一会话提交返回 409 / TICKET_VERSION_CONFLICT，弹窗关闭并显示冲突提示，页面刷新为胜出结果 |
| #53 分派及展示 | PASS：102 名启用维修人员需要读取两个候选页；停用账户和 Admin 不在候选中；页面完成分派后显示负责人、分派人、分派记录及事件，工单移出待分派队列 |
| #53 处理权限 | PASS：当前被分派维修人员可访问真实详情，并从页面开始处理；其他维修人员的详情返回 404；Reporter 没有分派按钮 |
| #52/#53 越权 | PASS：Reporter / Technician 无权进入两个管理员队列；直接真实审核与分派 API 对 Reporter 返回 403、对不可见工单的 Technician 返回 404，工单无变化 |
| #53 两个管理员会话 | PASS：同版本弹窗选择不同维修人员，先提交者成功，后提交者 409；页面刷新到胜出负责人，仅一条当前分派及一条 TICKET_ASSIGNED 事件 |
| #53 候选加载后被停用 | PASS：管理员另一会话停用已加载候选；提交返回 422，页面维修人员字段标红且保留弹窗；失败无状态或事件变化，改选有效候选后成功 |
| #53 没有启用候选 | PASS：临时停用全部 102 名候选，重新加载页面后显示提示，确认分派按钮禁用，工单保持待分派；结束时恢复原启用状态 |
| #53 优先级与队列切换 | PASS：HIGH 筛选仅显示 HIGH 的 PENDING_ASSIGNMENT 工单；切换审核／分派队列后筛选重置 |
| #53 390px 手机布局 | **FAIL**：document.scrollWidth=394，而 window.innerWidth=390；溢出元素为队列切换的 nav.form-actions，右边界 394 |

浏览器的两个管理员上下文使用同一个演示 Admin 账户、独立会话；验证的是两个用户操作窗口先后提交旧版本的冲突处理。真正同时提交的竞争和事件落库失败回滚，由本次后端 45 项回归中的并发、回滚测试补充验证。

## 已发现问题

手机视口下，DispatchWorkbenchPage 的队列导航复用 form-actions 类。共享 responsive.css 中该类在手机断点采用 sticky、左右负边距和 padding；本次测得导航右边界超出视口 4px。测量在 browser-results.json 的 mobile_layout 字段，见 [手机截图](mobile-pending-assignment.png) 和 [失败时截图](failure.png)。这是本次实际失败，不是测试跳过，也没有放宽断言。

建议由前端负责人舒玺悦核对队列导航与共享表单操作栏样式的复用边界。若后续修改共享 responsive.css，应协调表单页面维护者，回归其他手机表单；本轮只做测试与记录，未修改产品 CSS。

其他截图：[审核队列](review-queue.png)、[待分派队列](pending-assignment.png)、[驳回详情](rejected-ticket.png)、[分派成功](assigned-ticket.png)、[分派冲突](assignment-conflict.png)、[停用候选字段错误](disabled-candidate.png)、[无可用维修人员](no-active-technicians.png)。已人工查看分派成功、停用候选及手机截图。

## 版本、环境与隔离

- macOS ARM64；Python 3.12.13；PostgreSQL 17.11；PGTZ=UTC；后端依赖为仓库 requirements-dev.lock。
- Node 24.15.0；前端使用现有 package-lock.json 与 node_modules；Vite 5.4.21；Playwright 1.64.1；真实 Google Chrome 156.0.8078.76，无头运行。
- Web：http://127.0.0.1:41752；真实 API：http://127.0.0.1:8052；API 请求由现有 Vite preview 代理，浏览器使用同源 Cookie。生产前端编译时显式设置 VITE_USE_MOCK=0。
- 数据库仅用于本次联调：campusfix_dispatch_e2e_20261031，位于先前创建的独立临时 PostgreSQL 实例。未使用项目已有业务数据。迁移来自 Alembic，种子来自 app.seed。
- 额外账户只有虚构 example.invalid 地址；102 名启用和 1 名停用 Technician 用于候选分页及失效校验。密码仅保存在权限为 0600 的本机临时环境文件，不纳入报告。
- 浏览器业务测试无响应拦截、无 Mock、无跳过；准备工单与设置账户状态使用真实 HTTP API。SQL 只用于初始账户夹具和最后只读核对。
- 开始时工作树干净；已核对 origin/admin-flow 为相同 c61e428。#52/#53 在本轮开始时均已 CLOSED；本轮未修改 Issue 状态。

## 复现

使用新的专用数据库，名称必须以 campusfix_dispatch_e2e_ 开头。配置 DATABASE_URL、SECRET_KEY、三项 SEED_*_PASSWORD、PGTZ=UTC、ENVIRONMENT=test、ALLOWED_ORIGINS=http://127.0.0.1:41752，并将 ATTACHMENT_STORAGE_PATH 指向专用临时目录。不得对现有业务数据库执行夹具准备。

在 backend 目录，用锁定依赖的 Python 环境执行：

    python -m alembic upgrade head
    PYTHONPATH=. python ../tests/e2e/dispatch-fixtures.py
    python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8052

在另一个终端的 frontend 目录，依次构建并启动：

    VITE_USE_MOCK=0 VITE_API_TARGET=http://127.0.0.1:8052 npm run build -- --outDir /private/tmp/campusfix-dispatch-e2e-dist
    VITE_USE_MOCK=0 VITE_API_TARGET=http://127.0.0.1:8052 npm run preview -- --host 127.0.0.1 --port 41752 --strictPort --outDir /private/tmp/campusfix-dispatch-e2e-dist

Playwright 仅作为本机临时测试工具安装，本轮没有更改仓库的依赖清单：

    npm install --prefix /private/tmp/campusfix-dispatch-browser-tools --no-package-lock --ignore-scripts playwright@1.64.1

在仓库根目录，保持与种子一致的三项 SEED_*_PASSWORD：

    BASE_URL=http://127.0.0.1:41752 PLAYWRIGHT_MODULE=/private/tmp/campusfix-dispatch-browser-tools/node_modules/playwright/index.mjs node tests/e2e/dispatch-browser.mjs
    PYTHONPATH=backend python tests/e2e/dispatch-database-check.py docs/verification/2026-10-31-issues-52-53-integration

默认 Chrome 路径为 macOS 的 Google Chrome，可通过 CHROME_EXECUTABLE 指定其他 Chrome 路径。脚本默认将结果写入本目录；再次运行时可用 RESULT_DIR 指定新目录，避免覆盖历史证据。数据库核对命令的路径应与该目录一致。运行全套浏览器脚本必须使用全新数据库，避免已有工单影响 20+2 分页断言。

组件回归在 frontend 目录执行：

    npm test -- src/test/reviewQueue.test.tsx src/test/assignmentQueue.test.tsx --reporter=default --reporter=junit --outputFile=../docs/verification/2026-10-31-issues-52-53-integration/frontend-components.xml

后端专项在 backend 目录执行。CAMPUSFIX_TEST_DATABASE_URL 必须指向与浏览器联调数据分离的专用测试入口库，测试 fixture 会自行建立并清理临时数据库：

    PGTZ=UTC python -m pytest -q -p no:cacheprovider tests/test_issue53_assignment.py tests/test_workflow_api.py --junitxml=../docs/verification/2026-10-31-issues-52-53-integration/backend-workflow.xml

## 验证限制与工作树

未运行 Docker/Compose、Linux CI、Safari、Firefox、真实手机或 HTTPS。本次维修工作台列表页仍为既有占位页；仅验证被分派维修人员的详情访问与开始处理，不把维修工作台页面算作已实现。未新增产品规则或改变冻结契约。

脚本调试曾因登录标签含必填标记、对优先级选项顺序的错误假设、以及未等待队列异步刷新而失败；修正的是测试选择器与等待条件，未更改业务代码。最终证据来自全新夹具的完整重跑；手机布局失败保留为失败。已有警告为 React Router v7 提示、Starlette TestClient/httpx 弃用提示，以及构建时的 Rollup 注释提示。

本轮新增三个 tests/e2e 脚本及本验证目录；未修改共享实现文件、认证上下文、queryClient.ts、API 契约或冻结基线。测试结束后启动的 API、前端预览和临时 PostgreSQL 已停止。未提交、推送、发布或修改 Issue。
