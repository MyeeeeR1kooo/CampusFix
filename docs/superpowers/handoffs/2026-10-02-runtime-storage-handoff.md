# #45 运行环境与数据层交接

接收林志涛的 [Base Auth 交接](2026-10-02-base-auth-api-handoff.md)，以 `origin/base-auth` 的 `0ba628b82640995d8c0e9589d7602f0fffd930f5` 为开发起点。最高依据仍为 [P0 冻结基线](../specs/CampusFix%20P0%20Requirements%20%26%20Design%20Baseline.md) §8、§9、§10、§15、§16。

本次范围为熊雄在 #45 的 Docker 四服务、八表迁移、查询索引和幂等种子。未扩展公共 API、错误码、状态机、角色权限或前端业务页面。

## 可复用的数据模型

```python
from app.core.database import get_db, SessionLocal
from app.models import (
    User, Session as AuthSession, Location, Ticket, Assignment,
    TicketEvent, Comment, Attachment,
)
```

`app/models.py` 是共享 SQLAlchemy 行映射，不包含业务服务、Router 或授权。`app.core.database` 的现有 engine/session 和 `get_db()` 继续复用。`AuthSession` 是数据库行，与 `sqlalchemy.orm.Session` 区别命名。

| 表 | 使用模块 | 数据层要点 |
| --- | --- | --- |
| users | Auth / Users | 邮箱唯一，角色 CHECK，active 默认 true，密码使用已有 Core 散列工具 |
| sessions | Auth | token_hash 唯一，user_id 外键与索引；业务层仅保存原始令牌的 SHA-256 摘要 |
| locations | Locations | 三元地址唯一且非空，active 默认 true |
| tickets | Tickets / Workflow | code 唯一，status/category/priority CHECK，version ≥ 1，负责人及关闭时间与状态一致 |
| assignments | Assignments / Workflow | 所有外键索引，ticket_id 在 ended_at IS NULL 时唯一 |
| ticket_events | Workflow | PUBLIC / ADMIN_ONLY，前后状态 CHECK，按 ticket_id、created_at、id 升序索引 |
| comments | Comments | PUBLIC / ADMIN_ONLY，按 ticket_id、created_at、id 升序索引 |
| attachments | Attachments | storage_key 唯一，用途 CHECK，工单和上传人外键索引 |

所有内部主键为 bigint identity，时间为 timestamptz。部署数据库会话采用 UTC。外键默认 NO ACTION，不级联删除审计数据。

四个工单列表索引分别以 reporter_id、current_assignee_id、status、location_id 为首列，后接 `created_at DESC, id DESC`，加上事件和留言索引，直接落实 P0 §10.2 / #45 的六组设计。没有增加与实际查询无关的索引。

## 迁移与写入边界

- `backend/migrations/versions/0001_create_p0_core_tables.py` 是显式初始 schema 快照，不导入实时模型执行建表。
- 执行 `alembic upgrade head`；Core 和 API 启动过程均不建表、不自动运行迁移。
- 后续 schema 变更新增 Alembic revision；合入后的初始迁移不要直接改写。
- `updated_at` 由业务服务在同一事务中更新，时间默认值只负责插入。
- 只有 Workflow 修改工单状态、递增 version、写入动作事件和相应关联记录。数据库 CHECK 不代替事务、角色、资源归属或 expected_version 校验。
- 工单 code 根据数据库生成的 ID 构造；identity 使用 BY DEFAULT，支持业务层先从该 identity 序列分配 ID 后在同一事务内插入，避免以“当日最大值 + 1”生成尾号。日期口径仍按团队冻结契约决定。
- 事件只追加、文件内容校验、每种用途数量与账户/地点停用等，由各自业务模块按 P0 落实；本次不增加对应业务接口或数据库触发器。

## 种子与容器

`python -m app.seed` 从三项 `SEED_*_PASSWORD` 环境变量/当前 `.env` 读取虚构演示密码，复用 `hash_password()`。创建 Reporter、Technician、Admin 和三个虚构地点，无示例工单或图片。所有插入在一次事务中，唯一键冲突安全处理。重复执行保留已有密码、active、角色和时间；角色不符会报安全摘要并整体回滚，不输出密码、散列或数据库凭据。

容器启动顺序：db healthy → migrate 成功退出 → api healthy → web。只有 migrate 自动执行迁移；种子按需执行。数据库与附件卷分别持久化，附件卷只挂载 API。API 复用 Core 的配置、会话 Cookie 和 Origin 规则，Web 保留 `/api` 前缀和浏览器 Origin。

前端业务代码目前尚未提供。默认占位静态页只支持环境检查；`FRONTEND_DIST=frontend/dist` 可接入 #48 的构建产物。`deploy/docker-compose.test.yml` 仅用于一次性测试容器，不新增第五个长期服务。

## 验证及依赖

`backend/tests/test_p0_storage.py` 使用真实 PostgreSQL，每项测试独立建库并清理。覆盖迁移升级/回滚/再次升级、模型与迁移一致性、identity/timestamptz、六组索引、关键 CHECK/唯一键/外键、单个当前分派、种子幂等、保留既有状态、失败事务回滚、散列验证和并发种子执行。

| 关联项 | 本次提供 | 后续验收依赖 |
| --- | --- | --- |
| FR-01 登录与角色 | 三类账户及 Argon2id 密码，users/sessions 模型 | #47 的真实登录、会话与授权 Router |
| NFR-06 可重建 | Alembic、种子、固定依赖、Compose 与 README | 已在 Docker Engine 实启、重建并验证卷持久化，见 2026-10-07 验收记录 |
| NFR-08 隐私 | 虚构账户/邮箱/地点，无真实照片 | 业务附件授权由相关任务验证 |
| #48 前端同源 | Nginx `/api/` 代理、可选静态构建目录 | React 页面和浏览器登录联调 |

2026-10-07 已补齐 Docker 四服务实启、容器内 135 项后端测试、同源代理及卷持久化验证，详见 [Docker 实际运行验收](2026-10-07-docker-runtime-verification.md)。#45 的全新环境启动及 README 运行项可确认。

三角色 HTTP 登录和完整报修流程未实现时，不能将“散列验证通过”表述为“真实登录验收通过”。正式前端和 Auth 联调仍由对应任务完成后，再确认这些验收项。
