import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog, DataTable, FilterBar, Pagination, PriorityBadge, StatusBadge, Timeline } from "../components";
import { TextField } from "../components/Field";
import { STATUS_LABELS, STATUS_ORDER } from "../lib/labels";
import { createFixtures } from "../mocks/fixtures";

afterEach(cleanup);

describe("shared table, filters and cursor navigation", () => {
  const columns = [{ key: "name", label: "Name", render: (item: { id: number; name: string }) => item.name }];
  it("renders labelled mobile cells and keeps loading, empty and error states distinct", async () => {
    const retry = vi.fn();
    const props = { columns, caption: "Technicians", rowKey: (item: { id: number }) => item.id };
    const view = render(<DataTable {...props} rows={[{ id: 1, name: "Demo technician" }]} />);
    expect(screen.getByRole("table", { name: "Technicians" })).toBeInTheDocument();
    expect(screen.getByRole("cell")).toHaveAttribute("data-label", "Name");
    view.rerender(<DataTable {...props} rows={[]} loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    view.rerender(<DataTable {...props} rows={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("No matching records");
    view.rerender(<DataTable {...props} rows={[]} error="Failed to load" onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("submits from the keyboard, resets explicitly and disables busy actions", async () => {
    const apply = vi.fn(); const reset = vi.fn();
    const view = render(<FilterBar onSubmit={apply} onReset={reset}><TextField id="search" label="Search" /></FilterBar>);
    await userEvent.type(screen.getByRole("textbox", { name: "Search" }), "chair{Enter}");
    expect(apply).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(reset).toHaveBeenCalledOnce();
    view.rerender(<FilterBar onSubmit={apply} onReset={reset} busy><TextField id="search" label="Search" /></FilterBar>);
    await userEvent.type(screen.getByRole("textbox"), "{Enter}");
    expect(apply).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeDisabled();
  });

  it("passes opaque cursors intact, without totals or fictitious page numbers", async () => {
    const next = vi.fn(); const previous = vi.fn();
    const view = render(<Pagination nextCursor="opaque?=abc" hasPrevious={false} onNext={next} onPrevious={previous} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(next).toHaveBeenCalledWith("opaque?=abc");
    view.rerender(<Pagination nextCursor={null} hasPrevious onNext={next} onPrevious={previous} />);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(previous).toHaveBeenCalledOnce();
    expect(screen.getByRole("navigation")).toHaveTextContent("End of results");
    view.rerender(<Pagination nextCursor="next" hasPrevious onNext={next} onPrevious={previous} busy />);
    expect(screen.getAllByRole("button").every((button) => button.hasAttribute("disabled"))).toBe(true);
  });
});

describe("textual status and chronological timeline", () => {
  it("labels every generated status without depending on color", () => {
    render(<>{STATUS_ORDER.map((status) => <StatusBadge key={status} status={status} />)}<PriorityBadge priority={null} /><PriorityBadge priority="HIGH" /></>);
    for (const status of STATUS_ORDER) expect(screen.getByText(STATUS_LABELS[status])).toBeInTheDocument();
    expect(screen.getByText("Not reviewed")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("sorts event/comment ties without mutating input, labels internal notes and escapes text", () => {
    const fixtures = createFixtures(new Date("2026-10-03T10:00:00Z"));
    const event = fixtures.tickets[0].timeline.find((entry) => entry.kind === "EVENT")!;
    const comment = fixtures.tickets[0].timeline.find((entry) => entry.kind === "COMMENT")!;
    const entries = [{ ...event, id: 1 }, { ...comment, id: 1, body: "<script>alert('x')</script>" }];
    render(<Timeline entries={entries} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Internal note")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("<script>alert('x')</script>");
    expect(rows[0].querySelector("script")).toBeNull();
    expect(rows[1]).toHaveTextContent("Submitted");
    expect(entries[0].kind).toBe("EVENT");
    expect(rows[0].querySelector("time")).toHaveAttribute("datetime", comment.created_at);
  });
});

describe("confirmation dialog keyboard and pending behavior", () => {
  function Example({ confirm = () => undefined }: { confirm?: () => void | Promise<unknown> }) {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open confirmation</button><ConfirmDialog open={open} title="Confirm action" description="This updates the demo ticket." onCancel={() => setOpen(false)} onConfirm={confirm} /></>;
  }

  it("contains focus, closes with Escape and restores the trigger", async () => {
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Open confirmation" });
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Confirm action" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(trigger.closest("[inert]")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger.closest("[inert]")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("blocks repeated confirmation and dismissal while awaiting the request", async () => {
    let resolve!: () => void;
    const confirm = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    render(<Example confirm={confirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Open confirmation" }));
    await userEvent.dblClick(screen.getByRole("button", { name: "Confirm" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    await act(async () => resolve());
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("keeps errors reviewable and allows a retry", async () => {
    const confirm = vi.fn().mockRejectedValueOnce(new Error("The ticket has already been updated.")).mockResolvedValueOnce(undefined);
    render(<Example confirm={confirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Open confirmation" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already been updated");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
