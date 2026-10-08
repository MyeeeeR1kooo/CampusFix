# Base Auth 到业务 API 交接

**提供人：** 林志涛  
**接收人：** 熊雄  
**基线分支：** `origin/base-auth`  
**依据：** `docs/superpowers/specs/CampusFix P0 Requirements & Design Baseline.md`

## 1. Core 已提供

业务 API 可直接复用以下接口：

```python
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AppError, ErrorCode
from app.core.security import (
    clear_session_cookie,
    generate_session_token,
    get_session_token,
    hash_password,
    hash_session_token,
    set_session_cookie,
    verify_password,
)
```

- `get_settings()`：读取运行配置。
- `get_db()`：获取请求级 SQLAlchemy `Session`，请求结束后自动关闭。
- 密码和会话函数：供 Auth 模块实现登录、退出和会话校验。
- `AppError`、`ErrorCode`：统一错误响应。
- `create_app()`：在此注册业务 Router；API 前缀统一为 `/api`。

### 按接口复用关系

| 业务接口 | 应复用的 Core 能力 | 业务模块还需要负责 |
| --- | --- | --- |
| `POST /api/auth/login` | `get_db`、`verify_password`、`generate_session_token`、`hash_session_token`、`set_session_cookie`、`AppError` | 查询启用用户、创建 `sessions` 记录、统一登录失败提示 |
| `POST /api/auth/logout` | `get_db`、`get_session_token`、`hash_session_token`、`clear_session_cookie`、`AppError` | 删除当前会话记录 |
| `GET /api/me` | `get_db`、`get_session_token`、`hash_session_token`、`AppError` | 校验会话有效期和用户 `active` 状态，返回当前用户 |
| 所有受保护接口 | Auth 模块提供的当前用户依赖、`get_db`、`AppError` | 角色、资源关系和账户状态校验 |
| 所有写接口 | `create_app()` 已执行 Origin 校验、`AppError` | 实现业务校验和事务；不重复实现一套 Origin 规则 |
| 工单、地点、用户、统计接口 | `get_db`、`AppError`、`ErrorCode` | 模型查询、权限过滤、响应 Schema 和业务规则 |
| 附件接口 | `get_settings`、`get_db`、`AppError` | 文件校验、私有存储、元数据和授权下载 |

Core 当前**没有**提供 `get_current_user`、角色依赖或工单资源权限依赖；这些应由 Auth/Users/Workflow 模块实现，并供其他 Router 使用。

## 2. 配置字段不属于业务 API

`database_url`、`secret_key`、`attachment_storage_path`、`allowed_origins`、`session_lifetime_seconds`、`environment`、`secure_cookies`、`credentials_enabled` 是后端运行配置。

这些字段通过环境变量提供，不能作为用户接口返回值；尤其不能返回密钥、数据库连接信息或私有存储路径。

## 3. 业务数据字段

数据库模型、迁移和 API Schema 按冻结基线实现：

- `users`：`id`、`name`、`email`、`password_hash`、`role`、`active`、时间字段。
- `sessions`：`id`、`user_id`、`token_hash`、`expires_at`、`created_at`。
- `locations`：`id`、`building`、`floor`、`room_or_area`、`active`、时间字段。
- `tickets`：`id`、`code`、报修人、地点快照、标题、描述、类别、优先级、状态、当前负责人、`version`、时间字段。
- `assignments`、`ticket_events`、`comments`、`attachments`：字段和约束以冻结基线第 10 节为准。

数据库迁移是表结构的唯一来源；Core 不调用 `metadata.create_all()`。

## 4. API 约束

身份接口：

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/me
```

工单和动作接口：

```text
POST /api/tickets
GET  /api/tickets
GET  /api/tickets/{id}
POST /api/tickets/{id}/review
POST /api/tickets/{id}/assign
POST /api/tickets/{id}/start
POST /api/tickets/{id}/resolve
POST /api/tickets/{id}/confirm
POST /api/tickets/{id}/rework
POST /api/tickets/{id}/cancel
POST /api/tickets/{id}/comments
```

管理和附件接口以冻结基线第 11.4 节为准。

- 状态变化必须使用业务动作接口，不能开放通用 `PATCH status`。
- 状态动作必须携带 `expected_version`，冲突返回 `409` 和 `TICKET_VERSION_CONFLICT`。
- 只有 Workflow 模块可以修改工单状态并写入状态事件。
- 所有错误使用统一结构：`code`、`message`、`request_id`、`field_errors`。
- 写请求需要通过已配置的 `Origin` 校验。
- 登录成功后只在数据库保存会话令牌的 SHA-256 摘要，不能保存原始令牌。

## 5. 集成顺序

1. 从最新 `origin/base-auth` 创建或同步工作分支。
2. 完成模型、迁移、种子数据和业务 Schema。
3. 实现 Auth、Tickets、Workflow 等模块并在 `create_app()` 注册 Router。
4. 为登录、权限、状态转换、版本冲突和统一错误响应添加 API 测试。
5. 再进行 Docker、PostgreSQL、前端和端到端联调。

完整字段、状态机、权限和接口契约以冻结设计为准，不在本交接文档中另行扩展。
