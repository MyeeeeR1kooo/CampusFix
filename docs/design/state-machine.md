# 工单状态机工程规格（Issue #60）

- 工作分支：`base-auth`
- 状态：待全组评审；评审通过后作为 M04、M08、M09 的实现依据
- 依据：[P0 冻结基线](../superpowers/specs/CampusFix%20P0%20Requirements%20%26%20Design%20Baseline.md) §3–5、§7、§8.4、§10–12、§16；[已冻结 API 契约](../api/openapi.yaml)；[现有数据库模型](../../backend/app/models.py)

本文只规定 P0 工单状态转换、授权、并发控制与事件落库。工单状态机的编码属于 M04（#50）；审核和分派分别由 M08（#52）、M09（#53）接入。本文不增加重新分派、管理员强制关闭、终态重新打开或独立附件上传等 P1/范围外功能。`docs/CampusFix_PRD.md` 已自述作废，不用于补充本规格的规则。

## 1. 状态与责任方

| 状态 | 含义 | 当前责任方 | 后续状态 |
| --- | --- | --- | --- |
| `SUBMITTED` | 已提交，等待审核 | Admin | `PENDING_ASSIGNMENT`、`REJECTED`、`CANCELLED` |
| `PENDING_ASSIGNMENT` | 审核通过，等待分派 | Admin | `ASSIGNED` |
| `ASSIGNED` | 已指定维修人员，尚未开始 | 当前 Technician | `IN_PROGRESS` |
| `IN_PROGRESS` | 正在处理或返工 | 当前 Technician | `PENDING_CONFIRMATION` |
| `PENDING_CONFIRMATION` | 已提交维修结果，等待确认 | 原 Reporter | `CLOSED`、`IN_PROGRESS` |
| `CLOSED` | 报修人确认完成 | 无 | 终态 |
| `REJECTED` | 管理员驳回 | 无 | 终态 |
| `CANCELLED` | 报修人在审核前撤销 | 无 | 终态 |

“当前责任方”用于展示下一步由谁行动；实际操作权限还必须检查账户、角色、工单归属、当前状态和版本。返工回到 `IN_PROGRESS`，以 `REWORK_REQUESTED` 事件记录历史，不创建额外的长期状态。除下表八条转换外，没有其他 P0 状态跳转。

工单创建是初始化，不属于八条转换：原 Reporter 创建工单后，`tickets.status = SUBMITTED`、`version = 1`、`priority = NULL`、`current_assignee_id = NULL`、`closed_at = NULL`，并在同一创建事务写入 `TICKET_SUBMITTED` 公开事件（`from_status = NULL`，`to_status = SUBMITTED`）。创建接口没有 `expected_version`；Tickets 创建用例须与 Workflow 协作写事件，不能因此开放通用状态写入口。

## 2. 允许转换与转换授权

以下每个动作都要求有效会话、启用的操作者账户和 `expected_version`。表中“原 Reporter”指 `tickets.reporter_id`，而“当前 Technician”指 `tickets.current_assignee_id`；同角色的其他人没有该工单的对应操作权。

| 当前状态 → 下一状态 | 动作接口 | 允许的操作者 | 必填信息；可选信息 | 唯一对应事件 |
| --- | --- | --- | --- | --- |
| `SUBMITTED` → `PENDING_ASSIGNMENT` | `POST /api/tickets/{id}/review`，`decision=APPROVE` | Admin | 固定枚举中的 `category`、`priority`（`LOW`/`MEDIUM`/`HIGH`）、`expected_version` | `TICKET_APPROVED` |
| `SUBMITTED` → `REJECTED` | `POST /api/tickets/{id}/review`，`decision=REJECT` | Admin | 非空 `reason`、`expected_version` | `TICKET_REJECTED` |
| `SUBMITTED` → `CANCELLED` | `POST /api/tickets/{id}/cancel` | 原 Reporter | `expected_version`；`reason` 可选 | `TICKET_CANCELLED` |
| `PENDING_ASSIGNMENT` → `ASSIGNED` | `POST /api/tickets/{id}/assign` | Admin | 启用且角色为 Technician 的 `technician_id`、`expected_version` | `TICKET_ASSIGNED` |
| `ASSIGNED` → `IN_PROGRESS` | `POST /api/tickets/{id}/start` | 当前 Technician | `expected_version`；`note` 可选 | `WORK_STARTED` |
| `IN_PROGRESS` → `PENDING_CONFIRMATION` | `POST /api/tickets/{id}/resolve` | 当前 Technician | 非空 `resolution_note`、`expected_version`；结果图片可选 | `RESOLUTION_SUBMITTED` |
| `PENDING_CONFIRMATION` → `CLOSED` | `POST /api/tickets/{id}/confirm` | 原 Reporter | `expected_version` | `TICKET_CLOSED` |
| `PENDING_CONFIRMATION` → `IN_PROGRESS` | `POST /api/tickets/{id}/rework` | 原 Reporter | 非空 `reason`、`expected_version` | `REWORK_REQUESTED` |

只有 Admin 能审核与分派，但 Admin 不能代替原 Reporter 撤销、确认或要求返工，也不能代替当前 Technician 开始处理或提交结果。前端隐藏按钮不构成授权。所有状态变化只能走上述业务动作接口，由 Workflow 统一执行；客户端不能通过通用 `PATCH status` 改状态。

审核通过时在同一次状态更新中确认类别并设置优先级。分派时在执行动作的服务端事务中检查目标账户，不能只信前端候选列表。目标不存在、不是 Technician 或已停用均返回 `422 / VALIDATION_ERROR`，`field_errors` 指向 `technician_id`，且没有状态、版本、负责人、分派或事件变化。

## 3. 状态、分派与事件的落库约束

- 每次成功转换使 `tickets.version` 恰好加 1，并更新 `updated_at`；失败不递增版本。留言不改变状态或版本。
- `priority` 在 `PENDING_ASSIGNMENT` 至 `CLOSED` 必须非空；`SUBMITTED`、`REJECTED`、`CANCELLED` 可以为空。`current_assignee_id` 在分派前及 `REJECTED`、`CANCELLED` 为空；从 `ASSIGNED` 起保留，包括返工和关闭后。
- 分派同时设置 `tickets.current_assignee_id`、插入一条 `assignments` 记录并写入 `TICKET_ASSIGNED` 事件。现有部分唯一索引 `ticket_id WHERE ended_at IS NULL` 保证一个工单最多一名当前负责人。P0 不重新分派，正常流程中 `assignments.ended_at` 保持为空。
- 仅确认完成设置 `closed_at`；其余状态 `closed_at` 均为空。返工保留当前负责人，不创建新分派，后续由该 Technician 再次提交结果。
- 每次成功转换恰好追加一条表中对应的 `ticket_events` 记录，填入 `ticket_id`、真实操作者 `actor_id`、`type`、转换前后状态、说明及时间；事件只追加，应用接口不能修改或删除。驳回与返工原因、维修结果说明分别进入对应事件的 `note`；可选的开始处理备注、撤销原因有值时也进入 `note`。事件按冻结基线 §5.5 的可见性规则进入时间线；创建时的 `TICKET_SUBMITTED` 明确为 `PUBLIC`，本规格不增加新的内部事件类型。
- 时间线按已冻结契约合并事件与留言，再以 `created_at ASC, kind ASC, id ASC` 稳定排序。读取时按工单可见性和事件/留言可见性过滤；这不改变状态机写入规则。

## 4. 乐观锁、冲突和失败语义

状态动作请求中的 `expected_version` 必须是客户端读取到的工单版本。Workflow 在已验证会话、操作者权限、资源关系和业务输入后，以 `id + 预期当前状态 + expected_version` 作数据库条件更新，并在更新中执行 `version = version + 1`。可以用以下等价的 PostgreSQL 条件更新实现，不得先读取版本再无条件覆盖：

```sql
UPDATE tickets
SET status = :next_status,
    version = version + 1,
    updated_at = :now
    -- 同一动作需要更新的 category、priority、current_assignee_id、closed_at
WHERE id = :ticket_id
  AND status = :expected_status
  AND version = :expected_version
RETURNING id, version;
```

若条件更新没有命中记录，重新读取并按当前用户的可见性、状态和版本确定错误；不写事件或分派。已授权工单的旧版本请求返回 `409 / TICKET_VERSION_CONFLICT`；版本仍匹配但状态不允许该动作，返回 `409 / CONFLICT`。因此同一旧版本的审核、撤销、开始、提交结果或确认并发操作最多一个成功，重复旧版本动作不能重复写入有效事件。无权查看的工单返回 `404 / NOT_FOUND`；能查看但角色不允许执行动作返回 `403 / FORBIDDEN`。未登录、失效会话或已停用账户返回 `401 / UNAUTHORIZED`。缺失或无效字段返回 `422 / VALIDATION_ERROR`。错误响应沿用冻结契约的 `{error:{code,message,request_id,field_errors}}`，不暴露 SQL 或约束名。

上述条件更新是数据库层面的并发门槛。唯一索引和 CHECK 约束是额外保护，不能替代 Workflow 的角色、归属、状态及版本检查。状态冲突或任何后续写入失败都必须回滚整个动作。

## 5. 单事务执行顺序与时序图输入

关键参与者依次为客户端、API 路由、Auth、Workflow、PostgreSQL；提交结果带图片时还涉及 Attachments 的临时与私有存储。路由解析请求并序列化响应，Workflow 服务负责用例与事务，数据访问层执行查询和条件更新。

1. Auth 加载会话与当前用户，确认账户仍启用；Workflow 在动作的数据库事务中读取工单授权所需的最小信息，验证角色、原报修人/当前负责人关系和业务输入。分派目标须在执行分派时验证；带图片的动作先在事务外暂存并校验图片。
2. Workflow 按第 4 节做条件更新；更新零行时重新读取并按错误语义结束，不执行后续写入。
3. 审核通过时在该更新中写入类别与优先级；分派时在该更新中设置负责人，再在同一事务插入分派记录；确认完成时设置 `closed_at`；返工时保留负责人。其他动作只更新各自必要字段。
4. Workflow 在同一事务插入且仅插入一条对应状态事件。提交维修结果时，说明与结果图片元数据也属于该动作；在事务内写元数据、完成原子移动，失败时回滚并清理已移动文件，遵循冻结基线 §7.3。
5. 数据库提交成功后返回更新后的工单摘要与新版本。事件、分派或附件相关写入失败时，数据库状态与版本一同回滚，不返回成功。

吴恺煜绘制关键转换时序图时，可直接展开以下分支：

- **审核与撤销竞争**：两个操作者都基于 `SUBMITTED/version=1` 请求；条件更新只让一个成功，另一方重读后收到旧版本 `409`，没有第二条状态事件。
- **分派**：Admin 选择 Technician → 服务端验证目标账户仍启用且角色正确 → 条件更新工单 → 同事务写 `assignments` 与 `TICKET_ASSIGNED` → 提交；目标校验失败走 `422` 且零副作用。
- **维修与返工闭环**：当前 Technician 提交结果 → `PENDING_CONFIRMATION`；原 Reporter 选择确认则设置 `closed_at` 并关闭，选择返工则写 `REWORK_REQUESTED` 后回到 `IN_PROGRESS`，由同一负责人再次提交结果。
- **落库失败**：条件更新已命中，但事件/分派/附件步骤失败 → 回滚状态、版本及关联记录；附件按基线清理已移动文件。

## 6. M04/M08/M09 的验证依据

- 覆盖八种状态、八条合法转换及创建时的 `TICKET_SUBMITTED`；例如 `SUBMITTED` 不能直接到 `CLOSED`，三个终态没有后续动作。
- 对每条转换验证角色和工单关系；尤其其他 Reporter、非当前 Technician、非 Admin 的拒绝，以及停用账户原会话失效。
- 验证 `expected_version` 递增、旧版本与重复动作 `409`，同一版本并发审核、开始、提交结果或确认只有一次成功和一条有效事件。
- 验证驳回/返工/维修结果必填内容、无效分派目标三种 `422`、分派后唯一当前负责人，以及事件或分派写入失败时的全事务回滚。
- 使用真实 PostgreSQL 进行事务与并发集成测试；状态事件与时间线、公开/内部可见性按冻结契约验证。文档本身不代表这些业务测试已经通过。
