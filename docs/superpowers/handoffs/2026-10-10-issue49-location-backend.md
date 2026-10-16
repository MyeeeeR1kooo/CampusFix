# #49 地点后端交接（2026-10-10）

## 范围与依据

- 当前 [Issue #49](https://github.com/MyeeeeR1kooo/CampusFix/issues/49) 明确本阶段只做地点；蒋雨涵负责后端，舒玺悦负责前端。账户页面留到最终提交，账户后端复用 #47，不重复实现。
- 实现依据为 P0 冻结基线 §3.3、§6.1–6.2、§8.4、§9、§10、§11.4–11.5、§13.3、§16，以及冻结的 `docs/api/openapi.yaml` 地点路径和 schemas。作废 PRD、README、Mock 不是新增需求来源。
- 本地 `admin-management` 从远端同名分支快进到已整合 #47 的 `main@0f516d57` 后开发；没有推送、合并远端 PR、修改 Issue 或勾选验收。

## 本轮实现

| 接口 | 权限与行为 |
| --- | --- |
| `GET /api/locations` | 有效会话；仅返回启用的扁平地点记录 |
| `GET /api/admin/locations` | Admin；返回启用及停用地点 |
| `POST /api/admin/locations` | Admin；创建地点，201；`active` 省略时为 true |
| `PATCH /api/admin/locations/{id}` | Admin；部分修改显示字段或 active，200；未提供的字段保持原值 |

复用现有 `get_current_user`、`require_admin`、请求级数据库 Session、Origin 中间件和统一错误信封。四个接口注册于 `backend/app/main.py`。列表按 `created_at DESC, id DESC` 稳定游标分页，默认 20、最大 100；响应只有 `items` 和 `next_cursor`。游标签名绑定地点资源及有效/全部列表范围；不能跨这两种列表或账户列表复用。

`building`、`floor`、`room_or_area` 按冻结契约接受长度至少为 1 的字符串，保持原文，不增加 trim、大小写折叠、最大长度或纯空白拒绝规则。`active` 只接受 JSON 布尔值。PATCH 拒绝空对象、显式 null、未知字段；不存在的地点返回 404。

复用现有三字段组合唯一约束 `uq_locations_address`，重复创建或修改返回 `409 / CONFLICT` 并回滚；非该约束的数据库异常保持安全的 500，不冒充重复地点。所有写入失败均回滚。同地点的修改通过短事务行锁串行，避免并发部分更新返回旧字段，或显式启用值因旧读被当作无变化而未落库。不新增地点实体层级、表、迁移、删除接口或状态机规则。

## 与前端和 #51 的接缝

- 舒玺悦复用现有 `listActiveLocations`、`listAdminLocations`、`createLocation`、`updateLocation`，不新增路径或手写另一套字段。三级选择从扁平地点列表派生；需要全部选项时遍历 `next_cursor`，不能把第一页当作全部地点。
- 地点重复组合的 409 展示服务端 message，不带工单状态动作 meta，也不刷新同编号工单。沿用已批准的 P0 §13.3 边界。
- 本轮地点服务只写 `locations`，不删除地点、不修改工单外键、状态、事件或已有 `location_label_snapshot`。改名、停用和恢复不能影响旧快照。
- **仍待 #51 创建链路接入**：真实创建工单时校验地点存在且启用，在工单创建事务中保存当时名称快照；列表/详情读取该快照而不是当前地点名。还需覆盖“选择后、提交前地点被停用”的失败情形。本轮不实现整个 Tickets/Workflow 创建链路，也不把预置工单夹具当成真实创建接口已完成。
- 已发现 Mock 的共享文本校验额外拒绝纯空白，而冻结地点 schema 和数据库只要求 length > 0。此差异交舒玺悦、张越按现有契约复核；本轮不修改其文件。若产品要增加拒绝规则，须走人工批准的基线/契约变更，不能由后端静默追加。

## 验证状态

最终实测（2026-10-10）：

- 本轮新增 **99 项**：地点 schema/cursor 单测 74 项，API 场景 25 项（其中 17 项使用真实 PostgreSQL，另外 8 项验证未登录和 Origin 拒绝）。
- 后端全量及固定契约 Mock 回归 **556 passed，0 failed，0 skipped**。其中原有 #51 准备测试 279 项不算作本轮新增成果，也不代表 #51 业务 API 已完成。
- 覆盖四接口的角色/会话检查、启用/全部列表、空列表、分页边界及相同时间戳的稳定顺序、字段/路径校验、UTC/JSON 契约、停用后组合仍唯一、修改冲突的整笔回滚、旧工单快照不变、失败 commit/其他数据库故障、并发重复创建和真实交错的部分修改。并发 PATCH 用 PostgreSQL 的实际锁等待确认重叠，而不是用等待时间推断。
- 全量测试结果保存在本地 ignored `.contract-artifacts/issue49-final-results.xml`；代码检查 `git diff --check` 通过。原有 12 个 #45/#51 准备文件逐项 SHA-256 相同。
- 环境为 Windows / Python 3.12.14 / PostgreSQL 17.11、UTC。每个集成测试由 Alembic 初始化独立随机数据库，结束后清理；未连接或改写既有项目数据库。仅补装三个既有锁定依赖 Alembic/Mako/MarkupSafe，未更改锁文件或升级依赖；Windows 不支持的 uvloop 未安装。
- 1 个既有 Starlette/httpx TestClient 弃用警告，不是失败。本机 Windows 沙箱的本地测试请求曾停滞，最终在许可环境重跑通过；没有为此修改产品逻辑或跳过断言。

复现：设置指向**隔离 PostgreSQL 测试实例**、具备创建测试数据库权限的 `CAMPUSFIX_TEST_DATABASE_URL`，在 `backend/` 执行：

```text
python -m pytest tests/test_location_schemas.py tests/test_locations_api.py -q
python -m pytest tests ../tools/test_api_contract_mock.py -q
```

未运行：地点前端页面、真实页面联调、完整工单闭环、Docker/Linux 目标镜像和远端 CI。上述接口/数据库证据不替代这些验收。

## 协作与未完成项

- 共享文件改动：`backend/app/main.py` 仅新增地点路由 import/注册两行；`README.md` 仅同步当前接口状态和交接入口。需与林志涛及其他正在接入业务路由、更新入口文档的后端成员协调同一区域。本轮结束前检查 GitHub 开放 PR 为 0，未发现当前开放的重叠修改。
- 未修改 Auth/Users、Core、模型、迁移、依赖锁、前端、`queryClient.ts`、认证上下文、API 契约或冻结基线。
- 本轮前端页面和真实页面联调未完成，由舒玺悦及后续报修页面负责人张越接入；因此整条 #49 不关闭。
- 原有 12 个 #45/#51 未提交准备文件保留，不计作本轮 #49 新成果、不自动提交。
