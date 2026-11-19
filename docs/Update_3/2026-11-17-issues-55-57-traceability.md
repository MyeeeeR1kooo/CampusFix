# Update 3：#55–#57 验收追踪（交接草案）

2026-11-17 对照 GitHub；C8 由林志涛、熊雄共同完成。C3 已在真实 PostgreSQL 上实跑，当前工作树增加了两条测试。C7 的真实浏览器联调仍待林志涛牵头完成。

| Issue / 需求 | 需观察的行为 | 现有材料 | C8 还需关联的证据 |
| --- | --- | --- | --- |
| [#55 技师工作台](https://github.com/MyeeeeR1kooo/CampusFix/issues/55) · FR-04 / UC-03 | 技师 A 只看到自己当前负责的工单，列表显示状态、地点、优先级和提交时间，能进入详情 | [后端列表 API 测试](https://github.com/MyeeeeR1kooo/CampusFix/blob/92d4dd0e9c699d3c41637e6b53fa01e0134c8792/backend/tests/test_ticket_list_api.py)；[PR #114](https://github.com/MyeeeeR1kooo/CampusFix/pull/114) 记录工作台 Mock 测试及桌面浏览器检查，核对时尚未合入 | C3 技师范围已通过（见下）；待 C7 真实服务下本人工单列表、详情的截图与响应，记录对照工单的分派关系 |
| [#56 处理与提交结果](https://github.com/MyeeeeR1kooo/CampusFix/issues/56) · FR-07、FR-08 / UC-03 | 被分派的技师开始处理、输入结果说明、上传结果照片，工单进入待确认；无说明或他人操作不得写入 | [Workflow API 测试](https://github.com/MyeeeeR1kooo/CampusFix/blob/92d4dd0e9c699d3c41637e6b53fa01e0134c8792/backend/tests/test_workflow_api.py) 包含开始、提交、结果照片、失败回滚及角色边界 | C7 在真实页面提交前后截图、同一工单时间线与结果照片元数据；对应负例已随 [工作流全文件 JUnit](../verification/2026-11-17-issues-55-57/workflow-junit.xml) 实跑 |
| [#57 确认完成 / 要求返工](https://github.com/MyeeeeR1kooo/CampusFix/issues/57) · FR-09 / UC-04 | 原报修人确认后仅一条关闭事件；返工要求非空原因，回到处理中并新增返工事件 | [Workflow API 测试](https://github.com/MyeeeeR1kooo/CampusFix/blob/92d4dd0e9c699d3c41637e6b53fa01e0134c8792/backend/tests/test_workflow_api.py) 包含确认与返工路径 | C3 已证明本轮仅写一次关闭事件（见下）；待 C7 返工、再次提交和最终确认的截图、事件序列和重复确认时的实际响应 |

**C3 本次实跑。** 基于 `main@92d4dd0` 加本分支两条测试；Python 3.12.14、PostgreSQL 17.11。使用 FastAPI TestClient 走真实路由和数据库，两条通过，零失败、错误或跳过（只选这两条，同文件另外 42 条未选中）。[JUnit XML](../verification/2026-11-17-issues-55-57/c3-junit.xml) 已移除机器名；[脱敏 API 响应](../verification/2026-11-17-issues-55-57/c3-api.json) 来自同一次执行，两条用例各自使用新测试库，工单 ID 不跨用例关联。

- #55：管理员把两张工单分别派给两名技师，另留一张未分派。第一名技师不传筛选参数查询，只收到自己的工单，且没有下一页。
- #57：报修人连续两次用相同 UUID 幂等键和版本 5 确认，两次均返回 200，响应体完全一致；数据库为 CLOSED、版本 6，关闭时间与首次相同，只有一条 `TICKET_CLOSED`。
- 复跑：在 `backend/` 使用已安装开发依赖的 Python，设置 `CAMPUSFIX_TEST_DATABASE_URL` 为有建库权限的专用 PostgreSQL，再执行：
  ```sh
  python -m pytest tests/test_workflow_api.py -q -k 'repeating_confirm_preserves_a_single_ticket_closed_event or technician_list_after_dispatch_only_returns_current_assignments' --junitxml=c3-local.xml
  ```

**重复确认的判定。** [PR #115](https://github.com/MyeeeeR1kooo/CampusFix/pull/115) 已合入本次基线，并同步 P0 §4.2 与 API `ConfirmRequest`：相同工单、原报修人、UUID 幂等键和版本号的已成功确认重试返回 200；不同键或版本的旧请求仍返回 409。C3 据此验证相同键重放只产生一条 `TICKET_CLOSED`，不改变版本及关闭时间；上游已有的不同键/版本冲突、四请求并发重放测试也随全文件回归通过。

**同版本后端回归。** 整个 `test_workflow_api.py` 共 44 项（包括 C3 的两项），在 PostgreSQL 17.11 上全部通过，零失败、错误或跳过。[工作流 JUnit](../verification/2026-11-17-issues-55-57/workflow-junit.xml) 佐证后端审核、分派、开始、提交结果及返工/确认等行为；不代表实际浏览器联调。

**已有证据能证明什么。** [D1 启动与三角色登录](https://github.com/MyeeeeR1kooo/CampusFix/blob/92d4dd0e9c699d3c41637e6b53fa01e0134c8792/docs/Update_3/handoff/D1-main-compose-and-demo-logins.md) 只证明启动、登录；[PR #111](https://github.com/MyeeeeR1kooo/CampusFix/pull/111) 提供 #52、#53 审核和分派的局部联调，两者都不能替代 C7 全程。

**联合验收交接。** C7 负责人提供真实前后端的提交 SHA、测试时间、匿名工单编号以及各角色的截图和脱敏 JSON，覆盖提交、审核、分派、开始、提交结果、返工、再提交、确认；熊雄关联同一验收版本的测试 XML，并核对三项 Issue 的验收行，再由两人确认勾选及关闭范围。当前仅作追踪草案。
