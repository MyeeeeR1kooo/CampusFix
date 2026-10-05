# #46 最小字段清单

状态：v1.0.0 待评审。先供前端逐条确认字段，再以 [openapi.yaml](openapi.yaml) 中的 Schema 为最终机器可读定义。依据 P0 冻结基线，不从已作废 PRD 增加功能。

## 类型和公共返回对象

`Id` = 正整数 `integer/int64`；`Version` = 从 1 开始的整数；`UTC` = ISO 8601 字符串，以 `Z` 结尾；`?` 表示字段必定返回但值允许 `null`，不是字段可以缺失。

| 对象 | 返回字段与类型 |
| --- | --- |
| User | `id: Id, name: string, email: string, role: REPORTER/TECHNICIAN/ADMIN, active: boolean, created_at: UTC, updated_at: UTC` |
| UserSummary | `id: Id, name: string, role: Role`；工单参与者不下发邮箱、安全字段 |
| TicketSummary | `id: Id, code: string, reporter: UserSummary, location_id: Id, location_label_snapshot: string, title: string, category: Category, priority: Priority?, status: TicketStatus, current_assignee: UserSummary?, version: Version, created_at: UTC, updated_at: UTC, closed_at: UTC?, current_responsible_role: Role?, next_action: string?, allowed_actions: TicketAction[]` |
| TicketDetail | TicketSummary 全部字段，加 `description: string, report_photos: Attachment[], resolution_photos: Attachment[], assignments: Assignment[], timeline: (TicketEvent \| Comment)[]` |
| Attachment | `id: Id, ticket_id: Id, uploader: UserSummary, original_name: string, mime: image/jpeg\|image/png\|image/webp, size: integer`（字节），`purpose: REPORT_PHOTO\|RESOLUTION_PHOTO, created_at: UTC, download_url: string`（受保护相对地址） |
| Assignment | `id: Id, ticket_id: Id, technician: UserSummary, assigned_by: UserSummary, assigned_at: UTC, ended_at: null, reason: string?` |
| TicketEvent | `kind: EVENT, id: Id, ticket_id: Id, actor: UserSummary, type: EventType, from_status: TicketStatus?, to_status: TicketStatus, note: string?, visibility: PUBLIC\|ADMIN_ONLY, created_at: UTC` |
| Comment | `kind: COMMENT, id: Id, ticket_id: Id, author: UserSummary, body: string, visibility: PUBLIC\|ADMIN_ONLY, created_at: UTC` |
| Location | `id: Id, building: string, floor: string, room_or_area: string, active: boolean, created_at: UTC, updated_at: UTC` |
| Page<T> | `items: T[], next_cursor: string?`；默认 20、最多 100，空列表 `items: [], next_cursor: null`，不增加 `total` |
| Analytics | `by_status: {status,count}[], by_category: {category,count}[], by_building: {building,count}[], backlog_count: integer, average_close_seconds: number, daily_trend: {date: YYYY-MM-DD,created_count: integer,closed_count: integer}[]`；无关闭样本平均值为 0 |
| ErrorResponse | `error: {code: ErrorCode, message: string, request_id: string, field_errors: {field:string,message:string,type:string}[]}` |

`Category` 六类、`TicketStatus` 八态、`Priority` 三档以及事件/动作枚举见契约；不重复维护另一份枚举源码。工单展示编号和数据库 ID 是不同字段。

## 接口路径、返回对象和用途

目前仅第 1 行真实实现，其余 22 个操作均为待实现契约。

| 方法与路径 | 成功码 / 返回类型 | 用途与权限 |
| --- | --- | --- |
| GET `/health` | 200 / `{status: "ok"}` | 已实现，匿名存活检查，不访问数据库 |
| POST `/api/auth/login` | 200 / User + Set-Cookie | 登录；会话令牌只写 Cookie |
| POST `/api/auth/logout` | 204 / 无正文 | 删除当前已登录会话并清 Cookie |
| GET `/api/me` | 200 / User | 当前已登录用户 |
| POST `/api/tickets` | 201 / TicketSummary | Reporter 创建；字段与可选现场图片一起 multipart 上传 |
| GET `/api/tickets` | 200 / Page<TicketSummary> | 角色可见范围内的列表与七类筛选 |
| GET `/api/tickets/{id}` | 200 / TicketDetail | 相关人/Admin，图片、责任方、动作及可见时间线 |
| POST `/api/tickets/{id}/review` | 200 / TicketSummary | Admin 批准或驳回；批准必需类别/优先级，驳回必需原因 |
| POST `/api/tickets/{id}/assign` | 200 / TicketSummary | Admin 分派启用的 Technician，不提供重新分派 |
| POST `/api/tickets/{id}/start` | 200 / TicketSummary | 当前 Technician 开始处理 |
| POST `/api/tickets/{id}/resolve` | 200 / TicketSummary | 当前 Technician；处理说明和可选结果图片 multipart |
| POST `/api/tickets/{id}/confirm` | 200 / TicketSummary | 原 Reporter 确认完成；设置 closed_at |
| POST `/api/tickets/{id}/rework` | 200 / TicketSummary | 原 Reporter 填原因要求返工，回到 IN_PROGRESS |
| POST `/api/tickets/{id}/cancel` | 200 / TicketSummary | 原 Reporter 仅审核前撤销 |
| POST `/api/tickets/{id}/comments` | 201 / Comment | 非终态公开留言；仅 Admin 可写/读内部备注 |
| GET `/api/attachments/{id}` | 200 / 图片二进制 | 每次检查工单可见性，不是公共静态文件 |
| GET `/api/locations` | 200 / Page<Location> | 已登录用户读取有效地点，派生三级选择 |
| GET `/api/admin/locations` | 200 / Page<Location> | Admin 查看全部地点 |
| POST `/api/admin/locations` | 201 / Location | Admin 创建地点，楼宇/楼层/房间组合唯一 |
| PATCH `/api/admin/locations/{id}` | 200 / Location | Admin 修改显示信息或启停，不物理删除 |
| GET `/api/admin/users` | 200 / Page<User> | Admin 查询 Reporter/Technician，按角色/active 筛选 |
| PATCH `/api/admin/users/{id}/active` | 200 / User | Admin 启停 Reporter/Technician，不管理 Admin |
| GET `/api/admin/analytics` | 200 / Analytics | Admin 六类统计；日趋势按 Asia/Shanghai，30 天 |

## 不可遗漏的使用规则

- 所有写操作需要允许的 `Origin`；浏览器自动带上，手工客户端也需提供。
- 七个状态动作都传 `expected_version`；成功返回新版本，旧版本返回 409。留言不改变状态或版本。
- 工单编号 `CF-YYYYMMDD-NNNNNN` 的 `YYYYMMDD` 取创建时刻的 **Asia/Shanghai 本地日期**，与统计趋势日期同一时区（不是 UTC）。
- 分派目标账户不存在、非 Technician 或已停用：统一返回 `422 / VALIDATION_ERROR`，`field_errors.field` 为 `technician_id`，提示重新选择；失败不改变工单、分派记录或事件。
- priority 从待分派至 CLOSED 非空；current_assignee 分派后非空且关闭后保留；只有 CLOSED 的 closed_at 非空。
- `allowed_actions` 表示当前登录人可操作的按钮；`current_responsible_role/next_action` 表示当前业务责任，不等于当前人有权限。终态没有新增留言或状态动作。
- Reporter/Technician 的 timeline 不得含 ADMIN_ONLY；服务端过滤，不是前端隐藏。
- 一种图片用途总计最多 5 张，单张最多 5 MiB；返工不重置总额度。实际内容应可解码且为 JPEG/PNG/WebP。
- Issue 中 tickets CRUD 不扩展为通用编辑/删除：冻结基线只批准创建、查询和明确的状态动作。
- 未获人工逐条评审，不将本清单或版本号标作正式冻结。
