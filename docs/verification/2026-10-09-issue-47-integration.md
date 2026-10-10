# Issue #47 登录认证模块前后端集成测试

## 结论

2026-10-09 在 `base-auth` 的 `18abdd47cffd02575e92b5cb9f8efb509212cd57` 上完成模块级功能验收：真实浏览器联调 **12/12 组通过**，后端全量 **164/164 条通过**（包含 #47 专项 17 条），前端全量 **233/233 条通过**，TypeScript 检查和前端生产构建成功。本次执行未发现 #47 范围内的功能阻断问题。

本次属于“登录认证模块前后端集成测试”，也可称“模块级联调/功能验收测试”。浏览器场景从页面操作贯穿前端、真实 API 和数据库，属于该模块的 E2E 测试；不代表完整工单业务闭环已经验收。

## 范围与依据

- [Issue #47](https://github.com/MyeeeeR1kooo/CampusFix/issues/47)：登录、退出、会话读取、角色识别、账户启停、Cookie 凭据、安全与错误提示。
- [P0 冻结基线](../superpowers/specs/CampusFix%20P0%20Requirements%20%26%20Design%20Baseline.md)：§3.2–3.3、§9、§11.2/11.4/11.5、§13.1–13.3、§16.2–16.3。
- 当前 `docs/CampusFix_PRD.md` 的开头声明其仅供历史备查，因此未从历史正文引入额外需求或验收规则。
- 真实调用链：`LoginPage → AuthContext → api/endpoints → api/client → /api 同源代理 → Auth/Users Router → Session/User → PostgreSQL`。
- 三角色登录后的工作台及账户管理页面目前是 `UnbuiltPage` 占位页；只检查身份、路由和访问限制。账户管理页面由 #49 实现，#47 的账户启停通过真实 Admin API 验证。

## 版本与环境

开始时工作树干净，分支为 `base-auth`，本地提交为 `e05dd97`。检查远端发现 #84 已合并，使用 `git fetch origin base-auth` 和 `git merge --ff-only origin/base-auth` 同步到上述验收提交后重新运行相关前端测试。

| 项目 | 本次实际环境 |
| --- | --- |
| 浏览器 | Google Chrome 154.0.8037.99，无头运行；Playwright 1.64.0 |
| 前端 | Node 24.15.0；现有锁定依赖；Vite 5.4.21 生产构建 |
| Web 来源 | `http://127.0.0.1:41747`；Vite preview 的现有 `/api` 代理 |
| API | 真实 FastAPI 0.142.2 / Uvicorn 0.54.0，`127.0.0.1:8047` |
| 后端 Python | 3.14.4；复用已有临时环境；逐项核对运行/测试锁文件共 54 项依赖，版本全部一致 |
| 数据库 | PostgreSQL 17.11，独立临时实例，`127.0.0.1:55447`，UTC |
| 数据来源 | 仓库 Alembic 迁移和 `app.seed`；只使用虚构测试账户及测试密码 |
| Mock | 浏览器联调未启用；前端全量单元/组件回归包含原有 Mock 测试 |

数据库、浏览器工具、构建输出和脚本均位于 `/private/tmp/campusfix-issue47.AtQNAQ/`。未使用项目的现有数据库或真实凭据。

## 浏览器联调结果

| 场景组 | 实际检查 | 结果 |
| --- | --- | --- |
| 匿名访问与登录说明 | 未登录访问 `/admin/users` 返回登录页；三类账户说明与真实种子一致；显示紧急渠道提示；生产页面隐藏 Mock 指引 | 通过 |
| Reporter 会话闭环 | 表单登录 → `/reports`；真实角色正确；刷新恢复会话；已登录访问 `/login` 自动跳转；退出返回 204、清 Cookie、删数据库会话；旧 Cookie 请求返回 401 | 通过 |
| Technician 会话闭环 | 同上，角色及入口为 Technician / `/assignments` | 通过 |
| Admin 会话闭环 | 同上，角色及入口为 Administrator / `/workbench` | 通过 |
| 前端输入校验 | 非法邮箱和空密码显示字段错误，未发起登录 API 请求 | 通过 |
| 统一失败提示 | 不存在的账户和错误密码均返回同样的 401 错误语义及页面提示，未签发 Cookie | 通过 |
| 角色拒绝 | Reporter/Technician 的管理员页面访问被路由守卫拒绝；直接请求 Admin 查询/写接口返回 403 | 通过 |
| 账户停用与恢复 | 对 Reporter 和 Technician 分别用 Admin API 停用；下次 SPA 会话请求返回 401 并回登录页；停用期间无法登录；重新启用后旧会话仍为 401，新登录成功 | 通过 |
| 会话过期 | 临时数据库中将 Reporter 会话设置为已到期；刷新时真实 `/api/me` 返回 401，页面回登录页 | 通过 |
| Origin 拒绝 | 缺失 Origin、非配置 Origin 的登录写请求返回 `403 / ORIGIN_NOT_ALLOWED`，未签发会话 Cookie；正常浏览器写请求携带正确来源 | 通过 |
| 手机宽度 | 390×844 下真实登录/退出成功；登录页无横向溢出 | 通过 |
| 浏览器运行错误 | 收集页面 `pageerror`，结果为空 | 通过 |

三角色闭环还逐一检查：Cookie 为 `HttpOnly`、`SameSite=Lax`，有效期约 28800 秒；页面 JavaScript 无法读取会话 Cookie；刷新请求实际携带 Cookie；数据库保存的值等于浏览器令牌的 SHA-256 哈希；密码为 Argon2id；数据库会话有效期为 8 小时；登录请求体仅含 `email`、`password`。

已人工查看桌面 1440×900 与手机宽度登录截图，字段、错误/紧急提示区域和账户说明排版可读。截图只包含未填写凭据的登录页。

## 自动化回归与构建

| 检查 | 命令/证据 | 最终结果 |
| --- | --- | --- |
| #47 后端专项 | `python -m pytest tests/test_auth_api.py -q`，连接临时 PostgreSQL | 17 通过，0 跳过 |
| #47 前端相关 | `npm test -- src/test/App.test.tsx src/test/client.test.ts src/test/sessionCache.test.tsx src/test/demoAccounts.test.mjs` | 53 通过 |
| 后端全量 | `python -m pytest -q --tb=short --junitxml=…/backend-results.xml`，设置 `CAMPUSFIX_TEST_DATABASE_URL` | 164 通过，0 跳过 |
| 前端全量 | `npm test -- --reporter=default --reporter=junit --outputFile=…/frontend-results.xml` | 233 通过，0 跳过 |
| 生产构建 | `npm run build -- --outDir /private/tmp/campusfix-issue47.AtQNAQ/frontend-dist`，包含 `tsc -b` | 成功 |
| 浏览器联调 | `node /private/tmp/campusfix-issue47.AtQNAQ/auth-browser.mjs` | 12 组通过 |

后端专项同时覆盖无会话 401、非法输入、账户查询与启停限制、过期会话、登录事务失败不发 Cookie、账户更新事务失败不留下半更新。现有安全/配置测试覆盖非本地环境的 Secure Cookie 配置。

首次后端全量回归为 163 通过、1 失败：`test_seed_is_idempotent_and_preserves_existing_accounts` 发现临时 PostgreSQL 继承本机 `Asia/Shanghai` 时区，返回的时间偏移为 +08:00。将**此次临时实例**的时区对齐 Docker 配置要求的 UTC 后，全量重跑为 164 通过；未修改代码或放宽断言。

非阻断警告包括 React Router v7 future flag、一条已有 React `act(...)` 警告、Starlette/httpx TestClient 弃用提示，以及依赖中 Rollup 注释标记提示；这些不是浏览器 JavaScript 运行错误，测试和构建最终退出码均为 0。

## 原始证据

以下文件保留在本机临时目录，未纳入版本控制，系统清理临时目录后可能失效：

- [浏览器脚本](/private/tmp/campusfix-issue47.AtQNAQ/auth-browser.mjs)
- [浏览器结果 JSON](/private/tmp/campusfix-issue47.AtQNAQ/browser-results.json)
- [后端专项 JUnit](/private/tmp/campusfix-issue47.AtQNAQ/backend-auth-results.xml)
- [后端全量 JUnit](/private/tmp/campusfix-issue47.AtQNAQ/backend-results.xml)
- [前端全量 JUnit](/private/tmp/campusfix-issue47.AtQNAQ/frontend-results.xml)
- [桌面截图](/private/tmp/campusfix-issue47.AtQNAQ/login-desktop.png)
- [手机宽度截图](/private/tmp/campusfix-issue47.AtQNAQ/login-mobile.png)

## 未验证项与剩余限制

- 本机没有可用 Docker 命令，未重跑 Compose/Nginx 部署；本次通过项目已有 Vite preview 同源代理接通真实 API。
- 未验证 Linux/Python 3.12.12 镜像环境；本次后端使用 Python 3.14.4，虽然锁文件中的 54 项依赖版本均一致，仍不能替代目标镜像验证。
- 浏览器使用本地 HTTP，Cookie 的 `Secure=false` 符合本地配置；未做真实 HTTPS 部署验证。
- 8 小时有效期通过 Cookie/数据库数值验证；到期行为通过临时测试数据模拟，未持续等待 8 小时。
- 未运行 Firefox、Safari 或真实手机设备；手机检查是 Chrome 的 390px 视口。
- 本次 401 页面清理验证由刷新后的实际 SPA 会话请求触发；已有组件测试另覆盖运行中的 401 和跨会话缓存/迟到响应处理。
- 工单业务闭环、#49 账户管理 UI、远端 CI 不属于本次已验证结果。

## 仓库与协作状态

本次仅新增本报告，未修改产品代码、测试源文件、依赖锁文件、`queryClient.ts`、认证上下文、API 契约或冻结基线。没有共享实现文件的交叉修改风险；报告如需提交，可由 #47 后端负责人林志涛和前端负责人张越共同复核。未提交、推送、修改 Issue 状态或发布。

浏览器已关闭；此次启动的 API、前端预览和临时 PostgreSQL 在测试结束后停止。原始证据和临时数据文件保留以便复查。
