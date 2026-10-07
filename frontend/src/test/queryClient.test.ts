/**
 * §13.3's conflict behaviour (v1.1 clarification), tested at the query client (#48, #71).
 *
 * The clarified rule: the ticket wording and the authoritative re-fetch belong to ticket
 * operations — declared by `ticketActionMeta`, with `TICKET_VERSION_CONFLICT` counting
 * even if a call site forgot its meta — while other resources' `409 / CONFLICT` shows
 * the server's own message. Putting this in the mutation cache is what makes it one
 * behaviour instead of nine page-level habits, so these tests drive a real mutation
 * through the real client — no component required.
 */

import { QueryClient } from "@tanstack/react-query";
import type { MutationMeta } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { queryKeys, createAppQueryClient, ticketActionMeta } from "../lib/queryClient";

function conflict(code: string): ApiError {
  return new ApiError({
    status: 409,
    code: code as never,
    message: "The ticket has already been updated.",
    requestId: "req_1",
    fieldErrors: [],
  });
}

/** A 409 the contract declares off any ticket: the duplicated location combination. */
function locationConflict(): ApiError {
  return new ApiError({
    status: 409,
    code: "CONFLICT",
    message: "This building, floor and room already exists.",
    requestId: "req_2",
    fieldErrors: [],
  });
}

/**
 * `MutationCache.build` is what the observer uses internally; constructing `Mutation`
 * directly skips `defaultMutationOptions` and the cache wiring, so the test would not be
 * exercising the same path the app does.
 */
async function runMutation(client: QueryClient, error: unknown, variables: unknown, meta?: MutationMeta) {
  const mutation = client.getMutationCache().build(client, {
    mutationFn: async () => {
      throw error;
    },
    meta,
  });
  await mutation.execute(variables).catch(() => undefined);
}

describe("409 on a ticket operation", () => {
  it("notifies and marks the detail query stale for a declared ticket action", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    const key = queryKeys.tickets.detail(7);
    client.setQueryData(key, { id: 7, version: 1 });

    await runMutation(client, conflict("CONFLICT"), { ticketId: 7 }, ticketActionMeta);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/moved on/);
    expect(client.getQueryCache().find({ queryKey: key })?.isStale()).toBe(true);
  });

  it("treats TICKET_VERSION_CONFLICT as a ticket even if the call site forgot its meta", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    const key = queryKeys.tickets.detail(42);
    client.setQueryData(key, { id: 42, version: 1 });

    await runMutation(client, conflict("TICKET_VERSION_CONFLICT"), { id: 42, expected_version: 1 });

    expect(notify.mock.calls[0][0]).toMatch(/updated by someone else/);
    expect(client.getQueryCache().find({ queryKey: key })?.isStale()).toBe(true);
  });

  it("still announces the ticket wording when the variables name no ticket", async () => {
    // A ticket action whose variables somehow carry no id: the copy is right, but there
    // is nothing to re-fetch.
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    client.setQueryData(queryKeys.analytics(), { backlog_count: 0 });

    await runMutation(client, conflict("CONFLICT"), { note: "no id here" }, ticketActionMeta);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/moved on/);
    expect(client.getQueryCache().find({ queryKey: queryKeys.analytics() })?.isStale()).toBe(false);
  });

  it("does not treat a zero or negative id as a ticket to re-fetch", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    client.setQueryData(queryKeys.tickets.detail(0 as never), {});
    await runMutation(client, conflict("CONFLICT"), { id: 0 }, ticketActionMeta);
    expect(client.getQueryCache().find({ queryKey: queryKeys.tickets.detail(0 as never) })?.isStale()).toBe(false);
  });
});

describe("409 on another resource", () => {
  it("says what the server said when creating a location", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    const key = queryKeys.tickets.detail(5);
    client.setQueryData(key, { id: 5, version: 3 });

    await runMutation(client, locationConflict(), {
      building: "Teaching Building A",
      floor: "3",
      room_or_area: "301",
      active: true,
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe("This building, floor and room already exists.");
    // The §13.3 wording is reserved for a ticket that actually moved; leaking it here would
    // send the user to a ticket detail page that has nothing to do with the failure.
    expect(notify.mock.calls[0][0]).not.toMatch(/ticket/i);
    expect(client.getQueryCache().find({ queryKey: key })?.isStale()).toBe(false);
  });

  it("does not mistake a location edit's id for a ticket (#71 review)", async () => {
    // The regression the review caught: a location edit carries `id` — the location's —
    // and the old id-based inference showed the ticket wording and refreshed ticket 5,
    // a ticket that has nothing to do with the failed edit.
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    const key = queryKeys.tickets.detail(5);
    client.setQueryData(key, { id: 5, version: 3 });

    await runMutation(client, locationConflict(), {
      id: 5,
      building: "Teaching Building A",
      floor: "3",
      room_or_area: "301",
      active: true,
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe("This building, floor and room already exists.");
    expect(notify.mock.calls[0][0]).not.toMatch(/ticket/i);
    expect(client.getQueryCache().find({ queryKey: key })?.isStale()).toBe(false);
  });
});

describe("409 outside ticket state actions", () => {
  it.each([
    ["ticket creation with an inactive location", { location_id: 5 }, "The selected location is inactive."],
    ["a comment on a terminal ticket", { ticketId: 5, text: "Comment" }, "Closed tickets are read-only."],
  ] as const)("preserves the server message without refreshing detail for %s", async (_case, variables, message) => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    const key = queryKeys.tickets.detail(5);
    client.setQueryData(key, { id: 5, version: 3 });
    const error = new ApiError({ status: 409, code: "CONFLICT", message, requestId: "r", fieldErrors: [] });

    await runMutation(client, error, variables);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(message);
    expect(client.getQueryCache().find({ queryKey: key })?.isStale()).toBe(false);
  });
});

describe("other failures", () => {
  it("leaves a validation error to the form that raised it", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    await runMutation(
      client,
      new ApiError({ status: 422, code: "VALIDATION_ERROR", message: "Title is required.", requestId: "r", fieldErrors: [] }),
      { id: 1 },
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("leaves a non-API failure alone as well", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    await runMutation(client, new TypeError("fetch failed"), { id: 1 });
    expect(notify).not.toHaveBeenCalled();
  });

  it("never notifies on a successful mutation", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    const mutation = client.getMutationCache().build(client, { mutationFn: async () => ({ ok: true }) });
    await mutation.execute({ id: 1 });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("query keys", () => {
  it("names the ticket list and its filters so pages cannot drift apart", () => {
    expect(queryKeys.tickets.list({ status: "CLOSED" })).toEqual(["tickets", "list", { status: "CLOSED" }]);
    expect(queryKeys.tickets.detail(3)).toEqual(["tickets", "detail", 3]);
    // `all` is the prefix a broad invalidation uses; it must be a prefix of the others.
    expect(queryKeys.tickets.list({})).toEqual(expect.arrayContaining([...queryKeys.tickets.all]));
  });
});
