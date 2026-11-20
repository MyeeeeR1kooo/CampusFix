import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../app/App";
import { api, http } from "../api";
import { installMock } from "../api/mockBridge";
import { MOCK_PASSWORD } from "../mocks/fixtures";
import { createMockApi } from "../mocks/responder";

let mock: ReturnType<typeof createMockApi>;
const login = (email = "admin01@campusfix.test") => api.login({ email, password: MOCK_PASSWORD });
function openQueue() { window.history.replaceState({}, "", "/workbench"); return render(<App />); }
beforeEach(() => {
  vi.stubEnv("VITE_USE_MOCK", "1");
  mock = createMockApi({ now: () => new Date("2026-10-03T10:00:00Z") });
  installMock(mock.responder);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});
afterEach(() => { cleanup(); installMock(null); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function reviewFirstTicket() {
  await login(); openQueue();
  await userEvent.click(await screen.findByRole("link", { name: "Classroom lights flicker" }));
  await userEvent.click(await screen.findByRole("button", { name: "Review" }));
  return screen.getByRole("dialog");
}

describe("#52 review queue and review actions", () => {
  it("approves from the queue with category, priority and version, records the event and removes the row", async () => {
    const dialog = await reviewFirstTicket();
    await userEvent.selectOptions(within(dialog).getByLabelText(/Category/), "HVAC");
    await userEvent.selectOptions(within(dialog).getByLabelText(/Priority/), "HIGH");
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await screen.findByText("Reviewed — approved for assignment");
    expect(await api.getTicket(1)).toMatchObject({ category: "HVAC", priority: "HIGH", status: "PENDING_ASSIGNMENT", version: 2 });
    await userEvent.click(screen.getByRole("link", { name: "← Back" }));
    await screen.findByRole("link", { name: "Second floor door handle sticks" });
    expect(screen.queryByRole("link", { name: "Classroom lights flicker" })).not.toBeInTheDocument();
  });

  it("requires a rejection reason and displays the rejected event", async () => {
    const dialog = await reviewFirstTicket();
    await userEvent.selectOptions(within(dialog).getByLabelText("Decision"), "REJECT");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(await within(dialog).findByText("Enter a rejection reason.")).toBeInTheDocument();
    expect((await api.getTicket(1)).version).toBe(1);
    await userEvent.type(within(dialog).getByLabelText(/Rejection reason/), "Outside facilities scope");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("Outside facilities scope")).toBeInTheDocument();
    expect((await api.getTicket(1)).status).toBe("REJECTED");
  });

  it("pages with server cursors and resets the cursor when applying priority", async () => {
    await login("reporter01@campusfix.test");
    for (let i = 0; i < 21; i++) await api.createTicket({ title: `Extra ${i}`, description: "A fictional repair", category: "HVAC", location_id: 1 });
    await login();
    const paths: string[] = [];
    installMock((request) => { paths.push(request.path); return mock.responder(request); });
    openQueue();
    await screen.findByRole("link", { name: "Extra 20" });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("link", { name: "Classroom lights flicker" });
    expect(paths.some((path) => path.includes("cursor="))).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "HIGH");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("No tickets in review queue.")).toBeInTheDocument();
    const last = new URL(paths.filter((path) => path.startsWith("/api/tickets?")).at(-1)!, "http://localhost");
    expect(last.searchParams.get("status")).toBe("SUBMITTED");
    expect(last.searchParams.get("priority")).toBe("HIGH");
    expect(last.searchParams.has("cursor")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByRole("link", { name: "Extra 20" })).toBeInTheDocument();
  });

  it("closes a stale review after a concurrent approval and refreshes the detail", async () => {
    const dialog = await reviewFirstTicket();
    await userEvent.selectOptions(within(dialog).getByLabelText(/Category/), "HVAC");
    await userEvent.selectOptions(within(dialog).getByLabelText(/Priority/), "LOW");
    await api.reviewTicket(1, { decision: "APPROVE", category: "FURNITURE", priority: "HIGH", expected_version: 1 });
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: "Assign" })).toBeInTheDocument();
    expect((await api.getTicket(1)).category).toBe("FURNITURE");
    expect(screen.getByText(/updated by someone else/i)).toBeInTheDocument();
  });

  it("shows retry on list failures without showing stale rows", async () => {
    await login(); let fail = true;
    installMock((request) => request.path.startsWith("/api/tickets?") && fail
      ? new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Queue unavailable", request_id: "queue", field_errors: [] } }), { status: 500 })
      : mock.responder(request));
    openQueue();
    expect(await screen.findByText("Queue unavailable", {}, { timeout: 4000 })).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Classroom lights flicker" })).toBeInTheDocument();
  });

  it("offers only contract priorities and refuses an invalid priority without updating the ticket", async () => {
    const dialog = await reviewFirstTicket();
    expect(new Set(within(dialog).getAllByRole("option").filter((option) => option.parentElement?.id === "review-priority").map((option) => (option as HTMLOptionElement).value))).toEqual(new Set(["", "LOW", "MEDIUM", "HIGH"]));
    await expect(http.post("/api/tickets/1/review", { decision: "APPROVE", category: "HVAC", priority: "URGENT", expected_version: 1 })).rejects.toMatchObject({ status: 422 });
    expect((await api.getTicket(1)).version).toBe(1);
  });

  it.each(["reporter01@campusfix.test", "technician01@campusfix.test"])("denies the workbench and review operation to %s", async (email) => {
    await login(email); openQueue();
    expect(await screen.findByRole("heading", { name: /don't have access/i })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Review queue" })).not.toBeInTheDocument();
    const id = email.startsWith("technician") ? 3 : 1;
    await expect(api.reviewTicket(id, { decision: "APPROVE", category: "HVAC", priority: "LOW", expected_version: 1 })).rejects.toMatchObject({ status: 403 });
  });
});
