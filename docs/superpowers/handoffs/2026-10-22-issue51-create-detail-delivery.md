# #51 后端创建与详情交付（2026-10-22，阶段记录）

发布准备更新：用户已授权将当前完成的 #51 后端提交到 `reporter-flow` 并创建 PR，不合并 `main`。下文的“不提交、不推送”和列表尚未完成描述仅记录早先开发阶段，不是当前发布限制；当前完整范围与验证以[列表交付记录](2026-10-22-issue51-list-delivery.md)为准。

后续进展：用户已转述负责人确认搜索规则，正式列表与搜索已另行实现并验收，见 [列表交付记录](2026-10-22-issue51-list-delivery.md)。下文保留创建/详情交付当时的范围与测试结果。

## 范围和当前分支

- 依据：[Issue #51](https://github.com/MyeeeeR1kooo/CampusFix/issues/51)、冻结基线 §3 / §5 / §7 / §8.4 / §11 / §12、冻结 API YAML；关联 FR-02、FR-03、FR-04、FR-12、Issue FR-17、UC-01。
- 当前分支 `reporter-flow`；实现前已同步刚更新的 `origin/reporter-flow@0a66b566e1976a0d1abfa85aa953260e30bba13b`，本地同步 HEAD 为 `5c33887d143ca8482d87c7333a7c16dd6480f22e`。
- 本轮完成代码与测试，不提交、不推送、不合并 GitHub PR，不改 main。
- 用户此前决定关键字搜索等负责人确认，本轮没有自行选择匹配规则。因此不注册支持不全的 `GET /api/tickets`，也不把内部 q guard 暴露成新造的公共错误。

## 已实现的正式接口

### POST /api/tickets

- 仅启用的 Reporter，通过真实 Auth Cookie 认证；无图也必须 multipart，拒绝额外字段，执行标题、描述、类别、地点、图片数量等冻结校验。
- 返回 201、完整 TicketSummary、`Location: /api/tickets/{id}` 和统一 request ID。
- 使用 PostgreSQL identity 序列分配工单 ID；编号尾号取该 ID，日期取创建时刻 Asia/Shanghai 本地日期，不用每日最大值或临时假编号。
- 调用已有地点选择工具，保存地点 ID 和名称快照。
- 通过新 Workflow 初始化 helper 设置 `SUBMITTED/version=1`、三个初始 null 字段，写入唯一 `TICKET_SUBMITTED` 公开事件；不伪造状态转换。
- 复用已有附件模块的校验、临时保存、发布和清理能力；仅扩展元数据写入的 `purpose` 参数，报修使用 REPORT_PHOTO，#50 默认仍为 RESOLUTION_PHOTO。

事务顺序：Auth 单独读取身份 → 新业务 Session 在未开启事务、未锁地点时完成图片校验 → 地点共享锁、ID、工单、事件、附件元数据 → flush 并验证完整响应 → 原子移动私有文件 → commit。任何失败回滚并清理文件；rollback 自身抛错也执行文件清理。

### GET /api/tickets/{id}

- 注册真实详情路由，复用已有 fresh-column SQL 读取，不重新读取 ORM 来拼接公开字段。
- Reporter 仅自己、Technician 仅当前分配给自己的工单（包括关闭历史）、Admin 全部；不可见与不存在均为相同 404。
- SQL 层过滤 ADMIN_ONLY 时间线；返回照片元数据与受保护下载地址，不泄漏邮箱、密码、令牌、存储键或磁盘路径。
- 复用 Workflow 的真实责任方、下一步、允许操作；终态为空操作列表。投影只在资源可见性查询成功后执行。
- 保留实际 datetime 的时间线排序，支持同秒小数秒和稳定的 kind/id 顺序。

### 复用撤销

没有重写已有 `POST /api/tickets/{id}/cancel`。已用真实创建的工单串联创建 → 详情 → 撤销 → 详情，检查初始/撤销事件、版本递增及终态操作列表。

## 必要修正与依赖

- 图片结构 verify 后重新打开并 load 解码，拒绝结构检查可能漏过的截断 JPEG；修正同样适用于共用 helper 的结果图片。
- 新增 tzdata 运行依赖并锁定本机已验证的 2026.4，未升级其他依赖。当前 Windows `TZPATH=()`，确实依赖该包；[Python 官方说明](https://docs.python.org/3/library/zoneinfo.html#data-sources)也建议跨平台项目显式声明它。
- API YAML、冻结基线、数据库迁移、前端和状态转换规则未修改。

## 验证证据

- 新创建验收：20 passed，零跳过。含真实有/无图片、三种图片格式、5/6 张限制、损坏/伪装/过大、上海跨日、4 并发编号、身份/角色/Origin、失效会话、地点异常、元数据/移动/提交/回滚失败清理等。
- 新详情验收：10 passed。含真实 Cookie、三角色、越权/不存在、内部时间线隐私、完整响应、关闭历史、路径输入、缓存陈旧值和撤销联动。
- 详情加已有 Workflow 回归：45 passed。
- 真实创建 A/B 工单后，互访详情均 404；内部列表服务分别只读到自己的工单。这是内部列表联测，不是尚未注册的列表 GET 验收。
- 真实 HTTP 创建后，Admin 改名并停用地点，再读取详情仍为创建时快照。后端链路已验证；未进行浏览器端到端验收。
- 完整后端与契约 Mock 回归：668 passed，零失败、零跳过，123.32 秒；仅一条既有 Starlette/httpx 弃用警告。`pip check` 通过；diff 空白检查通过。
- 报告目录：`.contract-artifacts/issue51-implementation-20261022/`（忽略产物，不提交）。数据库为任务专用 PostgreSQL 17.11、UTC、127.0.0.1:55449，每个测试迁移并清理随机临时库。
- 本轮未重跑前端；上次同步检查的 Blob 兼容测试失败不在本次后端改动范围内。

## 文件与协作交叉

- 新业务源文件：`tickets/router.py`、`tickets/creation.py`、`workflow/submission.py`。
- 新测试：`test_ticket_creation_api.py`、`test_ticket_detail_api.py`。
- 共享文件 `app/main.py`：仅注册 Tickets 路由。
- 共享文件 `workflow/service.py`：原样抽取纯 `ticket_projection`，原 summary 复用；与林志涛协调。
- 共享文件 `attachments/service.py`：用途参数扩展及真实解码校验；与熊雄协调，默认结果照片用途保持。
- 共享依赖文件 `pyproject.toml` / `requirements.lock`：仅增加 tzdata；后续同步依赖时保留该项。
- 原有 Tickets helper 的模块说明更新为当前接入状态，未重写已验证的独立 SQL/分页逻辑。
- 当前开放 PR #97 只涉及前端，未发现上述共享后端文件交叉；正式前端接入仍与张越协调。
- 无关的 #45 查询索引交接与 #49 地点校验交接继续原位保留，不纳入 #51 提交；未运行宽泛暂存操作。

## 剩余与勾选边界

- 后端创建、编号/初态、地点快照持久化、详情、撤销已有实现与真实后端证据，可以作为对应后端子项的完成依据。本轮没有代为修改 GitHub 勾选。
- 列表六组确定筛选与分页已有内部实现，但完整列表接口及关键字仍未完成；不能将整个列表、七组筛选或分页接口验收勾选完成。
- #54 的授权下载、留言写入和孤儿文件维护命令不在本轮实现；“元数据有下载地址”不等于下载接口已完成。
- 前端页面、图片实际下载展示、完整列表接入、浏览器验收和 #51 整体完成标准仍未完成。
