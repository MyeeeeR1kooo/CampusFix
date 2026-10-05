# CampusFix P0 需求与设计冻结基线（Requirements & Design Baseline）

- 文档版本：1.0.1
- 日期：2026-10-03
- 状态：Frozen / Baseline Approved
- 冻结版本：P0 v1.0
- 冻结日期：2026-09-28
- 适用范围：CampusFix 第一版 Web PoC
- 上位文档：[CampusFix 产品需求文档](../../CampusFix_PRD.md)

## 1. 文档目的

本文档将 CampusFix PRD 中的 P0 范围落实为可实施的产品与技术设计，作为后续实现计划、接口开发、数据库迁移、测试和验收的共同基线。

### 1.1 冻结规则

本文档自 P0 v1.0 经团队确认后作为第一版开发基线。

未经变更评审，不得修改 P0 功能范围、业务状态机、角色权限、核心数据模型、API 契约及验收标准。

后续新增需求默认进入 P1 Backlog；确需修改 P0 时，应记录变更原因、影响范围和版本号。

本设计遵循以下原则：

1. 第一版优先完成可演示、可测试、可复现的完整工单闭环。
2. 不扩大已确认的产品边界，不提前实现 P1 功能。
3. 权限、状态机、事务和审计记录由后端强制保证。
4. 前后端、数据库、附件存储和测试环境使用明确契约协作。
5. 实现结果必须能从需求编号追踪到接口、页面和自动化测试。

### 1.2 已批准的基线修订

| 文档版本 / 日期 | 批准依据 | 原因与决定 | 影响范围 |
| --- | --- | --- | --- |
| 1.0.1 / 2026-10-03 | 项目负责人在本次会话明确批准“按推荐方案做吧” | 补齐 PR #65 契约评审 §3.3：分派目标不存在、非 Technician 或已停用，统一返回 `422 / VALIDATION_ERROR`，字段错误指向 `technician_id` | §11.5 错误映射、分派契约及样例、前端字段提示和后续业务测试；沿用 P0 v1.0 范围，不新增 HTTP 状态、错误码或数据库结构；不代表整个 API 契约已评审冻结 |

## 2. 已确认的产品边界

### 2.1 第一版目标

CampusFix 第一版用于处理校园实体设施故障，包括：

- 照明与供电；
- 门窗与门锁；
- 桌椅与家具；
- 空调与通风；
- 供水与卫生设施；
- 其他实体设施问题。

系统完成以下业务闭环：

```text
报修人提交
→ 管理员审核并设定优先级
→ 管理员分派维修人员
→ 维修人员开始处理并提交结果
→ 报修人确认完成或要求返工
→ 工单关闭或重新进入处理阶段
```

### 2.2 第一版不处理的事项

以下内容不属于 P0：

- IT 设备和校园网络故障；
- 医疗、消防、报警和紧急安全事件；
- 自助注册、邮箱验证和密码找回；
- 学校统一身份认证；
- 站内通知、邮件和短信；
- 自动派单和重新分派；
- 管理员强制关闭或重新打开工单；
- 疑似重复报修识别；
- 满意度评价；
- CSV 导出和自定义报表；
- 实时聊天；
- 原生移动应用；
- 支付、采购和供应商结算；
- 生产级高可用和跨区域部署。

页面必须提示用户：紧急安全事故、医疗事件和报警应使用学校现有紧急渠道，不由 CampusFix 处理。

## 3. 用户、账户与授权

### 3.1 角色

| 角色 | 主要能力 | 数据范围 |
| --- | --- | --- |
| Reporter | 创建报修、查看进度、补充公开留言、审核前撤销、确认完成、要求返工 | 自己创建的工单 |
| Technician | 查看任务、补充公开留言、开始处理、提交维修结果 | 当前分配给自己的工单，包括其关闭后的历史详情 |
| Admin | 查看全部工单、审核、驳回、分类、设置优先级、分派、维护地点和账户状态、查看统计 | 全部工单和管理数据 |

### 3.2 账户来源

- 三类角色均使用种子数据创建的演示账户。
- 第一版不提供普通用户注册入口。
- Admin 可在账户管理页面启用或停用 Reporter 和 Technician。
- 普通页面不允许创建 Admin、修改角色或修改其他用户身份。
- Admin 不能通过页面停用自己的当前账户。
- 用户只被停用，不做物理删除，以保护历史工单引用。
- 账户停用后，已有会话在下一次请求时立即失去访问权限。

### 3.3 授权原则

后端对每次请求同时检查：

1. 是否存在有效会话；
2. 当前账户是否启用；
3. 用户角色是否允许执行该动作；
4. 用户与目标工单是否存在允许的资源关系；
5. 工单当前状态是否允许执行该动作；
6. 客户端提交的工单版本是否仍然有效。

前端路由保护和按钮隐藏只用于改善体验，不构成安全边界。附件下载、时间线、留言和统计接口均执行后端授权。

## 4. 业务流程与状态机

### 4.1 状态定义

| 状态 | 含义 | 当前责任方 |
| --- | --- | --- |
| `SUBMITTED` | 已提交，等待审核 | Admin |
| `PENDING_ASSIGNMENT` | 审核通过，等待分派 | Admin |
| `ASSIGNED` | 已指定维修人员，尚未开始 | Technician |
| `IN_PROGRESS` | 正在处理或返工 | Technician |
| `PENDING_CONFIRMATION` | 已提交维修结果，等待确认 | Reporter |
| `CLOSED` | 报修人确认完成 | 无后续动作 |
| `REJECTED` | 管理员驳回 | 无后续动作 |
| `CANCELLED` | 报修人在审核前撤销 | 无后续动作 |

### 4.2 允许的转换

| 当前状态 | 动作 | 操作者 | 下一状态 | 必填信息 |
| --- | --- | --- | --- | --- |
| `SUBMITTED` | 审核通过 | Admin | `PENDING_ASSIGNMENT` | 类别、优先级、版本号 |
| `SUBMITTED` | 驳回 | Admin | `REJECTED` | 驳回原因、版本号 |
| `SUBMITTED` | 撤销 | 原 Reporter | `CANCELLED` | 版本号；原因可选 |
| `PENDING_ASSIGNMENT` | 分派 | Admin | `ASSIGNED` | 启用的 Technician、版本号 |
| `ASSIGNED` | 开始处理 | 当前 Technician | `IN_PROGRESS` | 版本号；备注可选 |
| `IN_PROGRESS` | 提交结果 | 当前 Technician | `PENDING_CONFIRMATION` | 处理说明、版本号；结果图片可选 |
| `PENDING_CONFIRMATION` | 确认完成 | 原 Reporter | `CLOSED` | 版本号 |
| `PENDING_CONFIRMATION` | 要求返工 | 原 Reporter | `IN_PROGRESS` | 返工原因、版本号 |

返工不增加长期状态，而是写入 `REWORK_REQUESTED` 事件后回到 `IN_PROGRESS`。关闭、驳回和撤销均为终态，第一版不提供重新打开功能。

### 4.3 状态变更规则

- 客户端不能通过通用 `PATCH status` 修改工单状态。
- 所有状态变化必须调用具有业务含义的动作接口。
- Workflow 服务是唯一允许修改 `tickets.status` 的模块。
- 状态、版本、关闭时间、负责人、分派记录和事件日志按动作需要在同一数据库事务中提交。
- 每个成功动作只写入一条对应的状态事件。
- 非法转换返回 `409 Conflict`，不产生任何状态或事件变化。
- 重复提交同一个旧版本的动作时，第一个请求可成功，后续请求返回 `409 Conflict`。

## 5. 工单功能设计

### 5.1 创建工单

Reporter 创建工单时填写：

| 字段 | 规则 |
| --- | --- |
| 标题 | 必填，1–120 个字符 |
| 描述 | 必填，1–4000 个字符 |
| 类别 | 必填，来自固定类别列表 |
| 地点 | 必填，来自启用的地点记录 |
| 现场图片 | 可选，最多 5 张 |

成功创建后：

- 生成全局唯一的工单编号；
- 状态设置为 `SUBMITTED`；
- 版本设置为 `1`；
- 保存创建时的地点文本快照；
- 写入 `TICKET_SUBMITTED` 公开事件；
- 返回完整工单摘要和当前版本。

工单编号格式为 `CF-YYYYMMDD-NNNNNN`，其中 `YYYYMMDD` 取创建时刻的 **Asia/Shanghai 本地日期**（与统计趋势日期同一时区，不是 UTC）。尾号使用数据库生成的工单 ID，不采用“查询当天最大值再加一”的方式，避免并发碰撞。

### 5.2 类别与优先级

固定类别为：

- `LIGHTING_ELECTRICAL`：照明与供电；
- `DOORS_WINDOWS_LOCKS`：门窗与门锁；
- `FURNITURE`：桌椅与家具；
- `HVAC`：空调与通风；
- `WATER_SANITARY`：供水与卫生设施；
- `OTHER_FACILITY`：其他设施问题。

Reporter 在创建时选择初始类别；Admin 审核时确认该类别，或在审核通过前将其纠正为另一固定类别。优先级由 Admin 审核时设定为 `LOW`、`MEDIUM` 或 `HIGH`。高优先级仅表示普通维修队列中的相对优先程度，不表示系统承诺处理紧急事故。

### 5.3 列表、筛选和详情

列表支持以下筛选：

- 状态；
- 类别；
- 优先级；
- 楼宇；
- 创建时间范围；
- 工单编号或标题关键字；
- Admin 可按当前维修人员筛选。

列表默认按 `created_at DESC, id DESC` 排序，使用包含这两个字段的游标分页。默认每页 20 条，最大每页 100 条。

详情页展示：

- 工单编号、标题、描述和类别；
- 创建时地点快照；
- 当前状态和优先级；
- 报修人和当前维修人员；
- 当前责任方和下一步动作；
- 现场图片和维修结果图片；
- 按时间排序的事件与留言；
- 当前用户被允许执行的操作。

### 5.4 留言与内部备注

- Reporter、当前 Technician 和 Admin 可在非终态工单中添加公开留言。
- 公开留言对所有有权访问该工单的人可见。
- 只有 Admin 可以创建和读取 `ADMIN_ONLY` 内部备注。
- Technician 和 Reporter 均不能读取内部备注。
- 留言正文为 1–2000 个字符。
- 留言不改变工单状态。
- 终态工单中的既有留言仍可查看，但不能新增留言。

### 5.5 时间线

以下动作必须形成事件：

- 工单提交；
- 审核通过；
- 驳回；
- 撤销；
- 分派；
- 开始处理；
- 提交维修结果；
- 确认完成；
- 要求返工。

事件为只追加记录，不能通过应用接口修改或删除。公开事件对所有工单相关人员可见；管理员内部事件只对 Admin 可见。

## 6. 地点与账户管理

### 6.1 地点模型

第一版使用一张扁平的 `locations` 表，每条记录表示一个可选择的具体位置：

```text
building + floor + room_or_area
```

前端从有效地点记录中派生楼宇、楼层和房间三级选择。该方案保持数据模型简单，同时满足受控选择要求。

### 6.2 地点操作

Admin 可以：

- 创建地点；
- 修改地点显示信息；
- 启用或停用地点；
- 查看全部地点。

`building + floor + room_or_area` 的组合必须唯一。停用地点不能再用于创建工单，但历史工单继续显示创建时保存的地点快照。

### 6.3 账户管理

账户管理页只提供：

- 按角色和启用状态筛选账户；
- 启用 Reporter 或 Technician；
- 停用 Reporter 或 Technician。

第一版不提供账户创建、角色修改、密码重置或 Admin 管理界面。演示账户通过幂等种子脚本创建。

## 7. 附件设计

### 7.1 文件规则

| 项目 | 规则 |
| --- | --- |
| 支持类型 | JPEG、PNG、WebP |
| 单个文件大小 | 最大 5 MiB |
| 每种用途数量 | 最多 5 张现场图片，最多 5 张结果图片 |
| 存储 | Docker 私有数据卷，不通过公共静态目录暴露 |
| 文件名 | 随机存储键；原始名称只作为元数据 |
| 下载 | 通过授权 API 流式返回 |

SVG 不在允许列表中。后端必须检查实际文件内容和可解码性，不能只相信扩展名或客户端提交的 MIME。

### 7.2 上传时机

- 创建工单接口使用 `multipart/form-data`，同时接收字段和现场图片。
- 提交维修结果接口使用 `multipart/form-data`，同时接收处理说明和结果图片。
- 第一版不提供脱离上述两个业务动作的通用附件上传接口。

### 7.3 文件与数据库一致性

文件处理顺序为：

1. 在数据库事务外将上传流写入临时目录并完成校验；
2. 开启数据库事务；
3. 写入工单或处理结果、附件元数据及事件；
4. 将临时文件原子移动到私有存储目录；
5. 提交数据库事务；
6. 任一步骤失败时回滚数据库并删除已写入文件。

进程异常退出仍可能留下无数据库引用的孤立文件，因此提供维护命令清理超过 24 小时且没有附件记录引用的文件。维护命令不属于用户功能。

## 8. 系统架构

### 8.1 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React、TypeScript、Vite |
| 路由 | React Router |
| 服务端状态 | TanStack Query |
| 表单校验 | React Hook Form、Zod |
| 后端 | FastAPI、SQLAlchemy 2.x、Alembic |
| 数据库 | PostgreSQL |
| 密码散列 | Argon2id |
| 后端测试 | Pytest |
| 前端测试 | Vitest、React Testing Library |
| 端到端测试 | Playwright |
| 本地交付 | Docker Compose |

实现时在依赖文件和锁文件中固定具体版本。设计文档只固定技术选型，不绑定短期补丁版本。

### 8.2 总体结构

```text
Browser
  │
  ▼
Web container (static frontend + /api reverse proxy)
  │
  ▼
FastAPI modular monolith
  ├── PostgreSQL
  └── private attachment volume
```

前端和 API 使用同一站点来源。开发环境由 Vite 将 `/api` 代理到 FastAPI；Docker 环境由 Web 容器执行同样的反向代理。

### 8.3 推荐仓库结构

正式初始化项目前，将当前 `Fronted` 目录更名为 `frontend`。建议结构如下：

```text
backend/
  app/
    main.py
    core/
      config.py
      database.py
      security.py
      errors.py
    modules/
      auth/
      users/
      locations/
      tickets/
      workflow/
      assignments/
      comments/
      attachments/
      analytics/
  migrations/
  tests/

frontend/
  src/
    app/
    api/
    components/
    features/
      auth/
      tickets/
      dispatch/
      technician/
      locations/
      users/
      analytics/
    routes/
    test/

tests/
  e2e/
```

### 8.4 后端模块职责

| 模块 | 职责 |
| --- | --- |
| Auth | 登录、退出、会话读取、密码验证 |
| Users | 当前用户信息、账户启停和账户查询 |
| Locations | 地点查询、创建、修改和启停 |
| Tickets | 创建、可见列表、详情和基础字段读取 |
| Workflow | 状态转换、授权、乐观锁、事务和事件写入 |
| Assignments | 当前负责人和分派历史 |
| Comments | 公开留言和管理员内部备注 |
| Attachments | 校验、私有存储、元数据和授权下载 |
| Analytics | 只读统计查询 |

路由层负责解析 HTTP 输入和序列化输出；应用服务负责用例和事务；数据访问层负责查询。其他模块不能绕过 Workflow 直接修改工单状态。

## 9. 身份认证与会话安全

### 9.1 会话方案

- 登录成功后生成高熵随机会话令牌。
- 浏览器 Cookie 保存原始令牌；数据库只保存令牌的密码学哈希。
- Cookie 设置 `HttpOnly`、`SameSite=Lax` 和明确的过期时间。
- 非本地 HTTP 环境必须启用 `Secure`。
- 会话绝对有效期为 8 小时，不使用无限期会话。
- 登出删除对应数据库会话并清除 Cookie。
- 每次受保护请求均检查会话有效期和用户 `active` 状态。

### 9.2 CSRF 与跨域策略

- 正常部署采用同源前端和 API，不开放任意跨域来源。
- 对 `POST`、`PUT`、`PATCH` 和 `DELETE` 请求校验 `Origin` 是否属于配置的站点来源。
- 开发环境仅允许明确配置的本地来源并携带凭据。
- API 不使用通配符 CORS 与凭据组合。

### 9.3 密码和日志

- 密码只保存安全散列。
- 种子密码通过环境变量或演示配置注入，不在运行日志中打印。
- 日志不记录密码、Cookie、会话令牌、文件内容和数据库连接密码。
- 登录失败使用统一提示，避免泄露账户是否存在。

## 10. 数据模型与数据库约束

所有时间字段使用 `timestamptz` 并以 UTC 保存。内部主键使用 `bigint generated ... as identity`。角色、状态、优先级、可见性和附件用途使用 `text` 配合数据库 `CHECK` 约束。

### 10.1 核心表

#### `users`

```text
id, name, email, password_hash, role, active, created_at, updated_at
```

- `email` 唯一；
- `role` 限定为 `REPORTER`、`TECHNICIAN`、`ADMIN`；
- `active` 默认 `true`。

#### `sessions`

```text
id, user_id, token_hash, expires_at, created_at
```

- `token_hash` 唯一；
- `user_id` 建立索引；
- 过期会话可由维护命令清理。

#### `locations`

```text
id, building, floor, room_or_area, active, created_at, updated_at
```

- `(building, floor, room_or_area)` 唯一；
- 三个位置字段均非空；
- `active` 默认 `true`。

#### `tickets`

```text
id, code, reporter_id, location_id, location_label_snapshot,
title, description, category, priority, status,
current_assignee_id, version, created_at, updated_at, closed_at
```

- `code` 唯一；
- `reporter_id`、`location_id`、`current_assignee_id` 为外键并建立索引；
- `priority` 在 `SUBMITTED`、`REJECTED` 和 `CANCELLED` 状态可为空，在 `PENDING_ASSIGNMENT`、`ASSIGNED`、`IN_PROGRESS`、`PENDING_CONFIRMATION` 和 `CLOSED` 状态必须非空；
- `version` 从 1 开始，每次成功状态转换递增；
- 只有 `CLOSED` 状态设置 `closed_at`；
- `current_assignee_id` 在分派前为空，分派后保留，包括工单关闭后。

#### `assignments`

```text
id, ticket_id, technician_id, assigned_by,
assigned_at, ended_at, reason
```

- 所有外键建立索引；
- 对 `ticket_id WHERE ended_at IS NULL` 建立部分唯一索引；
- 第一版没有重新分派，因此正常流程中 `ended_at` 保持为空；字段保留用于历史模型一致性。

#### `ticket_events`

```text
id, ticket_id, actor_id, type, from_status, to_status,
note, visibility, created_at
```

- `(ticket_id, created_at, id)` 建立复合索引；
- `visibility` 限定为 `PUBLIC` 或 `ADMIN_ONLY`；
- 记录只追加。

#### `comments`

```text
id, ticket_id, author_id, body, visibility, created_at
```

- `(ticket_id, created_at, id)` 建立复合索引；
- `visibility` 限定为 `PUBLIC` 或 `ADMIN_ONLY`。

#### `attachments`

```text
id, ticket_id, uploader_id, storage_key, original_name,
mime, size, purpose, created_at
```

- `storage_key` 唯一；
- `purpose` 限定为 `REPORT_PHOTO` 或 `RESOLUTION_PHOTO`；
- `ticket_id` 和 `uploader_id` 建立索引。

### 10.2 工单查询索引

至少建立：

```text
tickets(reporter_id, created_at DESC, id DESC)
tickets(current_assignee_id, created_at DESC, id DESC)
tickets(status, created_at DESC, id DESC)
tickets(location_id, created_at DESC, id DESC)
ticket_events(ticket_id, created_at, id)
comments(ticket_id, created_at, id)
```

索引以真实列表和统计查询为依据，不为每个字段机械创建索引。

### 10.3 删除策略

- 用户和地点使用停用，不做物理删除。
- 工单、分派、事件、留言和附件元数据不提供用户删除接口。
- 外键默认使用限制删除，避免级联破坏审计记录。

## 11. API 契约

### 11.1 通用规则

- API 前缀为 `/api`。
- 请求和响应使用 JSON；包含图片的业务动作使用 `multipart/form-data`。
- 时间使用 ISO 8601 UTC 字符串。
- 列表响应包含 `items` 和 `next_cursor`。
- 所有状态动作请求必须携带 `expected_version`。
- 成功状态动作返回更新后的工单摘要和新版本。

统一错误格式：

```json
{
  "error": {
    "code": "TICKET_VERSION_CONFLICT",
    "message": "The ticket has already been updated.",
    "request_id": "req_...",
    "field_errors": []
  }
}
```

`field_errors` 仅在字段校验失败时包含内容。

### 11.2 身份接口

| 方法与路径 | 用途 | 权限 |
| --- | --- | --- |
| `POST /api/auth/login` | 登录并创建会话 | 未登录 |
| `POST /api/auth/logout` | 删除当前会话 | 已登录 |
| `GET /api/me` | 获取当前用户 | 已登录 |

### 11.3 工单接口

| 方法与路径 | 用途 | 权限 |
| --- | --- | --- |
| `POST /api/tickets` | 创建含可选现场图片的工单 | Reporter |
| `GET /api/tickets` | 查询当前用户可见工单 | 已登录，按角色过滤 |
| `GET /api/tickets/{id}` | 获取详情、附件和可见时间线 | 工单相关人或 Admin |
| `POST /api/tickets/{id}/review` | 审核通过或驳回 | Admin |
| `POST /api/tickets/{id}/assign` | 分派维修人员 | Admin |
| `POST /api/tickets/{id}/start` | 开始处理 | 当前 Technician |
| `POST /api/tickets/{id}/resolve` | 提交结果和可选结果图片 | 当前 Technician |
| `POST /api/tickets/{id}/confirm` | 确认完成 | 原 Reporter |
| `POST /api/tickets/{id}/rework` | 要求返工 | 原 Reporter |
| `POST /api/tickets/{id}/cancel` | 审核前撤销 | 原 Reporter |
| `POST /api/tickets/{id}/comments` | 添加公开留言或内部备注 | 工单相关人；内部备注仅 Admin |

`review` 请求使用 `decision: APPROVE | REJECT`。批准时必须包含类别和优先级；驳回时必须包含原因。

### 11.4 附件、地点、账户和统计接口

| 方法与路径 | 用途 | 权限 |
| --- | --- | --- |
| `GET /api/attachments/{id}` | 授权下载附件 | 工单相关人或 Admin |
| `GET /api/locations` | 查询有效地点 | 已登录 |
| `GET /api/admin/locations` | 查询全部地点 | Admin |
| `POST /api/admin/locations` | 创建地点 | Admin |
| `PATCH /api/admin/locations/{id}` | 修改或启停地点 | Admin |
| `GET /api/admin/users` | 查询演示账户 | Admin |
| `PATCH /api/admin/users/{id}/active` | 启用或停用账户 | Admin |
| `GET /api/admin/analytics` | 获取管理统计 | Admin |

### 11.5 HTTP 状态和错误代码

| HTTP 状态 | 典型含义 |
| --- | --- |
| `400` | 请求格式错误 |
| `401` | 未登录、会话失效或账户停用 |
| `403` | 角色或资源关系不允许该动作 |
| `404` | 对当前用户不可见的资源不存在 |
| `409` | 状态不允许、版本冲突或唯一约束冲突 |
| `413` | 上传文件过大 |
| `415` | 文件类型不支持 |
| `422` | 字段校验失败 |
| `500` | 未预期服务端错误 |

分派接口 `POST /api/tickets/{id}/assign` 中，`technician_id` 指向不存在的账户、非 Technician 账户或已停用账户时，统一返回 `422 / VALIDATION_ERROR`，`field_errors` 指向 `technician_id`。这是字段的业务校验失败，不返回目标账户的 `404` 或 `409`；工单不存在、工单状态不允许及旧版本仍按原有错误语义处理。

后端必须在执行分派时校验目标账户，不能仅依赖前端候选列表。上述校验失败不得改变工单状态、版本、负责人、分派记录或事件；前端在维修人员选择控件旁提示错误并要求重新选择。后续业务集成测试必须覆盖三种失败及候选列表加载后目标账户被停用的场景，验证错误响应和失败无副作用。

客户端响应不包含堆栈、SQL、数据库约束名称或私有文件路径。

## 12. 并发与事务设计

Workflow 状态动作按以下顺序执行：

1. 加载当前用户并验证账户有效；
2. 加载工单授权所需的最小信息；
3. 验证角色、资源关系和业务输入；
4. 使用 `id + expected_status + expected_version` 条件更新工单；
5. 如果没有更新到记录，重新读取以区分不存在、无权访问和版本冲突；
6. 在同一事务中写入分派变化及事件；
7. 提交事务；
8. 返回递增后的版本。

事务内不执行外部 HTTP 请求，不进行耗时图片解码，不等待用户输入。数据库操作保持短事务，并按工单、分派、事件的一致顺序访问记录，降低锁竞争和死锁风险。

## 13. 前端设计

### 13.1 页面

| 页面 | 角色 | 主要内容 |
| --- | --- | --- |
| 登录页 | 所有人 | 登录、演示账户说明、紧急渠道提示 |
| 我的报修 | Reporter | 状态筛选、列表、创建入口 |
| 创建报修 | Reporter | 工单字段、地点三级选择、图片上传 |
| 工单详情 | 相关用户/Admin | 状态、责任方、图片、时间线、留言和动作 |
| 调度工作台 | Admin | 待审核、待分派、全部工单筛选 |
| 维修工作台 | Technician | 分配给自己的任务和状态筛选 |
| 地点管理 | Admin | 创建、编辑和启停地点 |
| 账户管理 | Admin | 查询及启停 Reporter/Technician |
| 管理统计 | Admin | 状态、类别、楼宇、积压、耗时和趋势 |

### 13.2 状态管理

- TanStack Query 管理工单、地点、时间线和统计等服务端状态。
- Auth Context 只保存当前用户和登录状态。
- 表单状态保留在组件或 React Hook Form 中。
- 第一版不引入 Redux 或 Zustand。
- TypeScript API 类型从 FastAPI OpenAPI 契约生成，减少枚举和字段重复定义。

### 13.3 交互与错误处理

- 每个详情页明确显示当前状态、当前负责人和下一步责任方。
- 提交动作期间禁用重复按钮，但正确性仍由后端版本控制保证。
- 收到 `409` 时提示工单已更新并重新获取详情。
- 收到 `401` 时清理前端登录状态并返回登录页。
- 字段错误显示在对应控件旁，并提供可读的页面级错误摘要。
- 图片在选择后展示预览、大小和删除入口。
- 核心流程支持键盘操作，颜色不是唯一状态标识。
- Reporter 创建和 Technician 提交结果必须适配移动端宽度。

## 14. 管理统计

第一版统计直接从 PostgreSQL 聚合，不使用缓存、物化视图或独立统计服务。

统计接口返回：

- 各状态工单数量；
- 各类别工单数量；
- 各楼宇工单数量；
- 非终态工单总数作为当前积压；
- 已关闭工单从创建到关闭的平均耗时；
- 最近 30 个自然日每天创建和关闭的工单数量。

所有时间存储为 UTC；按日趋势使用 `Asia/Shanghai` 时区分组。平均关闭耗时只计算 `status = CLOSED` 且 `closed_at IS NOT NULL` 的工单，并明确表示“从创建到关闭总耗时”，不描述为纯维修时长。

空数据时接口返回空集合或零值，前端仍正常显示图表和说明。

## 15. 部署、迁移与种子数据

### 15.1 Docker Compose 服务

| 服务 | 职责 |
| --- | --- |
| `web` | 提供前端静态资源并反向代理 `/api` |
| `api` | 运行 FastAPI |
| `db` | 运行 PostgreSQL |
| `migrate` | 一次性执行 Alembic 数据库迁移 |

附件和数据库分别使用持久化卷。服务配置通过环境变量注入，并提供不含真实密钥的 `.env.example`。

### 15.2 启动顺序

1. PostgreSQL 健康检查通过；
2. `migrate` 执行成功；
3. API 启动并通过健康检查；
4. Web 服务启动；
5. 按需执行幂等种子脚本。

不允许多个 API 实例在启动时同时自动运行迁移。

### 15.3 种子数据

种子脚本至少创建：

- 一个 Reporter；
- 一个 Technician；
- 一个 Admin；
- 多个匿名地点；
- 可选的匿名示例工单，用于统计和演示。

脚本重复执行不会创建重复账户或地点。所有姓名、邮箱、照片和描述均为虚构数据。

## 16. 测试设计

### 16.1 测试环境原则

- 后端集成测试使用真实 PostgreSQL，不使用 SQLite 替代。
- 每个测试运行在隔离数据库或可回滚的隔离事务中。
- 文件测试使用独立临时存储目录。
- 种子和时间相关测试使用确定数据。

### 16.2 测试层级

| 层级 | 重点 |
| --- | --- |
| Workflow 单元测试 | 所有合法与非法状态转换、必填字段和版本变化 |
| API 集成测试 | 登录、角色、资源归属、可见性、事务和附件授权 |
| 并发测试 | 同一版本并发审核、开始、提交结果或确认时只有一个成功 |
| 前端组件测试 | 表单校验、状态展示、动作按钮、错误和冲突处理 |
| Playwright E2E | 三角色完整闭环、驳回、撤销和返工路径 |
| 部署冒烟测试 | 迁移、种子、登录、健康检查和关键 API |

### 16.3 必须覆盖的失败语义

- 未登录访问受保护接口；
- Reporter 访问其他人的工单；
- Technician 操作分配给其他人的工单；
- 非 Admin 审核或分派；
- 停用账户继续使用原会话；
- 非法状态跳转；
- 旧版本和重复动作；
- 驳回、返工或提交结果缺少必填说明；
- 分派给停用或非 Technician 账户；
- 上传超大、伪装 MIME、损坏图片和超数量附件；
- 无权用户直接请求附件；
- 事件写入失败时状态更新回滚；
- 空统计数据；
- 相同创建时间下的分页稳定性。

### 16.4 验收基线

第一版完成必须同时满足：

1. 三类预置账户可以登录和退出；
2. Reporter 能提交带地点和可选图片的工单；
3. Admin 能审核、设定优先级并分派；
4. Technician 能开始处理并提交结果；
5. Reporter 能确认完成或要求返工；
6. 所有动作正确进入时间线；
7. 统计随工单数据变化；
8. 越权和非法状态操作均被拒绝；
9. 并发和重复请求不会造成重复有效事件或状态覆盖；
10. 全新环境可通过 Compose、迁移和种子脚本启动；
11. PRD 的 FR-01 至 FR-12 均有自动化测试映射；
12. 完整闭环端到端测试可重复通过。

## 17. 推荐实施顺序

实现采用纵向切片，每个阶段都应包含后端、前端和相应测试：

1. 仓库结构、配置、Docker Compose、PostgreSQL 和迁移；
2. 登录、会话、三类种子账户和权限基础；
3. 地点选择、创建工单、可见列表和详情；
4. Admin 审核和分派；
5. Technician 开始处理和提交结果；
6. Reporter 确认和返工；
7. 时间线、公开留言和内部备注；
8. 附件校验、私有存储和授权下载；
9. 地点及账户管理；
10. 管理统计；
11. 并发、异常路径、端到端测试和交付文档。

不得采用“先完成全部后端、最后再集成前端”的方式，因为这会推迟接口和交互问题的暴露。

## 18. 主要风险与控制

| 风险 | 控制方式 |
| --- | --- |
| 各接口直接修改状态，绕过状态机 | 只允许 Workflow 写入状态；代码评审和测试检查 |
| 前端隐藏按钮被误当作权限控制 | 所有接口执行服务端角色与资源关系校验 |
| 并发操作覆盖状态 | `expected_version` 条件更新和 `409` 冲突响应 |
| 状态成功但事件缺失 | 状态、分派和事件使用同一数据库事务 |
| 文件成功但数据库失败或相反 | 临时文件、短事务、失败补偿和孤立文件清理 |
| 私有图片被静态目录暴露 | 私有卷和授权下载接口 |
| 数据库测试与生产行为不一致 | 集成测试使用 PostgreSQL，不使用 SQLite |
| 文档与实现偏离 | 使用 FR/UC/接口/页面/测试追踪矩阵 |
| 范围扩张影响闭环 | 第一版不实现第 2.2 节列出的内容 |

## 19. 设计完成条件

本设计在以下条件满足后可进入实施计划阶段：

1. 团队确认本文档准确表达第一版范围；
2. 团队确认接口、数据模型、状态机和错误语义；
3. PRD 与本文档出现差异时，以 PRD 的产品目标和本文档的已确认 P0 实现细节共同解释；
4. 后续范围变化先更新设计和需求追踪关系，再进入实现。
