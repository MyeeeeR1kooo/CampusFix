/**
 * Reporter flow pages (#51) and photos/comments on the shared detail (#54).
 *
 * These tests drive the real App against the shared Mock responder, so routing,
 * providers, the API client and the pages are exercised together. They are not a
 * substitute for the real-browser run against FastAPI.
 */

import { useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../app/App";
import { api, type Role } from "../api";
import { installMock } from "../api/mockBridge";
import { PhotoPicker } from "../features/tickets/PhotoPicker";
import { bumpSessionVersion } from "../lib/session";
import { MOCK_PASSWORD } from "../mocks/fixtures";
import { createMockApi } from "../mocks/responder";
import { errorResponse } from "../test-helpers";

const NOW = new Date("2026-10-03T10:00:00Z");
const ACCOUNTS: Record<Role, string> = {
  REPORTER: "reporter01@campusfix.test",
  TECHNICIAN: "technician01@campusfix.test",
  ADMIN: "admin01@campusfix.test",
};
const REPORTER_B = "reporter02@campusfix.test";
const pngBytes = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII="),
  (value) => value.charCodeAt(0),
);
const validPhoto = (name = "window.png") => new File([pngBytes], name, { type: "image/png" });

function browserImageStubs() {
  vi.stubGlobal("Image", class {
    onload?: () => void;
    onerror?: () => void;
    set src(_url: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:mock-image");
    static revokeObjectURL = vi.fn();
  });
}

function installStateMock(options: { emptyTickets?: boolean } = {}) {
  vi.stubEnv("VITE_USE_MOCK", "1");
  const mock = createMockApi({ now: () => NOW, ...options });
  installMock(mock.responder);
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("The test attempted a network request outside the Mock layer");
  }));
  browserImageStubs();
  return mock;
}

async function signIn(role: Role | "REPORTER_B") {
  const email = role === "REPORTER_B" ? REPORTER_B : ACCOUNTS[role];
  await api.login({ email, password: MOCK_PASSWORD });
}

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

async function fillRequiredReport(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.type(screen.getByLabelText(/^Title/), title);
  await user.selectOptions(screen.getByLabelText(/^Category/), "DOORS_WINDOWS_LOCKS");
  await user.type(screen.getByLabelText(/^Description/), "The north window latch is loose.");
  await screen.findByRole("option", { name: "Library" });
  await user.selectOptions(screen.getByLabelText(/^Building/), "Library");
  await user.selectOptions(screen.getByLabelText(/^Floor/), "2");
  await user.selectOptions(screen.getByLabelText(/^Room or area/), "Reading room");
}

afterEach(() => {
  cleanup();
  installMock(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("create a repair report (#51)", () => {
  it("blocks a submit with every required field empty and keeps entered values", async () => {
    installStateMock();
    await signIn("REPORTER");
    const user = userEvent.setup();
    renderAt("/reports/new");

    await screen.findByRole("heading", { name: "Create a repair report" });
    expect(screen.getByText(/emergency channels/i)).toHaveTextContent(/safety/i);
    expect(screen.getByText(/emergency channels/i)).toHaveTextContent(/medical/i);
    expect(screen.getByText(/emergency channels/i)).toHaveTextContent(/police/i);

    await user.click(screen.getByRole("button", { name: "Submit report" }));

    expect(await screen.findByText("Enter a title.")).toBeInTheDocument();
    expect(screen.getByText("Describe the problem.")).toBeInTheDocument();
    expect(screen.getByText("Select a category.")).toBeInTheDocument();
    expect(screen.getByText("Select a location.")).toBeInTheDocument();
    expect(screen.getByText("Check the required fields below.")).toBeInTheDocument();
    await expect(api.listTickets()).resolves.toMatchObject({ items: expect.any(Array) });
    expect((await api.listTickets()).items).toHaveLength(8);
  });

  it("submits fields and a photo as one request, then shows the photo and timeline on detail", async () => {
    installStateMock();
    await signIn("REPORTER");
    const user = userEvent.setup();
    renderAt("/reports/new");

    await screen.findByRole("heading", { name: "Create a repair report" });
    await fillRequiredReport(user, "Library window latch");
    await user.upload(screen.getByLabelText(/Photos/), validPhoto());

    expect(screen.getByText("1 of 5 selected")).toBeInTheDocument();
    expect(screen.getByAltText("Preview of window.png")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit report" }));

    expect(await screen.findByRole("heading", { name: "Library window latch" })).toBeInTheDocument();
    const strip = screen.getByRole("region", { name: "Ticket status and responsibility" });
    expect(strip).toHaveTextContent("Submitted");
    const photos = screen.getByRole("region", { name: "Photos" });
    const image = await within(photos).findByAltText("Report photo: window.png");
    expect(image.getAttribute("src")).toBe("blob:mock-image");
    // The preview URL belongs to a File; the gallery's URL must come from the
    // bytes returned by the Mock responder, not from a direct /api/attachments <img>.
    const objectUrls = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(([value]) => value as Blob)
      .filter((value) => !(value instanceof File));
    expect(objectUrls.at(-1)?.size).toBe(pngBytes.length);
    expect(within(photos).getByText("No resolution photos have been submitted.")).toBeInTheDocument();
    const timeline = screen.getByRole("region", { name: "Timeline" });
    expect(within(timeline).getByText("Submitted", { selector: "strong" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "← Back" }));
    expect(await screen.findByRole("heading", { name: "My repairs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Library window latch" })).toBeInTheDocument();
  });

  it("creates without photos and reports the empty photo groups", async () => {
    installStateMock();
    await signIn("REPORTER");
    const user = userEvent.setup();
    renderAt("/reports/new");

    await screen.findByRole("heading", { name: "Create a repair report" });
    await fillRequiredReport(user, "Reading room chair");
    await user.click(screen.getByRole("button", { name: "Submit report" }));

    await screen.findByRole("heading", { name: "Reading room chair" });
    const photos = screen.getByRole("region", { name: "Photos" });
    expect(within(photos).getByText("No report photos were attached.")).toBeInTheDocument();
    expect(within(photos).getByText("No resolution photos have been submitted.")).toBeInTheDocument();
    expect(screen.getByText(/Library \/ 2 \/ Reading room/)).toBeInTheDocument();
  });

  it("shows the server's field error for a disguised image and stays on the form", async () => {
    installStateMock();
    await signIn("REPORTER");
    const user = userEvent.setup();
    renderAt("/reports/new");

    await screen.findByRole("heading", { name: "Create a repair report" });
    await fillRequiredReport(user, "Disguised file");
    await user.upload(
      screen.getByLabelText(/Photos/),
      new File(["not a PNG"], "fake.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Submit report" }));

    expect(await screen.findByText("Image content does not match an allowed type.")).toBeInTheDocument();
    expect(screen.getByText("Input validation failed.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create a repair report" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove fake.png" }));
    await waitFor(() =>
      expect(screen.queryByText("Image content does not match an allowed type.")).toBeNull(),
    );
    expect(screen.queryByText("Input validation failed.")).toBeNull();
  });

  it("ignores a create response that settles after the session ended", async () => {
    const { responder } = installStateMock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let processed!: () => void;
    const processedPromise = new Promise<void>((resolve) => { processed = resolve; });
    installMock(async (request) => {
      if (request.method === "POST" && request.path === "/api/tickets") {
        const response = await responder(request);
        processed();
        await gate;
        return response;
      }
      return responder(request);
    });

    await signIn("REPORTER");
    const user = userEvent.setup();
    renderAt("/reports/new");
    await screen.findByRole("heading", { name: "Create a repair report" });
    await fillRequiredReport(user, "Late create");
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    await processedPromise;

    bumpSessionVersion();
    release();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit report" })).toBeEnabled(),
    );
    expect(screen.queryByText(/Ticket CF-.* submitted\./)).toBeNull();
    expect(window.location.pathname).toBe("/reports/new");
  });
});

describe("my reports list (#51)", () => {
  it("shows only the reporter's tickets, filters by status and clears the filter", async () => {
    installStateMock();
    await signIn("REPORTER");
    const user = userEvent.setup();
    renderAt("/reports");

    await screen.findByRole("heading", { name: "My repairs" });
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(8));
    expect(screen.getByRole("link", { name: "Classroom lights flicker" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Second floor door handle sticks" })).toBeNull();

    await user.selectOptions(screen.getByLabelText(/^Status/), "SUBMITTED");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(screen.getByRole("link", { name: "Classroom lights flicker" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(8));
  });

  it("walks cursor pages without inventing totals", async () => {
    installStateMock();
    await signIn("REPORTER");
    for (let index = 0; index < 13; index += 1) {
      await api.createTicket({
        title: `Bulk report ${index}`,
        description: "Bulk-created during the pagination test.",
        category: "FURNITURE",
        location_id: 2,
      });
    }
    const user = userEvent.setup();
    renderAt("/reports");

    await screen.findByRole("heading", { name: "My repairs" });
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(20));
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(screen.getByRole("link", { name: "Classroom lights flicker" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(20));
  });

  it("shows the empty state when the reporter has no reports", async () => {
    installStateMock({ emptyTickets: true });
    await signIn("REPORTER");
    renderAt("/reports");

    expect(await screen.findByText("You have not submitted any reports yet.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Create a repair report" }).length).toBeGreaterThan(0);
  });

  it("renders a loading state and retries after an error", async () => {
    const mock = createMockApi({ now: () => NOW });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    installMock(async (request) => {
      if (request.method === "GET" && request.path.startsWith("/api/tickets?")) await gate;
      return mock.responder(request);
    });
    browserImageStubs();
    vi.stubEnv("VITE_USE_MOCK", "1");
    await signIn("REPORTER");
    renderAt("/reports");

    expect(await screen.findByText("Loading your reports…")).toBeInTheDocument();
    release();
    expect(await screen.findByRole("link", { name: "Classroom lights flicker" })).toBeInTheDocument();

    cleanup();
    let fail = true;
    installMock(async (request) => {
      if (request.method === "GET" && request.path.startsWith("/api/tickets?") && fail) {
        return errorResponse("INTERNAL_ERROR", 500, "The service is temporarily unavailable.");
      }
      return mock.responder(request);
    });
    renderAt("/reports");
    expect(await screen.findByText("The service is temporarily unavailable.", {}, { timeout: 4000 }))
      .toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Classroom lights flicker" })).toBeInTheDocument();
  });
});

describe("photo picker (#54)", () => {
  function Harness() {
    const [files, setFiles] = useState<File[]>([]);
    return <PhotoPicker files={files} onChange={setFiles} />;
  }

  it("rejects SVG, oversize files and more than five images, and removes a selected photo", async () => {
    browserImageStubs();
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness />);
    const input = screen.getByLabelText(/Photos/);

    await user.upload(input, new File(["<svg/>"], "picture.svg", { type: "image/svg+xml" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("use a JPEG, PNG or WebP image");
    expect(screen.queryByAltText("Preview of picture.svg")).toBeNull();

    await user.upload(
      input,
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("5 MiB or smaller");

    const six = Array.from({ length: 6 }, (_, index) => validPhoto(`photo-${index}.png`));
    await user.upload(input, six);
    expect(await screen.findByRole("alert")).toHaveTextContent("at most 5 photos");
    expect(screen.getByText("5 of 5 selected")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /Preview of photo-/ })).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: "Remove photo-0.png" }));
    expect(screen.getByText("4 of 5 selected")).toBeInTheDocument();
    expect(screen.queryByAltText("Preview of photo-0.png")).toBeNull();
  });
});

describe("conversation on the shared detail (#54)", () => {
  it("posts a public comment as the reporter and shows it on the timeline", async () => {
    installStateMock();
    await signIn("REPORTER");
    const user = userEvent.setup();
    renderAt("/tickets/5");

    await screen.findByRole("heading", { name: "Reading room window cannot close" });
    const form = screen.getByRole("form", { name: "Add a comment" });
    await user.type(within(form).getByLabelText(/^Comment/), "Leaving the window open for access.");
    await user.click(within(form).getByRole("button", { name: "Post comment" }));

    expect(await screen.findByText("Leaving the window open for access.")).toBeInTheDocument();
    const detail = await api.getTicket(5);
    expect(detail.timeline.some((entry) => entry.kind === "COMMENT"
      && entry.body === "Leaving the window open for access.")).toBe(true);
  });

  it("preserves a comment containing only whitespace, matching the frozen contract", async () => {
    installStateMock();
    await signIn("REPORTER");
    const user = userEvent.setup();
    renderAt("/tickets/5");

    await screen.findByRole("heading", { name: "Reading room window cannot close" });
    const form = screen.getByRole("form", { name: "Add a comment" });
    await user.type(within(form).getByLabelText(/^Comment/), "   ");
    await user.click(within(form).getByRole("button", { name: "Post comment" }));

    expect(await screen.findByText("Comment added.")).toBeInTheDocument();
    const detail = await api.getTicket(5);
    expect(detail.timeline.some((entry) => entry.kind === "COMMENT" && entry.body === "   ")).toBe(true);
  });

  it("keeps a terminal-comment conflict visible without refreshing the detail", async () => {
    const { responder } = installStateMock();
    let detailCalls = 0;
    installMock(async (request) => {
      if (request.method === "GET" && request.path === "/api/tickets/5") detailCalls += 1;
      if (request.method === "POST" && request.path === "/api/tickets/5/comments") {
        return errorResponse("CONFLICT", 409, "Comments cannot be added to a terminal ticket.");
      }
      return responder(request);
    });

    await signIn("REPORTER");
    const user = userEvent.setup();
    renderAt("/tickets/5");
    await screen.findByRole("heading", { name: "Reading room window cannot close" });
    expect(detailCalls).toBe(1);

    const form = screen.getByRole("form", { name: "Add a comment" });
    await user.type(within(form).getByLabelText(/^Comment/), "Too late");
    await user.click(within(form).getByRole("button", { name: "Post comment" }));

    expect(await within(form).findByRole("alert"))
      .toHaveTextContent("Comments cannot be added to a terminal ticket.");
    expect(screen.getByRole("form", { name: "Add a comment" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(detailCalls).toBe(1);
  });

  it("ignores a comment success that settles after the session ended", async () => {
    const { responder } = installStateMock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let processed!: () => void;
    const processedPromise = new Promise<void>((resolve) => { processed = resolve; });
    installMock(async (request) => {
      if (request.method === "POST" && request.path === "/api/tickets/5/comments") {
        const response = await responder(request);
        processed();
        await gate;
        return response;
      }
      return responder(request);
    });

    await signIn("REPORTER");
    const user = userEvent.setup();
    renderAt("/tickets/5");
    await screen.findByRole("heading", { name: "Reading room window cannot close" });
    const form = screen.getByRole("form", { name: "Add a comment" });
    await user.type(within(form).getByLabelText(/^Comment/), "Late comment");
    await user.click(within(form).getByRole("button", { name: "Post comment" }));
    await processedPromise;

    bumpSessionVersion();
    release();

    await waitFor(() =>
      expect(within(form).getByRole("button", { name: "Post comment" })).toBeEnabled(),
    );
    expect(screen.queryByText("Comment added.")).toBeNull();
    expect(within(form).getByLabelText(/^Comment/)).toHaveValue("Late comment");
  });

  it("shows internal notes only to an administrator", async () => {
    installStateMock();
    await signIn("ADMIN");
    await api.createComment(1, { body: "Admin-only scheduling detail", visibility: "ADMIN_ONLY" });

    await api.logout();
    await signIn("REPORTER");
    renderAt("/tickets/1");
    await screen.findByRole("heading", { name: "Classroom lights flicker" });
    expect(screen.queryByText("Admin-only scheduling detail")).toBeNull();
    expect(screen.queryByText("Internal note")).toBeNull();

    await api.logout();
    await signIn("ADMIN");
    cleanup();
    renderAt("/tickets/1");
    await screen.findByRole("heading", { name: "Classroom lights flicker" });
    expect(screen.getByText("Admin-only scheduling detail")).toBeInTheDocument();
    expect(screen.getAllByText("Internal note").length).toBeGreaterThan(0);
  });

  it("keeps a terminal ticket's history but offers no composer", async () => {
    installStateMock();
    await signIn("REPORTER");
    renderAt("/tickets/6");

    await screen.findByRole("heading", { name: "Entrance sign bracket is loose" });
    expect(screen.getByText(/read-only in its current status/i)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Add a comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Post comment" })).toBeNull();
    const timeline = screen.getByRole("region", { name: "Timeline" });
    expect(within(timeline).getByText("Confirmed — closed")).toBeInTheDocument();
  });

  it("hides another reporter's ticket behind the generic not-found page", async () => {
    installStateMock();
    await signIn("REPORTER_B");
    renderAt("/tickets/1");

    expect(await screen.findByRole(
      "heading",
      { name: "This page is not available" },
      { timeout: 4000 },
    )).toBeInTheDocument();
  });

  it("keeps the creation-time location snapshot after the location is renamed", async () => {
    installStateMock();
    await signIn("ADMIN");
    await api.updateLocation(1, { building: "Renamed Hall" });
    await api.logout();
    await signIn("REPORTER");
    renderAt("/tickets/1");

    await screen.findByRole("heading", { name: "Classroom lights flicker" });
    expect(screen.getByText(/Teaching Building A \/ 3 \/ 301/)).toBeInTheDocument();
    expect(screen.queryByText(/Renamed Hall/)).toBeNull();
  });
});
