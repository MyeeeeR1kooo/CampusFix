import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../app/App";
import { api } from "../api";
import { installMock } from "../api/mockBridge";
import { MOCK_PASSWORD } from "../mocks/fixtures";
import { createMockApi } from "../mocks/responder";

let mock: ReturnType<typeof createMockApi>;
const login = (email = "admin01@campusfix.test") => api.login({ email, password: MOCK_PASSWORD });
function openQueue(path = "/workbench?queue=assignment") { window.history.replaceState({}, "", path); return render(<App />); }
beforeEach(() => {
  vi.stubEnv("VITE_USE_MOCK", "1");
  mock = createMockApi({ now: () => new Date("2026-10-03T10:00:00Z") });
  installMock(mock.responder);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});
afterEach(() => { cleanup(); installMock(null); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function openAssignment() {
  await login(); openQueue();
  await userEvent.click(await screen.findByRole("link", { name: "Reading room chair is loose" }));
  await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByRole("option", { name: "Demo technician A" });
  return dialog;
}

describe("#53 assignment queue, action and history", () => {
  it("assigns to an active technician and displays the owner, assignment and timeline", async () => {
    const dialog = await openAssignment();
    expect(within(dialog).queryByRole("option", { name: "Inactive technician" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: "Demo dispatcher" })).not.toBeInTheDocument();
    expect(screen.getByText("No assignments yet.")).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText(/Technician/), "5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const owner = screen.getByRole("region", { name: "Ticket status and responsibility" });
    expect(owner).toHaveTextContent("Demo technician B");
    const records = screen.getByRole("table", { name: "Assignment records" });
    expect(records).toHaveTextContent("Demo technician B");
    expect(records).toHaveTextContent("Demo dispatcher");
    expect(screen.getByRole("list", { name: "Ticket timeline" })).toHaveTextContent("Assigned");
    const ticket = await api.getTicket(2);
    expect(ticket).toMatchObject({ status: "ASSIGNED", current_assignee: { id: 5 } });
    expect(ticket.assignments).toHaveLength(1);
    expect(ticket.assignments[0].ended_at).toBeNull();
    await userEvent.click(screen.getByRole("link", { name: "← Back" }));
    await userEvent.click(screen.getByRole("link", { name: "Pending assignment" }));
    expect(await screen.findByText("No tickets in pending assignment.")).toBeInTheDocument();
  });

  it("rejects a stale concurrent assignment and preserves the single winning owner", async () => {
    const dialog = await openAssignment();
    await userEvent.selectOptions(within(dialog).getByLabelText(/Technician/), "2");
    const before = await api.getTicket(2);
    await api.assignTicket(2, { technician_id: 5, expected_version: before.version });
    await userEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText(/updated by someone else/i)).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Assignment records" })).toHaveTextContent("Demo technician B");
    const after = await api.getTicket(2);
    expect(after.current_assignee?.id).toBe(5);
    expect(after.assignments).toHaveLength(1);
    expect(after.timeline.filter((entry) => entry.kind === "EVENT" && entry.type === "TICKET_ASSIGNED")).toHaveLength(1);
  });

  it("shows a field error if a loaded candidate is disabled, then accepts a corrected selection", async () => {
    const dialog = await openAssignment();
    await api.setUserActive(5, { active: false });
    await userEvent.selectOptions(within(dialog).getByLabelText(/Technician/), "5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(within(dialog).getByLabelText(/Technician/)).toHaveAttribute("aria-invalid", "true"));
    expect(within(dialog).getAllByRole("alert").length).toBeGreaterThanOrEqual(2);
    expect((await api.getTicket(2)).assignments).toHaveLength(0);
    await userEvent.selectOptions(within(dialog).getByLabelText(/Technician/), "2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect((await api.getTicket(2)).current_assignee?.id).toBe(2);
  });

  it("disables confirmation when no active technicians are available", async () => {
    await login();
    await api.setUserActive(2, { active: false }); await api.setUserActive(5, { active: false });
    openQueue();
    await userEvent.click(await screen.findByRole("link", { name: "Reading room chair is loose" }));
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText(/No active technicians are available/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Assign" })).toBeDisabled();
    expect((await api.getTicket(2)).status).toBe("PENDING_ASSIGNMENT");
  });

  it("retries a failed candidate query and clears filters when switching queues", async () => {
    await login(); let fail = true;
    installMock((request) => request.path.startsWith("/api/admin/users?") && fail
      ? new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Candidates unavailable", request_id: "users", field_errors: [] } }), { status: 500 })
      : mock.responder(request));
    openQueue("/workbench");
    await screen.findByRole("link", { name: "Classroom lights flicker" });
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "HIGH");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await screen.findByText("No tickets in review queue.");
    await userEvent.click(screen.getByRole("link", { name: "Pending assignment" }));
    await userEvent.click(await screen.findByRole("link", { name: "Reading room chair is loose" }));
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("Candidates unavailable", {}, { timeout: 4000 });
    expect(within(dialog).getByRole("button", { name: "Assign" })).toBeDisabled();
    fail = false;
    await userEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect(await within(dialog).findByRole("option", { name: "Demo technician A" })).toBeInTheDocument();
  });

  it.each(["reporter01@campusfix.test", "technician01@campusfix.test"])("denies assignment queue and action to %s", async (email) => {
    await login(email); openQueue();
    expect(await screen.findByRole("heading", { name: /don't have access/i })).toBeInTheDocument();
    const id = email.startsWith("technician") ? 3 : 2;
    await expect(api.assignTicket(id, { technician_id: 2, expected_version: 1 })).rejects.toMatchObject({ status: 403 });
  });
});
