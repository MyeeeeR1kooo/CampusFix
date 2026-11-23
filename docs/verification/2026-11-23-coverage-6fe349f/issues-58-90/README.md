# #58 统计看板与 #90 账户管理：专项补充

被测版本：[main@6fe349f01acc5ae6f17d1059e2e8984676016ab9](https://github.com/MyeeeeR1kooo/CampusFix/commit/6fe349f01acc5ae6f17d1059e2e8984676016ab9)，包含 [PR #126](https://github.com/MyeeeeR1kooo/CampusFix/pull/126) 对 [#58](https://github.com/MyeeeeR1kooo/CampusFix/issues/58)、[#90](https://github.com/MyeeeeR1kooo/CampusFix/issues/90) 的集成。覆盖率与下面的浏览器测试基于同一 Git SHA。账户管理复用 #47 已实现的后端接口；本次补充的是验证证据。

11 月 23 日 15:42–15:44（北京时间）的 D5 已执行前后端全量测试。下表将此前散在全量 XML 中的相关证据单独列出：

| Issue | 后端相关用例 | 前端相关用例 | 文件行覆盖率（同一份 D5 XML） |
| --- | --- | --- | --- |
| #58 统计看板 | `test_analytics_api.py` 3 项通过 | `analytics.test.tsx` 3 项通过 | 统计后端模块 70/71；`AnalyticsPage.tsx` 57/59 |
| #90 账户管理 | `test_auth_api.py::test_admin_account_management_revokes_existing_sessions` 1 项通过 | `accounts.test.tsx` 3 项通过 | 共享用户后端模块 101/104；`AccountManagementPage.tsx` 75/75 |

[10 条具体用例 TSV](d5-related-tests.tsv) · [分文件覆盖率 TSV](d5-module-lines.tsv) · [后端完整 JUnit](../backend-results.xml) · [前端完整 JUnit](../frontend-results.xml)。前端这 6 条是模拟 API 的组件测试，真实页面验证见下。共享用户模块的覆盖率也包含该模块的其他路径。上述通过数已包含在后端 758、前端 318 内。

## 真实浏览器与数据库核对

**#58 统计看板。** 2026-11-23 **16:05:59–16:06:02**（北京时间）实跑 7 项，全部通过。[空页面](analytics/01-analytics-empty.png)和[有数据的页面](analytics/02-analytics-populated.png)均使用真实 API。15 张虚构工单经独立 PostgreSQL 读取和 Python 聚合得到预期值，与接口和页面逐项一致：状态、类别、楼宇、积压、平均关闭耗时和 30 天趋势。实测积压 **9**；从创建到关闭平均 **201,600 秒**（约 **2.3 天**，含等待确认）；上海时区 10 月 25 日至 11 月 23 日创建 **12**、关闭 **2**，午夜分组通过。未登录 401，Reporter 和 Technician 403。见[实跑 JSON](analytics/browser.json)和[独立数据比对](analytics/analytics-db-oracle.json)。

**#58 加载、异常与恢复。** 16:07:22–16:07:25 在浏览器延迟真实请求核对加载态，主动模拟一次网络中断核对提示，再恢复真实 API 验证 Retry，共 3 项通过。故障为测试注入，有[截图](analytics/03-analytics-error-injected.png)和[复跑记录](analytics/ui-probe.json)。另发现三处分布区域的 `aria-labelledby` 引用无效，标题和数字可见，但区域缺少预期的辅助技术名称；同一 JSON 记录了 DOM 与可访问性快照。此项待原模块负责人处理。

**#90 账户管理。** 2026-11-23 **16:02:59–16:03:07**（北京时间）实跑 8 个场景，全部通过。管理员按角色和启用状态筛选，分别停用并恢复 Reporter 与 Technician。停用后旧会话和重新登录均返回 401；恢复后新登录成功，旧会话仍失效。已存工单保持创建人、状态及版本；非管理员访问账户接口和管理员停用自身均被 403 拒绝。结束时演示账户均已恢复启用。[实跑 JSON](accounts/browser.json) · [只读数据库核查](accounts/database.json) · [停用](accounts/04-reporter-inactive.png) · [历史工单](accounts/06-admin-history-while-reporter-disabled.png) · [恢复](accounts/13-managed-accounts-restored.png)。

两项均用本机生产前端（关闭 Mock）、Playwright 1.62.1、Chromium 和 FastAPI／PostgreSQL 17.11、相互隔离的虚构数据。场景数单独列报。[复跑说明](复跑说明.md)附脚本入口，记录中不含账户凭据或会话值。

报告第 6 章可按本页补记 #58、#90 核对结果，保留 [D5 全量报告](../README.md) 的时间、SHA 和份数口径。专项验收不替代全系统验收；团队最终签收另行确认。
