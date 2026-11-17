# D3：ErrorCode、HTTP 状态与触发条件

统计依据：当前 `backend/app/core/errors.py` 的 8 个 `ErrorCode`，并按冻结基线 §11.5 和 `docs/api/openapi.yaml` 的 API 错误契约整理。表中列出业务接口约定；具体接口是否可能返回某项错误，以该操作的 API 描述为准。

| 错误码 | HTTP 状态 | 触发条件 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | 请求格式错误，或分页游标无法解析、被篡改、用于不同筛选条件。 |
| `VALIDATION_ERROR` | 413 | 上传的单张图片超过 5 MiB。 |
| `VALIDATION_ERROR` | 415 | 业务端点的请求媒体类型不支持；图片实际格式不受支持，或与声明的格式不一致。 |
| `VALIDATION_ERROR` | 422 | 请求字段或业务选择值校验失败；例如必填字段、ID、`expected_version` 格式不合法，分派目标不存在/非 Technician/已停用，工单创建时地点不存在，图片数量超限或图片数据损坏，列表时间范围无效。 |
| `UNAUTHORIZED` | 401 | 未登录、会话过期或无效、账户停用；登录凭证校验失败也使用统一认证失败响应。 |
| `FORBIDDEN` | 403 | 用户已通过认证，但角色或资源关系不允许执行该操作；例如非 Admin 执行管理员操作，或使用 Admin 专属筛选。对当前用户不可见的资源按 `404 / NOT_FOUND` 处理。 |
| `NOT_FOUND` | 404 | 资源不存在，或资源对当前用户不可见；两者使用相同语义，避免泄露资源是否存在。 |
| `CONFLICT` | 409 | 当前业务状态不允许操作，或发生业务冲突；例如非法工单状态动作、重复地点、创建工单时所选地点已停用、终态工单新增留言。地点不存在则是 `422 / VALIDATION_ERROR`。 |
| `TICKET_VERSION_CONFLICT` | 409 | 携带 `expected_version` 的工单状态动作提交了过期版本；仅适用于有版本控制的工单状态动作。 |
| `ORIGIN_NOT_ALLOWED` | 403 | 写请求缺少 `Origin`，或来源不在配置的允许列表中。`GET`、`HEAD`、`OPTIONS` 不执行此项来源校验。 |
| `INTERNAL_ERROR` | 500 | 发生未预期的服务端错误；响应使用通用提示，不包含堆栈、SQL、数据库约束名称、密钥或私有路径。 |

错误响应结构统一为 `{error: {code, message, request_id, field_errors}}`。同一错误码可对应多个 HTTP 状态（如 `VALIDATION_ERROR`）；客户端应结合 HTTP 状态和错误码判断，不应只看错误码。

## 实现对照备注

`backend/app/main.py` 对 `AppError`、请求字段校验、Origin 拒绝和未捕获异常有对应处理器。普通 `HTTPException` 当前只明确映射 401、403、404；其他状态默认映射为 `CONFLICT`，且字符串 `detail` 会原样作为 `message` 返回。`docs/api/README.md` 已记录此 Core 限制。业务调用应使用显式 `AppError`，避免普通 `HTTPException` 与上表契约不一致。

未注册路径的框架 404 和错误方法 405 当前仍可能返回 FastAPI 默认 `{detail: ...}`，它们不是正式业务接口的错误契约范围。

## 来源

- `backend/app/core/errors.py`：8 个错误码枚举。
- `backend/app/main.py`：错误响应处理与 HTTP 状态映射。
- `backend/app/core/security.py`：写请求 Origin 校验范围。
- `docs/superpowers/specs/CampusFix P0 Requirements & Design Baseline.md` §11.5：冻结的 HTTP 错误语义。
- `docs/api/openapi.yaml`：错误组件、状态码和操作级触发条件。
- `docs/api/README.md`：Core 普通 `HTTPException` 的已知映射限制。
