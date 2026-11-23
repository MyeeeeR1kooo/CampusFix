# Update 3: C7/C8 同版本验收证据

运行日期：2026-11-23（北京时间）。本证据包固定对应 `main@667d9303ab8a10c89ebd46bcc14e25d66b95f558`；浏览器 JSON、数据库核对、JUnit 和截图均来自这一版本。旧版 `c5b600f` 证据保留在相邻历史目录，不与本包混用。

## C7 浏览器闭环

UTC 运行时间为 `2026-11-23T09:40:49.117Z` 至 `2026-11-23T09:40:53.126Z`，北京时间为 17:40:49 至 17:40:53。使用三个独立真实 Chromium 会话分别登录 REPORTER、ADMIN、TECHNICIAN；应用连接本机真实 FastAPI、生产构建和隔离 PostgreSQL。浏览器脚本完成 8 个场景，全部通过；无页面错误、无外部请求。最终同一虚构工单 `CF-20261123-000001` 为 CLOSED/version 8。

| 场景 | HTTP/状态结果 | 截图 |
| --- | --- | --- |
| 报修人提交工单和 1 张报修照 | 201，`SUBMITTED` v1 | [创建](02-reporter-create.png)、[已提交](03-reporter-submitted.png) |
| 管理员审核、分派 | 200，`PENDING_ASSIGNMENT` v2 → `ASSIGNED` v3 | [已分派](04-admin-assigned.png) |
| 技师查看本人分派并开始处理 | 200，`IN_PROGRESS` v4 | [工作台](01-technician-workbench.png)、[本人列表](05-technician-assigned-list.png) |
| 技师提交首次结果和照片 | 200，`PENDING_CONFIRMATION` v5 | [390px 结果弹窗](06-technician-mobile-result-photo.png) |
| 报修人填写原因要求返工 | 200，`IN_PROGRESS` v6 | [返工](07-reporter-rework.png) |
| 技师再次提交并附第 2 张结果照 | 200，`PENDING_CONFIRMATION` v7 | [再次提交](08-technician-resubmitted.png) |
| 报修人确认，重放完全相同请求 | 两次 200，`CLOSED` v8；只写 1 条 `TICKET_CLOSED` | [已关闭](09-reporter-closed.png) |

确认重放使用首次确认的同一幂等键和版本，不记作第二次页面点击。`c7-browser.json` 保存脱敏后的动作响应、状态版本、事件顺序和重放断言；`database.json` 保存同一工单的只读状态、事件和附件摘要。事件顺序为：`TICKET_SUBMITTED`、`TICKET_APPROVED`、`TICKET_ASSIGNED`、`WORK_STARTED`、`RESOLUTION_SUBMITTED`、`REWORK_REQUESTED`、`RESOLUTION_SUBMITTED`、`TICKET_CLOSED`。其中 `TICKET_CLOSED` 只有 1 条，照片为报修 1 张、结果 2 张。

移动视口检查结果提交弹窗：宽度 390，`scrollWidth` 388，无横向溢出。浏览器版本、页面截图索引和网络结果均在 JSON 中记录。

## 后端同版专项

真实隔离 PostgreSQL 上专项 JUnit 为 170 项通过，0 失败、0 错误、0 跳过；执行时间 27.944 秒。文件为 [backend-junit.xml](backend-junit.xml)，其测试包含 #55 技师范围、#56 结果照片及回滚、#57 返工/确认重放和单一关闭事件，以及 D6 相关回归。

## 文件索引与复跑

- [c7-browser.json](c7-browser.json)：脱敏浏览器步骤、响应、事件和断言。
- [database.json](database.json)：同工单状态、事件、附件及重放核对。
- [backend-junit.xml](backend-junit.xml)：同版后端专项测试结果。
- `01`–`09` PNG：三角色页面截图，包含 390px 结果提交页面。
- [浏览器脚本](../2026-11-23-update3-acceptance/c7-browser.mjs)：仅接受本机 URL；复跑时将 `RESULT_DIR` 指向新目录，并设置三个 `SEED_*_PASSWORD`。

复跑应在同一 SHA 启动全新的隔离数据库，执行 `alembic upgrade head` 和 `python -m app.seed`，再启动真实 FastAPI 和 `VITE_USE_MOCK=0` 的生产前端。后端专项命令见旧版同目录 README 的“后端回归”段落；本包只归档本次实际运行结果。

下载或复制证据后，可执行 `shasum -a 256 -c SHA256SUMS` 校验文件未被改写。

## 签收边界

该证据包记录林志涛执行和复核的 C7/C8 技术证据，不代替熊雄的明确联合签收。熊雄的交接材料见 [D6 回执](../../Update_3/handoff/2026-11-23-d6-xiongxiong.md)；联合签收状态以其确认消息为准。
