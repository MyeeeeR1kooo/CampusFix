# #46 前后端逐条评审记录（待填写）

契约 `1.0.0` / Pending review。本表是人工检查入口，不预填“已通过”。前端评审者：张越、舒玺悦；后端负责人：蒋雨涵、熊雄。实际负责人在 Issue/PR 记录身份、日期、结果和链接。

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
