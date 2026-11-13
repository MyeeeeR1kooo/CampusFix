# D1：main 分支 Compose 启动与三类演示账户登录

## 验证对象

- 分支：`main`
- 提交：`ca2d8c1a622feccbf7884e2fcf91bfd9aba4138c`（2026-11-13 获取 `origin/main` 后核对）
- 本记录只用于 D1 的启动与登录证据；三类账户均使用真实后端种子，前端使用 `frontend/dist`，不使用 Mock 页面。

## 实际执行与结果

| 步骤 | 命令或检查 | 结果 |
| --- | --- | --- |
| 分支和提交 | `git switch main`、`git fetch origin main`、`git rev-parse main origin/main` | 本地与远端均为上列提交 |
| 前端生产构建 | 在 `frontend/` 执行 `npm run build` | 通过；Vite 5.4.21，214 个模块，生成 `frontend/dist/index.html` |
| Docker Compose 配置 | `docker compose -p campusfix-d1-20261113 config --quiet` | 通过 |
| Docker Compose 启动 | `docker compose -p campusfix-d1-20261113 up --build -d --wait --wait-timeout 180` | 通过；`db`、`api`、`web` healthy，`migrate` Exited (0) |
| 演示数据 | `docker compose -p campusfix-d1-20261113 exec -T api python -m app.seed` | `Seed complete: 3 users, 3 locations created.` |
| 服务与前端 | `curl http://localhost:8080/health`、读取首页 HTML | 健康接口返回 `{"status":"ok"}`；首页引用 `/assets/index-...` 生产资源 |
| 三类演示账户登录 | Chrome 真实页面逐一提交登录表单，检查角色页地址、账号姓名和退出按钮 | 三类均通过；截图见下表 |

## 启动与取证命令

在仓库根目录执行。`.env` 已在本机准备并被 Git 忽略；它设置独立的 `POSTGRES_PASSWORD`、与之匹配的 `DATABASE_URL`、`SECRET_KEY`、三个 `SEED_*_PASSWORD` 及 `FRONTEND_DIST=frontend/dist`。不要提交 `.env` 或在截图中显示密码。以下使用独立 Compose 项目，避免复用其他项目的数据库卷。

本机使用 Homebrew Docker CLI 29.9.3、Compose 5.7.1 和 Colima Docker Engine 29.5.2。因原有 `~/.docker/bin` 链接失效，本轮以临时 Docker CLI 配置指定 Compose 插件目录，并通过 `DOCKER_HOST` 连接 Colima；使用正常安装的 Docker Desktop 时无需这两个临时变量。本轮 Colima 初次启动还遇到虚拟机 DNS 解析文件缺失，修复虚拟机 DNS 后才成功拉取镜像。第一次 API 镜像构建出现下载哈希错误，未改锁文件，重试后构建通过。

```sh
git switch main
git fetch origin main
git branch --show-current
git rev-parse HEAD

cd frontend
npm run build
cd ..

export FRONTEND_DIST=frontend/dist
# 仅本机 Colima 环境使用，临时配置含 Compose 插件路径
export DOCKER_CONFIG=/private/tmp/campusfix-d1-docker-config
export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock
docker compose -p campusfix-d1-20261113 config --quiet
docker compose -p campusfix-d1-20261113 up --build -d --wait --wait-timeout 180
docker compose -p campusfix-d1-20261113 ps -a
docker compose -p campusfix-d1-20261113 exec -T api python -m app.seed
curl --fail --silent --show-error http://localhost:8080/health
```

实际结果：`db`、`api`、`web` 为 healthy，`migrate` 退出码为 0；健康接口返回 `{"status":"ok"}`。种子首次运行创建三个演示账户和三个匿名地点。Web 页面来自 `frontend/dist`，而非默认的 `deploy/web/bootstrap`。已有相同卷时种子创建数可能为 0，仍需单独验证登录。

## 截图清单

| 证据 | 实际观察 | 文件 |
| --- | --- | --- |
| 启动成功 | `main`、提交号、再次执行 `up --wait`、三服务 healthy、迁移退出码 0、健康接口结果 | [D1-compose-success.png](D1-evidence/D1-compose-success.png)；[原始命令输出](D1-evidence/D1-runtime-commands.txt) |
| 报修人登录 | `reporter@example.invalid` 进入 `/reports`，显示 Demo Reporter / Reporter | [D1-reporter-login.png](D1-evidence/D1-reporter-login.png) |
| 维修人员登录 | `technician@example.invalid` 进入 `/assignments`，显示 Demo Technician / Technician | [D1-technician-login.png](D1-evidence/D1-technician-login.png) |
| 管理员登录 | `admin@example.invalid` 进入 `/workbench`，显示 Demo Dispatcher / Administrator | [D1-admin-login.png](D1-evidence/D1-admin-login.png) |

启动截图是对真实命令输出的排版截图，保留了相同内容的原始文本；不是操作系统终端窗口原始截屏。登录截图来自 Chrome 实际页面，三次登录各用独立浏览器会话，未显示密码或会话 Cookie。

维修人员登录成功，但当前 `main` 的 `/assignments` 页面显示“My assignments is not built yet”占位说明。本项只证明 D1 所需的登录，不证明维修人员业务流程已完成。

## 交付状态

已在 `main@ca2d8c1a` 实测 Compose 启动、真实前端、种子和三角色登录。交付文件均位于 `docs/Update_3/handoff/`。本机 `.env` 含演示密码且被 Git 忽略，交接账号密码应通过团队认可的私密渠道完成，不写入仓库或截图。本轮未验证完整业务闭环、全新机器复现或其他 D2–D7 交付物。
