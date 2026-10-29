# update2 五项审查问题修复记录

日期：2026-10-29。集成分支：`reporter-flow`。

## 修复与范围

| 审查项 | 修改 | 范围 |
| --- | --- | --- |
| 1：照片数量超限提示限定为维修结果照片 | 将 `Too many result photos.` 改为 `Too many photos.`；仍最多 5 张，超限返回 422 | 报修照片和维修结果照片共用的附件服务 |
| 2：查询文本缺少长度上限 | `q` 最多 120 字符；`building` 筛选值及地点创建、修改中的楼宇名称统一最多 255 字符 | 后端输入校验、地点表单、Mock、API 契约 |
| 3：创建时间筛选接受反向区间 | `created_from > created_before` 返回 422；相等区间有效并返回空列表 | 工单列表筛选及 Mock |
| 4：工单事件文本缺少长度上限 | 驳回原因、撤销原因、开始处理备注、维修结果说明、返工原因最多 2000 字符；原必填/可选规则保持不变 | Workflow JSON/multipart 请求、动作表单及 Mock |
| 5：复用 Session 时附件提交监听器累积 | 每个 Session 复用一组监听器，通过 Session 待发布记录标记提交；顶层回滚清理待发布记录 | 附件事务与文件生命周期 |

不截断已有地点名称或工单地点快照；不增加数据库约束或执行数据迁移。
审核表单只在驳回时校验驳回原因，切换为通过后不会被隐藏的超长原因阻止。

## 文件清单与共享影响

- `backend/app/modules/attachments/service.py`：报修、维修结果共用的照片数量提示、提交与回滚监听器。
- `backend/app/modules/locations/schemas.py`：地点创建、修改的楼宇长度。
- `backend/app/modules/tickets/schemas.py`：列表查询长度及时间区间。
- `backend/app/modules/workflow/schemas.py`、`router.py`：五类事件文本长度，含维修结果 multipart 字段。
- `frontend/src/features/locations/LocationManagementPage.tsx`：楼宇名称表单校验。
- `frontend/src/features/tickets/TicketActionZone.tsx`：共享动作弹窗校验与开始处理备注错误展示。
- `frontend/src/mocks/protocol.ts`：Mock 输入边界及时间区间规则，与真实 API 同步。
- `docs/api/openapi.yaml`：共享 API 契约的输入长度和区间语义。
- `docs/superpowers/specs/CampusFix P0 Requirements & Design Baseline.md`：记录批准的长度及时间区间边界。
- 测试文件：`backend/tests/test_attachments.py`、`test_location_schemas.py`、`test_locations_api.py`、`test_ticket_list_api.py`、`test_workflow_api.py`，以及 `frontend/src/test/mockApi.test.ts`、`ticketDetail.test.tsx`。

审核与派单工作台后续集成应关注 API 契约、冻结基线、Mock、共享动作区和地点表单；这些文件的并行修改需要与 #52/#53 开发者协调。本记录 PR 仅新增本文档，业务修改已在以下提交中交付。

2026-10-29 检查开放 PR #108、#109 的文件清单：二者均未直接修改上述共享文件；#109 修改 `TicketDetailPage.tsx`，集成时需关注其与共享动作区的调用关系。

## 提交与集成

- `a022203`：修复第 1、5 项，分支 `fix/reporter-photo-review`。
- `832c3f0`：将第 1、5 项合并至 `reporter-flow`。
- `f6805c5`：修复第 2、3、4 项，分支 `fix/update2-input-validation`。
- `4b62a82`：将第 2、3、4 项合并至 `reporter-flow`。
- `b42cf1f`：将上述代码合并至 `main`。
- `5822306`：将 `main` 同步至 `admin-flow`。

上述代码合并已推送 GitHub。本次补充 PR 用于记录问题、范围与验证证据，不重复实施代码修复。

## 验证证据与限制

- 后端完整测试：此前对这组后端修复运行得到 **743 passed**，有 1 条既有 Starlette/httpx 弃用警告。
- 最终前端完整测试：`cd frontend && npm test`，**283 passed**。
- 动作区回归：`ticketDetail.test.tsx`，**23 passed**，包含超长开始处理备注阻止提交、超长驳回原因报错以及切换通过后成功审核。
- TypeScript：`cd frontend && npx tsc -p tsconfig.json --noEmit` 通过。
- `git diff --check` 通过。
- 后端覆盖照片超限写入前拒绝、复用 Session 监听器数量稳定、回滚记录清理、筛选边界、超长请求返回 422 且无业务写入副作用。
- 最终前端修订后未能再次运行后端：本地没有 `pytest` 命令，Docker daemon 拒绝访问；后端代码在此前 743 项通过后未再修改。
- 本次补充文档不改变运行行为，不将既有测试结果表述为本次重新执行；未新增端到端或外部集成测试证据。
