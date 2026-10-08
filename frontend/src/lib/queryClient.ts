/**
 * Server-state wiring (P0 Baseline §13.2, §13.3).
 *
 * §13.2 makes TanStack Query the owner of ticket, location, timeline and statistics data.
 * Two things follow from a scaffold that must be shared, and both live here so no page
 * invents its own version:
 *
 *   1. One query-key factory. Cache keys are the only place a resource is named, and two
 *      pages that spell the same key differently silently fail to invalidate each other.
 *   2. One 409 rule. §13.3 (v1.1) scopes "tell the user and re-fetch the authoritative
 *      ticket" to ticket state actions, declared by `ticketActionMeta`; other resources'
 *      conflicts show the server's own message. That decision happens in the mutation
 *      cache, not in whichever page remembers.
 *
 * The notification is injected rather than imported: toasts belong to React's tree, and
 * taking the callback as an argument keeps this file testable without rendering anything.
 */

import { MutationCache, QueryClient } from "@tanstack/react-query";
import type { Mutation } from "@tanstack/react-query";

import { ApiError } from "../api/client";
import { conflictMessage, classify } from "../lib/errors";
import { currentSessionVersion } from "../lib/session";
import type { Id } from "../api";

export const queryKeys = {
  tickets: {
    all: ["tickets"] as const,
    list: (filters: unknown) => ["tickets", "list", filters] as const,
    detail: (id: Id) => ["tickets", "detail", id] as const,
  },
  locations: {
    all: ["locations"] as const,
    active: (params: unknown) => ["locations", "active", params] as const,
    admin: (params: unknown) => ["locations", "admin", params] as const,
  },
  users: {
    all: ["users"] as const,
    list: (filters: unknown) => ["users", "list", filters] as const,
  },
  analytics: () => ["analytics"] as const,
};

/**
 * Which ticket a confirmed ticket action was acting on: the convention is that a ticket
 * action's variables carry the id as `id` or `ticketId`. Whether the mutation is a
 * ticket action at all is decided by `ticketActionMeta`, never by guessing from the
 * shape of the variables (#71 review, §13.3 v1.1): a location edit carries an `id` too,
 * and reading it as a ticket both lies to the user and refreshes an unrelated ticket.
 */
function ticketIdOf(variables: unknown): Id | null {
  if (typeof variables !== "object" || variables === null) return null;
  const record = variables as Record<string, unknown>;
  for (const key of ["id", "ticketId"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

/**
 * Attaches to ticket state actions carrying expected_version, so the mutation cache
 * distinguishes them without inspecting variables. Do not attach to creation or comments.
 * §13.3 (v1.1) scopes the ticket copy and the detail re-fetch to ticket state actions;
 * other resources' `409 / CONFLICT` renders the server's own message.
 */
export const ticketActionMeta = { ticketAction: true } as const;

export interface QueryClientOptions {
  /** Render §13.3's conflict copy where the app shows notices. */
  notify: (message: string) => void;
}

export function createAppQueryClient({ notify }: QueryClientOptions): QueryClient {
  // Which session generation a mutation was submitted in, stamped when it starts and
  // read when it fails (#68 review): a conflict arriving after the session that issued
  // the mutation has ended is a stale callback — it must neither toast nor re-fetch into
  // the session now on screen. Fail-open when unstamped, so a missed stamp can never
  // silently disable §13.3's conflict handling.
  const submittedIn = new WeakMap<Mutation<unknown, unknown, unknown>, number>();
  const mutationCache = new MutationCache({
    onMutate: (_variables, mutation) => {
      submittedIn.set(mutation, currentSessionVersion());
    },
    onError: (error, variables, _context, mutation) => {
      if (!(error instanceof ApiError) || !error.isConflict) return;
      const submitted = submittedIn.get(mutation);
      if (submitted !== undefined && submitted !== currentSessionVersion()) return;

      const classified = classify(error);
      // Only current-session failures reach #71's operation-type handling.
      const ticketAction = error.code === "TICKET_VERSION_CONFLICT" || mutation.meta?.ticketAction === true;
      if (!ticketAction) {
        notify(classified.message);
        return;
      }
      notify(conflictMessage(classified));

      const id = ticketIdOf(variables);
      if (id === null) return;
      // Invalidate, don't patch: the server's version of the ticket is the only one
      // that can say who is responsible now.
      void client.invalidateQueries({ queryKey: queryKeys.tickets.detail(id) });
    },
  });
  const client = new QueryClient({
    // Failed queries are re-fetched by the user acting, not by the client hammering a
    // backend that is down.
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
    mutationCache,
  });
  return client;
}
