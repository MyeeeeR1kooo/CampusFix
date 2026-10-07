# CampusFix 核心基础设施与基础认证设计

**状态：** 已获任务负责人确认，可进入实现

**分支：** `base-auth`，跟踪 `origin/base-auth`

**依据：** `docs/superpowers/specs/CampusFix P0 Requirements & Design Baseline.md`

## 目标

实现 Issue #45 所需的后端共享基础设施：类型化配置、SQLAlchemy 数据库会话基础设施、密码和会话安全原语、统一 API 错误处理，以及 FastAPI 应用装配。

## 范围

本次实现负责：

- `backend/app/core/config.py`
- `backend/app/core/database.py`
- `backend/app/core/security.py`
- `backend/app/core/errors.py`
- `backend/app/main.py`
- 运行和测试上述模块所需的最小后端依赖声明
- `backend/tests/` 下的针对性测试

根目录 `AGENTS.md` 已覆盖项目治理要求；只有发现明确缺口时才修改，不进行无关重写。

## 不在范围内

本次不实现业务模块、工单状态转换、数据库模型或迁移、Docker Compose、种子数据、前端代码、附件功能和端到端用户流程。核心代码不得创建数据库表，也不得修改工单状态。

## 设计

### 配置

使用 `pydantic-settings` 从环境变量加载 `Settings`。配置对象提供数据库 URL、应用密钥、附件存储根目录、明确允许的站点来源、会话有效期、运行环境名称和 Cookie 安全策略。会话绝对有效期默认为 8 小时。非本地部署必须启用安全 Cookie；启用凭据时拒绝通配符来源。

### 数据库

使用 SQLAlchemy 2.x 提供一个配置好的 Engine 和请求级 Session 工厂。`get_db()` 生成请求使用的 Session，并在请求结束后关闭。核心模块不调用 `metadata.create_all`；Alembic 迁移是唯一的数据库结构来源。数据库集成测试使用 PostgreSQL。

### 安全

密码通过 `argon2-cffi` 使用 Argon2id 处理。会话令牌使用高熵不透明随机值；只有 SHA-256 摘要由 Auth 模块持久化。安全辅助函数覆盖令牌生成、摘要计算、过期时间计算、HttpOnly Cookie 读取、写入和清除，以及状态变更请求的 Origin 校验。Cookie 默认使用 `HttpOnly`、`SameSite=Lax` 和明确过期时间；本地 HTTP 开发之外启用 `Secure`。

核心模块只提供安全原语和依赖。Auth 模块负责登录、退出、会话记录读写和启用用户查询。

### 错误处理与应用装配

`AppError` 携带稳定错误码、HTTP 状态码、安全的客户端提示、可选字段错误和请求上下文。请求 ID 中间件生成不透明的 `req_...` 标识；全局处理器把校验、认证、授权、冲突和未预期错误序列化为冻结基线规定的错误结构，不泄露堆栈、SQL、凭据或私有路径。

`create_app()` 创建 FastAPI 应用，安装中间件和异常处理器，注册可用业务路由，并提供部署检查所需的健康检查端点。应用启动时不执行迁移或种子初始化。

## 提供给下游模块的接口

- `get_settings() -> Settings`
- `get_db() -> Iterator[Session]`
- `hash_password(password: str) -> str`
- `verify_password(password: str, password_hash: str) -> bool`
- `generate_session_token() -> str`
- `hash_session_token(token: str) -> str`
- `get_session_token(request: Request) -> str | None`
- `set_session_cookie(response: Response, token: str, settings: Settings) -> None`
- `clear_session_cookie(response: Response, settings: Settings) -> None`
- `require_same_origin(request: Request, settings: Settings) -> None`
- `AppError` 和统一错误响应结构
- `create_app() -> FastAPI`

只有 Auth 模块读写会话记录；只有 Workflow 模块可以修改工单状态。

## 验证

针对性测试覆盖：配置校验、Argon2id 往返验证、令牌不可逆性、Cookie 标志和过期时间、Origin 拒绝、数据库 Session 清理、错误序列化和请求 ID、应用启动及异常处理。迁移和 Compose 完成后，再执行 PostgreSQL 集成测试、登录测试、部署冒烟测试和完整 API 测试。前端与 Playwright 测试在后续集成阶段验证。
