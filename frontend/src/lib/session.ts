/**
 * Session generations for client-side state (#68 review).
 *
 * The backend session is a cookie and the server re-checks every request, but the
 * frontend also holds per-session state that must not outlive its session: the query
 * cache and the callbacks of work that was still in flight when the session ended.
 * Every boundary — logout, a 401, a new login replacing the previous account — bumps
 * this counter, and two guards read it:
 *
 *   • `AuthContext` discards boot-probe results that settle after the boundary, so a
 *     late `/api/me` answer cannot overwrite the account that just signed in;
 *   • `lib/queryClient.ts` stamps the generation onto each mutation when it starts, so
 *     a conflict raised by a *previous* session's mutation neither toasts nor
 *     re-fetches into the session now on screen.
 *
 * A monotonic counter rather than a timestamp: boundaries can land within the same
 * millisecond under test, and the guards have to stay deterministic.
 */

let version = 0;

/** Ends the current session generation and returns the number of the new one. */
export function bumpSessionVersion(): number {
  return (version += 1);
}

/** The generation that in-flight work belongs to. */
export function currentSessionVersion(): number {
  return version;
}
