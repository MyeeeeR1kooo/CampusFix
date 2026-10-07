/**
 * Authentication context (#47 semantics, #48 wiring).
 *
 * Session state comes from `GET /api/me` on boot. The cookie is HttpOnly, so the SPA can
 * neither read nor store a token — which is also why no request in this app carries an
 * actor or a role. The role on `user` feeds navigation and route guards, and both are
 * presentation only: every authorisation decision is re-made server-side.
 *
 * This file also owns §13.3's 401 rule. `client.ts` sees every response, and this is the
 * only place allowed to drop the session; registering the handler here keeps the fetch
 * layer free of React while making "expired session" a single code path.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import * as api from "../../api/endpoints";
import { setUnauthorizedHandler } from "../../api/client";
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

  // Clearing the user is the whole redirect: `RequireSession` sees no session on the
  // next render and sends the app to /login, so there is no imperative navigation to
  // race against, and no route that can render ticket data with a dead session.
  const clearSession = useCallback(() => setUser(null), []);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .getCurrentUser(controller.signal)
      .then(setUser)
      // A rejected probe is not an error state to show: it means "not signed in".
      .catch(() => setUser(null))
      .finally(() => setInitialising(false));
    return () => controller.abort();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const resolved = await api.login({ email, password });
    setUser(resolved);
    return resolved;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // The local clear below is what the user asked for, so it happens whatever the
      // server said; rethrowing here would surface as an unhandled rejection in the
      // click handler. Whether a failed logout should also be *shown* is #47's call.
      setUser(null);
    } finally {
      // Logout is 204 and idempotent; clear regardless so a failed round trip cannot
      // leave the UI in a half-signed-in state.
      setUser(null);
    }
  }, []);

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
