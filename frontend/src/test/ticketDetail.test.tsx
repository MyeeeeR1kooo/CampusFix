/**
 * #91 — the shared operation area and event timeline.
 *
 * The matrix below is the state machine's "who may do what" expressed as
 * server-computed `allowed_actions`; the component's only job is to project that
 * list. Visibility of the ticket itself is also server-side, so combinations the
 * mock refuses with 404 are asserted as hidden rather than as "no buttons".
 */

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../app/App";
import { ApiError, api } from "../api";
import type { Role, TicketDetail, TicketStatus } from "../api";
import { installMock } from "../api/mockBridge";
import { Timeline } from "../components";
import {
  LIFECYCLE_ACTIONS,
  TicketActionZone,
  allowedLifecycleActions,
} from "../features/tickets/TicketActionZone";
import type { LifecycleAction } from "../features/tickets/TicketActionZone";
import { ToastProvider } from "../hooks/useToast";
import { ACTION_LABELS } from "../lib/labels";
import { createAppQueryClient } from "../lib/queryClient";
import { bumpSessionVersion } from "../lib/session";
import { MOCK_PASSWORD } from "../mocks/fixtures";
import { createMockApi } from "../mocks/responder";
import { jsonResponse, userPayload } from "../test-helpers";

const NOW = new Date("2026-10-03T10:00:00Z");
const ACCOUNTS: Record<Role, string> = {
  REPORTER: "reporter01@campusfix.test",
  TECHNICIAN: "technician01@campusfix.test",
  ADMIN: "admin01@campusfix.test",
};
const TERMINAL: readonly TicketStatus[] = ["CLOSED", "REJECTED", "CANCELLED"];

function installStateMock() {
  vi.stubEnv("VITE_USE_MOCK", "1");
  const mock = createMockApi({ now: () => NOW });
  installMock(mock.responder);
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("The test attempted a network request outside the Mock layer");
  }));
  return mock.responder;
}

async function signIn(role: Role) {
  await api.login({ email: ACCOUNTS[role], password: MOCK_PASSWORD });
}

function renderZone(ticket: TicketDetail) {
  const client = createAppQueryClient({ notify: vi.fn() });
  const tree = (next: TicketDetail) => (
    <ToastProvider>
      <QueryClientProvider client={client}>
        <TicketActionZone ticket={next} />
      </QueryClientProvider>
    </ToastProvider>
  );
  const view = render(tree(ticket));
  return {
    ...view,
    rerenderTicket: (next: TicketDetail) => view.rerender(tree(next)),
  };
}

function openTicket(id: number) {
  window.history.replaceState({}, "", `/tickets/${id}`);
  return render(<App />);
}

const CASES: Array<{
  id: number;
  status: TicketStatus;
  expected: Record<Role, readonly LifecycleAction[] | "hidden">;
}> = [
  {
    id: 1,
    status: "SUBMITTED",
    expected: { REPORTER: ["CANCEL"], ADMIN: ["REVIEW"], TECHNICIAN: "hidden" },
  },
  {
    id: 2,
    status: "PENDING_ASSIGNMENT",
    expected: { REPORTER: [], ADMIN: ["ASSIGN"], TECHNICIAN: "hidden" },
  },
  {
    id: 3,
    status: "ASSIGNED",
    expected: { REPORTER: [], ADMIN: [], TECHNICIAN: ["START"] },
  },
  {
    id: 4,
    status: "IN_PROGRESS",
    expected: { REPORTER: [], ADMIN: [], TECHNICIAN: ["RESOLVE"] },
  },
  {
    id: 5,
    status: "PENDING_CONFIRMATION",
    expected: { REPORTER: ["CONFIRM", "REWORK"], ADMIN: [], TECHNICIAN: [] },
  },
  { id: 6, status: "CLOSED", expected: { REPORTER: [], ADMIN: [], TECHNICIAN: [] } },
  {
    id: 7,
    status: "REJECTED",
    expected: { REPORTER: [], ADMIN: [], TECHNICIAN: "hidden" },
  },
  {
    id: 8,
    status: "CANCELLED",
    expected: { REPORTER: [], ADMIN: [], TECHNICIAN: "hidden" },
  },
];

afterEach(() => {
  cleanup();
  installMock(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("operation area projection (#91)", () => {
  it("classifies every contract action as a lifecycle action or a conversation action", () => {
    expect(LIFECYCLE_ACTIONS).toHaveLength(7);
    expect(LIFECYCLE_ACTIONS).not.toContain("COMMENT_PUBLIC");
    expect(LIFECYCLE_ACTIONS).not.toContain("COMMENT_ADMIN_ONLY");
  });

  it.each(CASES)(
    "for $status (ticket $id), each role sees only the actions the server allows",
    async ({ id, status, expected }) => {
      installStateMock();

      for (const role of ["REPORTER", "TECHNICIAN", "ADMIN"] as const) {
        await signIn(role);
        const allowed = expected[role];

        if (allowed === "hidden") {
          await expect(api.getTicket(id)).rejects.toBeInstanceOf(ApiError);
          continue;
        }

        const ticket = await api.getTicket(id);
        expect(ticket.status).toBe(status);
        expect(allowedLifecycleActions(ticket.allowed_actions)).toEqual(allowed);
        if (TERMINAL.includes(status)) {
          expect(ticket.allowed_actions).toEqual([]);
          expect(ticket.current_responsible_role).toBeNull();
          expect(ticket.next_action).toBeNull();
        }

        cleanup();
        const view = renderZone(ticket);
        const buttons = screen.queryAllByRole("button").map((button) => button.textContent);
        expect(buttons).toEqual(allowed.map((action) => ACTION_LABELS[action]));
        // COMMENT_* belongs to #54's composer, never to the operation area.
        expect(screen.queryByRole("button", { name: ACTION_LABELS.COMMENT_PUBLIC })).toBeNull();
        expect(screen.queryByRole("button", { name: ACTION_LABELS.COMMENT_ADMIN_ONLY })).toBeNull();
        view.unmount();
      }
    },
  );

  it("renders no operation area at all for a terminal ticket", async () => {
    installStateMock();
    await signIn("ADMIN");
    const ticket = await api.getTicket(6);
    const view = renderZone(ticket);
    expect(view.container.querySelector(".action-zone")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("timeline order and visibility (#91)", () => {
  it("sorts ascending without mutating input and hides internal notes from a reporter", async () => {
    installStateMock();

    await signIn("ADMIN");
    const adminTicket = await api.getTicket(1);
    expect(adminTicket.timeline.some((entry) => entry.visibility === "ADMIN_ONLY")).toBe(true);

    await signIn("REPORTER");
    const reporterTicket = await api.getTicket(1);
    expect(reporterTicket.timeline.some((entry) => entry.visibility === "ADMIN_ONLY")).toBe(false);

    const reversed = [...reporterTicket.timeline].reverse();
    render(<Timeline entries={reversed} />);
    expect(screen.queryByText("Internal note")).not.toBeInTheDocument();
    const times = screen.getAllByRole("listitem").map(
      (row) => row.querySelector("time")?.getAttribute("datetime") ?? "",
    );
    expect(times).toEqual([...times].sort((a, b) => Date.parse(a) - Date.parse(b)));
    expect(reversed[0].id).toBe(reporterTicket.timeline.at(-1)!.id);

    cleanup();
    render(<Timeline entries={adminTicket.timeline} />);
    expect(screen.getByText("Internal note")).toBeInTheDocument();
  });
});

describe("ticket detail page (#91)", () => {
  it("only validates rejection reason length when rejecting", async () => {
    installStateMock();
    await signIn("ADMIN");
    const ticket = await api.getTicket(1);
    renderZone(ticket);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Decision" }), "REJECT");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Rejection reason (required)" }), {
      target: { value: "x".repeat(2001) },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(await within(dialog).findByText("Reason must be 2000 characters or fewer.")).toBeInTheDocument();

    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Decision" }), "APPROVE");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Category (required)" }), "LIGHTING_ELECTRICAL");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Priority (required)" }), "MEDIUM");
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.getTicket(1)).resolves.toMatchObject({ status: "PENDING_ASSIGNMENT" }));
  });

  it("shows the event note length error before starting work", async () => {
    installStateMock();
    await signIn("TECHNICIAN");
    const ticket = await api.getTicket(3);
    renderZone(ticket);
    await userEvent.click(screen.getByRole("button", { name: "Start work" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Opening note" }), {
      target: { value: "x".repeat(2001) },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Start work" }));
    expect(await within(dialog).findByText("Note must be 2000 characters or fewer.")).toBeInTheDocument();
    expect((await api.getTicket(3)).status).toBe("ASSIGNED");
  });

  it("shows status, owner, next actor and only the reporter's action", async () => {
    installStateMock();
    await signIn("REPORTER");
    openTicket(1);

    expect(await screen.findByRole("heading", { name: "Classroom lights flicker" })).toBeInTheDocument();
    const strip = screen.getByRole("region", { name: "Ticket status and responsibility" });
    expect(strip).toHaveTextContent("Submitted");
    expect(strip).toHaveTextContent("Awaiting review");
    expect(strip).toHaveTextContent("Administrator · Review");
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Assign" })).toBeNull();
    expect(screen.queryByText("Internal note")).toBeNull();
  });

  it("shows internal notes and review controls to an administrator", async () => {
    installStateMock();
    await signIn("ADMIN");
    openTicket(1);

    expect(await screen.findByRole("button", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByText("Internal note")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel request" })).toBeNull();
  });

  it("runs a state action through the shared dialog and refreshes the ticket", async () => {
    installStateMock();
    await signIn("REPORTER");
    openTicket(1);

    await userEvent.click(await screen.findByRole("button", { name: "Cancel request" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel request" }));

    await waitFor(() => {
      const strip = screen.getByRole("region", { name: "Ticket status and responsibility" });
      expect(strip).toHaveTextContent("Cancelled");
      expect(strip).toHaveTextContent("No further action");
    });
    expect(screen.queryByRole("button", { name: "Cancel request" })).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Timeline" })).getByText("Cancelled"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Classroom lights flicker" })).toHaveFocus(),
    );
    await expect(api.getTicket(1)).resolves.toMatchObject({ status: "CANCELLED", version: 2 });
  });

  it("keeps the rework dialog open when the required reason is empty", async () => {
    installStateMock();
    await signIn("REPORTER");
    openTicket(5);

    await userEvent.click(await screen.findByRole("button", { name: "Request rework" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Request rework" }));

    expect(
      await within(dialog).findByText("Enter a reason so the technician knows what to fix."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await expect(api.getTicket(5)).resolves.toMatchObject({ status: "PENDING_CONFIRMATION", version: 5 });
  });

  it("closes a stale action when the ticket moved on and reports the conflict", async () => {
    const responder = installStateMock();
    installMock(async (request) => {
      if (request.method === "POST" && request.path === "/api/tickets/1/cancel") {
        return new Response(
          JSON.stringify({
            error: {
              code: "TICKET_VERSION_CONFLICT",
              message: "The ticket has already been updated.",
              request_id: "req_conflict",
              field_errors: [],
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      return responder(request);
    });

    await signIn("REPORTER");
    openTicket(1);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel request" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel request" }));

    expect(await screen.findByText(/updated by someone else/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(api.getTicket(1)).resolves.toMatchObject({ status: "SUBMITTED", version: 1 });
  });
});

describe("technician result (#56)", () => {
  function resolutionPhoto(name: string) {
    // The valid PNG used by tests/e2e/fixtures/photo.png.
    const bytes = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGO8o6HBgA0wYRUdtBIA78QBPFxuqR4AAAAASUVORK5CYII="),
      (value) => value.charCodeAt(0),
    );
    return new File([bytes], name, { type: "image/png" });
  }

  function installPhotoMock() {
    const responder = installStateMock();
    vi.stubGlobal("Image", class {
      onload?: () => void;
      set src(_url: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:resolution-photo");
      static revokeObjectURL = vi.fn();
    });
    return responder;
  }

  it("starts an assigned ticket and submits its selected result photo once", async () => {
    const responder = installPhotoMock();
    const submissions: FormData[] = [];
    let release!: () => void;
    const responseGate = new Promise<void>((resolve) => { release = resolve; });
    installMock(async (request) => {
      if (request.method === "POST" && request.path === "/api/tickets/3/resolve" && request.form) {
        submissions.push(request.form);
        await responseGate;
      }
      return responder(request);
    });

    await signIn("TECHNICIAN");
    const assigned = await api.getTicket(3);
    openTicket(3);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Start work" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Start work" }));

    await user.click(await screen.findByRole("button", { name: "Submit result" }));
    const dialog = within(screen.getByRole("dialog"));
    const note = "Replaced the faulty switch and verified the repair.";
    await user.type(dialog.getByLabelText(/Resolution note/), note);
    await user.upload(dialog.getByLabelText(/Photos/), resolutionPhoto("repair-result.png"));
    expect(await dialog.findByRole("img", { name: "Preview of repair-result.png" })).toBeInTheDocument();

    try {
      await user.click(dialog.getByRole("button", { name: "Submit result" }));
      const pending = await dialog.findByRole("button", { name: "Submitting…" });
      expect(pending).toBeDisabled();
      expect(dialog.getByLabelText(/Photos/)).toBeDisabled();
      expect(dialog.getByRole("button", { name: "Remove repair-result.png" })).toBeDisabled();
      await user.click(pending);
      expect(submissions).toHaveLength(1);
      expect(submissions[0].get("expected_version")).toBe(String(assigned.version + 1));
      expect(submissions[0].get("resolution_note")).toBe(note);
      expect(submissions[0].getAll("photos")).toMatchObject([
        { name: "repair-result.png", type: "image/png" },
      ]);
    } finally {
      release();
    }

    const timeline = within(screen.getByRole("region", { name: "Timeline" }));
    expect(await timeline.findByText(note)).toBeInTheDocument();
    expect(timeline.getByText("Processing started")).toBeInTheDocument();
    expect(timeline.getByText("Result submitted")).toBeInTheDocument();
    const gallery = within(screen.getByRole("list", { name: "Resolution photos" }));
    expect(await gallery.findByRole("img")).toBeInTheDocument();
    expect(gallery.getByText("repair-result.png")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Ticket status and responsibility" }))
      .toHaveTextContent("Pending Confirmation");
    expect(screen.queryByRole("button", { name: "Submit result" })).not.toBeInTheDocument();
  });

  it("requires a resolution note even when a photo is selected", async () => {
    const responder = installPhotoMock();
    const submitResult = vi.fn(responder);
    installMock(submitResult);
    await signIn("TECHNICIAN");
    openTicket(4);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Submit result" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.upload(dialog.getByLabelText(/Photos/), resolutionPhoto("repair-result.png"));
    await user.type(dialog.getByLabelText(/Resolution note/), "   ");
    await user.click(dialog.getByRole("button", { name: "Submit result" }));

    expect(await dialog.findByText("Describe the work you carried out.")).toBeInTheDocument();
    expect(dialog.getByRole("img", { name: "Preview of repair-result.png" })).toBeInTheDocument();
    expect(submitResult).not.toHaveBeenCalledWith(expect.objectContaining({
      method: "POST", path: "/api/tickets/4/resolve",
    }));
  });

  it("offers only the remaining result-photo slots after rework", async () => {
    installPhotoMock();
    await signIn("TECHNICIAN");
    const ticket = await api.getTicket(4);
    const submitted = await api.resolveTicket(4, {
      expected_version: ticket.version,
      resolution_note: "Initial repair.",
      photos: Array.from({ length: 4 }, (_, index) => resolutionPhoto("prior-" + index + ".png")),
    });
    await signIn("REPORTER");
    await api.reworkTicket(4, { expected_version: submitted.version, reason: "Please check it again." });
    await signIn("TECHNICIAN");
    openTicket(4);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Submit result" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.upload(dialog.getByLabelText(/Photos/), [
      resolutionPhoto("first-new.png"),
      resolutionPhoto("second-new.png"),
    ]);

    expect(dialog.getByText("1 of 1 selected")).toBeInTheDocument();
    expect(await dialog.findByRole("img", { name: "Preview of first-new.png" })).toBeInTheDocument();
    expect(dialog.queryByRole("img", { name: "Preview of second-new.png" })).not.toBeInTheDocument();

    await user.type(dialog.getByLabelText(/Resolution note/), "Verified the repair again.");
    await user.click(dialog.getByRole("button", { name: "Submit result" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const after = await api.getTicket(4);
    expect(after.status).toBe("PENDING_CONFIRMATION");
    expect(after.resolution_photos).toHaveLength(5);
    expect(after.resolution_photos.map((photo) => photo.original_name)).toEqual(expect.arrayContaining([
      "prior-0.png", "prior-1.png", "prior-2.png", "prior-3.png", "first-new.png",
    ]));
  });

  it("shows an indexed photo error beside the picker and keeps the note available for retry", async () => {
    installPhotoMock();
    await signIn("TECHNICIAN");
    openTicket(4);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Submit result" }));
    const dialog = within(screen.getByRole("dialog"));
    const picker = dialog.getByLabelText(/Photos/);
    await user.type(dialog.getByLabelText(/Resolution note/), "Checked the repair.");
    await user.upload(picker, new File(["not a PNG"], "repair-result.png", { type: "image/png" }));
    await user.click(dialog.getByRole("button", { name: "Submit result" }));

    expect(await dialog.findByText("Image content does not match an allowed type.")).toBeInTheDocument();
    expect(dialog.getByText("Input validation failed.")).toBeInTheDocument();
    expect(picker).toHaveAttribute("aria-invalid", "true");
    await user.click(dialog.getByRole("button", { name: "Remove repair-result.png" }));
    expect(picker).not.toHaveAttribute("aria-invalid");
    expect(dialog.getByLabelText(/Resolution note/)).toHaveValue("Checked the repair.");

    await user.click(dialog.getByRole("button", { name: "Submit result" }));
    expect(await screen.findByText("Checked the repair.")).toBeInTheDocument();
    await expect(api.getTicket(4)).resolves.toMatchObject({
      status: "PENDING_CONFIRMATION",
      resolution_photos: [],
    });
  });
});

describe("action dialog ownership (#91 P2)", () => {
  it("closes an open dialog when the route moves to another ticket", async () => {
    installStateMock();
    await signIn("ADMIN");
    const first = await api.getTicket(1);
    const second = await api.getTicket(9);
    expect(first.allowed_actions).toContain("REVIEW");
    expect(second.allowed_actions).toContain("REVIEW");

    const view = renderZone(first);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(first.code);

    view.rerenderTicket(second);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("closes a dialog whose action is no longer allowed on the same ticket", async () => {
    installStateMock();
    await signIn("ADMIN");
    const ticket = await api.getTicket(1);
    const view = renderZone(ticket);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    view.rerenderTicket({ ...ticket, allowed_actions: ["ASSIGN"] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});

describe("action success and session generation (#91 P2)", () => {
  it("does not toast a success that settles after the session ended", async () => {
    const responder = installStateMock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let processed!: () => void;
    const processedPromise = new Promise<void>((resolve) => { processed = resolve; });

    installMock(async (request) => {
      if (request.method === "POST" && request.path === "/api/tickets/1/cancel") {
        const response = await responder(request);
        processed();
        await gate;
        return response;
      }
      return responder(request);
    });

    await signIn("REPORTER");
    const ticket = await api.getTicket(1);
    renderZone(ticket);
    await userEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Cancel request" });
    await userEvent.click(confirm);
    await processedPromise;

    // End the generation while the already-successful response is in flight.
    bumpSessionVersion();
    release();

    await waitFor(() => expect(confirm).toBeEnabled());
    expect(screen.queryByText(/Ticket .* cancelled\./)).not.toBeInTheDocument();
  });
});

describe("assignment candidate pagination (#91 P2)", () => {
  it("follows every cursor page before offering the technician list", async () => {
    const responder = installStateMock();
    installMock(async (request) => {
      const url = new URL(request.path, "http://mock.invalid");
      if (request.method === "GET" && url.pathname === "/api/admin/users") {
        const cursor = url.searchParams.get("cursor");
        if (!cursor) {
          return jsonResponse({
            items: [userPayload({ id: 21, name: "First technician", role: "TECHNICIAN" })],
            next_cursor: "page-2",
          });
        }
        if (cursor === "page-2") {
          return jsonResponse({
            items: [userPayload({ id: 22, name: "Second technician", role: "TECHNICIAN" })],
            next_cursor: null,
          });
        }
      }
      return responder(request);
    });

    await signIn("ADMIN");
    const ticket = await api.getTicket(2);
    renderZone(ticket);
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    const dialog = screen.getByRole("dialog");

    expect(
      await within(dialog).findByRole("option", { name: "First technician" }),
    ).toBeInTheDocument();
    expect(
      await within(dialog).findByRole("option", { name: "Second technician" }),
    ).toBeInTheDocument();
  });
});

describe("action validation summary (#97 P2)", () => {
  it("keeps the field error and dialog summary until a corrected assignment succeeds", async () => {
    const responder = installStateMock();
    let rejected = false;
    installMock(async (request) => {
      if (request.method === "POST" && request.path === "/api/tickets/2/assign" && !rejected) {
        rejected = true;
        return jsonResponse({
          error: {
            code: "VALIDATION_ERROR",
            message: "Select an active technician.",
            request_id: "req_assignment_validation",
            field_errors: [{
              field: "technician_id",
              message: "Select an active technician.",
              type: "value_error",
            }],
          },
        }, 422);
      }
      return responder(request);
    });

    await signIn("ADMIN");
    const ticket = await api.getTicket(2);
    renderZone(ticket);
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("option", { name: "Demo technician A" });
    const technician = within(dialog).getByRole("combobox", { name: /Technician/ });
    await userEvent.selectOptions(technician, "2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Assign" }));

    await waitFor(() => {
      expect(technician).toHaveAttribute("aria-invalid", "true");
      const alerts = within(dialog).getAllByRole("alert");
      expect(alerts).toHaveLength(2);
      expect(alerts.find((alert) => alert.closest(".field"))).toHaveTextContent("Select an active technician.");
      expect(alerts.find((alert) => !alert.closest(".field"))).toHaveTextContent("Select an active technician.");
    });
    expect(technician).toHaveValue("2");
    await expect(api.getTicket(2)).resolves.toMatchObject({
      status: "PENDING_ASSIGNMENT", version: ticket.version,
    });

    await userEvent.selectOptions(technician, "5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(`Ticket ${ticket.code} assigned.`)).toBeInTheDocument();
    await expect(api.getTicket(2)).resolves.toMatchObject({
      status: "ASSIGNED", version: ticket.version + 1, current_assignee: { id: 5 },
    });
  });
});
