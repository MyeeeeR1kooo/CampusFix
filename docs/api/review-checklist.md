# #46 前后端逐条评审记录（待填写）

契约 `1.0.0` / Pending review。本表是人工检查入口，不预填“已通过”。前端评审者：张越、舒玺悦；后端负责人：蒋雨涵、熊雄。实际负责人在 Issue/PR 记录身份、日期、结果和链接。

2026-10-07 更新：前端 12 行字段复核及 Mock/类型对齐已在公开评审中通过，见下方证据索引。本表的人工表格与勾选仍待有决策权限的负责人批准后落笔；未填写的表格不表示链接中的评审未发生，也不能据此提前勾选业务页面、真实后端或 E2E 的验收项。

## 页面字段检查

| 页面/流程 | 重点字段、契约路径 | 前端确认/问题 |
| --- | --- | --- |
| 登录与登录态 | login/me 的 id/name/email/role/active；Cookie 不读 JSON token；401 回登录页；logout 204 不解析 JSON | 待评审 |
| Reporter 创建 | 有效 locations 的 building/floor/room_or_area；title/description/category/location_id/photos；201 的 code/status/version | 待评审 |
| 我的报修/调度/维修列表 | items/next_cursor；共七类筛选（六类通用 + 当前维修人员仅 Admin）；时间范围用 created_from/created_before 两个参数，共八个筛选参数，加 cursor/limit 共十个查询参数；location snapshot、priority、assignee、责任方及 allowed_actions；无 total | 待评审 |
| 工单详情 | description、两类照片 download_url、分派历史、timeline kind、责任阶段、可执行动作；ADMIN_ONLY 后端过滤 | 待评审 |
| 审核/驳回/分派 | APPROVE 的 category/priority，REJECT 的 reason；启用 Technician 列表；expected_version 和更新摘要 | 待评审 |
| 开始/提交结果 | note 可选；resolution_note 必填；可选照片 multipart；409 重新读详情 | 待评审 |
| 确认/返工/撤销 | confirm 无评价字段；rework reason；cancel 仅审核前；终态无新增操作 | 待评审 |
| 留言/内部备注 | body/visibility，返回 Comment；1–2000 字符；仅 Admin 内部备注 | 待评审 |
| 地点维护 | 所有地点列表、创建、局部修改/启停；停用不改变历史快照；唯一组合冲突 409 | 待评审 |
| 账户管理 | Reporter/Technician，role/active 筛选、启停；无账号创建/改角色/管理 Admin | 待评审 |
| 管理统计 | 六组字段；秒不是纯维修时间，0/空集合；30 日、Asia/Shanghai、按日期升序 | 待评审 |
| 通用错误与附件 | error.code/message/request_id/field_errors；8 枚举；413/415/422图片提示；授权二进制下载。Origin 拒绝仅适用于写请求；角色拒绝可发生于读或写请求。工单列表中非 Admin 使用 current_assignee_id，以及三个管理 GET（locations/users/analytics）的角色拒绝均为 403 / FORBIDDEN；普通地点 GET 无 403 声明。按各操作检查，不为 GET 增加 Origin 校验 | 待评审 |

## Mock 和类型检查

- [ ] 已从当前 YAML 重新生成 Mock 和 TypeScript 类型，无人工维护的第二套字段/枚举。
- [ ] 已用三类用户信息、正常与空列表、所有状态动作成功示例检查布局和按钮。
- [ ] 已展示待确认详情的两类照片、分派历史、事件与留言；不读取私有路径。
- [ ] 已检查 401、403（角色/来源）、404、409（状态/版本）、413、415、422、500 提示。
- [ ] 分派目标不存在、非 Technician、已停用三类样例均为 `422 / VALIDATION_ERROR`；在 `technician_id` 控件旁显示错误并要求重新选择，不提示“工单已更新”。
- [ ] 清楚 Mock 是固定字段样例，不是权限/事务/图片校验通过证据。
- [ ] 若有缺字段，已注明页面、契约字段、冻结基线章节及是否引入产品变更。

## 后端与正式冻结

- [ ] 后端负责人认可可实现性，确认与 Core 8 错误码、Cookie、Origin 一致。
- [ ] 后续业务模块已知应使用 AppError，不错误复用 HTTPException 的默认映射。
- [ ] 分派业务实现须在服务端校验目标账户；后续集成测试覆盖三类失败、候选列表加载后账户被停用，以及失败后状态、版本、负责人、分派记录和事件均未改变。Mock 不作为这些行为的验收证据。
- [ ] 人类完成字段评审，结果记录在 Issue #46 或 PR。
- [ ] 有权限的负责人批准 v1.0，填写批准日期及证据链接。
- [ ] 批准后同步 YAML/README 状态，按团队分支/PR 流程提交。
- [ ] 全组收到正式冻结通知，知悉后续修改须 Issue + 升版本号 + 通知全组。

批准人：待填写。批准日期：待填写。Issue/PR 证据：待填写。

## 评审证据索引（非冻结批准）

记录日期：2026-10-07。本节整理已公开的评审结论、对应修订和证据范围，不代替评审人签署，不勾选上面的检查项，也不填写批准人或批准日期。舒玺悦最新评审对应本次文档更新前的 `base-auth@27d85c6`，契约内容锚点为 `009f7f3`，仍是 `1.0.0 / pending-review`。本次文档更新通过现有 PR #65 交付终审，不改变契约或上述人类评审的签署范围。

| 证据 / 负责人 | 对应修订和已记录结论 | 仍需确认的范围 |
| --- | --- | --- |
| 熊雄：后端字段及可实现性 | [2026-10-02 评审记录](https://github.com/MyeeeeR1kooo/CampusFix/pull/65#issuecomment-5950257146)针对 `0ba628b`，认可后端可实现性和与 Core 的一致性；同时明确真实业务路由、事务、权限、图片及 E2E 未验收 | 旧技术评审不等于当前稿的冻结批准；本轮契约/Core 增量回归已完成，记录见 README。冻结时引用原评审及当前修订的验证证据，是否另需人工后端复核由负责人确认，不自动新增一轮完整重审 |
| 张越：自己负责的前端字段 | [字段逐条确认](https://github.com/MyeeeeR1kooo/CampusFix/issues/46#issuecomment-5991909270)已于 2026-10-06 更新至 `009f7f3`；[更新指针](https://github.com/MyeeeeR1kooo/CampusFix/issues/46#issuecomment-6009710357)确认两处 403 问题解决。页面字段表第 1、2、4、7、8、12 行已核对，第 3 行仅确认 Reporter 的“我的报修”部分 | 其余前端字段已由舒玺悦在 2026-10-07 的整体复核中确认；不扩大张越本人签署范围，也不把字段核对当作实际页面或真实后端验收 |
| 舒玺悦：前端字段及修改请求 | [更新后的 Issue 复核](https://github.com/MyeeeeR1kooo/CampusFix/issues/46#issuecomment-5999377198)及 [APPROVED 评审](https://github.com/MyeeeeR1kooo/CampusFix/pull/65#pullrequestreview-5432043884)针对 `27d85c6`：12 行字段全部通过，含第 3 行调度/维修；两处 403 问题已解决，无遗留修改请求。旧 [CHANGES_REQUESTED](https://github.com/MyeeeeR1kooo/CampusFix/pull/65#pullrequestreview-5418130475) 仅作历史证据 | 前端批准不等于项管批准冻结；正式状态、批准记录和人工清单仍待有权限的负责人处理 |
| 张越：生成类型与请求封装 | [草稿 PR #71](https://github.com/MyeeeeR1kooo/CampusFix/pull/71) 当前 `56a4716` 的前端文件与 `fdb1082` 相同，类型摘要为 `sha256:9cfffc74c835`；筛选参数及错误码分组回到契约类型来源。舒玺悦报告组合副本重新生成的类型与其一致，仅时间不同 | 按 #68 → #69 → #71 整合后，在最终工作分支对同一 YAML 做生成比对；冻结若改变 YAML 摘要，再重新生成并验证，不能以临时组合验证代表实际分支已合并 |
| 舒玺悦：前端 Mock | [最新交接](https://github.com/MyeeeeR1kooo/CampusFix/blob/333608035631a35bbff93292fd6ba3b014ed99f9/frontend/ISSUE-48-HANDOFF.md)及整体复核确认 #69 的 `3336080` 对齐当前契约：保留上海日期修复，统一 req_mock_ 请求 ID，新增四种受限 GET 403 回归；记录 22 个业务操作、75 份响应契约校验通过。作者报告 #69 前端 177 项、与 #71 组合 184 项测试及类型/构建通过 | 同版本确认已补齐；最终实际分支整合及验证仍待执行。上方合成检查项留给有权限的人类落笔；Mock 不代替真实业务、图片解码或 E2E 验收 |

### 证据范围与后续验收

- 字段齐全、Schema/样例校验、类型生成与 Mock 检查，只证明对应的契约或前端模拟层；不证明会话授权、服务端权限、PostgreSQL 事务/并发、图片解码及真实 HTTP 联调通过。
- 页面布局、动作按钮、完整错误提示、真实分派选择框、业务接口及端到端闭环，随 #47、#49、#51–#58 等对应模块补充实现与验收。此说明不删除、减免或提前勾选上面的任何检查项；未验证的内容保持待验证，并由负责人记录后续证据。
- 本节所列评论、测试结果和分支提交均不构成 v1.0 冻结批准。正式批准、清单落笔、YAML/README 状态同步、合并及全组通知，仍按 [README 的评审和冻结规则](README.md#评审和冻结规则) 执行。
