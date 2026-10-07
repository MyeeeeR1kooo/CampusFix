/**
 * Application root: providers + route table (P0 Baseline §13.1, §13.2).
 *
 * Provider order is load-bearing: the error boundary wraps everything, auth resolves
 * before any guard runs, the query client sits *under* the toast provider because §13.3's
 * conflict notice needs somewhere to be rendered, and toasts are available to every page.
 *
 * Route map — all nine pages Baseline §13.1 lists, no more:
 *   /login            all
 *   /reports          Reporter
 *   /reports/new      Reporter
 *   /tickets/:id      any related actor (the server decides visibility)
 *   /workbench        Administrator
 *   /assignments      Technician
 *   /analytics        Administrator
 *   /locations        Administrator
 *   /admin/users      Administrator — account management (#49)
 *
 * The table declares every page but imports only the screens that exist. On this scaffold
 * that is `/login` alone; the rest render `UnbuiltPage`, which names the owner. That is
 * what lets #48 land first: a map that statically imported all nine screens would make the
 * scaffold depend on nine implementations, and "脚手架只搭一次，两人共用" would stop
 * being true.
 *
 * The role gates below are a navigation affordance, not a permission control. AGENTS.md §6
 * forbids treating a route guard or a hidden button as authorisation, and every decision is
 * re-made server-side from the session cookie.
 */

import { useMemo } from "react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "../components/AppLayout";
import { AuthProvider, landingFor, useAuth } from "../features/auth/AuthContext";
import { LoginPage } from "../features/auth/LoginPage";
import { ToastProvider, useToast } from "../hooks/useToast";
import { createAppQueryClient } from "../lib/queryClient";
import { ErrorBoundary } from "./ErrorBoundary";
import { NotFoundPage, UnbuiltPage } from "./StatePages";
import { RequireRole, RequireSession } from "./ProtectedRoute";

/** Sends an authenticated visitor from "/" to their role's landing page. */
function RoleHome() {
  const { user, initialising } = useAuth();
  if (initialising) return <p role="status">Loading…</p>;
  return <Navigate to={user ? landingFor(user.role) : "/login"} replace />;
}

/** A contracted route whose screen has an owner but no implementation yet. */
function pending(route: string, owner: string) {
  return <UnbuiltPage route={route} owner={owner} />;
}

/** One client for the app, carrying §13.3's 409 behaviour in its mutation cache. */
function QueryProvider({ children }: { children: ReactNode }) {
  const { notify } = useToast();
  const client = useMemo(
    // A conflict is not something the user did wrong, so it reads as info, not error.
    () => createAppQueryClient({ notify: (message) => notify(message, "info") }),
    [notify],
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <QueryProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/" element={<RoleHome />} />

                <Route element={<RequireSession />}>
                  <Route element={<AppLayout />}>
                    <Route
                      path="/reports"
                      element={
                        <RequireRole roles={["REPORTER"]}>
                          {pending("My reports", "张越 (features/tickets/MyReportsPage)")}
                        </RequireRole>
                      }
                    />
                    <Route
                      path="/reports/new"
                      element={
                        <RequireRole roles={["REPORTER"]}>
                          {pending("Create a repair report", "张越 (features/tickets/CreateRepairPage)")}
                        </RequireRole>
                      }
                    />
                    <Route
                      path="/tickets/:ticketId"
                      element={pending("Ticket detail", "张越 (features/tickets/TicketDetailPage)")}
                    />
                    <Route
                      path="/workbench"
                      element={
                        <RequireRole roles={["ADMIN"]}>
                          {pending("Dispatch workbench", "舒玺悦 (features/dispatch/)")}
                        </RequireRole>
                      }
                    />
                    <Route
                      path="/assignments"
                      element={
                        <RequireRole roles={["TECHNICIAN"]}>
                          {pending("My assignments", "舒玺悦 (features/technician/)")}
                        </RequireRole>
                      }
                    />
                    <Route
                      path="/analytics"
                      element={
                        <RequireRole roles={["ADMIN"]}>
                          {pending("Statistics", "舒玺悦 (features/analytics/)")}
                        </RequireRole>
                      }
                    />
                    <Route
                      path="/locations"
                      element={
                        <RequireRole roles={["ADMIN"]}>
                          {pending("Location management", "舒玺悦 (features/locations/)")}
                        </RequireRole>
                      }
                    />
                    <Route
                      path="/admin/users"
                      element={
                        <RequireRole roles={["ADMIN"]}>
                          {pending("Account management", "舒玺悦 (features/users/, #49)")}
                        </RequireRole>
                      }
                    />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Route>
              </Routes>
            </BrowserRouter>
          </QueryProvider>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
