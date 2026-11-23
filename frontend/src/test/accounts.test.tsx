import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../app/App";
import { api } from "../api";
import { installMock } from "../api/mockBridge";
import { MOCK_PASSWORD } from "../mocks/fixtures";
import { createMockApi } from "../mocks/responder";

beforeEach(() => {
  vi.stubEnv("VITE_USE_MOCK", "1");
  installMock(createMockApi({ now: () => new Date("2026-10-03T10:00:00Z") }).responder);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});

afterEach(() => {
  cleanup();
  installMock(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function openAccounts() {
  await api.login({ email: "admin01@campusfix.test", password: MOCK_PASSWORD });
  window.history.replaceState({}, "", "/admin/users");
  render(<App />);
  await screen.findByText("Demo reporter A");
}

describe("#90 account management — FR-16", () => {
  it("filters by role and active state, then clears both filters", async () => {
    await openAccounts();
    const user = userEvent.setup();
    const table = screen.getByRole("table", { name: "Managed accounts" });
    expect(within(table).queryByText("Demo dispatcher")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Role" }), "TECHNICIAN");
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "false");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await within(table).findByText("Inactive technician")).toBeInTheDocument();
    expect(within(table).queryByText("Demo technician A")).not.toBeInTheDocument();
    expect(within(table).queryByText("Demo reporter A")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await within(table).findByText("Demo reporter A")).toBeInTheDocument();
    expect(within(table).getByText("Demo technician A")).toBeInTheDocument();
  });

  it("disables and re-enables a Reporter while preserving the existing report", async () => {
    await openAccounts();
    const user = userEvent.setup();
    const original = await api.getTicket(1);
    const row = screen.getByText("Demo reporter A").closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Disable" }));
    const dialog = screen.getByRole("dialog", { name: "Disable account?" });
    expect(dialog).toHaveTextContent("lose access on its next request");
    await user.click(within(dialog).getByRole("button", { name: "Disable account" }));
    await waitFor(() => expect(within(screen.getByText("Demo reporter A").closest("tr")!).getByText("Inactive")).toBeInTheDocument());
    expect((await api.getTicket(1)).reporter.id).toBe(original.reporter.id);
    await user.click(within(screen.getByText("Demo reporter A").closest("tr")!).getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(within(screen.getByText("Demo reporter A").closest("tr")!).getByText("Active")).toBeInTheDocument());
  });

  it("rejects account API requests from a non Admin session", async () => {
    await api.login({ email: "reporter01@campusfix.test", password: MOCK_PASSWORD });
    window.history.replaceState({}, "", "/admin/users");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /don't have access/i })).toBeInTheDocument();
    await expect(api.listUsers()).rejects.toMatchObject({ status: 403 });
    await expect(api.setUserActive(2, { active: false })).rejects.toMatchObject({ status: 403 });
  });
});
