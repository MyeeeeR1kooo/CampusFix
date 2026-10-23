# #51 / #54 后端整合交付（2026-10-23，提交时快照）

## 范围与批准

用户已明确批准：将 #102 合入 `reporter-flow`，提交推送新增验收、更新 #101；不要合并 `main`。验收采用项目既定 Linux/Docker，不扩展原生 Windows 支持。前端页面和浏览器 E2E 仍归张越。

本轮不新增业务接口、权限、状态规则、公共契约、迁移或依赖；只整合已有后端并补充取消分支的接缝验收。

## 固定版本与对接核查

- [#101](https://github.com/MyeeeeR1kooo/CampusFix/pull/101)：`reporter-flow@0e5a141f5275133ab1cf343cbcbde6438cc81163` → `main`。
- [#102](https://github.com/MyeeeeR1kooo/CampusFix/pull/102)：`attachments-storage@892d5b9e6b3f631d4b4f566a439de08a780ecd46` 已合入 `reporter-flow`，合并提交 `3d21bffea92029eb5a263776d8bba57a3a7cb650`。保留熊雄的 14 个提交、14 个改动文件，不覆盖或重复实现其业务代码。
- 新增验收提交为 `ff59c730684a06ee8bf23bbe27eacc184d1b5d6e`；已与上述官方合并结果在本地正常合并。本记录只描述提交时状态，后续 Linux 结果以 [#101 Checks](https://github.com/MyeeeeR1kooo/CampusFix/pull/101/checks) 和 PR 当前说明为准。
- 主体实现已核实：授权下载、公开/内部留言、超过 24 小时无引用文件清理均存在，照片 helper 保留调用签名、显式 `REPORT_PHOTO` 与默认 `RESOLUTION_PHOTO`。
- #51 已有详情 `download_url=/api/attachments/{id}` 与新下载路由一致；真实 Comment 从详情 timeline 读取并在 SQL 过滤内部备注，不必另建留言读取接口。
- 创建仍由 Tickets 拥有事务，Workflow 仍唯一负责状态转换；留言不修改 status/version/updated_at 或状态事件。

## 新增取消分支验收

`backend/tests/test_ticket_attachment_handoff.py` 实际收集 3 项：

1. 无图真实创建 → 公开/内部留言 → 地点改名并停用 → 真实撤销 → 保留快照和历史留言、拒绝终态新增、列表状态更新、其他 Reporter 隔离。
2. 同一取消链带照片，并要求 Reporter/Admin 仍可通过详情地址下载，其他 Reporter 无权读取。
3. 真实无图创建后准备已保存附件 fixture，独立验证详情下载地址，隔离发布与下载故障。

测试走真实 Auth、HTTP 和迁移后的临时 PostgreSQL；不使用业务/Auth stub，不加 skip/xfail，不放宽预期。隔离验收目录 `CampusFix-integration-51-54-20261023` 保留 #102 固定 SHA 和同一测试副本。

## 验证状态

| 证据 | 实际结果与边界 |
| --- | --- |
| [#101 Actions 39781978811](https://github.com/MyeeeeR1kooo/CampusFix/actions/runs/39781978811) | 旧 SHA 的 backend PostgreSQL 与 frontend 测试/契约同步/类型检查/构建 success |
| [#102 Actions 39926782941](https://github.com/MyeeeeR1kooo/CampusFix/actions/runs/39926782941) | #102 固定 SHA 的上述 job 均 success，不覆盖新增 3 项 |
| 本轮测试收集 | 新增 3 项收集成功；不是运行通过 |
| 先前 Windows 补充实跑 | 新 3 项为 1 passed / 2 failed；完整含 Mock 为 724 passed / 26 failed / 0 errors / 0 skipped；不作为 Linux 验收 |
| 新提交 Linux 验证 | 本记录提交时待推送触发；不能用旧 SHA 的结果代替，最终结果见 #101 Checks |

Windows 失败包含 POSIX 权限断言、不支持 `utime(..., follow_symlinks=False)` 和缺少 `O_NOFOLLOW/O_NONBLOCK`。按用户决定不扩展 Windows 兼容，也不删除安全保护制造通过。报告位于忽略目录 `.contract-artifacts/issue51-54-integration-20261023/`；早期 `seam-results.xml` 的 schema 引用错误已修正，最终补充结果见 `seam-results-final.xml` 与 `backend-results.xml`。临时数据库已停止，无生产数据操作。

## 待执行验证

分支已包含 #102；使用团队锁定依赖和专用 PostgreSQL 17.11，在 Linux 执行：

```sh
cd backend
export CAMPUSFIX_TEST_DATABASE_URL='<专用 PostgreSQL 的 postgresql+psycopg 连接串>'
python -m pytest tests/test_ticket_attachment_handoff.py -q -p no:cacheprovider
python -m pytest tests ../tools/test_api_contract_mock.py -q -p no:cacheprovider
python -m pip check
```

预期新增 3 项及完整回归通过、数据库项零跳过。现有 Ubuntu CI 会自动收集新增测试，但其 backend job 只运行 backend 的 pytest，**不包含 tools/test_api_contract_mock.py**；发布后须按实际 CI 数量报告，不把未运行的 Mock 算入新提交结果。

## 授权与交付流程

- 用户明确批准的 #102 → reporter-flow 合并已通过正常 GitHub CLI 完成，没有使用管理员绕过或变更 main。
- 常规 Git HTTPS 连接超时，但同一用户的已登录 GitHub CLI 接口可用；同步时核对原始 Git 对象 SHA，保留本地验收提交及官方合并历史，只允许 reporter-flow 普通前进更新，不强推。
- 提交推送新验收与当前交接说明后，等待新 SHA 的 Linux CI，再更新 #101 的五段说明、实际测试数量和结果链接。整个 #51 因前端未交付仍不关闭。

## 共享文件与交接

本轮新修改仅为测试和交接说明；#102 带入的 `main.py`、`attachments/service.py`、`workflow/service.py` 与熊雄、林志涛共享，整合时保留 Tickets Router、照片用途、事务边界、`ticket_projection` 和原状态机。核查的其他开放 #97 只涉及前端，无这些后端文件交叉。

后端核心功能已有真实接口与证据，#54 已整合；新增验收须以新 Linux 结果确认。张越的正式页面、浏览器端到端和 Docker 全新重建未验收，不能把整个 #51 标为完成。#45/#49 及历史准备文档原位保留，不纳入本次提交。
