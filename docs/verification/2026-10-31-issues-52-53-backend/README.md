# Issues #52 / #53 后端测试记录（2026-10-31）

## 范围与版本

- 被测分支：admin-flow；已提交代码 HEAD：ee653437dd68179681c3dae62db091f6779b062a。
- #52：复用工单列表的 SUBMITTED 状态筛选，运行现有 Workflow 的审核通过、驳回、分类、优先级、授权与事件测试；没有单独的 #52 测试文件。
- #53：复用工单列表的 PENDING_ASSIGNMENT 状态筛选，运行现有 Workflow 的分派、授权、负责人、记录与事件测试；另外运行本地未跟踪的 backend/tests/test_issue53_assignment.py，其 SHA-256 为 6e8f91fba85eb90b04aed54660dc409d317668828acd98402a64fd7996133bd2。该文件包含五项测试，不属于上述 HEAD，复现本次结果需保留相同内容；不能把它视为已集成到 CI。

## 环境与结果

macOS ARM64；Python 3.12.13；依赖来自 backend/requirements-dev.lock；隔离的 PostgreSQL 17.11 临时实例。设置 PGTZ=UTC，使用专用本地测试库；测试 fixture 为用例建立、迁移并清理独立数据库。运行后已停止临时 PostgreSQL。

| 检查 | JUnit 原始报告 | 实际结果 |
| --- | --- | --- |
| #53 专项及现有 Workflow 测试，包含 #52 审核动作 | [workflow-results.xml](workflow-results.xml) | 45 passed；0 failed / errors / skipped |
| 后端全量回归，已包含上述 45 项 | [backend-results.xml](backend-results.xml) | 748 passed；0 failed / errors / skipped |

两次运行各有一条已有的 Starlette TestClient / httpx 弃用警告。45 项已包含在 748 项中，不能相加。

复现时，在 backend 目录设置 CAMPUSFIX_TEST_DATABASE_URL 为专用 PostgreSQL 连接串，并设置 PGTZ=UTC。使用 Python 3.12 与仓库锁定依赖，依次执行：

    python -m pytest -q -p no:cacheprovider tests/test_issue53_assignment.py tests/test_workflow_api.py --junitxml=../docs/verification/2026-10-31-issues-52-53-backend/workflow-results.xml
    python -m pytest -q -p no:cacheprovider tests --junitxml=../docs/verification/2026-10-31-issues-52-53-backend/backend-results.xml

实际运行解释器为 /private/tmp/campusfix-issue53-venv/bin/python。此前扩大相邻回归时，临时 PostgreSQL 会话继承 Asia/Shanghai 时区，导致 test_seed_is_idempotent_and_preserves_existing_accounts 的 UTC 偏移断言失败；设置 PGTZ=UTC 后该项和完整回归均通过。未修改测试断言或产品代码。

## 验证边界与仓库状态

本记录证明本地后端测试通过，不代表 #52/#53 整体 Issue 已正式验收。本次未运行前端测试、浏览器联调、Linux CI 或 Compose 冒烟测试。两份 XML 是本次重新运行生成的证据，不是此前终端输出的追溯记录。

本次仅新增本目录的说明及两份报告。原有未跟踪的 backend/tests/test_issue53_assignment.py 保持原状；未提交、推送或修改 Issue 状态。
