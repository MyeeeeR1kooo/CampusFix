# D4: 全模块测试清单与 FR 对照

整理日期：2026-11-23。交给彭兆彬统一编正式 TC 编号；本清单不预编 TC，也不把覆盖率或测试通过数当成需求验收结论。FR 编号以 `docs/CampusFix_PRD.md` 第 5 节的 **FR-01 至 FR-12** 和冻结 P0 基线为准。一个测试可支撑多个 FR；表中的 FR 是所测行为的归属，不表示该文件的每个参数化实例都单独证明全部所列 FR。

**完整逐函数索引：**[D4-test-functions.tsv](D4-test-functions.tsv)。共 623 条：后端 305 个函数、前端 318 个用例，均对应同一次全量运行。每行含文件、精确函数／用例名、参数化实例数、候选 FR 范围、结果及 SHA。`candidate_FR_scope` 是**文件级候选范围**，不是逐函数断言结论；编 TC 时应以本页 FR 表及测试断言确认精确映射。`shared-infrastructure` 表示通用支撑测试，不强行分配单个业务 FR。

## 版本与统计口径

| 证据 | 被测源码 / 执行结果 | 用途与边界 |
| --- | --- | --- |
| [11 月 23 日全量 JUnit](../../verification/2026-11-23-coverage-6fe349f/README.md) | 被测 `main@6fe349f01acc5ae6f17d1059e2e8984676016ab9`；pytest **758/758 通过**（28 文件，0 失败、0 错误、0 跳过）；Vitest **318/318 通过**（20 文件，0 失败、0 错误、0 跳过） | [后端 XML](../../verification/2026-11-23-coverage-6fe349f/backend-results.xml)和[前端 XML](../../verification/2026-11-23-coverage-6fe349f/frontend-results.xml)是本清单的逐函数结果来源。C7/C8 验收目标 `667d9303` 相比本次被测 SHA 只新增 #127 证据文档，应用及测试代码无差异。 |
| [11 月 23 日 C7/C8 专项](../../verification/2026-11-23-update3-acceptance-main-667d9303/README.md) | 被测 `main@667d9303ab8a10c89ebd46bcc14e25d66b95f558`。浏览器 **8/8 通过**，pytest **170/170 通过**（0 失败、0 错误、0 跳过） | [同版专项 XML](../../verification/2026-11-23-update3-acceptance-main-667d9303/backend-junit.xml)与浏览器证据用于本轮 C7/C8 确认。与全量结果分别列报。 |
| [C7/C8 历史记录](../../verification/2026-11-23-update3-acceptance/README.md) | 历史被测 `main@c5b600f16635dd11589a0d93c6592890192e8598`，后端专项 **170/170 通过** | 保留当次 [专项 XML](../../verification/2026-11-23-update3-acceptance/backend-junit.xml)和浏览器证据。 |

pytest 数字是**参数化展开后的实例数**，不是函数定义数。前端数字是 `it`/`test` 用例数。下面的文件表采用同一全量 JUnit 的实跑数字；完整用例名以 XML 的 `classname` + `name` 为准。

## FR 到具体测试

以下给出报告组编 TC 时可直接定位的函数／用例。后端写作 `文件::函数`，前端写作 `文件 > 用例名`；同文件其他参数化实例和边界用例见 XML 与源文件。

| FR / 行为 | 后端具体函数 | 前端具体用例 |
| --- | --- | --- |
| FR-01 登录、退出、角色与会话 | `test_auth_api.py::test_three_roles_login_read_session_and_logout`；`test_auth_api.py::test_expired_session_is_rejected_without_sliding_renewal`；`test_security.py::test_session_tokens_are_random_and_only_the_digest_is_persisted` | `App.test.tsx > posts exactly the contract's body and lands on the role's page`；`App.test.tsx > posts to the contract's logout and returns to the login page`；`sessionCache.test.tsx > empties the cache before the next account signs in` |
| FR-02 创建工单、编号与首事件 | `test_ticket_creation_api.py::test_real_create_detail_cancel_chain_preserves_submission_and_photo`；`test_ticket_creation_api.py::test_concurrent_creations_allocate_distinct_ids_and_one_event_each`；`test_ticket_numbering.py::test_uses_identity_and_at_least_six_suffix_digits` | `reporterPages.test.tsx > blocks a submit with every required field empty and keeps entered values`；`reporterPages.test.tsx > submits fields and a photo as one request, then shows the photo and timeline on detail` |
| FR-03 照片校验与授权下载 | `test_attachments.py::test_fake_mime_and_corrupt_images_are_rejected_without_files`；`test_attachments.py::test_missing_unrelated_and_anonymous_downloads`；`test_ticket_creation_api.py::test_jpeg_png_and_webp_are_stored_with_verified_mime_size_and_private_bytes`；`test_workflow_api.py::test_resolution_photo_is_private_metadata_and_file` | `reporterPages.test.tsx > rejects SVG, oversize files and more than five images, and removes a selected photo`；`ticketDetail.test.tsx > starts an assigned ticket and submits its selected result photo once` |
| FR-04 列表、详情、角色范围 | `test_ticket_list_api.py::test_list_role_scope_and_workflow_projection_without_origin`；`test_ticket_detail_api.py::test_missing_and_unrelated_details_have_same_404_and_never_query_children`；`test_issue55_technician_workbench.py::test_assigned_list_is_scoped_before_filtering_and_pagination`；`test_workflow_api.py::test_technician_list_after_dispatch_only_returns_current_assignments` | `technicianWorkbench.test.tsx > renders only A's assignments with status, snapshot, priority, reported time and detail links, including closed tickets`；`reporterPages.test.tsx > shows only the reporter's tickets, filters by status and clears the filter` |
| FR-05 管理员审核、驳回与事件 | `test_workflow_api.py::test_admin_review_actions_commit_state_version_and_one_public_event`；`test_workflow_api.py::test_only_admin_can_review_or_assign`；`test_issue53_assignment.py::test_review_then_assign_grants_current_technician_access` | `reviewQueue.test.tsx > approves from the queue with category, priority and version, records the event and removes the row`；`reviewQueue.test.tsx > requires a rejection reason and displays the rejected event` |
| FR-06 管理员分派与当前负责人 | `test_workflow_api.py::test_assign_writes_assignee_assignment_and_event_atomically`；`test_workflow_api.py::test_invalid_assignment_target_is_422_without_side_effects`；`test_issue53_assignment.py::test_concurrent_assignment_has_one_current_owner_and_one_event` | `assignmentQueue.test.tsx > assigns to an active technician and displays the owner, assignment and timeline`；`ticketDetail.test.tsx > follows every cursor page before offering the technician list` |
| FR-07 当前技师开始处理 | `test_workflow_api.py::test_technician_start_and_resolve_then_reporter_confirm`；`test_workflow_api.py::test_second_phase_actions_reject_wrong_role_or_state` | `ticketDetail.test.tsx > starts an assigned ticket and submits its selected result photo once`；`ticketDetail.test.tsx > shows the event note length error before starting work` |
| FR-08 结果说明、照片与待确认状态 | `test_workflow_api.py::test_resolution_photo_is_private_metadata_and_file`；`test_workflow_api.py::test_invalid_result_photo_leaves_no_file_or_state_change`；`test_workflow_api.py::test_result_photo_and_state_roll_back_when_event_insert_fails` | `ticketDetail.test.tsx > requires a resolution note even when a photo is selected`；`ticketDetail.test.tsx > shows an indexed photo error beside the picker and keeps the note available for retry` |
| FR-09 原报修人确认／返工、幂等 | `test_workflow_api.py::test_reporter_rework_preserves_assignee_and_can_resolve_again`；`test_workflow_api.py::test_confirm_replay_requires_matching_key_and_version`；`test_workflow_api.py::test_repeating_confirm_preserves_a_single_ticket_closed_event`（#120 新增）；`test_workflow_api.py::test_concurrent_confirm_replay_has_one_event` | `ticketDetail.test.tsx > keeps the rework dialog open when the required reason is empty`；`mockApi.test.ts > replays only the matching successful confirm request` |
| FR-10 留言、公开时间线与内部备注 | `test_comments_api.py::test_allowed_comment_is_a_contract_row_without_state_version_or_event_change`；`test_comments_api.py::test_non_admin_internal_note_is_denied_and_never_written`；`test_ticket_detail_api.py::test_internal_timeline_is_filtered_in_sql_before_public_http_response` | `reporterPages.test.tsx > posts a public comment as the reporter and shows it on the timeline`；`ticketDetail.test.tsx > sorts ascending without mutating input and hides internal notes from a reporter` |
| FR-11 真实统计与空数据 | `test_analytics_api.py::test_analytics_matches_ticket_rows_and_shanghai_days`；`test_analytics_api.py::test_shanghai_midnight_and_waiting_for_confirmation_count_in_close_time`；`test_analytics_api.py::test_analytics_requires_admin_and_has_stable_empty_response` | `analytics.test.tsx > renders real aggregates and labels total close duration`；`analytics.test.tsx > renders empty statistics without hiding the dashboard sections` |
| FR-12 地点维护与历史快照 | `test_locations_api.py::test_create_edit_disable_enable_returns_current_utc_resource_without_deleting`；`test_locations_api.py::test_rename_and_disable_leave_historical_ticket_snapshot_and_workflow_data_unchanged`；`test_location_ticket_selection.py::test_location_disabled_after_an_earlier_selection_is_rejected_on_reselection` | `locations.test.tsx > edits, disables and re-enables without changing an existing ticket's snapshot`；`locations.test.tsx > loads every active page and chooses a leaf ID, resetting descendants when a parent changes` |

## 后端全文件清单

路径统一前缀 `backend/tests/`。数字为 `main@6fe349f` 全量 JUnit 的**实例数**。`conftest.py` 仅为夹具配置，不是测试文件。

| 测试文件 | 已实跑实例数 | 对应 FR / 基础设施 | 具体函数示例 |
| --- | ---: | --- | --- |
| `test_api_contract.py` | 95 | FR-01–12，API 契约 | `test_exact_frozen_p0_route_coverage_without_extra_features`；`test_every_request_and_json_response_example_validates` |
| `test_attachments.py` | 40 | FR-03、FR-08 | `test_six_images_are_rejected_before_writing`；`test_reused_session_keeps_one_publication_listener_and_clears_rollback` |
| `test_auth_api.py` | 17 | FR-01；账户启停为冻结基线 §6.3，非 PRD FR-01–12 独立项 | `test_three_roles_login_read_session_and_logout`；`test_admin_account_management_revokes_existing_sessions` |
| `test_comments_api.py` | 28 | FR-10 | `test_allowed_comment_is_a_contract_row_without_state_version_or_event_change`；`test_terminal_comments_stay_readable_but_no_role_can_append` |
| `test_config.py` | 2 | FR-01 支撑／配置 | `test_settings_reject_wildcard_origin_when_credentials_are_enabled` |
| `test_database.py` | 2 | FR-01–12 支撑／数据库生命周期 | `test_get_db_closes_the_session_after_request` |
| `test_errors.py` | 2 | FR-01–12 支撑／错误契约 | `test_app_error_serializes_to_the_frozen_error_envelope` |
| `test_issue53_assignment.py` | 5 | FR-05、FR-06 | `test_review_then_assign_grants_current_technician_access`；`test_concurrent_assignment_has_one_current_owner_and_one_event` |
| `test_issue55_technician_workbench.py` | 2 | FR-04 | `test_assigned_list_is_scoped_before_filtering_and_pagination` |
| `test_location_schemas.py` | 75 | FR-12 | `test_creation_rejects_invalid_location_text`；`test_cursor_rejects_a_modified_signature_wrong_secret_and_other_resources` |
| `test_location_ticket_selection.py` | 13 | FR-02、FR-12 | `test_selection_reads_current_database_values_not_a_stale_identity_map` |
| `test_locations_api.py` | 25 | FR-12 | `test_all_roles_read_active_locations_but_only_admin_manages_them`；`test_rename_and_disable_leave_historical_ticket_snapshot_and_workflow_data_unchanged` |
| `test_main.py` | 3 | FR-01–12 支撑／健康与通用请求 | `test_state_changing_requests_without_an_allowed_origin_are_rejected_uniformly` |
| `test_p0_storage.py` | 36 | FR-01–12 支撑／迁移、约束、种子 | `test_fresh_upgrade_rollback_and_upgrade_again`；`test_seed_is_idempotent_and_preserves_existing_accounts` |
| `test_security.py` | 8 | FR-01 | `test_password_hash_uses_argon2id_and_round_trips` |
| `test_ticket_access.py` | 75 | FR-04、FR-10 | `test_read_visibility_matches_role_and_resource_ownership`；`test_timeline_filters_internal_and_unknown_visibility_without_mutating_input` |
| `test_ticket_attachment_handoff.py` | 3 | FR-02、FR-03、FR-10 | `test_created_ticket_keeps_comments_snapshot_and_photos_after_cancel` |
| `test_ticket_creation_api.py` | 20 | FR-02、FR-03、FR-12 | `test_concurrent_creations_allocate_distinct_ids_and_one_event_each`；`test_upload_rejections_leave_no_ticket_event_metadata_or_file` |
| `test_ticket_detail_api.py` | 10 | FR-04、FR-10、FR-12 | `test_related_roles_get_full_contract_and_real_workflow_projection_without_origin` |
| `test_ticket_list_api.py` | 10 | FR-04 | `test_list_role_scope_and_workflow_projection_without_origin`；`test_cursor_is_bound_to_user_and_filters_and_rejects_tampering` |
| `test_ticket_numbering.py` | 19 | FR-02 | `test_uses_identity_and_at_least_six_suffix_digits` |
| `test_ticket_pagination.py` | 97 | FR-04 | `test_cursor_is_bound_to_user_role_and_signing_key`；`test_every_nonempty_filter_is_bound` |
| `test_ticket_preparation.py` | 5 | FR-02、FR-04 | `test_creation_fields_and_number_format_do_not_allocate_or_initialize_a_ticket` |
| `test_ticket_reads.py` | 15 | FR-04、FR-10、FR-12 | `test_role_scopes_are_applied_before_seek_and_limit_including_closed_history` |
| `test_ticket_responses.py` | 21 | FR-03、FR-04、FR-10 | `test_detail_examples_round_trip_and_match_frozen_schema` |
| `test_ticket_schemas.py` | 83 | FR-02、FR-04 | `test_create_requires_all_four_fields`；`test_list_contains_all_seven_filter_groups_and_pagination` |
| `test_workflow_api.py` | 44 | FR-05–10 | `test_technician_start_and_resolve_then_reporter_confirm`；`test_repeating_confirm_preserves_a_single_ticket_closed_event` |
| `test_analytics_api.py` | 3 | FR-11 | `test_analytics_matches_ticket_rows_and_shanghai_days`；`test_shanghai_midnight_and_waiting_for_confirmation_count_in_close_time`；`test_analytics_requires_admin_and_has_stable_empty_response` |

## 前端全文件清单

路径统一前缀 `frontend/src/test/`。数字是**`main@6fe349f` 全量 Vitest 实跑结果**。前端用例名的完整定位格式为 `文件 > describe 名 > it 名`，表中省略 `describe`；例如 `technicianWorkbench.test.tsx > #55 technician workbench — FR-04 / UC-03 entry > renders only A's assignments with status, snapshot, priority, reported time and detail links, including closed tickets`。

| 测试文件 | 当前通过 | 对应 FR / 基础设施 | 具体用例名示例（`it` 文本） |
| --- | ---: | --- | --- |
| `App.test.tsx` | 25 | FR-01、FR-02、FR-04、FR-11、FR-12；路由 | `posts exactly the contract's body and lands on the role's page`；`serves the statistics page to Admin` |
| `accounts.test.tsx` | 3 | 冻结基线 §6.3 账户管理；源码称 `FR-16`，该编号**不在 PRD FR-01–12 内**，报告组需按正式目录核对 | `filters by role and active state, then clears both filters`；`disables and re-enables a Reporter while preserving the existing report` |
| `analytics.test.tsx` | 3 | FR-11 | `renders real aggregates and labels total close duration`；`does not draw bars for zero counts alongside nonzero counts` |
| `assignmentQueue.test.tsx` | 7 | FR-06 | `assigns to an active technician and displays the owner, assignment and timeline` |
| `client.test.ts` | 14 | FR-01–12 支撑／HTTP 客户端 | `carries the cookie and invents no token of its own`；`carries code, request id and field errors` |
| `components.test.tsx` | 11 | FR-04–10 支撑／通用组件 | `sorts event/comment ties without mutating input, labels internal notes and escapes text`；`blocks repeated confirmation and dismissal while awaiting the request` |
| `demoAccounts.test.mjs` | 4 | FR-01 | `lists exactly the seeded role/account pairs` |
| `endpoints.test.ts` | 29 | FR-01–12，API 客户端契约 | `exports exactly one function per declared business operation`；`sends the version with every state action` |
| `errors.test.ts` | 20 | FR-01–12 支撑／错误处理 | `classifies every code the contract declares, and no others`；`says the ticket was updated for a stale version` |
| `labels.test.ts` | 33 | FR-04–10、FR-12；状态和字段文案 | `TicketStatus renders as text, never blank`；`terminal statuses > are exactly the three the state machine ends on` |
| `locations.test.tsx` | 5 | FR-12、FR-02 | `edits, disables and re-enables without changing an existing ticket's snapshot` |
| `mockApi.test.ts` | 62 | FR-01–12；Mock 契约及闭环 | `runs create → review → assign → start → resolve → rework → resolve → confirm` |
| `mockBridge.test.ts` | 7 | FR-01–12 支撑／Mock 接入 | `the Mock mount point > does not intercept when the switch is off` |
| `mockPages.test.tsx` | 8 | FR-01、FR-04–10；Mock 页面 | `uses queue filters, pagination, detail timeline and a real cancellation through the shared dialog` |
| `queryClient.test.ts` | 16 | FR-04–09 支撑／冲突刷新、会话隔离 | `treats TICKET_VERSION_CONFLICT as a ticket even if the call site forgot its meta` |
| `reporterPages.test.tsx` | 18 | FR-02–04、FR-10、FR-12 | `submits fields and a photo as one request, then shows the photo and timeline on detail` |
| `reviewQueue.test.tsx` | 8 | FR-05 | `requires a rejection reason and displays the rejected event` |
| `sessionCache.test.tsx` | 7 | FR-01、FR-04 支撑／会话隔离 | `cannot repopulate the cache or 401 the next session away` |
| `technicianWorkbench.test.tsx` | 11 | FR-04 | `renders only A's assignments with status, snapshot, priority, reported time and detail links, including closed tickets` |
| `ticketDetail.test.tsx` | 27 | FR-04–10 | `starts an assigned ticket and submits its selected result photo once`；`keeps the rework dialog open when the required reason is empty` |

## 给报告组的使用说明

1. 用上方 FR 表选具体测试函数作为 TC 候选，按需求行为拆分 TC，不直接把参数化实例数当 TC 数。复合闭环测试可在多个 FR 下引用同一个测试 ID，并标注它实际断言的步骤。
2. 要完整列出某文件的每个测试函数，筛选[逐函数索引](D4-test-functions.tsv)的 `file` 列；要展开 pytest 的每个参数化实例，从同版[后端 JUnit](../../verification/2026-11-23-coverage-6fe349f/backend-results.xml)按 `classname` 筛选 `testcase`。
3. D4 的全量结果栏注明被测 SHA `6fe349f` 与 2026-11-23 的执行时间。本轮 C7/C8 联合确认对应 `667d9303`，验收范围、保留事项和后续复核见 [C8 追踪矩阵](../2026-11-23-c8-acceptance-traceability.md#联合签收状态)。
