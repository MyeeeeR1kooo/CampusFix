import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../app/App";
import { api } from "../api";
import { installMock } from "../api/mockBridge";
import { MOCK_PASSWORD } from "../mocks/fixtures";
import { createMockApi } from "../mocks/responder";

const now = new Date("2026-10-03T10:00:00Z");
const ticketId = 5;
const ticketPath = `/tickets/${ticketId}`;
const apiPath = `/api${ticketPath}`;
const ownerEmail = "reporter01@campusfix.test";
const otherReporterEmail = "reporter02@campusfix.test";

function installTicketMock(clock = () => now) {
  vi.stubEnv("VITE_USE_MOCK", "1");
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("The test attempted a network request outside the Mock layer");
  }));
  const { responder } = createMockApi({ now: clock });
  installMock(responder);
  return responder;
}

async function openTicket(email = ownerEmail) {
  await api.login({ email, password: MOCK_PASSWORD });
  window.history.replaceState({}, "", ticketPath);
  render(<App />);
}

afterEach(() => {
  cleanup();
  installMock(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("reporter confirmation and rework (#57)", () => {
  it("blocks a repeated submit and reuses the confirmation key and version after a lost response", async () => {
    let currentTime = now;
    const responder = installTicketMock(() => currentTime);
    const submissions: unknown[] = [];
    const backendStatuses: Array<number | undefined> = [];
    let release!: () => void;
    const firstResponseGate = new Promise<void>((resolve) => { release = resolve; });
    installMock(async (request) => {
      if (request.method !== "POST" || request.path !== `${apiPath}/confirm`) {
        return responder(request);
      }
      submissions.push(request.json);
      const firstAttempt = submissions.length === 1;
      const response = await responder(request);
      backendStatuses.push(response?.status);
      if (firstAttempt) {
        await firstResponseGate;
        throw new TypeError("Connection dropped after the server confirmed.");
      }
      return response;
    });

    await openTicket();
    const confirm = await screen.findByRole("button", { name: "Confirm completion" });
    const before = await api.getTicket(ticketId);
    const user = userEvent.setup();
    await user.click(confirm);
    const dialog = within(screen.getByRole("dialog"));
    try {
      await user.click(dialog.getByRole("button", { name: "Confirm completion" }));
      const pendingButton = await dialog.findByRole("button", { name: "Submitting…" });
      expect(pendingButton).toBeDisabled();
      await user.click(pendingButton);
      await waitFor(() => expect(backendStatuses).toEqual([200]));
      expect(submissions).toHaveLength(1);
      expect(submissions[0]).toEqual({
        expected_version: before.version,
        idempotency_key: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
      });
    } finally {
      release();
    }

    expect(await dialog.findByRole("alert")).toHaveTextContent("Connection dropped after the server confirmed.");
    const firstCommit = await api.getTicket(ticketId);
    expect(firstCommit).toMatchObject({ status: "CLOSED", version: before.version + 1, closed_at: now.toISOString() });
    currentTime = new Date(now.getTime() + 1000);

    await user.click(dialog.getByRole("button", { name: "Confirm completion" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Ticket status and responsibility" })).toHaveTextContent("Closed");
    });
    expect(submissions).toEqual([submissions[0], submissions[0]]);
    expect(backendStatuses).toEqual([200, 200]);
    expect(screen.queryByRole("button", { name: "Confirm completion" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request rework" })).not.toBeInTheDocument();
    const timeline = within(screen.getByRole("region", { name: "Timeline" }));
    expect(timeline.getAllByText("Confirmed — closed")).toHaveLength(1);
    const afterRetry = await api.getTicket(ticketId);
    expect(afterRetry).toEqual(firstCommit);
    expect(afterRetry.timeline.filter((entry) => entry.kind === "EVENT" && entry.type === "TICKET_CLOSED"))
      .toHaveLength(1);
  });

  it("requires a reason and refreshes the status, actions and timeline when rework is requested", async () => {
    const responder = vi.fn(installTicketMock());
    installMock(responder);
    await openTicket();
    const rework = await screen.findByRole("button", { name: "Request rework" });
    const before = await api.getTicket(ticketId);
    const user = userEvent.setup();
    await user.click(rework);
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Request rework" }));
    expect(await dialog.findByText("Enter a reason so the technician knows what to fix.")).toBeInTheDocument();
    expect(responder).not.toHaveBeenCalledWith(expect.objectContaining({
      method: "POST", path: `${apiPath}/rework`,
    }));

    const reason = "The window still sticks when it is almost closed.";
    await user.type(dialog.getByLabelText(/What still needs fixing/), reason);
    await user.click(dialog.getByRole("button", { name: "Request rework" }));

    const timeline = within(screen.getByRole("region", { name: "Timeline" }));
    expect(await timeline.findByText(reason)).toBeInTheDocument();
    expect(timeline.getAllByText("Rework requested")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Ticket status and responsibility" })).toHaveTextContent("In Progress");
    expect(screen.queryByRole("button", { name: "Confirm completion" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request rework" })).not.toBeInTheDocument();
    expect(responder).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST", path: `${apiPath}/rework`,
      json: { reason, expected_version: before.version },
    }));
    await expect(api.getTicket(ticketId)).resolves.toMatchObject({
      status: "IN_PROGRESS",
      version: before.version + 1,
      closed_at: null,
      current_assignee: before.current_assignee,
      assignments: before.assignments,
    });
  });

  it("hides a pending ticket and both actions from a different reporter", async () => {
    installTicketMock();
    await openTicket(otherReporterEmail);

    // The shared query client retries once before rendering its not-found state.
    expect(await screen.findByRole(
      "heading",
      { name: "This page is not available" },
      { timeout: 4000 },
    )).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm completion" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request rework" })).not.toBeInTheDocument();
  });
});
