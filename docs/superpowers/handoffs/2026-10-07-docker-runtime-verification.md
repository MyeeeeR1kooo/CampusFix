# #45 Docker 实际运行验收（2026-10-07）

结论：熊雄负责的四服务运行环境、迁移、种子及持久化验证通过。此次使用真实 Docker Engine 和 PostgreSQL 容器；后端容器测试 **135 passed，0 failed / errors / skipped**，耗时 6.69 秒。保留 1 条已有 TestClient/httpx 弃用警告。

## 验证环境与代码范围

- macOS ARM64 主机；独立 Lima 2.2.1 虚拟机，Ubuntu 26.04.1 LTS / Linux ARM64，3 CPU、4 GiB 内存。
- Docker Engine 29.8.2，Docker Compose 5.6.0。
- 项目：`campusfix-docker-verify-20261007-r3`；使用全新数据库卷与独立测试凭据。
- 镜像：`python:3.12.12-slim-bookworm`、`postgres:17.11-bookworm`、`nginx:1.28.0-alpine`，后端使用现有锁定依赖。
- 验证起止（UTC）：`2026-10-07T05:24:38.515558+00:00` 至 `2026-10-07T05:25:54.655251+00:00`。
- 基础代码为 PR #66 的 `3bbd1ddc9315e4498782a739dd16b6de0c1eb867`，对应树 `e68864d042239b452392e2e9f653a3a0ac12d700`；叠加下述两处测试环境修复。被测源代码归档 SHA256 和两处修复文件 SHA256 见证据 JSON。

## 实测结果

| 检查 | 结果 |
| --- | --- |
| 全新环境 `up --build -d --wait` | 退出码 0；db、api、web 均 healthy；migrate Exited (0) |
| 启动依赖 | db 启动在迁移前；迁移成功结束后 api 启动，随后 web 启动 |
| HTTP 静态页与健康检查 | Web 返回 200；`/health` 返回 200 和 `{"status":"ok"}` |
| 同源 `/api` 代理 | 未实现探测路径返回 API 的 404 和 X-Request-ID；允许 Origin 的 POST 到达 API，非法 Origin 返回 403 / ORIGIN_NOT_ALLOWED |
| 迁移 | 8 张业务表及 alembic_version；版本 0001；P0 §10.2 六组索引实存 |
| 种子 | 首次 3 users / 3 locations；第二次 0 / 0；三角色各一人，工单 0 |
| 密码 | 三角色 Argon2id 散列均可往返验证；日志未输出密码或散列 |
| 容器权限 | API UID 10001；附件卷可写；运行镜像未安装 pytest |
| 存储隔离 | db 和 api 分别挂载数据库、附件命名卷；web 无附件挂载 |
| 容器内完整后端测试 | 135 passed；真实 PostgreSQL；迁移回滚/再次升级、约束、并发种子等均通过；无跳过 |
| `down` 后重建 | 保留命名卷；账户、地点、迁移、索引及附件标记前后一致；种子再次 0 / 0 |
| API 强制重建 | `up -d --force-recreate --wait api` 成功；Web 健康检查及同源代理恢复；数据仍一致 |
| 外部端口 | 仅 web 发布到 127.0.0.1:8080；api 和 db 无宿主机端口发布 |

附件标记是用于检查卷读写及持久化的虚构测试文件，未代表图片上传/授权等业务功能验收。

## 本次修复

1. `deploy/docker-compose.test.yml` 为测试镜像显式设置 `ALLOWED_ORIGINS=http://localhost:5173`，与已有后端测试请求一致。首轮继承运行站点 8080 时，校验测试请求被 Origin 中间件拒绝，出现 134 passed / 1 failed；修复后 135 项均通过。正常运行服务继续使用 `.env` 配置的站点来源。
2. `backend/Dockerfile` 的 test 阶段将 pytest 缓存写入 `/tmp/campusfix-pytest-cache`，支持 UID 10001；运行镜像阶段保持原有配置。

重试过程中的 macOS 资源附带文件曾导致验证副本中的 Alembic 读取失败；清理打包附带文件后，以新的空卷重跑通过。未修改迁移脚本、Core 或公共接口，也未跳过或改写测试断言。

## 证据

- [脱敏运行日志](../../verification/2026-10-07-docker/runtime-smoke.log)：工具版本、四服务状态、迁移、种子、容器测试、重建及 HTTP 输出。
- [结构化验证数据](../../verification/2026-10-07-docker/verification.json)：退出码、时间、代码范围、健康状态、索引、账户与持久化前后对比。
- [JUnit 测试报告](../../verification/2026-10-07-docker/backend-results.xml)：135 个测试用例的逐项记录。
- [证据 SHA256](../../verification/2026-10-07-docker/SHA256SUMS)：核对文件完整性。

## 复现

按 README 创建 `.env`，填写独立数据库密码、对应 DATABASE_URL、SECRET_KEY 和三类种子密码。以下命令不输出这些凭据：

```bash
docker compose config --quiet
docker compose up --build -d --wait --wait-timeout 180
docker compose ps -a
curl --fail http://localhost:8080/health
docker compose exec -T api python -m app.seed
docker compose exec -T api python -m app.seed
docker compose -f docker-compose.yml -f deploy/docker-compose.test.yml build api
docker compose -f docker-compose.yml -f deploy/docker-compose.test.yml run --rm --no-deps api
```

持久化测试仅在独立测试项目中执行 `docker compose down` 后再次 `up -d --wait`，并比较数据及附件标记；不要使用删除卷的参数。

## 后续联调边界

- 三角色真实 HTTP 登录仍依赖 #47 的 Auth Router；散列往返验证不代表登录通过。
- 正式 React 页面与浏览器完整联调仍依赖 #48；本次验证的是当前静态占位页、健康检查与同源代理基础设施。
- #45 中“全新环境 docker compose up 能起”和“全新环境按 README 步骤能跑起来”可确认；“三类演示账户可登录”“小测试全部通过”及正式前端联调保留待验收。
