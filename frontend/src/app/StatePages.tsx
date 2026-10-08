/**
 * 404 / 403 pages (status semantics: Baseline §11.5).
 *
 * Not-found copy is deliberately generic and carries no existence hint: a
 * reporter asking for another reporter's ticket gets the same page as one
 * asking for a ticket that does not exist.
 */

import { Link } from "react-router-dom";

import { landingFor, useAuth } from "../features/auth/AuthContext";

export function NotFoundPage() {
  const { user } = useAuth();
  return (
    <div className="state-page">
      <h1>This page is not available</h1>
      <p className="muted">
        The address may be incorrect, or the item may have been removed.
      </p>
      <Link className="button primary" to={user ? landingFor(user.role) : "/login"}>
        {user ? "Back to my work" : "Go to sign in"}
      </Link>
    </div>
  );
}

export function DeniedPage() {
  const { user } = useAuth();
  return (
    <div className="state-page">
      <h1>You don't have access to this page</h1>
      <p className="muted">Your account does not have permission for this area.</p>
      <Link className="button primary" to={user ? landingFor(user.role) : "/login"}>
        Back to my work
      </Link>
    </div>
  );
}

/**
 * Stand-in for a page whose module has not landed yet.
 *
 * The scaffold declares every contracted route (see app/App.tsx) and renders this
 * for the ones with no implementation, so the route table, the role gates and the
 * Mock layer are all usable before the screens arrive - which is what #48 asks for
 * ("脚手架只搭一次，两人共用"). It says which owner fills it rather than failing
 * silently, because a blank page reads like a working page.
 */
export function UnbuiltPage({ route, owner }: { route: string; owner: string }) {
  return (
    <div className="state-page">
      <h1>{route} is not built yet</h1>
      <p className="muted">
        The route is wired; the screen is owned by {owner}. Until it lands, mount a
        Mock responder (src/api/mockBridge.ts) to develop against it.
      </p>
    </div>
  );
}
