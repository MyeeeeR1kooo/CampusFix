/**
 * The scaffold as a running app (#48's "npm run dev 能起，路由可用").
 *
 * Everything else in this suite tests a module in isolation. This file mounts `App` and
 * checks the four claims the scaffold is actually judged on:
 *
 *   • the route table reaches all nine Baseline §13.1 pages, and gates them by role;
 *   • an unbuilt page names its owner instead of looking like a finished screen;
 *   • the login form is React Hook Form + Zod, and Zod's message is what the user sees;
 *   • a successful login lands on that role's page using the contract's bare `User`.
 *
 * A 401 *during* login must not clear a session nobody had yet — the generic refusal is
 * rendered and the user stays on the form. That is where §13.3 and the login page could
 * otherwise collide.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../app/App";
import { stubApi, userPayload } from "../test-helpers";

type TestRole = "REPORTER" | "TECHNICIAN" | "ADMIN";

const NO_SESSION = {
  status: 401,
  body: { error: { code: "UNAUTHORIZED", message: "No session.", request_id: "r", field_errors: [] } },
};

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

/** A session for `GET /api/me`, so the guarded half of the route table is reachable. */
function signedInAs(role: TestRole) {
  return stubApi([
    { match: /\/api\/me$/, reply: () => ({ body: userPayload({ id: 3, name: `${role} user`, role }) }) },
  ]);
}

function anonymous() {
  return stubApi([{ match: /\/api\/me$/, reply: () => NO_SESSION }]);
}

const notBuilt = (label: string) => new RegExp(`${label} is not built yet`, "i");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("anonymous visitors", () => {
  it("land on the login page from the root", async () => {
    anonymous();
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeTruthy();
  });

  it("learn nothing about which routes exist", async () => {
    // The 404 page sits behind the session on purpose: an unauthenticated probe of
    // /admin/users gets the login page, not a hint that the path is real.
    anonymous();
    renderAt("/definitely-not-a-page");
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByText(notBuilt("Account management"))).toBeNull();
  });
});

describe("the route table — all nine pages declared, one built", () => {
  const guarded: Array<[string, TestRole, string]> = [
    ["/reports", "REPORTER", "My reports"],
    ["/reports/new", "REPORTER", "Create a repair report"],
    ["/tickets/7", "REPORTER", "Ticket detail"],
    ["/workbench", "ADMIN", "Dispatch workbench"],
    ["/analytics", "ADMIN", "Statistics"],
    ["/locations", "ADMIN", "Location management"],
    ["/admin/users", "ADMIN", "Account management"],
    ["/assignments", "TECHNICIAN", "My assignments"],
  ];

  it.each(guarded)("%s as %s renders a page that names its owner", async (path, role, label) => {
    signedInAs(role);
    renderAt(path);
    expect(await screen.findByRole("heading", { name: notBuilt(label) })).toBeTruthy();
    // "a blank page reads like a working page" — the stand-in must say who fills it.
    expect(document.body.textContent).toMatch(/owned by (张越|舒玺悦)/);
  });

  it("refuses a role that does not own the page", async () => {
    signedInAs("REPORTER");
    renderAt("/admin/users");
    expect(await screen.findByRole("heading", { name: /don't have access/i })).toBeTruthy();
    expect(screen.queryByText(notBuilt("Account management"))).toBeNull();
  });

  it("serves the login page itself", async () => {
    anonymous();
    renderAt("/login");
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeTruthy();
  });
});

describe("landing pages", () => {
  it.each<[TestRole, string]>([
    ["ADMIN", "Dispatch workbench"],
    ["TECHNICIAN", "My assignments"],
    ["REPORTER", "My reports"],
  ])("%s starts at %s", async (role, label) => {
    signedInAs(role);
    renderAt("/");
    expect(await screen.findByRole("heading", { name: notBuilt(label) })).toBeTruthy();
  });
});

describe("the login form (RHF + Zod, §13.2)", () => {
  it("blocks a malformed email before any request leaves the browser", async () => {
    const api = anonymous();
    renderAt("/login");

    await userEvent.type(screen.getByLabelText(/Email/), "not-an-email");
    await userEvent.type(screen.getByLabelText(/Password/), "whatever");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(api.calls.filter((c) => c.url === "/api/auth/login")).toHaveLength(0);
  });

  it("blocks an empty password too", async () => {
    const api = anonymous();
    renderAt("/login");

    await userEvent.type(screen.getByLabelText(/Email/), "reporter01@campusfix.test");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(api.calls.filter((c) => c.url === "/api/auth/login")).toHaveLength(0);
  });

  it("posts exactly the contract's body and lands on the role's page", async () => {
    const api = stubApi([
      { match: /\/api\/me$/, reply: () => NO_SESSION },
      { match: /\/api\/auth\/login$/, method: "POST", reply: () => ({ body: userPayload({ role: "ADMIN" }) }) },
    ]);
    renderAt("/login");

    await userEvent.type(screen.getByLabelText(/Email/), "admin01@campusfix.test");
    await userEvent.type(screen.getByLabelText(/Password/), "demo-password");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { name: notBuilt("Dispatch workbench") })).toBeTruthy();
    const request = api.calls.find((c) => c.url === "/api/auth/login");
    expect(request?.method).toBe("POST");
    // No actor, no role, no token: identity is the cookie's business.
    expect(JSON.parse(String(request?.body))).toEqual({
      email: "admin01@campusfix.test",
      password: "demo-password",
    });
  });

  it("shows one generic refusal for a bad password and keeps the user on the form", async () => {
    stubApi([
      { match: /\/api\/me$/, reply: () => NO_SESSION },
      {
        match: /\/api\/auth\/login$/,
        method: "POST",
        reply: () => ({
          status: 401,
          body: { error: { code: "UNAUTHORIZED", message: "Email or password is not correct.", request_id: "r", field_errors: [] } },
        }),
      },
    ]);
    renderAt("/login");

    await userEvent.type(screen.getByLabelText(/Email/), "reporter01@campusfix.test");
    await userEvent.type(screen.getByLabelText(/Password/), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Email or password is not correct.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("renders server field errors beside the field, not as a banner", async () => {
    stubApi([
      { match: /\/api\/me$/, reply: () => NO_SESSION },
      {
        match: /\/api\/auth\/login$/,
        method: "POST",
        reply: () => ({
          status: 422,
          body: {
            error: {
              code: "VALIDATION_ERROR",
              message: "Input validation failed.",
              request_id: "r",
              field_errors: [{ field: "email", message: "该账号不存在", type: "not_found" }],
            },
          },
        }),
      },
    ]);
    renderAt("/login");

    await userEvent.type(screen.getByLabelText(/Email/), "ghost@campusfix.test");
    await userEvent.type(screen.getByLabelText(/Password/), "whatever");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    const email = screen.getByLabelText(/Email/);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("login-email-error")?.textContent).toBe("该账号不存在");
  });

  it("re-validates after a correction instead of pinning the first message", async () => {
    stubApi([
      { match: /\/api\/me$/, reply: () => NO_SESSION },
      {
        match: /\/api\/auth\/login$/,
        method: "POST",
        reply: () => ({
          status: 401,
          body: { error: { code: "UNAUTHORIZED", message: "Email or password is not correct.", request_id: "r", field_errors: [] } },
        }),
      },
    ]);
    renderAt("/login");

    await userEvent.type(screen.getByLabelText(/Email/), "bad-email");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(document.getElementById("login-email-error")).not.toBeNull());

    await userEvent.clear(screen.getByLabelText(/Email/));
    await userEvent.type(screen.getByLabelText(/Email/), "reporter01@campusfix.test");

    // Asserted by the message element, not by its text: Zod's default copy is a library
    // detail, and a test that pins it breaks when the library rewords it.
    await waitFor(() => expect(document.getElementById("login-email-error")).toBeNull());
  });
});

describe("signing out", () => {
  it("posts to the contract's logout and returns to the login page", async () => {
    const api = stubApi([
      { match: /\/api\/me$/, reply: () => ({ body: userPayload({ id: 3, name: "reporter", role: "REPORTER" }) }) },
      // 204 with no body: the client must not try to read JSON, and the UI must not wait
      // on the response to clear the session.
      { match: /\/api\/auth\/logout$/, method: "POST", reply: () => ({ status: 204, body: undefined }) },
    ]);
    renderAt("/reports");

    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeTruthy();
    expect(api.calls.some((c) => c.url === "/api/auth/logout" && c.method === "POST")).toBe(true);
  });

  it("clears the session even when logout fails in transit", async () => {
    stubApi([
      { match: /\/api\/me$/, reply: () => ({ body: userPayload({ id: 3, name: "reporter", role: "REPORTER" }) }) },
      {
        match: /\/api\/auth\/logout$/,
        method: "POST",
        reply: () => ({ status: 500, body: { error: { code: "INTERNAL_ERROR", message: "Boom.", request_id: "r", field_errors: [] } } }),
      },
    ]);
    renderAt("/reports");

    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));

    // A user who pressed Log out is logged out in the UI, whatever the server said.
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeTruthy();
  });
});
