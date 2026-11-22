# D5 / C11：Update 3 前后端覆盖率（2026-11-21）

R8 第 6 章 §6.3 和表 6.4 可引用下表。测量对象是 [`main@46304e4`](https://github.com/MyeeeeR1kooo/CampusFix/commit/46304e481da466e7bf78eac5be84f68f2abc2764) 加 [#119](https://github.com/MyeeeeR1kooo/CampusFix/pull/119) 的覆盖率依赖与配置，应用和测试源码与该版 `main` 一致。这一版包含 [#121](https://github.com/MyeeeeR1kooo/CampusFix/pull/121) 合入的维修工作台和结果照片功能。

| 范围 | 测试结果 | 行覆盖率 | 其它覆盖率 | 原始报告 |
| --- | --- | --- | --- | --- |
| 后端 `backend/app` | 753 项通过，0 失败／错误／跳过 | **1,633 / 1,678（97.32%）** | 未测分支 | [HTML](backend/html/index.html) · [Cobertura XML](backend/coverage.xml) · [JUnit XML](backend-results.xml) |
| 前端 `frontend/src` | 18 个文件、312 项通过，0 失败／错误／跳过 | **3,306 / 3,430（96.38%）** | 分支 1,206 / 1,283，函数 284 / 312（HTML 显示 93.99% 和 91.02%） | [HTML](frontend/index.html) · [Cobertura XML](frontend/cobertura-coverage.xml) · [JUnit XML](frontend-results.xml) |

统计口径与 [11 月 17 日报告（`main@92d4dd0`）](../2026-11-17-coverage/README.md) 一致。后端按 `app` 的可执行语句行统计；前端用 V8 统计 `src` 中的 TS/TSX，包括未加载文件和 Mock，排除测试、测试助手和类型声明。前后端分别计数。本次未加入 [#120](https://github.com/MyeeeeR1kooo/CampusFix/pull/120) 的补充测试；覆盖率也不能替代 C7 的三角色浏览器联调证据。

环境：Python 3.12.13、PostgreSQL 17.11（UTC 会话）、pytest 8.4.2、pytest-cov 7.0.0、Node.js 24.21.0、Vitest 与 V8 provider 2.1.9。前端类型检查和生产构建通过。JUnit 去除了本机名称和工作区绝对路径；测试数和结果保持原样。

## 复跑

在有建库权限的专用 PostgreSQL 测试库上设置 `CAMPUSFIX_TEST_DATABASE_URL`，使用 SQLAlchemy 的 `postgresql+psycopg://` 连接串；未设置时数据库项会被跳过。从仓库根目录执行：

```sh
out="$(mktemp -d)"
(
  cd backend
  : "${CAMPUSFIX_TEST_DATABASE_URL:?请先设置专用测试库 URL}"
  export CAMPUSFIX_TEST_DATABASE_URL TZ=UTC PGTZ=UTC ALLOWED_ORIGINS=http://localhost:5173
  python -m pip install -r requirements-dev.lock
  COVERAGE_FILE="$out/.coverage" python -m pytest -q --cov=app --cov-report=term \
    --cov-report="html:$out/backend/html" --cov-report="xml:$out/backend/coverage.xml" \
    --junitxml="$out/backend-results.xml"
)
(
  cd frontend
  npm ci
  npm test -- --coverage --maxWorkers=2 --minWorkers=1 \
    --reporter=default --reporter=junit --outputFile.junit="$out/frontend-results.xml" \
    --coverage.reportsDirectory="$out/frontend"
  npm run build
)
```

HTML 源码页可以下载到本地打开。从本报告目录执行 `shasum -a 256 -c SHA256SUMS` 核对已归档的原始结果和报告资源。
