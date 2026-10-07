/**
 * The only `fetch` call site in the app (#48).
 *
 * Two guarantees:
 *   1. Every failure arrives as an `ApiError` carrying the contract's four envelope
 *      fields — `code`, `message`, `request_id`, `field_errors` — because
 *      `docs/api/openapi.yaml` declares that shape as the only error body. There is
 *      exactly one parser, so a page never guesses at a wire format.
 *   2. Nothing else calls `fetch`. Session identity is an HttpOnly cookie; the SPA
 *      never holds a token, so no request here carries an actor or a role.
 *
 * Types come from `./generated/schema` directly: inside `src/api/` that is the same
 * owner. Everywhere else must import `../api`, which is what keeps a #46 freeze to one
 * directory instead of a sweep across the pages.
 */

import { requestViaMock } from "./mockBridge";
import type { components } from "./generated/schema";

type Schema = components["schemas"];

export class ApiError extends Error {
  readonly status: number;
  readonly code: Schema["ErrorCode"];
  /** Required by the contract, but a proxy error page has no body to read. */
  readonly requestId: string | undefined;
  readonly fieldErrors: Schema["FieldError"][];

  constructor(init: {
    status: number;
    code: Schema["ErrorCode"];
    message: string;
    requestId?: string;
    fieldErrors?: Schema["FieldError"][];
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.fieldErrors = init.fieldErrors ?? [];
  }

  /** Field messages keyed by the dotted path the server used, for RHF/Zod resolvers. */
  get fields(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const fe of this.fieldErrors) out[fe.field] = fe.message;
    return out;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** §13.3: any 409 means the ticket moved under the user — both contract codes do. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  get isDenied(): boolean {
    return this.isUnauthorized || this.isForbidden;
  }
}

let onUnauthorized: (() => void) | null = null;

/**
 * §13.3's 401 rule, from the one place that can see every response. The auth provider
 * registers `clearSession`; passing null detaches it again for tests.
 *
 * A failed *login* is also a 401. It still runs the handler, which is harmless — there
 * is no session to clear and the user is already on the login page — and the ApiError
 * is thrown regardless so the form can show why.
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** Drop absent/empty filters so the server sees "no filter" rather than an invalid one. */
export function buildQuery(params: Record<string, unknown> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

const FALLBACK_CODE: Schema["ErrorCode"] = "INTERNAL_ERROR";

/** The declared error object, before it has been checked. */
type WireError = Schema["ErrorResponse"]["error"];

async function toApiError(response: Response): Promise<ApiError> {
  // The header is on every declared response and the body repeats it; the body wins
  // when both are present, the header is the fallback for a body we cannot read.
  const headerRequestId = response.headers.get("X-Request-ID") ?? undefined;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiError({
      status: response.status,
      code: FALLBACK_CODE,
      message: "The request could not be completed.",
      requestId: headerRequestId,
    });
  }

  // Read defensively: a response that is not the declared envelope must still become an
  // ApiError rather than a TypeError on a missing field.
  const error = (body as { error?: Partial<WireError> } | null)?.error;
  if (!error || typeof error.code !== "string" || typeof error.message !== "string") {
    // Not a contract error body: an nginx or proxy error page, a truncated stream, or
    // a route FastAPI answered outside the declared operations. Still a typed failure.
    return new ApiError({
      status: response.status,
      code: FALLBACK_CODE,
      message: "The request could not be completed.",
      requestId: error?.request_id ?? headerRequestId,
    });
  }

  return new ApiError({
    status: response.status,
    code: error.code,
    message: error.message,
    requestId: error.request_id ?? headerRequestId,
    fieldErrors: Array.isArray(error.field_errors) ? error.field_errors : [],
  });
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  /** JSON body — mutually exclusive with `form`. */
  json?: unknown;
  /** multipart body: ticket creation and resolve carry photos this way. */
  form?: FormData;
  signal?: AbortSignal;
}

async function send(path: string, options: RequestOptions, want: "json"): Promise<unknown>;
async function send(path: string, options: RequestOptions, want: "blob"): Promise<Blob>;
async function send(path: string, options: RequestOptions, want: "json" | "blob"): Promise<unknown> {
  const { method = "GET", json, form, signal } = options;

  // The Mock mount point sits above `fetch`, not above the envelope handling: a served
  // mock still passes through the same 204 rule and error parser, so the Mock layer
  // cannot invent a wire shape the backend does not produce.
  const response =
    (await requestViaMock({ method, path, json, form })) ??
    (await fetch(path, {
      method,
      // HttpOnly session cookie (#46: Cookie/Origin). Browsers attach Origin on their
      // own for writes; nothing here may hand-write it.
      credentials: "same-origin",
      headers: json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: json !== undefined ? JSON.stringify(json) : form,
      signal,
    }));

  if (!response.ok) {
    const apiError = await toApiError(response);
    // §13.3: a 401 anywhere means the session is gone. The handler clears it and
    // redirects; the throw still happens so the caller can say why.
    if (apiError.isUnauthorized) onUnauthorized?.();
    throw apiError;
  }
  // 204 has no body — logout is the only declared 204, and parsing it would throw.
  if (response.status === 204) return undefined;
  if (want === "blob") return await response.blob();
  return await response.json();
}

export const http = {
  get: async <T>(path: string, signal?: AbortSignal) =>
    (await send(path, { signal }, "json")) as T,
  post: async <T>(path: string, json?: unknown) => (await send(path, { method: "POST", json }, "json")) as T,
  patch: async <T>(path: string, json?: unknown) =>
    (await send(path, { method: "PATCH", json }, "json")) as T,
  /** Creates and resolves send fields plus photos in one multipart request. */
  multipart: async <T>(path: string, form: FormData) =>
    (await send(path, { method: "POST", form }, "json")) as T,
  /** Attachment bytes. Every read re-checks ticket visibility server-side. */
  blob: (path: string, signal?: AbortSignal) => send(path, { signal }, "blob"),
};
