# Update 3：#55–#57 验收追踪（交接草案）

初稿：2026-11-17。最近核对：2026-11-21（北京时间），基线 [main@46304e4](https://github.com/MyeeeeR1kooo/CampusFix/commit/46304e481da466e7bf78eac5be84f68f2abc2764)。C8 由林志涛、熊雄共同完成；以下先归档代码和自动化测试的证据，C7 三角色浏览器联调的证据待补。

| Issue / 需求 | 需观察的行为 | 代码和测试证据 | 待补的 C7 浏览器证据 |
| --- | --- | --- | --- |
| [#55 技师工作台](https://github.com/MyeeeeR1kooo/CampusFix/issues/55) · FR-04 / UC-03 | 技师只看到自己当前负责的工单，列表显示状态、地点、优先级和提交时间，能进详情 | [工作台 #114](https://github.com/MyeeeeR1kooo/CampusFix/pull/114) 已随 [#121](https://github.com/MyeeeeR1kooo/CampusFix/pull/121) 合入 `main`；[后端专项](https://github.com/MyeeeeR1kooo/CampusFix/blob/46304e481da466e7bf78eac5be84f68f2abc2764/backend/tests/test_issue55_technician_workbench.py#L13) 覆盖本人工单、分页和详情权限；[前端组件测试](https://github.com/MyeeeeR1kooo/CampusFix/blob/46304e481da466e7bf78eac5be84f68f2abc2764/frontend/src/test/technicianWorkbench.test.tsx) 覆盖工作台 | 真实服务下的技师列表和详情截图、响应；记录本人和另一名技师的工单分派关系 |
| [#56 处理与提交结果](https://github.com/MyeeeeR1kooo/CampusFix/issues/56) · FR-07、FR-08 / UC-03 | 被分派的技师开始处理，带说明和结果照片提交，工单进入待确认；无说明或他人操作不得写入 | [照片与提交表单 #118](https://github.com/MyeeeeR1kooo/CampusFix/pull/118) 已随 #121 合入 `main`；[Workflow API 测试](https://github.com/MyeeeeR1kooo/CampusFix/blob/46304e481da466e7bf78eac5be84f68f2abc2764/backend/tests/test_workflow_api.py#L343) 与[详情页组件测试](https://github.com/MyeeeeR1kooo/CampusFix/blob/46304e481da466e7bf78eac5be84f68f2abc2764/frontend/src/test/ticketDetail.test.tsx#L363) 有启动、提交结果和照片的相关用例 | 真实页面提交前后截图、同一工单的时间线和结果照片元数据 |
| [#57 确认完成 / 要求返工](https://github.com/MyeeeeR1kooo/CampusFix/issues/57) · FR-09 / UC-04 | 原报修人确认后只记录一次关闭事件；返工要求非空原因，回到处理中并新增返工事件 | `main` 已有确认／返工操作与 [后端重放及返工用例](https://github.com/MyeeeeR1kooo/CampusFix/blob/46304e481da466e7bf78eac5be84f68f2abc2764/backend/tests/test_workflow_api.py#L376)；[#117](https://github.com/MyeeeeR1kooo/CampusFix/pull/117) 的前端专项测试在 [reporter-confirm@bc8eef3](https://github.com/MyeeeeR1kooo/CampusFix/blob/bc8eef356dc609a2e69702d2ebefac0f64e76c2e/frontend/src/test/reporterConfirmation.test.tsx)，尚未进入 `main` | 返工、再提交、确认后的页面和事件序列；重复确认的响应和关闭事件计数 |

GitHub 已关闭 #55、#56（11 月 19 日）和 #57（11 月 20 日）。[当前 main 的前后端 CI](https://github.com/MyeeeeR1kooo/CampusFix/actions/runs/44561545607) 通过；Issue 状态与 CI 均不替代 C7 的真实浏览器联调记录。

**C3 的 11 月 17 日实跑。** 基于 `main@92d4dd0` 加 [#120](https://github.com/MyeeeeR1kooo/CampusFix/pull/120) 的两条测试；Python 3.12.14、PostgreSQL 17.11。使用 FastAPI TestClient 走真实路由和数据库，两条通过，零失败、错误或跳过（只选这两条，同文件另外 42 条未选中）。[JUnit XML](../verification/2026-11-17-issues-55-57/c3-junit.xml) 已移除机器名；[脱敏 API 响应](../verification/2026-11-17-issues-55-57/c3-api.json) 来自同一次执行，两条用例各自使用新测试库，工单 ID 不跨用例关联。上表链接的最新 `main` 专项已覆盖技师只能看本人工单；本次保留 C3 原测试和原始记录。

- #55：管理员把两张工单分别派给两名技师，另留一张未分派。第一名技师不传筛选参数查询，只收到自己的工单，且没有下一页。
- #57：报修人连续两次用相同 UUID 幂等键和版本 5 确认，两次均返回 200，响应体完全一致；数据库为 CLOSED、版本 6，关闭时间与首次相同，只有一条 `TICKET_CLOSED`。
- 复跑：在 `backend/` 使用已安装开发依赖的 Python，设置 `CAMPUSFIX_TEST_DATABASE_URL` 为有建库权限的专用 PostgreSQL，再执行：
  ```sh
  python -m pytest tests/test_workflow_api.py -q -k 'repeating_confirm_preserves_a_single_ticket_closed_event or technician_list_after_dispatch_only_returns_current_assignments' --junitxml=c3-local.xml
  ```

**重复确认的判定。** [PR #115](https://github.com/MyeeeeR1kooo/CampusFix/pull/115) 已合入本次基线，并同步 P0 §4.2 与 API `ConfirmRequest`：相同工单、原报修人、UUID 幂等键和版本号的已成功确认重试返回 200；不同键或版本的旧请求仍返回 409。C3 据此验证相同键重放只产生一条 `TICKET_CLOSED`，不改变版本及关闭时间；上游已有的不同键/版本冲突、四请求并发重放测试也随全文件回归通过。

**同版本后端回归。** 整个 `test_workflow_api.py` 共 44 项（包括 C3 的两项），在 PostgreSQL 17.11 上全部通过，零失败、错误或跳过。[工作流 JUnit](../verification/2026-11-17-issues-55-57/workflow-junit.xml) 佐证后端审核、分派、开始、提交结果及返工/确认等行为；不代表实际浏览器联调。

**已有证据能证明什么。** [D1 启动与三角色登录](https://github.com/MyeeeeR1kooo/CampusFix/blob/92d4dd0e9c699d3c41637e6b53fa01e0134c8792/docs/Update_3/handoff/D1-main-compose-and-demo-logins.md) 只证明启动、登录；[PR #111](https://github.com/MyeeeeR1kooo/CampusFix/pull/111) 提供 #52、#53 审核和分派的局部联调，两者都不能替代 C7 全程。

**联合验收交接。** 林志涛负责汇总 C7 的提交 SHA、测试时间、匿名工单编号、各角色截图和脱敏 JSON，覆盖提交、审核、分派、开始、提交结果、返工、再提交及确认。熊雄关联相同验收版本的测试 XML，和林志涛一起核对追踪矩阵。本次只更新可核实的证据，C8 完整验收待 C7 记录齐备。
