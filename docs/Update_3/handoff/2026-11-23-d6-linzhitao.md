# D6：林志涛负责模块的缺陷与回归材料

整理日期：2026-11-23。负责人：林志涛。本记录依据已合入代码、Issue、修复 PR 和实跑证据整理，供负责人及报告组核对；不代替林志涛的个人签收，也不编造正式 TC 编号。R9 的 H04 只是报告定位号。

## 范围与版本

林志涛的后端责任范围为 [#47 登录、会话和角色权限](https://github.com/MyeeeeR1kooo/CampusFix/issues/47)、[#50 Workflow 状态机与事件](https://github.com/MyeeeeR1kooo/CampusFix/issues/50)、[#55 技师本人列表](https://github.com/MyeeeeR1kooo/CampusFix/issues/55)、[#56 开始处理及提交结果](https://github.com/MyeeeeR1kooo/CampusFix/issues/56)、[#57 确认及返工](https://github.com/MyeeeeR1kooo/CampusFix/issues/57)。#52 管理员审核共用 Workflow，但该业务交付和附件／留言模块分别由熊雄负责，见[其 D6 回执](2026-11-23-d6-xiongxiong.md)。前端页面的责任人按各 Issue 记录，不在本回执中代签。

本次回归证据的被测应用和测试 SHA 为 `6fe349f01acc5ae6f17d1059e2e8984676016ab9`。当前 `main@667d9303ab8a10c89ebd46bcc14e25d66b95f558` 相比该 SHA 只增加 #127 验证材料，应用和测试代码无差异。2026-11-23 北京时间 15:42–15:44 的[全量报告](../../verification/2026-11-23-coverage-6fe349f/README.md)和[后端 JUnit](../../verification/2026-11-23-coverage-6fe349f/backend-results.xml)记录 PostgreSQL 17.11、Python 3.12.13、pytest 8.4.2 下 **758 项通过、0 失败、0 错误、0 跳过**。以下函数结果均包含在 758 项内，不重复相加。

## 缺陷与修复记录

| 来源／关联 Issue | 原现象与复现 | 修复版本 | 同版回归结果 |
| --- | --- | --- | --- |
| R9 H04；#50 Workflow、#56 结果、#57 返工；#52 审核部分见熊雄回执 | 审核驳回原因、撤销原因、开始备注、结果说明、返工原因缺少统一长度上限。提交 2,001 字符会越过批准边界；应返回 422 且不写状态／事件，2,000 字符应可提交。 | [`f6805c5dc8189c7909d458359e45fcd3aabc1067`](https://github.com/MyeeeeR1kooo/CampusFix/commit/f6805c5dc8189c7909d458359e45fcd3aabc1067)；[审查修复记录](../../superpowers/handoffs/2026-10-29-update2-review-fixes.md)说明 Workflow Schema、Router、前端动作表单及 API 契约同步修改。 | `backend/tests/test_workflow_api.py::test_event_text_length_limit_rejects_without_writes` 的 **5 个参数实例通过**；分别检查 2,001 字符 422、无写入、2,000 字符成功及事件内容。 |
| C2 确认重放问题；#57 | 首次确认成功而响应丢失后，原报修人按相同 UUID 幂等键和版本重试，需要返回原成功结果；旧语义会将第二次请求作为版本冲突。重复执行也不能新增关闭事件或改变 `closed_at`。不同键或版本的旧请求仍应 409。 | [PR #115](https://github.com/MyeeeeR1kooo/CampusFix/pull/115)，修复提交 `9a2a818774c80597a08610dfffea4298b4a7769b`；经批准同步了冻结基线 §4.2、OpenAPI、迁移、后端及前端调用。[PR #120](https://github.com/MyeeeeR1kooo/CampusFix/pull/120) 增加具体回归函数。 | `test_confirm_replay_requires_matching_key_and_version`、`test_concurrent_confirm_replay_has_one_event`、`test_repeating_confirm_preserves_a_single_ticket_closed_event` **各 1 项通过**。同键同版本两次 200、同一响应／关闭时间、仅一条 `TICKET_CLOSED`；异键／异版本 409，四请求并发仍只写一条事件。 |

## 其他责任范围核对

| 范围 | 同版具体回归 | 结果与边界 |
| --- | --- | --- |
| #47 Auth／会话 | `test_auth_api.py::test_three_roles_login_read_session_and_logout`、`test_expired_session_is_rejected_without_sliding_renewal`、`test_admin_account_management_revokes_existing_sessions`；整个 `test_auth_api.py` | **17 项通过**；包含停用账户后旧会话失效和历史工单保留。没有从这些测试发现本轮新增 Auth 缺陷。 |
| #50 Workflow／事务 | `test_workflow_api.py::test_concurrent_review_requests_have_one_winner`、`test_event_insert_failure_rolls_back_state_and_assignment`、`test_concurrent_second_phase_actions_have_one_winner`、`test_result_photo_and_state_roll_back_when_event_insert_fails`；整个 `test_workflow_api.py` | **44 项通过**；覆盖版本冲突、单一成功者、事件写入失败回滚及照片与状态回滚。结果照片清理也涉及熊雄负责的附件服务，见其回执。 |
| #55 技师本人列表 | `test_issue55_technician_workbench.py::test_assigned_list_is_scoped_before_filtering_and_pagination`、`test_workbench_list_requires_auth_and_technicians_cannot_choose_an_assignee`，及 `test_workflow_api.py::test_technician_list_after_dispatch_only_returns_current_assignments` | 专项文件 **2 项通过**，Workflow 关联函数 **1 项通过**；验证服务端在筛选／分页前按当前负责人限制范围。 |
| #56／#57 完成闭环 | `test_workflow_api.py::test_technician_start_and_resolve_then_reporter_confirm`、`test_reporter_rework_preserves_assignee_and_can_resolve_again`、`test_rework_reason_and_confirm_contract_reject_invalid_input`、`test_resolution_photo_is_private_metadata_and_file` | 均在上述 **44 项**中通过；确认、返工、无效输入和结果照片的具体状态与事件由原测试断言核对。 |

## D6 结论与待办

**在 `main@6fe349f` 已归档全量自动化测试及上述责任范围的回归内，未发现新增缺陷；本轮无新增缺陷修复提交。**此结论只覆盖列出的自动化检查和历史修复回归，不代表人工浏览器验收或所有未测边界均无缺陷。#47/#50/#55/#56/#57 的相关测试数已包含在 758 中，不另计。

历史 [C7 三角色浏览器闭环](../../verification/2026-11-23-update3-acceptance/README.md)及 [C8 追踪矩阵](../2026-11-23-c8-acceptance-traceability.md)验证的是更早的 `main@c5b600f`；若报告组以 `6fe349f` 为最终验收版本，需另行在该版本完成 C7/C8 同版联调和林志涛、熊雄联合签收。本回执不将 #127 的全量 pytest 或 #58/#90 专项浏览器检查替代该步骤。
