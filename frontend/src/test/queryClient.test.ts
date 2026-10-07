/**
 * §13.3's conflict behaviour, tested at the query client (#48).
 *
 * The rule is "on 409, tell the user and re-fetch the authoritative ticket". Putting it in
 * the mutation cache is what makes it one behaviour instead of nine page-level habits, so
 * these tests drive a real mutation through the real client — no component required.
 */

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { queryKeys, createAppQueryClient } from "../lib/queryClient";
import { bumpSessionVersion } from "../lib/session";

function conflict(code: string): ApiError {
  return new ApiError({
    status: 409,
    code: code as never,
    message: "The ticket has already been updated.",
    requestId: "req_1",
    fieldErrors: [],
  });
}

/**
 * `MutationCache.build` is what the observer uses internally; constructing `Mutation`
 * directly skips `defaultMutationOptions` and the cache wiring, so the test would not be
 * exercising the same path the app does.
 */
async function runMutation(client: QueryClient, error: unknown, variables: unknown) {
  const mutation = client.getMutationCache().build(client, {
    mutationFn: async () => {
      throw error;
    },
  });
  await mutation.execute(variables).catch(() => undefined);
}

describe("409", () => {
  it("notifies and marks the detail query stale", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    const key = queryKeys.tickets.detail(42);
    client.setQueryData(key, { id: 42, version: 1 });

    await runMutation(client, conflict("TICKET_VERSION_CONFLICT"), { id: 42, expected_version: 1 });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/updated by someone else/);
    expect(client.getQueryCache().find({ queryKey: key })?.isStale()).toBe(true);
  });

  it("covers a plain state conflict too, since both are 409", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    await runMutation(client, conflict("CONFLICT"), { ticketId: 7 });
    expect(notify.mock.calls[0][0]).toMatch(/moved on/);
    expect(client.getQueryCache().find({ queryKey: queryKeys.tickets.detail(7) })).toBeUndefined();
  });

  it("re-fetches nothing when the variables name no ticket", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    client.setQueryData(queryKeys.analytics(), { backlog_count: 0 });

    await runMutation(client, conflict("CONFLICT"), { note: "no id here" });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().find({ queryKey: queryKeys.analytics() })?.isStale()).toBe(false);
  });

  it("does not treat a zero or negative id as a ticket", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    client.setQueryData(queryKeys.tickets.detail(0 as never), {});
    await runMutation(client, conflict("CONFLICT"), { id: 0 });
    expect(client.getQueryCache().find({ queryKey: queryKeys.tickets.detail(0 as never) })?.isStale()).toBe(false);
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

describe("session generations (#68 review)", () => {
  /** A mutation whose failure is delivered by hand, so the test controls *when*. */
  function pendingFailure(client: QueryClient) {
    let rejectMutation: ((error: unknown) => void) | null = null;
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () =>
        new Promise((_resolve, reject) => {
          rejectMutation = reject;
        }),
    });
    const settled = mutation.execute({ id: 1 }).catch(() => undefined);
    // One macrotask: by the time it runs, the submission — and its generation
    // stamp — has happened.
    const submitted = new Promise((resolve) => setTimeout(resolve, 0));
    return { fail: (error: unknown) => rejectMutation!(error), settled, submitted };
  }

  it("suppresses a 409 raised by a mutation of a previous session", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    const { fail, settled, submitted } = pendingFailure(client);

    await submitted;
    bumpSessionVersion(); // the session that issued the mutation has ended
    fail(conflict("CONFLICT"));
    await settled;

    expect(notify).not.toHaveBeenCalled();
    expect(client.getQueryCache().find({ queryKey: queryKeys.tickets.detail(1) })).toBeUndefined();
  });

  it("still toasts a 409 raised inside the current session", async () => {
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    const { fail, settled, submitted } = pendingFailure(client);

    await submitted;
    fail(conflict("TICKET_VERSION_CONFLICT"));
    await settled;

    expect(notify).toHaveBeenCalledTimes(1);
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
