/**
 * Session boundaries own the query cache (#68 review).
 *
 * §13.3's 401 rule used to drop only the login state; the query cache survived the
 * boundary, so one account's data could greet the next one while it re-fetched. These
 * tests drive the real `AuthProvider` over a real app query client — the same wiring
 * `App.tsx` mounts — and cover the scenarios the review names: logout, a mid-session
 * 401, switching accounts, and requests that were still in flight when the boundary
 * happened.
 *
 * The fetch stub honours `AbortSignal` the way a browser does, because that is exactly
 * the mechanism `endSession` relies on: a cancelled query must never deliver its
 * response — in particular never a late 401 — into the session that replaced it.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "../features/auth/AuthContext";
import { http } from "../api/client";
import { getTicket } from "../api/endpoints";
import { createAppQueryClient, queryKeys } from "../lib/queryClient";
import { errorResponse, jsonResponse, userPayload } from "../test-helpers";

const TICKET_KEY = queryKeys.tickets.detail(42);
/** A key nothing observes, so a cached entry there can only disappear via a reset. */
const RESIDUAL_KEY = queryKeys.tickets.detail(999);

const NO_SESSION = () => ({
  status: 401,
  body: { error: { code: "UNAUTHORIZED", message: "No session.", request_id: "r", field_errors: [] } },
});

const ADMIN = userPayload({ id: 9, name: "Admin Ada", role: "ADMIN", email: "admin01@campusfix.test" });
const REPORTER = userPayload({ id: 5, name: "Reporter Rep", role: "REPORTER" });

interface SessionRoute {
  match: RegExp;
  method?: string;
  reply: (init?: RequestInit) => { status?: number; body: unknown; delayMs?: number };
}

interface StubAnswer {
  status?: number;
  body: unknown;
  delayMs?: number;
}

const settle = async ({ status = 200, body, delayMs = 0 }: StubAnswer) => {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  return jsonResponse(body, status);
};

function stubSessionFetch(routes: SessionRoute[]) {
  const calls: Array<{ url: string; method: string }> = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });

    const route = routes.find((r) => r.match.test(url) && (!r.method || r.method === method));
    if (!route) return errorResponse("NOT_FOUND", 404, `No stub matched ${method} ${url}`);

    const signal = init?.signal;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!signal) return settle(route.reply(init));
    // Abort wins the race: a cancelled request rejects instead of answering, even
    // when its handler would have replied later.
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    return Promise.race([settle(route.reply(init)), aborted]);
  });
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

const ticketGetCount = (calls: Array<{ url: string; method: string }>) =>
  calls.filter((c) => c.method === "GET" && /\/api\/tickets\/42$/.test(c.url)).length;

/** One detail query plus the session controls, wired exactly like the app providers. */
function SessionProbe() {
  const client = useQueryClient();
  const { user, login, logout } = useAuth();
  const detail = useQuery({
    queryKey: TICKET_KEY,
    queryFn: ({ signal }) => getTicket(42, signal),
    enabled: user !== null,
  });
  return (
    <div>
      <p data-testid="session">{user ? `signed-in:${user.name}` : "no-session"}</p>
      {detail.isFetching && <p data-testid="detail">loading</p>}
      {detail.data && <p data-testid="detail">{JSON.stringify(detail.data)}</p>}
      <button type="button" onClick={() => void login("admin01@campusfix.test", "demo-password")}>
        Sign in as admin
      </button>
      <button type="button" onClick={() => void login("reporter01@campusfix.test", "demo-password")}>
        Sign in as reporter
      </button>
      <button type="button" onClick={() => void logout()}>Log out</button>
      <button type="button" onClick={() => void detail.refetch()}>Refresh</button>
      <button type="button" onClick={() => client.setQueryData(RESIDUAL_KEY, { residual: true })}>
        Seed residual cache
      </button>
    </div>
  );
}

function renderSession(routes: SessionRoute[]) {
  const stub = stubSessionFetch(routes);
  const client = createAppQueryClient({ notify: vi.fn() });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <SessionProbe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { client, stub };
}

const loginRoute: SessionRoute = {
  match: /\/api\/auth\/login$/,
  method: "POST",
  reply: (init) => ({
    body: JSON.parse(String(init?.body)).email === "admin01@campusfix.test" ? ADMIN : REPORTER,
  }),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("logout", () => {
  it("empties the cache before the next account signs in", async () => {
    const { client, stub } = renderSession([
      { match: /\/api\/me$/, reply: NO_SESSION },
      loginRoute,
      { match: /\/api\/tickets\/42$/, reply: () => ({ body: { id: 42, internal_note: "ADMIN ONLY" } }) },
    ]);
    await screen.findByTestId("session");
    expect(screen.getByTestId("session").textContent).toBe("no-session");

    await userEvent.click(screen.getByRole("button", { name: "Sign in as admin" }));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("signed-in:Admin Ada"));
    await waitFor(() => expect(client.getQueryData(TICKET_KEY)).toMatchObject({ internal_note: "ADMIN ONLY" }));

    const getsAtLogout = ticketGetCount(stub.calls);
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("no-session"));
    // The admin's data is gone, not merely hidden: reporter must refetch, not inherit.
    expect(client.getQueryData(TICKET_KEY)).toBeUndefined();
    expect(client.getQueryCache().getAll().every((entry) => entry.state.data === undefined)).toBe(true);
    expect(client.getMutationCache().getAll()).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Sign in as reporter" }));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("signed-in:Reporter Rep"));
    await waitFor(() => expect(client.getQueryData(TICKET_KEY)).toMatchObject({ internal_note: "ADMIN ONLY" }));
    expect(ticketGetCount(stub.calls)).toBeGreaterThan(getsAtLogout);
  });

  it("clears the session even when logout fails in transit", async () => {
    const { client } = renderSession([
      { match: /\/api\/me$/, reply: () => ({ body: ADMIN }) },
      { match: /\/api\/auth\/logout$/, method: "POST", reply: () => ({ status: 500, body: { error: { code: "INTERNAL_ERROR", message: "Boom.", request_id: "r", field_errors: [] } } }) },
      { match: /\/api\/tickets\/42$/, reply: () => ({ body: { id: 42 } }) },
    ]);
    await waitFor(() => expect(client.getQueryData(TICKET_KEY)).toMatchObject({ id: 42 }));

    await userEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("no-session"));
    expect(client.getQueryData(TICKET_KEY)).toBeUndefined();
  });
});

describe("a mid-session 401", () => {
  it("empties the cache, not just the login state", async () => {
    let ticketGets = 0;
    const { client } = renderSession([
      { match: /\/api\/me$/, reply: () => ({ body: ADMIN }) },
      {
        match: /\/api\/tickets\/42$/,
        reply: () => {
          ticketGets += 1;
          return ticketGets === 1 ? { body: { id: 42, internal_note: "visible" } } : NO_SESSION();
        },
      },
    ]);
    await waitFor(() => expect(client.getQueryData(TICKET_KEY)).toMatchObject({ internal_note: "visible" }));

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("no-session"));
    expect(client.getQueryData(TICKET_KEY)).toBeUndefined();
    expect(client.getQueryCache().getAll().every((entry) => entry.state.data === undefined)).toBe(true);
  });
});

describe("a request in flight at the boundary", () => {
  it("cannot repopulate the cache or 401 the next session away", async () => {
    // The admin's detail request is slow and answers 401 — as if the cookie died
    // mid-flight. Logout must abort it: the response must never be processed, so the
    // reporter who signs in next keeps their session and their own fresh data.
    let ticketGets = 0;
    const { client, stub } = renderSession([
      { match: /\/api\/me$/, reply: NO_SESSION },
      loginRoute,
      {
        match: /\/api\/tickets\/42$/,
        reply: () => {
          ticketGets += 1;
          return ticketGets === 1
            ? { ...NO_SESSION(), delayMs: 300 }
            : { body: { id: 42, internal_note: "REPORTER VIEW" } };
        },
      },
    ]);
    await screen.findByTestId("session");

    await userEvent.click(screen.getByRole("button", { name: "Sign in as admin" }));
    await waitFor(() => expect(ticketGetCount(stub.calls)).toBe(1)); // in flight

    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("no-session"));

    await userEvent.click(screen.getByRole("button", { name: "Sign in as reporter" }));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("signed-in:Reporter Rep"));
    await waitFor(() => expect(client.getQueryData(TICKET_KEY)).toMatchObject({ internal_note: "REPORTER VIEW" }));

    // Past the point where the aborted request would have answered 401.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.getByTestId("session").textContent).toBe("signed-in:Reporter Rep");
    expect(client.getQueryData(TICKET_KEY)).toMatchObject({ internal_note: "REPORTER VIEW" });
  });

  it("discards a boot probe that settles after a newer login", async () => {
    // /api/me is slow; a faster login must win, and the probe's late answer — an
    // account the app already moved past — must not resurrect it.
    renderSession([
      { match: /\/api\/me$/, reply: () => ({ body: ADMIN, delayMs: 200 }) },
      loginRoute,
    ]);
    await screen.findByTestId("session");

    await userEvent.click(screen.getByRole("button", { name: "Sign in as reporter" }));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("signed-in:Reporter Rep"));

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.getByTestId("session").textContent).toBe("signed-in:Reporter Rep");
  });
});

describe("switching accounts", () => {
  it("clears residual cache at the login boundary itself", async () => {
    const { client } = renderSession([
      { match: /\/api\/me$/, reply: NO_SESSION },
      loginRoute,
      { match: /\/api\/tickets\/42$/, reply: () => ({ body: { id: 42, internal_note: "fresh" } }) },
    ]);
    await screen.findByTestId("session");

    // Simulates whatever the previous session left behind — the login boundary must
    // not depend on every earlier path having cleaned up. The key is observer-less on
    // purpose: nothing will ever refetch it, so only a real reset removes it.
    await userEvent.click(screen.getByRole("button", { name: "Seed residual cache" }));
    expect(client.getQueryData(RESIDUAL_KEY)).toMatchObject({ residual: true });

    await userEvent.click(screen.getByRole("button", { name: "Sign in as reporter" }));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("signed-in:Reporter Rep"));
    expect(client.getQueryData(RESIDUAL_KEY)).toBeUndefined();
    // The reporter's own data arrives from a fresh fetch, not from the old cache.
    expect(client.getQueryData(TICKET_KEY)).toMatchObject({ internal_note: "fresh" });
  });
});

describe("a signal-less request's late 401 (#68 review)", () => {
  it("cannot end the session that replaced its own", async () => {
    // Mutations carry no AbortSignal, so logout cannot cancel them the way it cancels
    // queries. The guard is the generation stamp in client.ts: this slow write was
    // issued by the admin session, so its 401 — landing after the reporter already
    // signed in — describes an ended session and must be dropped instead of ending the
    // reporter's fresh one.
    const { stub } = renderSession([
      { match: /\/api\/me$/, reply: NO_SESSION },
      loginRoute,
      { match: /\/api\/tickets$/, method: "POST", reply: () => ({ ...NO_SESSION(), delayMs: 300 }) },
      { match: /\/api\/tickets\/42$/, reply: () => ({ body: { id: 42, internal_note: "REPORTER VIEW" } }) },
    ]);
    await screen.findByTestId("session");

    await userEvent.click(screen.getByRole("button", { name: "Sign in as admin" }));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("signed-in:Admin Ada"));

    const slowWrite = http.post("/api/tickets").catch(() => undefined);
    await waitFor(() => expect(stub.calls.some((c) => c.method === "POST" && /\/api\/tickets$/.test(c.url))).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("no-session"));
    await userEvent.click(screen.getByRole("button", { name: "Sign in as reporter" }));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("signed-in:Reporter Rep"));

    await slowWrite; // the old write's 401 lands here
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.getByTestId("session").textContent).toBe("signed-in:Reporter Rep");
  });
});
