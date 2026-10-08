/**
 * The Mock mount point (#48).
 *
 * Ownership, not just placement: 张越 owns this file and the one call site in
 * `client.ts` that consults it; 舒玺悦 owns the responder implementation and its
 * fixture data. The split exists because the 分工表 says the two of them must not
 * edit each other's files, and because "脚手架只搭一次，两人共用" - a seam inside
 * the fixture directory would have made the mount point something to re-create.
 *
 * Contract:
 *   - a responder returns a `Response`, or `null` to fall through to the real
 *     backend for that one request;
 *   - returning a real `Response` is deliberate. A mock that handed back a plain
 *     object would skip `parseError`, the 204 rule and the envelope unwrap, so the
 *     Mock layer would be testing a wire format the backend does not speak.
 *
 * The switch is `VITE_USE_MOCK=1`, read per request rather than at module load so
 * a test can flip it. With the flag off, or with no responder installed, nothing
 * here runs and the request goes to `/api` as before - which is what #48 asks:
 * "关掉 Mock 后请求会打到真实后端地址".
 */

export interface MockRequest {
  readonly method: string;
  readonly path: string;
  readonly json?: unknown;
  readonly form?: FormData;
}

/** Return a Response to serve the request, or null to let it reach the backend. */
export type MockResponder = (request: MockRequest) => Response | null | Promise<Response | null>;

let responder: MockResponder | null = null;

export function mockSwitchOn(): boolean {
  return import.meta.env.VITE_USE_MOCK === "1";
}

/** Install the Mock layer. Passing null detaches it again. */
export function installMock(next: MockResponder | null): void {
  responder = next;
}

/** Resolve a request through the mount point, or null when the real fetch should run. */
export async function requestViaMock(request: MockRequest): Promise<Response | null> {
  if (responder === null || !mockSwitchOn()) return null;
  return responder(request);
}
