# Update 3：C7／C8 同版本验收证据

运行日期：2026-11-23（北京时间）。结果 JSON 和 JUnit 的时间戳使用 UTC。被测应用、配置和测试取自 [main@c5b600f](https://github.com/MyeeeeR1kooo/CampusFix/commit/c5b600f16635dd11589a0d93c6592890192e8598)，完整 Git SHA 为 `c5b600f16635dd11589a0d93c6592890192e8598`。本次归档提交只增补验收材料。

## C7 浏览器闭环

08:53:22–08:53:26 在 macOS 26.6.2，使用 Playwright 1.62.1 和 Chromium 153.0.8010.12，连接本机生产构建（Node 24.21.0，`VITE_USE_MOCK=0`）、真实 FastAPI 和迁移至 `0002` 的 PostgreSQL 17.11。三个独立浏览器会话使用虚构的种子账户。**8 个场景通过**，单张虚构工单 `CF-20261123-000001` 从提交走到关闭。

| 操作者和步骤 | 实际结果 | 截图 |
| --- | --- | --- |
| 报修人创建工单，附 1 张报修照片 | 201，`SUBMITTED`，v1 | [创建](02-reporter-create.png)、[已提交](03-reporter-submitted.png) |
| 管理员审核、分派 | 两次 200，`PENDING_ASSIGNMENT` v2 → `ASSIGNED` v3 | [分派后](04-admin-assigned.png) |
| 技师在本人工作台查看、打开并开始处理 | 200，`IN_PROGRESS` v4；本人工单范围同时由后端 #55 专项核对 | [工作台](01-technician-workbench.png)、[本人分派列表](05-technician-assigned-list.png) |
| 技师提交说明和结果照片 | 200，`PENDING_CONFIRMATION` v5；空说明被表单拦下 | [390px 结果弹窗](06-technician-mobile-result-photo.png) |
| 报修人填写原因要求返工 | 200，`IN_PROGRESS` v6，负责人不变；空原因被表单拦下 | [返工](07-reporter-rework.png) |
| 技师再次提交并附第 2 张结果照片 | 200，`PENDING_CONFIRMATION` v7 | [再次提交](08-technician-resubmitted.png) |
| 原报修人确认关闭、原请求重放 | 两次 200，`CLOSED` v8；版本、关闭时间和时间线不变，只有一条 `TICKET_CLOSED` | [已关闭](09-reporter-closed.png) |

首次确认在页面点击。重放在同一浏览器会话以原幂等键和版本发出相同请求，验证服务端幂等；不把它记作界面上第二次点击。见[脱敏浏览器 JSON](browser.json)中的九次动作响应和事件序列，以及[同一工单的只读数据库核查](database.json)：最终 8 条事件、1 条关闭事件、3 个照片附件。390px 截图只验证维修结果弹窗，不用于关闭 R9 的队列导航缺陷。

复跑时在上述 **被测 SHA** 启动全新的隔离 test DB（先执行 `alembic upgrade head`、`python -m app.seed`），FastAPI 绑定本机 `127.0.0.1:41824`，生产构建和 Vite preview 使用 `VITE_USE_MOCK=0 VITE_API_TARGET=http://127.0.0.1:41824`，绑定 `127.0.0.1:41823` 并将此地址加入后端 `ALLOWED_ORIGINS`。在被测仓库根目录，从归档分支或下载副本调用[浏览器脚本](c7-browser.mjs)，配置 `RESULT_DIR` 为新输出路径，提供测试用 `SEED_*_PASSWORD`。安装 Chrome/Chromium 的 Playwright 浏览器；若 Playwright 不在脚本可解析的目录，传 `PLAYWRIGHT_MODULE` 指向其 `index.mjs`。脚本只接受本机地址，使用仓库现有 PNG 夹具。

## 后端回归

本机隔离的 PostgreSQL 17.11（UTC）、Python 3.12.13、pytest 8.4.2。使用真实数据库，**170 项通过，0 失败、错误或跳过**。JUnit 去掉机器名，保留函数、计数和执行时间。

| 测试范围 | 通过数 |
| --- | ---: |
| 共享附件和清理（`test_attachments.py`） | 40 |
| 留言 API（`test_comments_api.py`） | 28 |
| 工单照片和留言交接（`test_ticket_attachment_handoff.py`） | 3 |
| 技师工作台后端（`test_issue55_technician_workbench.py`） | 2 |
| 审核、分派、维修、返工和确认（`test_workflow_api.py`） | 44 |
| P0 迁移、种子数据和数据库约束（`test_p0_storage.py`） | 36 |
| 登录与会话（`test_auth_api.py`） | 17 |

[JUnit XML](backend-junit.xml) 包含 #55 的负责人范围、#56 的结果照片和回滚、#57 的确认重放及返工，及 D6 的 H01/H05。专用测试库的连接用 `CAMPUSFIX_TEST_DATABASE_URL` 注入，测试前端 Origin 设为 `http://localhost:5173`。从 `backend/` 复跑：

```sh
: "${CAMPUSFIX_TEST_DATABASE_URL:?set a disposable PostgreSQL test database URL}"
export TZ=UTC PGTZ=UTC ALLOWED_ORIGINS=http://localhost:5173
python -m pytest -q --tb=short tests/test_attachments.py tests/test_comments_api.py \
  tests/test_ticket_attachment_handoff.py tests/test_issue55_technician_workbench.py \
  tests/test_workflow_api.py tests/test_p0_storage.py tests/test_auth_api.py \
  --junitxml=/tmp/campusfix-update3-backend.xml
```

[C8 同版本追踪矩阵](../../Update_3/2026-11-23-c8-acceptance-traceability.md) · [熊雄 D6 回执](../../Update_3/handoff/2026-11-23-d6-xiongxiong.md)。本轮是验收回归，没有重跑或覆盖 D5。林志涛的联合签收另行确认。下载归档后执行 `shasum -a 256 -c SHA256SUMS` 可校验证据文件。
