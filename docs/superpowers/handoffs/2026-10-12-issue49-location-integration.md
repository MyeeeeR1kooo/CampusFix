# #49 地点后端接缝与真实联调（2026-10-12）

## 本轮边界

- 从本地 `admin-management@fdae52b` 安全快进到远端 `a58a7db`，接收已合并的 [PR #88](https://github.com/MyeeeeR1kooo/CampusFix/pull/88) 五个前端文件。没有合并 `main` 或改写伙伴的文件。
- 依据冻结 P0 §5.1、§6.2、§7.3、§8.4、§12，以及冻结 `POST /api/tickets`。只补 Locations 所属的地点读取接缝；不改变四个地点 HTTP 接口、模型、迁移、依赖锁、公共契约、Workflow 或附件实现。
- 账户页面仍不属于本阶段。报修表单复用 `LocationCascade` 的接入由张越在 #51 完成。

## 内部地点接缝

`backend/app/modules/locations/ticket_selection.py` 提供：

```python
selection = select_location_for_ticket(db, validated_location_id)
# selection.location_id
# selection.location_label_snapshot
```

返回不可变的 `TicketLocationSnapshot`，名称以现有契约示例的 `building / floor / room_or_area` 连接，保留字段原文，不 trim 或改变大小写。

- 地点不存在：`422 / VALIDATION_ERROR`，`field_errors` 指向 `location_id`。这是工单创建表单的选择字段校验，不改变地点维护接口的资源 404。
- 地点停用：`409 / CONFLICT`，无工单版本冲突语义。
- 使用真实数据库列读取，不接受 Session identity map 里的旧名称或旧 active 状态。
- `SELECT FOR SHARE` 允许多个创建用例同时读取；同一地点的改名和启停会与之串行。锁保留到调用方事务结束，不会在校验后、保存前放开。
- 不 flush、commit、rollback，不写入 Ticket、状态、事件或已有快照。调用方对整个创建用例的事务负责。

**调用时机：** 完成附件暂存/校验等慢操作后，在最终短写事务中读取地点并保存返回的 ID 和快照，随后与 Workflow、附件元数据和文件移动一起提交。失败由调用方回滚并清理文件；不能在事务结束后才使用旧选择结果创建工单，也不能持锁做图片校验或外部 I/O。

## 不代表已完成的部分

截至本轮开始，远端 Tickets、Workflow、Attachments 仍没有可直接接入的业务实现，#60 新增的是状态机规格，不是服务实现。因此：

- 本轮没有注册假的 `POST /api/tickets`，没有绕过 Workflow 初始化状态或写事件。
- 返回名称快照不等于真实创建请求已经把它存入工单。
- #51 仍需将该接缝接入真实创建事务，并让列表/详情读取 `tickets.location_label_snapshot`。
- 林志涛需交接 Workflow 的创建事件调用和事务协作；熊雄需交接附件暂存、验证、移动、清理接口。无需等待整条 Issue 完成，但不能以占位实现代替。
- #49 当前“工单创建时保存地点名称快照”的勾选没有真实创建接口证据，不能作为完成声明。应在交接时向负责人澄清，本轮不擅自改动线上勾选。
- 舒玺悦的 Mock 仍额外拒绝纯空白地点名，与冻结契约的 minLength 1 不同；交其按地点 schema 对齐，不为迁就 Mock 改后端规则或共享文本校验。

## 本轮验证

- 新增 `backend/tests/test_location_ticket_selection.py`：**13 项真实 PostgreSQL 测试通过**。覆盖原文快照、不可变返回值、不存在/停用地点、调用方事务归属、ORM 旧缓存，以及双方先后取得锁和多个创建用例同时读取。竞争测试读取 PostgreSQL 实际锁等待状态，不以延时猜测是否加锁。
- 后端全量回归（`tests` 与 `tools/test_api_contract_mock.py`）：**569 passed，0 failed，0 skipped**。结果包含原有 #51 准备测试，不表示 #51 的业务接口已完成。
- 前端按现有锁文件安装后：**238 项测试通过**，生产构建成功；没有修改依赖版本或锁文件。构建仍有已锁定 Zod 包的非阻断 Rollup 注释警告，后端仍有已有 Starlette/httpx 提示。
- 使用隔离 PostgreSQL 17.11 测试库、真实 FastAPI 和 Vite 代理，设置 `VITE_USE_MOCK=0`，按 computer-use 技能用专用浏览器接口实际检查：管理员登录、查询、新增、必填提示、重复地点 409 提示、改名、停用、重新启用、前后分页和退出。
- 停用后的改名测试地点经数据库独立核验仅有一条且 `active=false`，Reporter 的真实地点查询不返回它。真实游标遍历无重复：管理员 25 条（20 + 5），停用期间 Reporter 24 条（20 + 4）。随后浏览器重新启用该地点，并在第二页看到 Active。
- Reporter 登录后没有管理入口；直接进入 `/locations` 被送回 `/reports`，不能访问管理页面。浏览器没有捕获到 error 级别控制台日志。
- 最后独立核验：重新启用的测试地点在 Reporter 的真实查询中出现且仅出现一次；Reporter 请求管理员 GET / POST / PATCH 接口均返回 `403 / FORBIDDEN`，虚构地点的字段、更新时间和数据库行数均未变化。
- 本地证据位于忽略目录 `.contract-artifacts/issue49-followup-20261012/`：`selection-results.xml`、`backend-results.xml`、`frontend-test-results.json`、构建日志、`fixture-api-checks.json`、`final-permission-checks.json` 和 `location-disabled.png`。截图记录的是测试地点改名后停用的时点，不是生产数据。

**尚未验收：** 报修表单上的级联选择、真实创建保存快照、后续地点改名不影响历史工单列表/详情，以及手机布局。现有前端组件测试不替代这些真实链路验收。

## 测试环境清理

- 已停止本轮前端、API（含启动进程）和任务独立 PostgreSQL。原记录的四个进程均已退出，5173 / 18049 / 55449 无剩余监听。
- 仅删除本轮虚构数据的独立数据库 `issue49_followup_20261012_199d8c342f3f`；没有接触用户实际数据。脚本、日志、脱敏报告和截图保留在忽略目录供核查，页面服务不再运行。

## 工作树与协作

- 新增内部地点接缝、相应后端测试和本交接记录；原有 12 个 #45/#51 未提交准备文件保留，逐一 SHA-256 核验与本轮开始完全一致，不自动纳入 #49 提交。
- 没有修改前端伙伴文件、Core、认证上下文、queryClient、冻结基线或公共 API schema。
- 新接缝由后续 #51 Tickets 创建服务消费；需与林志涛、熊雄协调同一事务边界。已有共享路由注册 `backend/app/main.py` 本轮不增加 Tickets 注册。
- 实现和联调阶段只在本地修改。用户随后明确授权将本轮三个新增文件提交并推送到 `admin-management`；不包含原有 #45/#51 准备文件，不修改或合并 `main`，不创建 PR 或关闭 Issue。
