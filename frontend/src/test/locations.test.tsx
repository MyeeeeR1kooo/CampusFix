import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../app/App";
import { api, type Location } from "../api";
import { installMock } from "../api/mockBridge";
import { LocationCascade } from "../features/locations/LocationCascade";
import { MOCK_PASSWORD } from "../mocks/fixtures";
import { createMockApi } from "../mocks/responder";

let mock: ReturnType<typeof createMockApi>;

beforeEach(() => {
  vi.stubEnv("VITE_USE_MOCK", "1");
  mock = createMockApi({ now: () => new Date("2026-10-03T10:00:00Z") });
  installMock(mock.responder);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});

afterEach(() => {
  cleanup();
  installMock(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function openAdminPage() {
  await api.login({ email: "admin01@campusfix.test", password: MOCK_PASSWORD });
  window.history.replaceState({}, "", "/locations");
  render(<App />);
  await screen.findByText("Teaching Building A");
}

describe("#49 location management — FR-12", () => {
  it("creates a location and shows the server's duplicate-combination error", async () => {
    await openAdminPage();
    const user = userEvent.setup();
    expect(screen.getByRole("table", { name: "All locations" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New location" }));
    const form = screen.getByRole("region", { name: "New location" });
    await user.click(within(form).getByRole("button", { name: "Save location" }));
    expect(await within(form).findByText("Enter a building.")).toBeInTheDocument();
    expect(within(form).getByText("Enter a floor.")).toBeInTheDocument();
    expect(within(form).getByText("Enter a room or area.")).toBeInTheDocument();
    expect(within(form).getByText("Check the required location fields.")).toBeInTheDocument();
    await user.type(within(form).getByRole("textbox", { name: /Building/ }), "Teaching Building A");
    await user.type(within(form).getByRole("textbox", { name: /Floor/ }), "3");
    await user.type(within(form).getByRole("textbox", { name: /Room or area/ }), "301");
    await user.click(within(form).getByRole("button", { name: "Save location" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("This location already exists.");

    await user.clear(within(form).getByRole("textbox", { name: /Building/ }));
    await user.type(within(form).getByRole("textbox", { name: /Building/ }), "Lab C");
    await user.click(within(form).getByRole("button", { name: "Save location" }));
    expect(await screen.findByText("Lab C")).toBeInTheDocument();
    expect((await api.listAdminLocations()).items.some((location) => location.building === "Lab C")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("edits, disables and re-enables without changing an existing ticket's snapshot", async () => {
    await openAdminPage();
    const user = userEvent.setup();
    const snapshot = (await api.getTicket(1)).location_label_snapshot;
    const row = screen.getByText("Teaching Building A").closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("region", { name: "Edit location" });
    await user.clear(within(form).getByRole("textbox", { name: /Building/ }));
    await user.type(within(form).getByRole("textbox", { name: /Building/ }), "Renamed A");
    await user.click(within(form).getByRole("button", { name: "Save location" }));
    const renamed = (await screen.findByText("Renamed A")).closest("tr")!;
    await user.click(within(renamed).getByRole("button", { name: "Disable" }));
    const dialog = screen.getByRole("dialog", { name: "Disable location?" });
    expect(dialog).toHaveTextContent(/Existing reports retain their saved location name/);
    await user.click(within(dialog).getByRole("button", { name: "Disable location" }));
    await waitFor(() => expect(within(screen.getByText("Renamed A").closest("tr")!).getByText("Inactive")).toBeInTheDocument());
    expect((await api.listActiveLocations()).items.some((location) => location.id === 1)).toBe(false);
    expect((await api.getTicket(1)).location_label_snapshot).toBe(snapshot);
    await user.click(within(screen.getByText("Renamed A").closest("tr")!).getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(within(screen.getByText("Renamed A").closest("tr")!).getByText("Active")).toBeInTheDocument());
    expect((await api.listActiveLocations()).items.some((location) => location.id === 1)).toBe(true);
  });

  it("keeps the management route behind the Admin role gate", async () => {
    await api.login({ email: "reporter01@campusfix.test", password: MOCK_PASSWORD });
    window.history.replaceState({}, "", "/locations");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /don't have access/i })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "All locations" })).not.toBeInTheDocument();
    await expect(api.listAdminLocations()).rejects.toMatchObject({ status: 403 });
  });

  it("pages through the complete admin list with server cursors", async () => {
    await api.login({ email: "admin01@campusfix.test", password: MOCK_PASSWORD });
    for (let index = 0; index < 21; index++) {
      await api.createLocation({ building: `New ${index}`, floor: "1", room_or_area: "101", active: true });
    }
    window.history.replaceState({}, "", "/locations");
    render(<App />);
    expect(await screen.findByText("New 20")).toBeInTheDocument();
    expect(screen.queryByText("Teaching Building A")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Teaching Building A")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("New 20")).toBeInTheDocument();
  });
});

describe("#49 location cascade for #51's form", () => {
  it("loads every active page and chooses a leaf ID, resetting descendants when a parent changes", async () => {
    const first: Location = { id: 1, building: "A", floor: "1", room_or_area: "First", active: true, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
    const last: Location = { ...first, id: 101, building: "B", floor: "9", room_or_area: "Last" };
    const paths: string[] = [];
    installMock(async (request) => {
      if (request.method === "GET" && request.path.startsWith("/api/locations?")) {
        paths.push(request.path);
        const cursor = new URL(request.path, "http://localhost").searchParams.get("cursor");
        return new Response(JSON.stringify(cursor ? { items: [last], next_cursor: null } : { items: [first], next_cursor: "after-first" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return mock.responder(request);
    });
    const onChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><LocationCascade value={null} onChange={onChange} /></QueryClientProvider>);
    const user = userEvent.setup();
    await screen.findByRole("option", { name: "B" });
    await user.selectOptions(screen.getByRole("combobox", { name: /Building/ }), "B");
    await user.selectOptions(screen.getByRole("combobox", { name: /Floor/ }), "9");
    await user.selectOptions(screen.getByRole("combobox", { name: /Room or area/ }), "101");
    expect(onChange).toHaveBeenLastCalledWith(101);
    expect(paths).toHaveLength(2);
    expect(paths[1]).toContain("cursor=after-first");
    await user.selectOptions(screen.getByRole("combobox", { name: /Building/ }), "A");
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("combobox", { name: /Room or area/ })).toBeDisabled();
  });
});
