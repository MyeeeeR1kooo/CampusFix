# CampusFix #46 API 契约交接

## 当前状态

- 契约版本：`1.0.0`，**Frozen / 已冻结**（2026-10-07 经 PM 徐琨钦 批准，证据见 [批准记录](https://github.com/MyeeeeR1kooo/CampusFix/pull/65#issuecomment-6030042408)）。
- 任务：[Issue #46](https://github.com/MyeeeeR1kooo/CampusFix/issues/46)。负责人：蒋雨涵、熊雄；前端逐条评审：张越、舒玺悦；人工批准后才冻结。
- 代码基线：用户已确认使用 `base-auth`，本次文档更新前的公开评审快照为 `27d85c6`；契约内容锚点为 `009f7f3`，后续提交只更新交接文档。Issue 中的历史分支标注不代表此次使用了不存在的分支。
- 产品依据：[P0 冻结基线](../superpowers/specs/CampusFix%20P0%20Requirements%20%26%20Design%20Baseline.md)，尤其第 3–7、9–12、14 节；Core 依据：[交接说明](../superpowers/handoffs/2026-10-02-base-auth-api-handoff.md)。旧 PRD 已作废，不用于增加功能。
- 交付范围：字段清单、完整契约、契约校验、可生成的 Mock、TypeScript 类型生成验证。本次没有修改状态机、权限、数据库、Core 或业务模块。契约稿通过分支/PR 交付，前端字段复核及 Mock/类型对齐已通过；**契约已于 2026-10-07 批准冻结 v1.0**，按整合顺序合并及关闭 #46 仍未完成。

入口：[最小字段清单](minimal-fields.md) → [OpenAPI 契约](openapi.yaml) → [前端评审清单](review-checklist.md)。

2026-10-07 经用户授权，将本次收尾材料提交到现有 PR #65，并从草稿转为正式待审批，申请项管批准冻结。正式待审批不等于已获冻结批准或已合并；YAML 状态、人工勾选及批准人/日期仍不代填。

2026-10-03 经项目负责人在本次会话批准，按基线文档修订 1.0.1 补齐 PR #65 评审 §3.3：分派目标不存在、非 Technician 或已停用，统一使用 `422 / VALIDATION_ERROR`，字段错误指向 `technician_id`。此次只完善待评审稿的错误语义和样例，契约仍为 `1.0.0 / pending-review`，不代表整个契约已获人工批准或冻结。

2026-10-06 根据[张越的字段评审](https://github.com/MyeeeeR1kooo/CampusFix/issues/46#issuecomment-5991909270)及[舒玺悦的修改请求](https://github.com/MyeeeeR1kooo/CampusFix/pull/65#pullrequestreview-5418130475)，在 `base-auth@841a011` 基础上完成待评审修正：补回 `GET /api/tickets` 已描述的 `403 / FORBIDDEN`，只提供 Admin 专属筛选的角色拒绝样例；纠正清单对 GET/403 的说明；统一七类筛选的计数。这是既有权限规则的契约一致性修复，不新增权限、字段、错误码或业务端点。保留 #70 的上海编号日期和冻结状态测试修正；契约仍为 `1.0.0 / pending-review`，批准人、日期及人工勾选不由本次修正代填。

### 2026-10-07 冻结批准快照

已上传的契约修正锚点为 [`base-auth@009f7f3`](https://github.com/MyeeeeR1kooo/CampusFix/commit/009f7f30ceec0b28267efd556ff6617ee1d18be6)。GitHub 上 YAML 的 SHA256 为 `9cfffc74c83517c6695834c4f70f7673db99aa913f20dc42e6f0d5928de5485c`；Windows 工作文件比较前需统一为 LF 换行，不能将 CRLF 字节差异误报为契约内容变化。此处只索引已发生的评审和技术验证，不代填人工清单、批准人或批准日期。

| 事项 | 已有证据 | 尚需处理 |
| --- | --- | --- |
| 契约及错误约定 | 字段清单、23 个操作、8 个 ErrorCode、分页/ID/日期约定和冻结规则已交付；403 修正已进入草稿 PR #65，前端复核通过 | 已于 2026-10-07 由 PM 批准冻结，见[批准记录](https://github.com/MyeeeeR1kooo/CampusFix/pull/65#issuecomment-6030042408) |
| 前端字段复核 | 张越的[逐条确认](https://github.com/MyeeeeR1kooo/CampusFix/issues/46#issuecomment-5991909270)覆盖本人页面；舒玺悦的[最新整体复核](https://github.com/MyeeeeR1kooo/CampusFix/pull/65#pullrequestreview-5432043884)针对 27d85c6，覆盖全部 12 行（含调度/维修），无遗留修改请求 | 批准后由负责人据公开证据填写人工清单；字段复核不等于完整页面或真实后端验收 |
| 前端生成类型 | [草稿 PR #71](https://github.com/MyeeeeR1kooo/CampusFix/pull/71) 当前为 56a4716，前端文件与已生成新类型的 fdb1082 相同；舒玺悦报告组合副本重新生成的类型与其一致，仅生成时间不同 | 按 #68 → #69 → #71 整合后，在实际工作分支对同一 YAML 做生成比对，避免旧快照覆盖新类型；冻结状态改动若改变 YAML 摘要，按新快照重新生成并验证 |
| Mock | 固定 Mock 已校验 23 个操作、191 个响应样例；#69 的 [3336080](https://github.com/MyeeeeR1kooo/CampusFix/commit/333608035631a35bbff93292fd6ba3b014ed99f9) 修复 req_mock_ 请求 ID 及四种受限 GET 403 回归；舒玺悦记录 22 个业务操作、75 份响应按当前契约通过校验 | 在最终整合分支保留最新 Mock 并验证；模拟行为不作为真实权限、事务、图片解码或 E2E 的验收证据 |
| 正式批准与交付 | 经用户授权通过现有 PR #65 提交终审；契约 1.0.0 已于 2026-10-07 批准冻结，尚未合并 | 已批准；清单与状态已同步，按整合顺序合并并通知全组后更新 Issue 完成记录 |

舒玺悦于 2026-10-07 对 `27d85c6` 提交新的 [APPROVED 评审](https://github.com/MyeeeeR1kooo/CampusFix/pull/65#pullrequestreview-5432043884)，明确两处 403 修改请求已修复、整体复核通过。旧的 [CHANGES_REQUESTED](https://github.com/MyeeeeR1kooo/CampusFix/pull/65#pullrequestreview-5418130475) 保留为历史记录，不再列为待修复阻断。历史后端评审及各证据范围见 [评审证据索引](review-checklist.md#评审证据索引非冻结批准)。

舒玺悦的[交接记录](https://github.com/MyeeeeR1kooo/CampusFix/blob/333608035631a35bbff93292fd6ba3b014ed99f9/frontend/ISSUE-48-HANDOFF.md)报告 #69 前端 177 项、与 #71 组合 184 项测试及类型/构建通过；这些是作者验证记录，本次未重跑远程前端。端口口径已确认：8080 是 Compose 默认入口，8000/4010 是显式代理目标，5173 是前端开发入口；状态型 Mock 使用 VITE_USE_MOCK=1，不依赖 4010。合并前的规则候选、批准条件及操作交接见 [整合准备记录](../superpowers/handoffs/2026-10-07-pr-integration-preparation.md)，它不构成冻结或合并批准。

完整页面布局、图片展示、错误提示、真实登录/授权、PostgreSQL 事务和 E2E 仍由后续页面及业务 Issue 补验。这里没有删除、勾选或豁免原清单中的相应条目；冻结前应将尚未完成的业务验收交接给对应负责人，不能用 Schema、生成类型或 Mock 宣称这些行为已通过，也不应为完成契约而接管后续业务模块。

## 已实现与待实现对照

| 契约 / 能力 | `base-auth` 现状 | 此次一致性证据 |
| --- | --- | --- |
| GET `/health` | 已实现；返回 `{status: "ok"}` | 真实应用调用后按 Schema 校验；路径不误写成 `/api/health` |
| 错误包裹、请求 ID、8 个 ErrorCode | Core 已实现 | 用真实 Core 的 AppError / 校验 / Origin 拒绝路径检查 Schema；枚举精确对照 `core/errors.py` |
| Cookie / Origin | Core 提供工具及中间件 | Cookie 名/安全属性/8 小时默认值与契约一致；所有写请求含 Origin 参数 |
| Auth（3）、Tickets/Workflow/Comments（11） | 仅空模块，业务路由待实现 | 静态契约和输入/输出样例验证，不宣称登录、事务和权限已经运行 |
| Attachments/Locations/Users/Analytics（8） | 仅空模块，业务路由待实现 | 静态契约、图片元数据、分页与统计 Schema 校验 |

共 23 个操作：22 个冻结基线业务操作，加上已有 `/health`。FastAPI 自动文档路由和测试临时路由不是业务接口。

重要的 Core 现有限制（已做只读诊断，本次不改相邻模块）：

- 普通 `HTTPException` 仅正确映射已配置的 401/403/404；400/413/415/422/500 的当前默认错误码为 CONFLICT，且字符串 detail 会原样返回。业务模块应按 Core 交接使用 `AppError`，显式指定契约状态、ErrorCode 和安全文案，不能把内部异常字符串作为 message。
- 未注册路径的框架 404、错误方法的 405 仍为 `{detail: ...}`，不属于此文件声明的操作；后续 Core 全局错误统一可单独提 Issue。正式业务接口的“不可见/不存在资源”仍必须使用 `AppError(NOT_FOUND, 404, ...)`，不得将这项现状当作业务豁免。
- HTTPException 原附加头不会全部保留。成功登录/登出按 Cookie helper 设置响应头，不依赖该异常处理器传递 Cookie。

## 本次确定的契约约定

这些是 #46 授权范围内的表示和实现约定，不增加 P0 功能：

| 事项 | 约定 |
| --- | --- |
| 成功响应 | 创建工单/留言/地点 201；其他有正文动作 200；退出 204 无正文。正文直接返回声明对象，不额外套 `data` |
| 错误 | 固定 `{error:{code,message,request_id,field_errors}}`；只复用 Core 8 个枚举。400/413/415/422 使用 VALIDATION_ERROR，通过 HTTP 状态区分。业务状态冲突 CONFLICT，旧版本 TICKET_VERSION_CONFLICT |
| 分派目标校验 | 目标不存在、非 Technician 或已停用均为 422 / VALIDATION_ERROR，field_errors 指向 technician_id；前端提示重新选择。服务端执行分派时校验，失败不改变工单状态、版本、负责人、分派记录或事件 |
| ID | JSON 正整数 `integer/int64`。不擅自改成字符串；JS 超过 `Number.MAX_SAFE_INTEGER` 会有精度风险，未来变更需评审，当前演示数据应处于安全范围 |
| 时间 | UTC ISO 8601，以 Z 结尾；趋势日期单独使用 Asia/Shanghai 的 YYYY-MM-DD。数据库仍使用 timestamptz |
| 分页 | `items/next_cursor`；无下一页 null。默认 20、最大 100；排序 `created_at DESC,id DESC`。游标不透明，不跨筛选条件复用；无 count/offset/page 额外接口 |
| 可空 | `?` 是必返字段的 null，不是省略。工单 priority/assignee/closed_at 按状态关系校验；终态无 allowed_actions |
| 列表筛选 | 共七类：状态、类别、优先级、楼宇、创建时间范围、编号或标题关键词、当前维修人员（仅 Admin），即六类通用 + 一类 Admin 专用；AND 组合。时间范围 `[created_from, created_before)` 占两个参数，共八个筛选参数，加 cursor/limit 共十个查询参数。楼宇使用关联地点的 building，历史展示仍读取快照 |
| 读请求的 403 | 非 Admin 在工单列表使用 current_assignee_id，以及非 Admin 访问管理地点/用户/统计 GET，返回 403 / FORBIDDEN；GET 不校验 Origin。普通地点 GET 无 403 声明，不能把所有列表 GET 一概视为有或无 403 |
| 时间线 | 合并事件与留言，按 `created_at ASC, kind ASC, id ASC` 稳定排序；kind 同时用于前端区分两类对象 |
| 图片 | 创建/resolve 两处 multipart，重复同名 photos 部件；每用途累计最多 5 张，每张 5 MiB，JPEG/PNG/WebP。返工不增加图片总额度，无独立上传、编辑或删除接口 |
| 统计 | 六组，耗时单位秒且包括等待阶段；无关闭样本为 0，空分布 []；连续 30 个上海自然日含今日、升序补零。Mock 日期固定，仅供确定性展示 |

授权、资源归属、ADMIN_ONLY 过滤、图片解码、乐观锁及事务必须在业务实现中验证。Schema 和 TypeScript 不替代这些后端检查。

## 本地验证与生成

在仓库根目录运行；Python 开发环境建议使用虚拟环境。首次准备（Python 3.9+；本次验证使用 3.12）：

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e "./backend[dev]"
```

契约和当前 Core 测试、Mock 实测：

```powershell
.venv\Scripts\python.exe -m openapi_spec_validator docs/api/openapi.yaml
.venv\Scripts\python.exe -m pytest backend/tests tools/test_api_contract_mock.py -q
.venv\Scripts\python.exe tools/api_contract_mock.py
```

最后一条从契约样例生成 `.contract-artifacts/mock-responses.json`，记录操作、状态码、媒体类型、样例名和正文。输出被忽略，不提交生成物。全部 JSON 样例先按对应 Schema 校验，错误会直接阻止导出。

TypeScript 生成与编译检查（Node 20+、pnpm；依赖版本及完整依赖树在工具专用目录固定，不改变前端或后端运行依赖）：

```powershell
pnpm --dir tools/api-contract install --frozen-lockfile --ignore-scripts
pnpm --dir tools/api-contract run generate
pnpm --dir tools/api-contract run typecheck
```

生成 `.contract-artifacts/schema.d.ts`，`smoke.ts` 检查审核两种请求、列表、详情、时间线、附件等类型可用，并要求不完整审核请求等错误不能通过编译。后续前端接入时复用生成类型，不手写第二套枚举。改 YAML 后先重新生成再编译。

### Mock 预览

```powershell
.venv\Scripts\python.exe tools/api_contract_mock.py --serve --port 4010
```

只监听本机 `127.0.0.1`。前端开发代理可将 `/api` 指向 `http://127.0.0.1:4010`，无需为 Mock 开放跨域。改契约后重启；结束时 Ctrl+C。

| 想预览的情况 | 示例请求控制头 |
| --- | --- |
| 待确认详情含图片/分派 | GET `/api/tickets/1`，`X-Mock-Example: pending_confirmation_reporter` |
| 审核驳回 | POST `/api/tickets/1/review`，`X-Mock-Example: rejected` |
| 空列表 | GET `/api/tickets`，`X-Mock-Example: empty` |
| 非 Admin 使用维修人员筛选（固定拒绝样例） | GET `/api/tickets?current_assignee_id=2`，`X-Mock-Status: 403`、`X-Mock-Example: role`；控制头只选择样例，不验证真实用户或查询权限 |
| 版本冲突 | POST `/api/tickets/1/confirm`，`X-Mock-Status: 409`、`X-Mock-Example: version` |
| 分派目标不存在 | POST `/api/tickets/1/assign`，`X-Mock-Status: 422`、`X-Mock-Example: technician_not_found` |
| 分派目标角色不符 | POST `/api/tickets/1/assign`，`X-Mock-Status: 422`、`X-Mock-Example: technician_wrong_role` |
| 分派目标已停用 | POST `/api/tickets/1/assign`，`X-Mock-Status: 422`、`X-Mock-Example: technician_inactive` |
| 来源拒绝 | 任一声明 403 的写端点，`X-Mock-Status: 403`、`X-Mock-Example: origin` |
| 角色拒绝 | 声明 403 的端点，`X-Mock-Status: 403`、`X-Mock-Example: role` |

这只是**无状态样例服务**：不验证请求体、Cookie、Origin、权限、筛选，不保存状态或改变版本；路径 ID 不改变样例中的 ID。它按契约返回固定示例，不做真实登录，也不设置假会话 Cookie。附件下载用安全的 1×1 PNG 占位图；JPEG/WebP 在导出中是媒体类型说明，不代表真实图片上传测试。控制头不在正式业务契约中，不能发送到生产 API。Mock 自身的错误用 `mock_error` 明确区分。

## 测试记录与未验证部分

### 2026-10-06 评审修正

本地分支 `feat/46-review-fixes`，起点 `841a011`。本轮只修改以下六个已跟踪文件；既有 #45/#51 未提交文件不属于本次修正：

- `docs/api/openapi.yaml`、`docs/api/review-checklist.md`、`docs/api/README.md`。
- `backend/tests/test_api_contract.py`、`tools/test_api_contract_mock.py`、`tools/api-contract/smoke.ts`。

新增回归覆盖工单列表与三个管理 GET 的角色拒绝声明、GET 无 Origin 参数、列表 403 仅角色样例、Mock 的固定 403 样例及生成类型的响应/筛选字段。修正前新增契约回归准确发现两项失败；修正后通过。生成物仍位于忽略的 `.contract-artifacts/`，只用生成器更新，不手改。

本轮实际验证结果：

- OpenAPI 3.1 校验通过；重新生成的 Mock 含 23 个操作、191 个响应样例，全部 JSON 样例通过 Schema 校验。
- #46 相关 122 项测试通过：契约 94、现有 Core 14、Mock 14，含本次新增的 6 项契约回归和 3 项 Mock 回归。
- `pytest backend/tests tools/test_api_contract_mock.py -q` 全量 401 项通过；其中 279 项属于保留的 #51 准备测试，不算作 #46 新增成果。
- 从修改后的 YAML 重新生成 TypeScript 类型，严格编译通过；包括列表 403、管理员筛选/时间参数及预期应拒绝的拼错字段与字符串 ID。
- 1 个既有 FastAPI/Starlette TestClient 弃用警告，不是失败；未新增或升级依赖。
- 正常 Git 差异空白检查通过；原有 12 个 #45/#51 未提交文件逐一对比 SHA256，内容保持不变。

上述记录为本地验证证据。经用户授权，本轮修正以独立提交更新 `base-auth` 上的[现有草稿 PR #65](https://github.com/MyeeeeR1kooo/CampusFix/pull/65)，只提交修改供复核，不代表最终稿或正式冻结，也不授权合并到 `main`、代签评审或关闭 Issue。真实业务路由/授权、PostgreSQL 事务与并发、图片和前端/E2E 联调不在这些测试的验证范围内。

2026-10-06 修正提交时仍待舒玺悦的整体复核及前端 Mock 同版本确认；这两项已在 2026-10-07 的新评审中补齐。当前仍待有决策权限的人类批准冻结及全组通知。前端实际工作分支在整合后仍应对同一 YAML 做类型生成比对并保留最新 Mock；此处类型编译和固定样例验证不代表业务页面、真实授权或端到端联调通过。

2026-10-06 收尾时重新运行 OpenAPI 校验、上述 #46/Core/Mock 的 122 项测试、Mock 导出和 TypeScript 严格编译，全部通过；仍只有同一项既有 TestClient 弃用警告。该轮仅补充 README 和评审清单中的证据索引与交接范围，没有修改 YAML、字段、状态码、权限、冻结状态或业务实现。前端 PR #71 的测试/构建结果属于作者报告；该轮没有重跑远程前端或真实业务/E2E 测试。

### 原始 #46 交付记录

实际变更文件（均为 #46；原始工作树干净，未覆盖他人修改）：

- 文档：`docs/api/minimal-fields.md`、`docs/api/openapi.yaml`、`docs/api/README.md`、`docs/api/review-checklist.md`。
- 校验：`backend/tests/test_api_contract.py`；`backend/pyproject.toml` 只增加三项固定版本的开发校验依赖。
- Mock：`tools/api_contract_mock.py`、`tools/test_api_contract_mock.py`。
- 类型生成：`tools/api-contract/package.json`、`.npmrc`、`pnpm-lock.yaml`、`smoke.ts`。
- `.gitignore`：忽略虚拟环境、缓存、开发包及生成物。没有修改 Core/业务代码或数据库。

2026-10-02 本地结果：

- OpenAPI 3.1 校验通过；109 项测试通过（后端 99、Mock 10）。
- 所有操作的成功及错误响应样例通过 Schema 校验；Mock 导出 23 操作、190 个响应示例。
- TypeScript 类型生成及严格编译通过，含预期应失败的类型案例。
- 一个来自现有 FastAPI/Starlette 依赖范围的 TestClient/httpx 弃用警告，不是失败；未顺手升级依赖。

未运行且不应伪称通过：真实 PostgreSQL 业务集成、登录权限/停用会话、状态事务/并发、真实图片内容校验、业务统计查询、前端页面及 E2E。这些依赖尚未实现的业务模块，不能用 SQLite 或 Mock 代替。

## 评审和冻结规则

1. 蒋雨涵、熊雄完成后端字段及可实现性检查；张越、舒玺悦按 [逐条清单](review-checklist.md) 评审页面字段与 Mock，无须在常规技术细节成稿前逐项决策。
2. 缺字段先说明对应冻结基线/页面，不通过“前端需要”直接增加 P0 范围。涉及权限、状态机、核心数据库或产品规则，先由负责人批准基线变更。
3. 组长/有决策权限的人类批准后，在 Issue/PR 留下评审证据；更新清单、`x-contract-status` 和此处状态，才正式冻结 v1.0。AI 不代签。
4. **冻结后的任何契约改动必须走 Issue + 升版本号 + 通知全组**，列明原因、请求/响应/枚举影响、后端与前端调用方、测试和迁移影响。破坏兼容性升主版本，向后兼容增加升次版本，仅说明/示例修正升补丁版本；若影响 P0 基线仍需先评审基线。
5. 修改后重新运行契约/样例/类型检查，业务实现逐条补充真实一致性测试；将类型/Mock重新生成，不手改生成物。
6. 人工检查本地 diff 和敏感信息，再按团队流程 Commit、Push、PR、Review、Merge。推送分支或创建草稿 PR 仅表示待评审稿可查阅，不代表已批准、正式冻结、合并或 #46 已关闭。

工程参考：[OpenAPI 3.1 官方规范](https://spec.openapis.org/oas/v3.1.0.html)、[openapi-typescript 官方 CLI](https://openapi-ts.dev/cli)。
