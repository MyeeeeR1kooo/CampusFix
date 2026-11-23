# CampusFix D5：统计与账户管理合入后的全量覆盖率

**补充交接：** [#58 统计看板、#90 账户管理专项核对与浏览器证据](issues-58-90/README.md)。原全量报告数字保持不变；专项在相同 SHA 上另行实跑，不能与全量测试计数相加。

**状态：已实跑；待林志涛确认最终验收版本。** 本次测量的是 [`main@6fe349f01acc5ae6f17d1059e2e8984676016ab9`](https://github.com/MyeeeeR1kooo/CampusFix/commit/6fe349f01acc5ae6f17d1059e2e8984676016ab9) 的干净工作树，包含 [#126](https://github.com/MyeeeeR1kooo/CampusFix/pull/126) 合入的 #58 统计看板和 #90 账户管理。#126 的合并点为 `1fa6102a641876c1a24b7d2ca0ec4dc241e2248b`，到被测 SHA [只新增两份 D4 文档](https://github.com/MyeeeeR1kooo/CampusFix/compare/1fa6102a641876c1a24b7d2ca0ec4dc241e2248b...6fe349f01acc5ae6f17d1059e2e8984676016ab9)，应用代码、测试和覆盖率配置相同。本报告只作为该版本证据，不据此宣布团队完成验收。

| 测试（2026-11-23 北京时间） | 文件 | 通过 | 失败 | 错误 | 跳过 | 行覆盖率 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 后端 pytest / PostgreSQL，15:42:35–15:44:39 | 28 | **758** | 0 | 0 | 0 | **97.37%**（1,705 / 1,751） |
| 前端 Vitest，15:42:44–15:43:13 | 20 | **318** | 0 | 0 | 0 | **96.34%**（3,427 / 3,557） |

前端分支为 1,263 / 1,348（报告显示 93.69%），函数为 306 / 340（90.00%）。前端使用报告工具输出的显示值：3,427 / 3,557 在 HTML 和 Cobertura XML 中显示为 96.34%。后端未开启分支测量。前端类型检查、生产构建和 OpenAPI 类型摘要核对也通过。后端已有 Starlette/httpx 弃用警告，未导致失败。

统计后端专项 3 项、前端统计 3 项和账户管理 3 项均包含在各自全量测试中；后端账户回归也核对停用账户后撤销旧会话、保留已有工单。它们不另外加到总数。覆盖率按原 D5 口径分别统计 `backend/app` 和 `frontend/src`；后者含未加载的 TS/TSX 和 Mock，排除测试、辅助文件与声明。前后端口径不同，不合并百分比，也不作为浏览器联调验收。

| 材料 | 后端 | 前端 |
| --- | --- | --- |
| 完整 HTML 入口 | [coverage.py](backend/html/index.html) | [V8 / Istanbul](frontend/index.html) |
| Cobertura 覆盖率 XML | [coverage.xml](backend/coverage.xml) | [cobertura-coverage.xml](frontend/cobertura-coverage.xml) |
| JUnit 测试结果 | [backend-results.xml](backend-results.xml) | [frontend-results.xml](frontend-results.xml) |
| 执行日志 | [pytest](logs/backend.log) | [Vitest](logs/frontend.log) · [构建](logs/frontend-build.log) · [依赖安装](logs/npm-ci.log) |

从 GitHub 下载仓库 ZIP 或克隆仓库，进入本目录后打开对应的 HTML 首页。源码页、CSS 和 JS 随目录提供。JUnit 保留测试名、结果、时间及计数，机器名和本地路径已移除或替换。[summary.json](summary.json) 提供测试时间、版本号与计数。在本目录运行 `shasum -a 256 -c SHA256SUMS` 可核对文件。

## 环境与复跑

本机 macOS 26.6.2 ARM64。后端 Python 3.12.13、PostgreSQL 17.11（UTC，会话用本机专用 Unix socket）、pytest 8.4.2、pytest-cov 7.0.0、coverage.py 7.10.7；前端 Node.js 24.21.0、npm 11.19.0、Vitest 和 V8 provider 2.1.9。依赖按被测提交提供的锁文件安装。数据库只用于测试，有建临时库权限。

在完整仓库中检出上面的 SHA，并从仓库根目录执行。先把 `CAMPUSFIX_TEST_DATABASE_URL` 设为专用数据库的 SQLAlchemy `postgresql+psycopg://` URL；不设会跳过数据库测试。

```sh
out="$(mktemp -d)"
(
  cd backend
  : "${CAMPUSFIX_TEST_DATABASE_URL:?请设置专用 PostgreSQL 测试库 URL}"
  export CAMPUSFIX_TEST_DATABASE_URL TZ=UTC PGTZ=UTC ALLOWED_ORIGINS=http://localhost:5173
  python -m pip install -r requirements-dev.lock || exit
  COVERAGE_FILE="$out/.coverage" python -m pytest -q --tb=short --cov=app \
    --cov-report=term-missing --cov-report="html:$out/backend/html" \
    --cov-report="xml:$out/backend/coverage.xml" --junitxml="$out/backend-results.xml"
) && (
  cd frontend
  npm ci && npm test -- --coverage --maxWorkers=2 --minWorkers=1 \
    --reporter=default --reporter=junit --outputFile.junit="$out/frontend-results.xml" \
    --coverage.reportsDirectory="$out/frontend" && npm run build
)
printf 'Reports: %s\n' "$out"
```

报告第 6 章若采用此结果，请注明被测 SHA 与运行日期。11 月 21 日的记录继续作为旧版历史证据；若最终验收 SHA 改动了应用、测试、依赖或覆盖率配置，按新版本另测归档。
