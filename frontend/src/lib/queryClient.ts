/**
 * Server-state wiring (P0 Baseline §13.2, §13.3).
 *
 * §13.2 makes TanStack Query the owner of ticket, location, timeline and statistics data.
 * Two things follow from a scaffold that must be shared, and both live here so no page
 * invents its own version:
 *
 *   1. One query-key factory. Cache keys are the only place a resource is named, and two
 *      pages that spell the same key differently silently fail to invalidate each other.
 *   2. One 409 rule. §13.3 says a conflict tells the user and re-fetches the authoritative
 *      ticket — so that happens in the mutation cache, not in whichever page remembers.
 *
 * The notification is injected rather than imported: toasts belong to React's tree, and
 * taking the callback as an argument keeps this file testable without rendering anything.
 */

import { MutationCache, QueryClient } from "@tanstack/react-query";

import { ApiError } from "../api/client";
import { conflictMessage, classify } from "../lib/errors";
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
 * Which ticket a mutation was acting on. Every action endpoint takes the id as its first
 * argument, so the convention is that its variables carry `id` or `ticketId`; anything
 * else still gets the message, it just cannot be re-fetched automatically.
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

export interface QueryClientOptions {
  /** Render §13.3's conflict copy where the app shows notices. */
  notify: (message: string) => void;
}

export function createAppQueryClient({ notify }: QueryClientOptions): QueryClient {
  const client = new QueryClient({
    // Failed queries are re-fetched by the user acting, not by the client hammering a
    // backend that is down.
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
    mutationCache: new MutationCache({
      onError: (error, variables) => {
        if (!(error instanceof ApiError) || !error.isConflict) return;

        notify(conflictMessage(classify(error)));

        const id = ticketIdOf(variables);
        if (id === null) return;
        // Invalidate, don't patch: the server's version of the ticket is the only one
        // that can say who is responsible now.
        void client.invalidateQueries({ queryKey: queryKeys.tickets.detail(id) });
      },
    }),
  });
  return client;
}
