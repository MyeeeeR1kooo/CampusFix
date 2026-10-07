import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../app/App";
import { api } from "../api";
import { installMock } from "../api/mockBridge";
import { createMockApi } from "../mocks/responder";
import { startDevelopmentMock } from "../mocks/bootstrap";
import { PreviewApp } from "../mocks/preview/PreviewApp";
import { MOCK_PASSWORD } from "../mocks/fixtures";

beforeEach(() => {
  vi.stubEnv("VITE_USE_MOCK", "1");
  installMock(createMockApi({ now: () => new Date("2026-10-03T10:00:00Z") }).responder);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Mock preview attempted a network request"); }));
  window.history.replaceState({}, "", "/mock-preview.html#/queue");
});
afterEach(() => { cleanup(); installMock(null); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("two developer pages reuse the public components", () => {
  it("disables stale cancellation after a 409 refresh removes the permitted action", async () => {
    window.history.replaceState({}, "", "/mock-preview.html#/detail/1");
    render(<PreviewApp />);
    await userEvent.click(await screen.findByRole("button", { name: "Use Demo reporter A" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel report" }));
    await api.login({ email: "admin01@campusfix.test", password: MOCK_PASSWORD });
    await api.reviewTicket(1, { decision: "APPROVE", category: "LIGHTING_ELECTRICAL", priority: "LOW", expected_version: 1 });
    await api.login({ email: "reporter01@campusfix.test", password: MOCK_PASSWORD });
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel report" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("already been updated");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel report" })).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(await api.getTicket(1)).toMatchObject({ status: "PENDING_ASSIGNMENT", version: 2 });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("uses queue filters, pagination, detail timeline and a real cancellation through the shared dialog", async () => {
    render(<PreviewApp />);
    await userEvent.click(await screen.findByRole("button", { name: "Use Demo reporter A" }));
    expect(await screen.findByRole("table", { name: "Visible tickets" })).toHaveClass("data-table");
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByRole("link", { name: "Classroom lights flicker" }));
    expect(await screen.findByRole("table", { name: "Ticket summary" })).toHaveClass("data-table");
    expect(await screen.findByRole("list", { name: "Ticket timeline" })).toHaveClass("timeline");
    expect(screen.queryByText("Internal note")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel report" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel report" }));
    expect(await screen.findByText("No further action — this ticket was cancelled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel report" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("link", { name: "Back to queue" })).toHaveFocus();
    await userEvent.click(screen.getByRole("link", { name: "Back to queue" }));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Status" }), "CANCELLED");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByRole("link", { name: "Classroom lights flicker" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("clears cached admin data on logout before a different role logs in", async () => {
    render(<PreviewApp />);
    await userEvent.click(await screen.findByRole("button", { name: "Use Demo dispatcher" }));
    expect(await screen.findByRole("link", { name: "Corridor lamp needs replacement" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use Demo reporter A" }));
    expect(await screen.findByRole("link", { name: "Duplicate report about a chair" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Corridor lamp needs replacement" })).not.toBeInTheDocument();
  });
});

describe("actual scaffold bootstrap and 401 routing", () => {
  it("mounts the real responder before authentication and redirects to login on expiry", async () => {
    installMock(null);
    await startDevelopmentMock();
    await api.login({ email: "reporter01@campusfix.test", password: MOCK_PASSWORD });
    window.history.replaceState({}, "", "/reports");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /My reports is not built yet/i })).toBeInTheDocument();
    // A fresh responder has no session, reproducing server expiry through the same bridge.
    installMock(createMockApi().responder);
    await act(async () => { await api.listTickets().catch(() => undefined); });
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
  });

  it("does not install fixtures when the switch is disabled", async () => {
    installMock(null); vi.stubEnv("VITE_USE_MOCK", "0");
    await startDevelopmentMock();
    vi.stubEnv("VITE_USE_MOCK", "1");
    await expect(api.getCurrentUser()).rejects.toThrow("attempted a network request");
  });
});
