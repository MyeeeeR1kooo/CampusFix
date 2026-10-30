# Update2 追踪矩阵进程

更新日期：2026-10-30  
材料提供人：林志涛  
范围：CampusFix Update 2 后端自动化测试及需求追踪证据

## 1. 当前结论

- 当前 `backend/tests` 共收集 743 项测试，在当前 HEAD 上全部通过。
- PRD 的 FR-01 至 FR-10、FR-12 均能映射到真实后端实现测试。
- FR-11 目前只有 API 契约样例和前端 Mock，没有 Analytics 后端实现或真实业务测试，不能填写为 Pass。
- Assignments 没有独立后端模块测试文件，其分派及分派历史行为由 Workflow 测试覆盖。
- 本文统计的是已实际运行的测试证据，不把测试文件存在、契约样例存在或 Mock 行为等同于真实后端验收。

## 2. 后端模块与测试文件

仓库没有采用 `backend/tests/modules/<module>/` 目录结构，测试集中在 `backend/tests/`。下列数量为 pytest 收集后的用例数，包含参数化展开。

| 模块 | 测试文件 | 用例数 | 大致覆盖 |
| --- | --- | ---: | --- |
| Auth / Users | `backend/tests/test_auth_api.py` | 17 | 三角色登录、会话读取和退出、错误凭据、过期/停用会话、Origin、账户查询和启停、事务失败回滚 |
| Locations | `test_location_schemas.py`、`test_location_ticket_selection.py`、`test_locations_api.py` | 113 | 地点增改停启、角色权限、游标分页、唯一约束、并发、历史快照、工单创建地点选择 |
| Tickets | `test_ticket_access.py`、`test_ticket_attachment_handoff.py`、`test_ticket_creation_api.py`、`test_ticket_detail_api.py`、`test_ticket_list_api.py`、`test_ticket_numbering.py`、`test_ticket_pagination.py`、`test_ticket_preparation.py`、`test_ticket_reads.py`、`test_ticket_responses.py`、`test_ticket_schemas.py` | 358 | 创建、编号、列表、搜索、筛选、游标、详情、角色可见性、地点快照和撤销联动 |
| Workflow / Assignments | `backend/tests/test_workflow_api.py` | 40 | 审核、驳回、分派、开工、提交结果、确认、返工、撤销、角色限制、乐观锁、并发和事务回滚 |
| Comments | `backend/tests/test_comments_api.py` | 28 | 公开留言、内部备注、可见性过滤、终态拒绝、并发和事务回滚 |
| Attachments | `backend/tests/test_attachments.py` | 40 | 文件类型、内容、大小和数量校验，私有存储、授权下载、文件事务、并发限制和孤儿清理 |
| Core / Contract | `test_api_contract.py`、`test_config.py`、`test_database.py`、`test_errors.py`、`test_main.py`、`test_p0_storage.py`、`test_security.py` | 147 | OpenAPI、配置、数据库约束、统一错误、健康检查、迁移/种子和安全中间件 |
| Analytics | 无真实业务测试文件 | 0 | 只有契约样例和前端 Mock；没有真实统计接口实现测试 |
| **合计** | `backend/tests` | **743** | 当前正式后端测试全集 |

## 3. 最近一次全绿运行

### 3.1 版本与时间

| 项目 | 值 |
| --- | --- |
| 测试执行 HEAD | `a72623aaf827f880824503248d8c3e952ac01f22` |
| HEAD 提交时间 | 2026-10-30 11:44:25 +08:00 |
| 全绿执行时间 | 2026-10-30 12:23-12:28 +08:00 |
| 产品代码锚点 | `a5a3028d0dbe5df2e0bb3a6b1d2ac687ee8216a4`，2026-10-29 17:36:41 +08:00 |
| 环境 | Python 3.12.13、PostgreSQL 17.11、仓库锁定依赖、隔离临时数据库 |

`a72623a` 只新增验证文档，没有修改产品代码；因此本轮被测产品代码对应 `a5a3028`。

### 3.2 pytest 摘要

正式后端测试：

```text
python -m pytest tests -q -p no:cacheprovider

743 passed, 0 failed, 0 errors, 0 skipped
1 warning
41.07s
```

额外契约 Fixture 测试：

```text
python -m pytest ../tools/test_api_contract_mock.py -q -p no:cacheprovider

14 passed, 0 failed
0.83s
```

两组最终结果合计为 757 passed、0 failed。契约 Fixture 首次组合运行时，进程内 `127.0.0.1` 请求被本机代理转成 502；设置 `NO_PROXY=127.0.0.1,localhost` 后 14 项全部通过，确认不是业务实现失败。

唯一警告为已有的 Starlette/TestClient 弃用提示，不影响测试退出码。

## 4. FR-01 至 FR-12 测试映射

| FR | 功能 | 主要测试文件 | 当前证据 |
| --- | --- | --- | --- |
| FR-01 | 登录、退出、角色识别 | `test_auth_api.py`、`test_security.py` | Pass：真实 Auth、会话和 PostgreSQL 测试 |
| FR-02 | 工单创建 | `test_ticket_creation_api.py`、`test_ticket_numbering.py`、`test_ticket_attachment_handoff.py` | Pass：真实创建、编号、初始事件、并发和事务测试 |
| FR-03 | 图片上传和授权读取 | `test_attachments.py`、`test_ticket_creation_api.py`、`test_workflow_api.py` | Pass：上传、解码、私有存储、授权下载和失败清理 |
| FR-04 | 工单列表与详情 | `test_ticket_access.py`、`test_ticket_reads.py`、`test_ticket_list_api.py`、`test_ticket_detail_api.py`、`test_ticket_pagination.py` | Pass：三角色范围、筛选、搜索、分页和详情 |
| FR-05 | 审核与驳回 | `test_workflow_api.py` | Pass：管理员授权、原因校验、事件、版本和并发 |
| FR-06 | 分派 | `test_workflow_api.py` | Pass：目标维修人员校验、权限、负责人和分派记录原子写入 |
| FR-07 | 开始处理 | `test_workflow_api.py` | Pass：当前维修人员、状态转换、错误角色和非法状态 |
| FR-08 | 提交维修结果 | `test_workflow_api.py`、`test_attachments.py` | Pass：处理说明、结果图片、提交时间、失败回滚 |
| FR-09 | 确认或返工 | `test_workflow_api.py` | Pass：原报修人授权、返工原因、重复处理和并发冲突 |
| FR-10 | 留言与时间线 | `test_comments_api.py`、`test_ticket_detail_api.py`、`test_ticket_attachment_handoff.py` | Pass：公开/内部可见性、时间线、终态和并发 |
| FR-11 | 管理统计 | `test_api_contract.py::test_analytics_empty_example_has_the_six_groups_and_continuous_thirty_days` | **Not run：仅契约空响应样例；没有 Analytics 后端实现和真实业务测试** |
| FR-12 | 地点管理 | `test_location_schemas.py`、`test_location_ticket_selection.py`、`test_locations_api.py`、`test_ticket_creation_api.py` | Pass：管理操作、权限、并发、创建快照和历史不变性 |

严格按“仓库内是否存在任何自动化引用”统计时，FR-11 有契约和前端 Mock 引用；但按“真实后端实现是否被测试”统计，FR-11 当前覆盖数为 0，必须保持 Not run。

## 5. 当前没有完整验收证据的 NFR

| NFR | 要求 | 当前状态 |
| --- | --- | --- |
| NFR-03 | 至少 5 名新用户能在 3 分钟内完成报修 | Not run：没有正式试用者任务记录 |
| NFR-04 | 500 张种子工单下列表/详情 p95 小于 1 秒，统计小于 3 秒 | Not run：没有固定环境性能测试结果 |
| NFR-05 | 核心端到端流程连续运行 20 次无阻断错误 | Not run：已有单次及重复冒烟记录，但没有 20 次连续验收 |
| NFR-07 | 表单标签、错误提示、键盘操作和非颜色单一表达 | Partial：已有组件键盘测试及人工检查，没有完整自动化可访问性扫描 |

## 6. 证据边界

- 本轮 743 项只证明当前后端测试全集通过，不替代前端页面或浏览器端到端验收。
- `backend/.pytest_cache`、`frontend/node_modules/.vite/vitest/results.json` 等本机缓存不作为正式追踪证据。
- 历史测试数字来自不同提交和不同范围，不能相加为当前覆盖数。
- FR-11、NFR-03、NFR-04、NFR-05 应保持 Not run；NFR-07 应保持 Partial，直到取得对应验收证据。
