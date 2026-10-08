/**
 * Route guards (role map: Baseline §13.1).
 *
 * Two distinct situations, deliberately handled differently:
 *   • no session at all      → redirect to the login page, no data rendered
 *                              per Baseline §13.3's 401 rule;
 *   • signed in, wrong role  → the denial page, rendered *inside* the app
 *                              shell so the user still has their navigation
 *                              and a way back.
 *
 * Neither guard is a security boundary — the server re-checks every request.
 */

import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import type { Role } from "../api";
import { useAuth } from "../features/auth/AuthContext";
import { DeniedPage } from "./StatePages";

export function RequireSession() {
  const { user, initialising } = useAuth();
  const location = useLocation();

  if (initialising) {
    return (
      <div className="boot">
        <p role="status">Loading CampusFix…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  // `role` is optional on the wire type; treat an absent role as no access.
  if (!user.role || !roles.includes(user.role)) return <DeniedPage />;
  return <>{children}</>;
}
