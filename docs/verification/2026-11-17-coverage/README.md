# C11：Update 3 前后端覆盖率（2026-11-17）

测量对象：[main@92d4dd0](https://github.com/MyeeeeR1kooo/CampusFix/commit/92d4dd0e9c699d3c41637e6b53fa01e0134c8792)，加本分支的开发依赖与覆盖率设置，未修改应用代码。本次测量的是当时已集成到 main 的代码；不包括尚未合并的 #55 工作台或另一个分支新增的 C3 两条用例。覆盖率是被测试执行到的代码比例，不是需求通过率或 C7 浏览器验收结果。

| 范围 | 测试结果 | 行覆盖率 | 其他指标 | 可核对文件 |
| --- | --- | --- | --- | --- |
| 后端 `backend/app` | 751 通过，0 失败/错误/跳过 | 1633 / 1678 = 97.32% | 按可执行语句行计数，未开启分支测量 | [HTML](backend/html/index.html) · [Cobertura XML](backend/coverage.xml) · [JUnit](backend-results.xml) |
| 前端 `frontend/src` | 17 个文件，298 通过，0 失败/错误/跳过 | 3192 / 3365 = 94.85% | 分支 1161 / 1236 = 93.93%；函数 267 / 296 = 90.20% | [HTML](frontend/index.html) · [Cobertura XML](frontend/cobertura-coverage.xml) · [JUnit](frontend-results.xml) |

后端使用 Python 3.12.13、PostgreSQL 17.11、pytest 8.4.2、pytest-cov 7.0.0；前端使用 Node 24.21.0、Vitest 与 V8 provider 2.1.9。前端统计未加载的 TS/TSX 源文件，含 Mock，排除测试、测试助手及类型声明。后端原有 Starlette/httpx 弃用警告仍在。两套报告分母不同，不能将百分比直接取平均。

## 复跑

在专用 PostgreSQL 测试库上设置 `CAMPUSFIX_TEST_DATABASE_URL`（SQLAlchemy 的 `postgresql+psycopg://` URL，角色可创建临时数据库）。未设置时会跳过数据库测试，不能用作同口径的覆盖率。先进入仓库根目录，再运行：

```sh
(
  cd backend
  : "${CAMPUSFIX_TEST_DATABASE_URL:?请先设置专用测试库 URL}"
  export CAMPUSFIX_TEST_DATABASE_URL TZ=UTC PGTZ=UTC ALLOWED_ORIGINS=http://localhost:5173
  python -m pip install -r requirements-dev.lock
  out=../docs/verification/2026-11-17-coverage
  python -m pytest -q --cov=app --cov-report=term \
    --cov-report="html:$out/backend/html" --cov-report="xml:$out/backend/coverage.xml" \
    --junitxml="$out/backend-results.xml"
)
(
  cd frontend
  npm ci
  out=../docs/verification/2026-11-17-coverage
  npm test -- --coverage --maxWorkers=2 --minWorkers=1 \
    --reporter=default --reporter=junit --outputFile.junit="$out/frontend-results.xml" \
    --coverage.reportsDirectory="$out/frontend"
)
```

环境预检中曾遇到 PostgreSQL 时区与 CI 不同、临时连接角色不匹配的问题；均已修正测试环境。以上归档来自正确连接专用临时库、显式设置数据库会话 UTC 后，在最新 main 上的完整重跑；未为此修改测试或业务代码。归档去除了 JUnit 的本机标识、报告生成器的增量缓存；源码页可在本地直接打开。`SHA256SUMS` 用于校验本次固定输出（在本目录运行 `shasum -a 256 -c SHA256SUMS`）。
