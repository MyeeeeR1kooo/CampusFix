# #51 / #54 前端真实联调记录（2026-10-24）

> 状态：工作树未提交。基线 `origin/reporter-flow@4f5ac526b524c16159f15ae2b8d2b0978c40d65a`。
> 范围：#51 创建/列表/详情接入，以及 #54 图片、照片分区、公开留言和管理员内部备注。
> 该记录同时包含可重放的 API E2E 脚本与浏览器实测观察；它不替代 Issue 的最终验收决定。

## 1. 环境

- Docker 29.6.2 / Docker Compose v5.3.1
- Compose 项目：`campusfix51e2e`（独立数据库与附件卷）
- PostgreSQL `17.11-bookworm`
- API：`campusfix-api:local`，Python 3.12，`alembic upgrade head`
- Web：本项目 `frontend/dist` 构建产物，nginx 同源代理 `/api`，`http://localhost:8090`
- 前端最终构建：`frontend/dist`（`npm run build`）

英文演示种子（`backend/app/seed.py`）：

```text
REPORTER   Demo Reporter    reporter@example.invalid
TECHNICIAN Demo Technician  technician@example.invalid
ADMIN      Demo Dispatcher  admin@example.invalid

Demo Building A / 1 / Room 101
Demo Building A / 2 / Shared Area
Demo Building B / 1 / Room 102
```

种子是 create-only；已有数据库卷不会被改写。复现全英文演示必须使用全新卷。

## 2. 启动与复现

在仓库根目录：

```sh
# 0. 仅清理本次隔离演示项目；不要对含真实数据的项目执行 -v
docker compose -p campusfix51e2e down -v

# 1. 准备本地 .env（从 .env.example 复制），设置 DATABASE_URL、POSTGRES_PASSWORD、
#    SECRET_KEY、SEED_REPORTER_PASSWORD、SEED_TECHNICIAN_PASSWORD、SEED_ADMIN_PASSWORD。
#    本记录的地址和端口需要以下值；导出变量会覆盖 .env 中的同名值：
export WEB_PORT=8090
export ALLOWED_ORIGINS=http://localhost:8090
export FRONTEND_DIST=frontend/dist

# 2. 先构建真实前端；web 镜像在 build 时复制这个目录，顺序不能反
cd frontend
npm ci
npm run build
cd ..

# 3. 构建并启动真实栈，然后写入英文演示种子
docker compose -p campusfix51e2e build api web
docker compose -p campusfix51e2e up -d --wait
docker compose -p campusfix51e2e run --rm --no-deps api python -m app.seed

# 4. 确认 8090 提供的是真实构建，而不是 deploy/web/bootstrap 占位页
curl -fsS http://localhost:8090/ | grep -q 'assets/index-' && echo frontend-ok

# 5. 可重放的真实后端 E2E
SEED_REPORTER_PASSWORD=<seed reporter password> \
SEED_TECHNICIAN_PASSWORD=<seed technician password> \
SEED_ADMIN_PASSWORD=<seed admin password> \
BASE_URL=http://localhost:8090 \
node tests/e2e/reporter-flow-smoke.mjs

# 6. 前端单元/页面测试
cd frontend
npx vitest run --no-cache
```

`tests/e2e/reporter-flow-smoke.mjs` 只使用 Node 内置 `fetch` / `FormData` / `Blob`，不新增依赖。它覆盖：

- 三角色真实登录；
- 带图 multipart 创建（真实 PNG，77 bytes）与无图创建；
- 列表可见范围、`q` 检索、状态筛选、20 条游标分页；状态筛选同时断言所有返回项均为 `CANCELLED`，并排除脚本创建的未取消工单。
- 详情、时间线、授权附件下载（Reporter 可读、未分派 Technician 404）；
- 公开留言、Reporter 创建内部备注 403、Admin 内部备注对 Reporter 不下发；
- 地点改名并停用后的创建时快照保留；结束时恢复地点并校验 200 与字段一致，恢复失败会让脚本非零退出。
- 审核前撤销 → `CANCELLED`、允许操作清空、历史照片/留言保留；
- 终态新增留言 409，且版本和留言数不变。

### 本轮实际输出（全新数据库，首次运行）

```json
{
  "result": "PASS",
  "ticket": "CF-20261024-000001",
  "attachment": { "id": 1, "bytes": 77, "mime": "image/png" },
  "comments": { "public": "Public E2E note 1792826788628", "internalHiddenFromReporter": true },
  "pagination": { "first": 20, "second": 2 },
  "locationSnapshot": "Demo Building B / 1 / Room 102",
  "terminal": "CANCELLED"
}
```

脚本在已有数据的数据库上再次运行也通过（第二次 `first: 20, second: 20`），说明分页断言不依赖固定总量。

## 3. 后端种子回归

种子改为英文后，用真实 PostgreSQL 运行种子、Auth 和地点测试：

```sh
docker build -t campusfix-api:test --target test backend
docker run --rm --network campusfix51e2e_default \
  -v "$PWD/docs:/docs:ro" \
  -e CAMPUSFIX_TEST_DATABASE_URL='postgresql+psycopg://...@db:5432/postgres' \
  -e SECRET_KEY='<test-only secret>' \
  campusfix-api:test \
  pytest -q tests/test_p0_storage.py tests/test_auth_api.py tests/test_locations_api.py
```

结果：

- 定向种子/Auth/地点测试：`78 passed, 1 warning`
- 完整后端测试（同一 PostgreSQL、同一测试镜像）：`736 passed, 1 warning`

种子唯一约束测试原先硬编码中文地点；已改为读取 `DEMO_LOCATIONS[0]`，以后改演示地点不会让该测试失去意义。

## 4. 浏览器实测（in-app browser，真实 API）

以下均在 `http://localhost:8090` 的真实 Compose 栈上操作：

| 场景 | 观察结果 |
|---|---|
| Reporter 登录 / 列表 | 空状态、创建入口、状态筛选可见 |
| 必填校验 | 空表单提交显示页面摘要 + 标题/类别/描述/地点字段错误 |
| 地点级联 | 楼宇/楼层/房间逐级启用，选项来自真实 `/api/locations` |
| 紧急渠道 | 安全、医疗、报警三类提示均在创建页出现 |
| 带图创建 | 提交后跳到详情，报修照片加载成功（8×8 PNG，`naturalWidth=8`） |
| 无图创建 | 详情显示两个空照片分区，地点快照正确 |
| 公开留言 | 提交后时间线出现，详情刷新 |
| Admin 内部备注 | Admin 可见 `INTERNAL NOTE` 标签；Reporter 详情不含该文本 |
| 跨用户 | Technician 访问未分派工单得到统一 404 页面 |
| 地点快照 | Admin 改名并停用地点后，历史详情仍显示 `Demo Building B / 1 / Room 102`，新地点列表不再包含它 |
| 非法/损坏图片 | 真实后端返回 `Invalid image data.`；移除文件后错误横幅消失 |
| 终态留言 409 | 提交后服务端错误保持可见，表单保留；网络记录只有 `POST .../comments [409]`，没有额外详情 GET |
| 空白留言 | 三个空格提交成功；真实 API 返回 `body: "   ", len: 3` |
| 全英文演示 | 详情显示 `Demo Reporter` 和英文地点，页面文本无中文 |
| Mock 模式照片 | 在 `VITE_USE_MOCK=1` 的 Vite 页面中，两张种子照片均为 blob URL 加载（`naturalWidth=1`），只有 blob 图片请求，没有 `/api/attachments` 穿透 |

浏览器证据使用 Qoder in-app browser 与网络请求面板读取；截图为临时观察结果，不写入仓库。

## 5. 前端自动化结果

```text
npx vitest run --no-cache
Test Files  15 passed (15)
Tests       278 passed (278)

npm run build
tsc -b && vite build: passed
```

覆盖新增回归：旧会话迟到创建/留言回调、终态留言 409 不刷新、Mock 图片字节、空白留言契约、照片预览/移除、分页、筛选、空/加载/错误态。

## 6. 未覆盖与边界

- 浏览器步骤是人工按上表执行并记录，不是仓库内自动浏览器测试；仓库当前没有 Playwright 依赖，未擅自新增。
- 种子改为英文只影响全新数据库；已有演示卷保留旧中文数据，这是幂等种子的既有语义。
- 未在本次提交/推送，因此没有该工作树的远端 CI 结果。
