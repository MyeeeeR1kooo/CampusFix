# D6：熊雄负责模块的缺陷与回归交接

核对日期：2026-11-23。接收材料：项宸 2026-11-22《熊雄交接》中的 D6 回复模板、R8 覆盖率补充和 R9 缺陷记录。

本记录仅交接熊雄负责的模块。R9 的 H01/H05 等编号仅为报告定位号，不是 Issue 或正式 TC 编号。

## 负责人、范围与版本

负责人：熊雄。范围为 #45 的 Docker、迁移和种子数据，#52 的后端审核、分类和优先级交付，以及 #54 的共享附件存储、授权下载、留言、失败回滚和孤儿文件清理。本轮 R9 对应的具体历史修复为附件模块的 H01、H05。

| 版本用途 | 完整 SHA / 说明 |
| --- | --- |
| 项宸 D6 模板及 R9 核对基线 | `46304e481da466e7bf78eac5be84f68f2abc2764` |
| 本轮核对、专项回归基线 | `c5b600f16635dd11589a0d93c6592890192e8598`（main） |
| 11 月 21 日 D5 证据归档提交 | `cc3cdc24118b80a7f8f791c508bd3025ebaac37c` |

模板基线至本轮基线的后端应用代码、Compose 和迁移无差异；后端测试仅 `backend/tests/test_workflow_api.py` 增加 54 行。旧 D5 的应用/测试测量基线仍按原记录保留，不能改写为本轮全量测量。若最终集成版本继续变化，C7、C8、追踪矩阵和新增验收证据应一起确认新的运行 SHA。

## H01：共享照片数量超限提示

- 问题来源：R9 H01；[2026-10-29 审查修复记录](https://github.com/MyeeeeR1kooo/CampusFix/blob/46304e481da466e7bf78eac5be84f68f2abc2764/docs/superpowers/handoffs/2026-10-29-update2-review-fixes.md)。所属模块为 `backend/app/modules/attachments/service.py`，报修照片与维修结果照片共用。
- 原现象：超过 5 张照片时，共享校验提示只写了维修结果照片，无法准确表达报修上传失败。
- 最短复现：向共享 `prepare_photos` 传入 6 张有效 PNG；接口场景分别为创建报修或提交维修结果时选择 6 张照片。
- 修复提交：[`a02220375e29978fed744784c845bdf486bc8e1b`](https://github.com/MyeeeeR1kooo/CampusFix/commit/a02220375e29978fed744784c845bdf486bc8e1b)。提示统一为 `Too many photos.`，状态仍为 422，文件写入前拒绝。
- 集成提交：先合入 `reporter-flow` 的 [`832c3f07d4862672288f1d371a49a1cb2605f93e`](https://github.com/MyeeeeR1kooo/CampusFix/commit/832c3f07d4862672288f1d371a49a1cb2605f93e)，再随 [`b42cf1f08f096fd07540c40ed1371b493fda1d46`](https://github.com/MyeeeeR1kooo/CampusFix/commit/b42cf1f08f096fd07540c40ed1371b493fda1d46) 集成至 main。
- 具体回归：`backend/tests/test_attachments.py::test_six_images_are_rejected_before_writing`，断言 422、精确错误消息及无文件写入。
- 已验证历史结果：`regression passed`。11 月 21 日 D5 JUnit 中该用例无 failure、error 或 skipped；本轮状态另见下方实际回归记录。

## H05：复用 Session 时附件监听器累积

- 问题来源：R9 H05；同一份 [2026-10-29 审查修复记录](https://github.com/MyeeeeR1kooo/CampusFix/blob/46304e481da466e7bf78eac5be84f68f2abc2764/docs/superpowers/handoffs/2026-10-29-update2-review-fixes.md)。所属模块为附件事务与文件生命周期。
- 原现象：同一 SQLAlchemy Session 多次处理附件时重复注册发布监听器，回滚后的待发布记录也需清理。
- 最短复现：复用同一 Session 连续暂存、发布并提交两个附件批次，再暂存、发布第三批后回滚，最后提交第四批；核对监听器数量、各批提交状态与磁盘文件。
- 修复提交和集成提交：与 H01 相同，修复为 `a02220375e29978fed744784c845bdf486bc8e1b`，通过 `832c3f07d4862672288f1d371a49a1cb2605f93e` 和 `b42cf1f08f096fd07540c40ed1371b493fda1d46` 集成。
- 具体回归：`backend/tests/test_attachments.py::test_reused_session_keeps_one_publication_listener_and_clears_rollback`，检查只增加一个提交监听器、成功批次持久化、回滚批次未标记成功且被清理、后续提交不受污染，最终只保留三个成功批次文件。
- 已验证历史结果：`regression passed`。11 月 21 日 D5 JUnit 中该用例无 failure、error 或 skipped；本轮状态另见下方实际回归记录。

## 实际运行与证据

历史执行日为 2026-11-21，测量对象为 `main@46304e4` 加 #119 覆盖率依赖与配置；Python 3.12.13、PostgreSQL 17.11、pytest 8.4.2，UTC 会话。已直接核对 [归档 JUnit](https://github.com/MyeeeeR1kooo/CampusFix/blob/cc3cdc24118b80a7f8f791c508bd3025ebaac37c/docs/verification/2026-11-21-coverage/backend-results.xml)：后端共 753 项，0 失败、错误、跳过，H01/H05 两项包含其中。两项和 R9 共 12 条相关实例均不得再与 753 相加。

环境、复跑命令及原始结果见 [D5 README](https://github.com/MyeeeeR1kooo/CampusFix/blob/cc3cdc24118b80a7f8f791c508bd3025ebaac37c/docs/verification/2026-11-21-coverage/README.md)。该目录的 `SHA256SUMS` 用于核对原始证据文件内容；它与 Git 代码 SHA 含义不同。已有证据及其校验和保持原样，新增运行使用独立目录和校验清单。

**本轮实际回归（2026-11-23，北京时间，`main@c5b600f`）：** Python 3.12.13、PostgreSQL 17.11（UTC）、pytest 8.4.2。使用隔离测试库；运行 7 个文件，**170 项通过，0 失败、0 错误、0 跳过**。H01、H05 两条专项均再次通过，当前状态均为 `regression passed`。执行明细、复跑命令与分类计数见[验收证据入口](../../verification/2026-11-23-update3-acceptance/README.md)及[原始 JUnit](../../verification/2026-11-23-update3-acceptance/backend-junit.xml)。

**D6 核对结论：** 已核对本人负责的运行基座、后端审核、附件与留言模块；在本轮实际覆盖范围内**未发现新增缺陷**，没有本轮缺陷修复提交（无）。已知遗留：Docker 镜像未在本轮重建；390px 队列导航历史异常归前端复验；跨角色共同验收结论仍待林志涛签收。

另外核对了本人模块与共享修复的接点，以下用例都包含在上述 170 项中：

| 来源 | 现象和复现 | 历史修复 | 本轮回归 |
| --- | --- | --- | --- |
| #54 附件事务，维修结果接入 | 让带结果照片的提交在 commit、rollback 都失败，核对是否仍清理照片 | [`639f86b`](https://github.com/MyeeeeR1kooo/CampusFix/commit/639f86b77cff4cb3e330591f0dc6ffa385a46370) | `test_resolution_commit_and_rollback_failure_still_clean_files`，通过 |
| R9 H04 的 #52 后端审核部分 | 提交 2,001 字符的驳回原因，返回 422 且不写事件；2,000 字符可提交 | [`f6805c5`](https://github.com/MyeeeeR1kooo/CampusFix/commit/f6805c5dc8189c7909d458359e45fcd3aabc1067)，共享修复 | `test_event_text_length_limit_rejects_without_writes` 的 Admin/REJECT 实例，通过 |
| #45 演示账户交付与契约对齐 | 新库播种三种角色，按契约样例邮箱登录，并重跑种子核对幂等 | [`623fc2a`](https://github.com/MyeeeeR1kooo/CampusFix/commit/623fc2aa06e2ecfb45b3542b625e317d09bab484) | 三角色浏览器登录及 `test_seed_is_idempotent_and_preserves_existing_accounts`，通过 |

## 新增、遗留及协作边界

H01/H05 的修复提交、函数和实跑证据已补齐。无新增缺陷的结论限于熊雄负责的范围及已执行检查。

| 项目 | 现有证据或边界 | 本次 D6 的处理 |
| --- | --- | --- |
| #45 Docker、迁移、种子数据 | 有历史 Docker 验证及 D1 运行记录；历史环境和日期按原档案保留 | 本轮专项回归不能自动证明重新构建 Docker 或全新环境复现通过 |
| #52 后端审核、分类、优先级 | 复用共享 Workflow；既有后端证据见 `docs/verification/2026-10-31-issues-52-53-backend/README.md` | 本轮新增测试结果只按实际执行范围记录；不代替 #53 分派负责人确认 |
| #54 附件、授权下载、留言、回滚、清理 | 所有权和接入约定见 [#54 交接](https://github.com/MyeeeeR1kooo/CampusFix/blob/46304e481da466e7bf78eac5be84f68f2abc2764/docs/superpowers/handoffs/2026-10-23-issue54-integration.md) | H01/H05 属本模块；其余边界按专项实跑结果确认 |
| R9 M01：390px 队列导航溢出 | 2026-10-31 浏览器记录为 394px 文档宽度、390px 视口，历史结果 FAIL；当前浏览器修复结果须由前端实际复验 | 不以 Issue 关闭或本次后端测试代为关闭；由舒玺悦确认当前状态 |
| R9 H02–H04、U01 | 查询/地点长度、时间范围、共享 Workflow 文本及确认幂等涉及其他模块和负责人 | 可以引用已公开证据；本记录不代替相应负责人 D6 回复 |
| C7 / C8 | C7 真实三角色闭环、C8 联合验收及追踪矩阵须同一集成版本；真实角色截图、脱敏响应和同一工单状态/事件需可关联 | 当前后端回归不能代替真实浏览器闭环或林志涛的联合确认；C8 未具备完整证据时按待验收交接 |
| FR11 真实统计、FR16 完整账户管理及报告汇总 | 11 月 22 日交接指出尚未完整交付，归属其他成员 | 本记录不补做这些业务，不代签、不宣称已验收 |

需求编号按徐琨钦 11 月 19 日 v1.0 的 17 FR + 8 NFR 目录，由彭兆彬统一正式 TC 和 R10 状态；本记录提供真实函数名，不自行编造 TC 编号。覆盖率已可供 R8 使用，无需仅为写报告重复生成 D5。后续最终代码变更需要重新测量时，应另外归档当时的 SHA、日期与结果。
