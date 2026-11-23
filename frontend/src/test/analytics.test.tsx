import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../app/App";
import { stubApi, userPayload } from "../test-helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderAnalytics(body: unknown) {
  stubApi([
    { match: /\/api\/me$/, reply: () => ({ body: userPayload({ id: 3, role: "ADMIN" }) }) },
    { match: /\/api\/admin\/analytics$/, reply: () => ({ body }) },
  ]);
  window.history.pushState({}, "", "/analytics");
  render(<App />);
}

const emptyAnalytics = {
  by_status: [], by_category: [], by_building: [], backlog_count: 0, average_close_seconds: 0,
  daily_trend: Array.from({ length: 30 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, created_count: 0, closed_count: 0 })),
};

describe("analytics page", () => {
  it("renders empty statistics without hiding the dashboard sections", async () => {
    renderAnalytics(emptyAnalytics);
    expect(await screen.findByText("Current backlog")).toBeInTheDocument();
    expect(screen.getByText("Current backlog")).toBeInTheDocument();
    expect(screen.getByText("Average time to close")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "By status" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "By category" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "By building" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "30-day trend" })).toBeInTheDocument();
    expect(screen.getAllByText("No data yet.")).toHaveLength(3);
  });

  it("renders real aggregates and labels total close duration", async () => {
    renderAnalytics({
      ...emptyAnalytics,
      by_status: [{ status: "CLOSED", count: 2 }],
      by_category: [{ category: "HVAC", count: 2 }],
      by_building: [{ building: "North Hall", count: 2 }],
      backlog_count: 4,
      average_close_seconds: 5400,
      daily_trend: [{ date: "2026-10-23", created_count: 3, closed_count: 1 }],
    });
    expect(await screen.findByText("4")).toBeInTheDocument();
    expect(screen.getByText("1.5 hr")).toBeInTheDocument();
    expect(screen.getByText("Closed", { selector: ".distribution-label" })).toBeInTheDocument();
    expect(screen.getByText("HVAC")).toBeInTheDocument();
    expect(screen.getByText("North Hall")).toBeInTheDocument();
    expect(screen.getByText("From creation to closure, including confirmation")).toBeInTheDocument();
  });
});
