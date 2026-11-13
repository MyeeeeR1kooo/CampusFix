# #54 照片、授权下载与留言接入交接

负责人：熊雄。创建工单接收人：蒋雨涵（#51）；维修结果接收人：林志涛（#56）；前端：张越。

工作／提交分支 `attachments-storage`，PR 合入目标 `reporter-flow`。已同步 `0e5a141` 的 #51 工单交付及 #50 Workflow；PR #101 的目标是 main，本次不改该 PR，不代替负责人合并 main。

## 决策与兼容约定

以冻结 P0 §3、§5.4、§7、§8.4 及 `docs/api/openapi.yaml` 为依据。只复用一套 `attachments/service.py`，不新增通用上传接口，不改冻结契约、表结构、状态机或权限规则。

照片校验、暂存、元数据、原子发布和失败清理继续使用已有四个 helper；保留调用签名及 `stage_photos` 默认用途 `RESOLUTION_PHOTO`。报修照片显式指定 `REPORT_PHOTO`。两种用途分别最多 5 张，单张最多 5 MiB，随机存储键为现有的 32 位 hex，不依赖文件后缀。原始名称仅作元数据。

保留当前调用方约定：客户端声明 MIME 必须与实际解码格式一致；JPEG/PNG/WebP 结构校验后重新打开，逐帧完成真实解码。非法 MIME/格式为 415，损坏图片为 422，超大为 413，超数量为 422，全部使用 `VALIDATION_ERROR` 和 Core 统一结构。

Pillow 与 multipart、tzdata 沿用成员当前锁定版本；本次不升级依赖。早期附件预览的独立 staging API 已被共享 helper 替代，避免形成两套接口。

## 创建工单与维修结果的调用顺序

```python
from app.modules.attachments.service import (
    prepare_photos, stage_photos, publish_photos, discard_photos,
)

# photos 是已有 multipart 路由解析的 list[UploadFile]。
# 身份验证后，在业务 SQL 和地点／工单行锁之前完成校验。
prepared = prepare_photos(photos, settings.attachment_storage_path)
published = []
try:
    # 调用方在同一 Session 中执行已授权的业务动作、工单和事件写入。
    # 创建工单使用现有地点快照 helper 和 Workflow 提交初始化。
    stage_photos(db, ticket_id, actor.id, prepared, purpose="REPORT_PHOTO")
    # 维修结果沿用 stage_photos(db, ticket_id, actor.id, prepared)，默认 RESOLUTION_PHOTO。
    db.flush()
    # 先完成响应投影／校验，再发布文件。
    published = publish_photos(prepared)
    db.commit()
except Exception:
    try:
        db.rollback()
    finally:
        discard_photos(prepared, published)
    raise
```

helper 不 commit；事务及状态事件仍由 Tickets/Workflow 的业务用例负责。实际创建路由已经使用独立业务 Session，图片解码不跨地点行锁。`stage_photos` 锁定工单行并 flush 当前待写数据，保证 Core `autoflush=False` 时同事务多批和并发请求不会突破每用途 5 张限制。

文件在同一私有卷内先独占保留随机目标，再用 `os.replace` 原子替换自己的保留文件，不覆盖已有文件；发布前刷新年龄，避免旧临时文件刚发布就被维护命令误删。提交成功被记录在照片生命周期中，之后的通知异常不能反向删除已提交文件。失败清理会尝试所有路径；若存储拒绝删除，会明确失败，需修复权限后运行维护命令，不能当作成功。

为使维修结果和创建工单采用相同的清理约定，`workflow/service.py` 仅把已有异常分支调整为 `try rollback / finally discard_photos`；不改变任何转换、版本、角色授权或响应投影。共享文件需与林志涛、蒋雨涵协调。

## 授权下载与前端使用

- 沿用详情中已有 `report_photos` / `resolution_photos` 的 `download_url`：`GET /api/attachments/{id}`。
- 每次请求复用真实会话检查，并复用 Tickets 的资源可见性函数。原 Reporter、当前 Technician（包含其已关闭工单历史）、Admin 可读。
- 不存在和不可见使用相同 404 响应；停用／过期会话为 401。下载不依赖前端隐藏按钮。
- 返回原图字节，MIME 与元数据一致，`Cache-Control: private, no-store`；展示文件名安全编码，并设置 `nosniff`。
- 私有路径、`storage_key` 不下发；不增加静态公开目录。文件名越界、符号链接、目录及缺失文件不能绕过接口读取。

前端按既有登录请求封装携带 Cookie 获取 `download_url` 的图片字节。不要拼接存储目录或把附件路径当作公共静态 URL。

## 留言接口与详情读取

```text
POST /api/tickets/{id}/comments
Content-Type: application/json
Origin: <已配置站点>
{"body":"今天可以进入房间维修。","visibility":"PUBLIC"}
```

成功 201，响应严格沿用冻结 `Comment`：`kind`、`id`、`ticket_id`、`author`（id/name/role）、`body`、`visibility`、`created_at`。正文 1–2000 字符，保留原文；不新增去空白规则，不接受客户端 author_id、expected_version 或其他额外字段。

Reporter、当前 Technician、Admin 可创建 PUBLIC，只有 Admin 可创建 ADMIN_ONLY。不存在或无关工单为 404，相关非 Admin 创建内部备注为 403，终态新增为 `409 / CONFLICT`，无效字段为 422。Origin 与会话检查继续由 Core/Auth 负责。

读取直接复用 `GET /api/tickets/{id}` 的 `timeline`，不新增留言列表、修改、删除或按 ID 读取端点。#51 已有 SQL 隐私过滤会排除 Reporter/Technician 的内部备注，终态历史留言保持可读。

留言写入锁定同一工单行并在获得锁后重新检查终态，与 Workflow 的状态更新串行；不修改工单 status、version、updated_at，也不新增状态事件。终态转换先提交时，等待中的留言会重新看到终态并返回 409。

## 孤儿清理

```text
python -m app.modules.attachments.cleanup
```

读取现有 `DATABASE_URL` 与 `ATTACHMENT_STORAGE_PATH`。只清理严格超过 24 小时、没有附件记录引用的受管随机文件，以及 `.upload-*` 临时文件；保留已引用、近期、恰好 24 小时、非受管文件及符号链接，不删除数据库记录，不新增常驻服务。

成功输出删除数量，重复执行为 0；错误只输出安全摘要。已有演示数据和历史验证证据均保留。

## 验证与发布范围

验收基于 Python 3.12.14、PostgreSQL 17.11、团队锁定依赖、专用随机测试库和私有 Unix socket（无 TCP 监听）。所有身份、角色与资源检查走真实 Auth，不用假业务端点或 auth stub。

```text
CAMPUSFIX_TEST_DATABASE_URL=<专用测试库 URL> python -m pytest tests ../tools/test_api_contract_mock.py -q -p no:cacheprovider
```

专项已实跑真实后端链路：创建报修照片 → 下载 → 公开／内部留言 → 审核分派 → 维修结果照片 → 三角色下载 → 关闭后历史只读。事务失败、SQL 写入失败、文件发布和提交失败、并发数量限制、终态与留言竞争、恶意 MIME／损坏多帧、私有路径及清理 CLI 均有回归。

最终完整回归为 **747 passed，0 failed / errors / skipped，42.56 秒**，其中附件与留言专项 67 项；保留 1 条已有 Starlette/TestClient 的 httpx 弃用警告。依赖一致性检查和最终差异检查通过。本地 JUnit 存于工作区仓库外 `runtime-verification/issue54-2026-10-23/backend-results.xml`，不回写 10-07 或 10-21 的历史记录。

本次不代替前端接入、真实浏览器 E2E、Docker 重建或远端 CI 验收；这些未运行的项目不标记通过。#52、#51 关键字规则及其他成员的业务功能不在本次实现范围内。

共享注册文件 `backend/app/main.py` 只增加附件下载和留言 Router；附件 helper 与 Workflow 清理点在上文说明。创建 PR 前再次检查开放 PR #101（后端共享调用方）与 #97（前端组件），并在本次 PR 中说明合并时需保留双方改动。
