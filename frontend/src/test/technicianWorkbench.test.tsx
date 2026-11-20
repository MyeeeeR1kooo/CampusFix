import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../app/App";
import { api } from "../api";
import { installMock } from "../api/mockBridge";
import { PRIORITY_LABELS, STATUS_LABELS } from "../lib/labels";
import { MOCK_PASSWORD } from "../mocks/fixtures";
import { createMockApi } from "../mocks/responder";

const NOW = new Date("2026-10-03T10:00:00Z");
let mock: ReturnType<typeof createMockApi>;
let listPaths: string[];
const signIn = (email = "technician01@campusfix.test") => api.login({ email, password: MOCK_PASSWORD });
function openWorkbench() { window.history.replaceState({}, "", "/assignments"); return render(<App />); }

beforeEach(() => {
  vi.stubEnv("VITE_USE_MOCK", "1");
  mock = createMockApi({ now: () => NOW });
  listPaths = [];
  installMock((request) => {
    if (request.path.startsWith("/api/tickets?")) listPaths.push(request.path);
    return mock.responder(request);
  });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});
afterEach(() => { cleanup(); installMock(null); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("#55 technician workbench — FR-04 / UC-03 entry", () => {
  it("renders only A's assignments with status, snapshot, priority, reported time and detail links, including closed tickets", async () => {
    await signIn();
    const expected = (await api.listTickets()).items;
    openWorkbench();
    const table = await screen.findByRole("table", { name: "My assigned tickets" });
    await within(table).findByRole("link", { name: "Washroom tap keeps dripping" });
    expect(within(table).getAllByRole("row")).toHaveLength(expected.length + 1);
    for (const ticket of expected) {
      const link = within(table).getByRole("link", { name: ticket.title });
      expect(link).toHaveAttribute("href", `/tickets/${ticket.id}`);
      const row = link.closest("tr")!;
      expect(row).toHaveTextContent(ticket.code);
      expect(row).toHaveTextContent(STATUS_LABELS[ticket.status]);
      expect(row).toHaveTextContent(ticket.location_label_snapshot);
      expect(row).toHaveTextContent(PRIORITY_LABELS[ticket.priority!]);
      expect(row.querySelector("time")).toHaveAttribute("datetime", ticket.created_at);
    }
    expect(within(table).getByText("Closed")).toBeInTheDocument();
    expect(within(table).queryByRole("link", { name: "Corridor lamp needs replacement" })).not.toBeInTheDocument();
    await expect(api.getTicket(10)).rejects.toMatchObject({ status: 404 });
    await userEvent.click(within(table).getByRole("link", { name: "Washroom tap keeps dripping" }));
    expect(await screen.findByRole("heading", { name: "Washroom tap keeps dripping" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "← Back" }));
    expect(await screen.findByRole("heading", { name: "My assignments" })).toBeInTheDocument();
  });

  it("uses session-scoped server queries and status filters without sending an actor or admin-only assignee filter", async () => {
    await signIn(); openWorkbench();
    await screen.findByRole("link", { name: "Washroom tap keeps dripping" });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "ASSIGNED");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Air conditioner makes a rattling noise" })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Washroom tap keeps dripping" })).toBeInTheDocument();
    const params = new URL(listPaths.at(-1)!, "http://localhost").searchParams;
    expect([...params.keys()].sort()).toEqual(["limit", "status"]);
    expect(params.get("status")).toBe("ASSIGNED");
    expect(params.get("limit")).toBe("20");
    await userEvent.selectOptions(screen.getByLabelText("Status"), "REJECTED");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("No assigned tickets match this status.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByRole("link", { name: "Air conditioner makes a rattling noise" })).toBeInTheDocument();
  });

  it("walks server cursor pages, goes back, and resets the cursor on a filter change", async () => {
    await signIn("reporter01@campusfix.test");
    const created = [];
    for (let index = 0; index < 21; index++) created.push(await api.createTicket({ title: `New assignment ${index}`, description: "Fictional repair", category: "HVAC", location_id: 1 }));
    await signIn("admin01@campusfix.test");
    for (const ticket of created) {
      const reviewed = await api.reviewTicket(ticket.id, { decision: "APPROVE", category: "HVAC", priority: "LOW", expected_version: ticket.version });
      await api.assignTicket(ticket.id, { technician_id: 2, expected_version: reviewed.version });
    }
    await signIn(); openWorkbench();
    await screen.findByRole("link", { name: "New assignment 20" });
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("link", { name: "Washroom tap keeps dripping" });
    expect(new URL(listPaths.at(-1)!, "http://localhost").searchParams.has("cursor")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByRole("link", { name: "New assignment 20" });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("link", { name: "Washroom tap keeps dripping" });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "ASSIGNED");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByRole("link", { name: "New assignment 20" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(new URL(listPaths.at(-1)!, "http://localhost").searchParams.has("cursor")).toBe(false);
  });

  it("shows the empty state when the technician has no tickets", async () => {
    mock = createMockApi({ now: () => NOW, emptyTickets: true });
    await signIn(); openWorkbench();
    expect(await screen.findByText("No tickets are assigned to you yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows a loading state without partial rows and retries list failures", async () => {
    await signIn(); let release: (() => void) | undefined;
    installMock((request) => request.path.startsWith("/api/tickets?")
      ? new Promise<Response>((resolve) => { release = () => resolve(new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Assignments unavailable", request_id: "workbench", field_errors: [] } }), { status: 500 })); })
      : mock.responder(request));
    openWorkbench();
    const loadingTable = await screen.findByRole("table", { name: "My assigned tickets" });
    expect(within(loadingTable).getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByRole("link", { name: "Washroom tap keeps dripping" })).not.toBeInTheDocument();
    await act(async () => { release?.(); });
    // The app retries once; release that request as well.
    const first = release;
    await waitFor(() => expect(release).not.toBe(first), { timeout: 3000 });
    await act(async () => { release?.(); });
    expect(await screen.findByText("Assignments unavailable")).toBeInTheDocument();
    installMock(mock.responder);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Washroom tap keeps dripping" })).toBeInTheDocument();
  });

  it("redirects an anonymous visitor without requesting the list, and the API rejects the missing session", async () => {
    openWorkbench();
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(listPaths).toHaveLength(0);
    await expect(api.listTickets()).rejects.toMatchObject({ status: 401 });
  });

  it.each(["reporter01@campusfix.test", "admin01@campusfix.test"])("denies the technician route to %s before loading a list", async (email) => {
    await signIn(email); openWorkbench();
    expect(await screen.findByRole("heading", { name: /don't have access/i })).toBeInTheDocument();
    expect(listPaths).toHaveLength(0);
  });

  it("hides cached rows when the server denies the next list request", async () => {
    await signIn(); openWorkbench();
    await screen.findByRole("link", { name: "Washroom tap keeps dripping" });
    installMock((request) => request.path.startsWith("/api/tickets?")
      ? new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Not allowed", request_id: "denied", field_errors: [] } }), { status: 403 })
      : mock.responder(request));
    await userEvent.selectOptions(screen.getByLabelText("Status"), "ASSIGNED");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByRole("heading", { name: /don't have access/i }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "My assigned tickets" })).not.toBeInTheDocument();
  });

  it("returns to login when the session expires during a list request", async () => {
    await signIn(); openWorkbench();
    await screen.findByRole("link", { name: "Washroom tap keeps dripping" });
    installMock(createMockApi({ now: () => NOW }).responder);
    await userEvent.selectOptions(screen.getByLabelText("Status"), "ASSIGNED");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "My assigned tickets" })).not.toBeInTheDocument();
  });

  it("clears A's cached tasks before B logs in and displays only B's assignment", async () => {
    await signIn(); openWorkbench();
    await screen.findByRole("link", { name: "Washroom tap keeps dripping" });
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    await screen.findByRole("heading", { name: "Log in" });
    await userEvent.type(screen.getByLabelText(/Email/), "technician02@campusfix.test");
    await userEvent.type(screen.getByLabelText(/Password/), MOCK_PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    const link = await screen.findByRole("link", { name: "Corridor lamp needs replacement" });
    const table = link.closest("table")!;
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Washroom tap keeps dripping" })).not.toBeInTheDocument();
    await expect(api.getTicket(3)).rejects.toMatchObject({ status: 404 });
  });
});
