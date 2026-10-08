/**
 * Authentication context (#47 semantics, #48 wiring).
 *
 * Session state comes from `GET /api/me` on boot. The cookie is HttpOnly, so the SPA can
 * neither read nor store a token — which is also why no request in this app carries an
 * actor or a role. The role on `user` feeds navigation and route guards, and both are
 * presentation only: every authorisation decision is re-made server-side.
 *
 * This file also owns §13.3's 401 rule and, with it, the whole session lifecycle
 * (#68 review): `client.ts` sees every response, and this is the only place allowed to
 * drop the session — which now means the query cache as well as the login state, so one
 * account's cached data and in-flight requests can never reach the next one. Registering
 * the handler here keeps the fetch layer free of React while making "expired session" a
 * single code path.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import * as api from "../../api/endpoints";
import { setUnauthorizedHandler } from "../../api/client";
import { bumpSessionVersion, currentSessionVersion } from "../../lib/session";
import type { Role, User } from "../../api";

interface AuthValue {
  user: User | null;
  /** True until the boot-time `/api/me` probe settles. */
  initialising: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Role landing page after login. */
export function landingFor(role: Role | undefined): string {
  switch (role) {
    case "ADMIN":
      return "/workbench";
    case "TECHNICIAN":
      return "/assignments";
    default:
      return "/reports";
  }
}

/** Navigation per role, covering all nine Baseline §13.1 pages. */
export function navItemsFor(role: Role | undefined): Array<{ to: string; label: string }> {
  switch (role) {
    case "ADMIN":
      return [
        { to: "/workbench", label: "Dispatch Workbench" },
        { to: "/analytics", label: "Analytics" },
        { to: "/locations", label: "Locations" },
        { to: "/admin/users", label: "Accounts" },
      ];
    case "TECHNICIAN":
      return [{ to: "/assignments", label: "My Assignments" }];
    default:
      return [
        { to: "/reports", label: "My Repairs" },
        { to: "/reports/new", label: "Create Repair" },
      ];
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initialising, setInitialising] = useState(true);
  const queryClient = useQueryClient();

  // Dropping the cache is part of every session boundary (#68 review). `cancelQueries`
  // aborts what is still in flight so a late response can neither repopulate the cache
  // under the next account nor process a 401 against it; `clear()` removes every cached
  // entry and mutation the previous session owned. React Query is the owner of ticket,
  // location, timeline and statistics data (§13.2), so this is what keeps one account's
  // internal notes from greeting whoever signs in next.
  const resetQueryCache = useCallback(() => {
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);

  // Clearing the user is the whole redirect: `RequireSession` sees no session on the
  // next render and sends the app to /login, so there is no imperative navigation to
  // race against, and no route that can render ticket data with a dead session.
  const endSession = useCallback(() => {
    bumpSessionVersion();
    resetQueryCache();
    setUser(null);
  }, [resetQueryCache]);

  useEffect(() => {
    setUnauthorizedHandler(endSession);
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  useEffect(() => {
    const controller = new AbortController();
    const versionAtBoot = currentSessionVersion();
    api
      .getCurrentUser(controller.signal)
      // The probe belongs to the session it started in: if a boundary happened while it
      // was in flight — logout, a faster login — its answer describes an account the
      // app has already moved past and must not resurrect.
      .then((me) => {
        if (currentSessionVersion() === versionAtBoot) setUser(me);
      })
      // A rejected probe is not an error state to show: it means "not signed in".
      .catch(() => {
        if (currentSessionVersion() === versionAtBoot) setUser(null);
      })
      .finally(() => setInitialising(false));
    return () => controller.abort();
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const resolved = await api.login({ email, password });
      // Signing in is a boundary too: whatever the previous session left behind — it
      // should already be gone via `endSession` — must not survive into this account.
      bumpSessionVersion();
      resetQueryCache();
      setUser(resolved);
      return resolved;
    },
    [resetQueryCache],
  );

  const logout = useCallback(async () => {
    // The local boundary happens before the round trip, so the redirect never waits on
    // the network; logout is 204 and idempotent. A failed round trip is swallowed here
    // rather than rethrown — it would surface as an unhandled rejection in the click
    // handler — and whether a failed logout should also be *shown* is #47's call. A 401
    // from the logout itself re-runs `endSession`, which is idempotent.
    endSession();
    await api.logout().catch(() => undefined);
  }, [endSession]);

  const value = useMemo(
    () => ({ user, initialising, login, logout }),
    [user, initialising, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
