/**
 * Application shell: role-based navigation, current user, logout
 * (a persistent left rail on desktop, an identity bar on top).
 *
 * The shell renders the role's destinations in three interchangeable forms
 * (one per viewport band):
 *   .nav-rail   — ≥1024px, one full-height region flush to the viewport's left
 *                 edge at every desktop width. 240px wide at
 *                 ≥1280px; at 1024-1279px it collapses to icons,
 *                 because 240px there leaves 784px for a detail page that needs
 *                 a two-column split.
 *   .task-bar   — 720-1023px, the second tier of the header.
 *   .tab-bar    — <720px, the thumb zone.
 * Exactly one is *visible* per band, and the
 * choice is CSS-only so the three stay one component rather than a resize
 * listener plus a re-render.
 *
 * All three map the SAME array from `navItemsFor`, which is the only reason
 * their destination sets can disagree. A second list literal here would be the
 * "same rule, two homes" defect already removed once in this repo (c2ffcc9).
 *
 * Navigation is derived from the signed-in role only. Hiding a link is UX, not
 * security: every route and every operation is re-authorised server-side.
 */

import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { landingFor, navItemsFor, useAuth } from "../features/auth/AuthContext";
import { ROLE_LABELS } from "../lib/labels";
import { Icon, type IconName } from "./Icon";

/** One glyph per destination, so the navigation reads at a glance. */
const NAV_ICONS: Record<string, IconName> = {
  "/reports": "doc",
  "/reports/new": "plus",
  "/workbench": "doc",
  "/analytics": "chart",
  "/locations": "building",
  "/assignments": "wrench",
};

/** The reporter's create action is the page's one obvious next step, so it is
 *  styled as a button rather than as another tab. */
const CTA_PATH = "/reports/new";

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;

  const links = navItemsFor(user.role);
  const roleLabel = user.role ? ROLE_LABELS[user.role] : "";

  const onLogout = async () => {
    setSigningOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <nav className="nav-rail" aria-label="Main">
        <ul className="nav-rail-links">
          {links.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={link.to === "/reports"}
                // The tooltip is what makes the collapsed band usable; in the
                // full band it repeats a label that is already on screen, which
                // is noise the browser shows for one hover.
                title={link.label}
                className={({ isActive }) =>
                  [
                    "nav-rail-link",
                    isActive ? "nav-rail-link-active" : "",
                    link.to === CTA_PATH ? "nav-link-cta" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")
                }
              >
                <Icon name={NAV_ICONS[link.to] ?? "doc"} />
                <span className="nav-rail-label">{link.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="app-column">
        <header className="app-header">
          <div className="app-nav">
            <div className="identity-bar">
              <Link to={landingFor(user.role)} className="brand">
                <span className="brand-mark" aria-hidden="true">
                  <Icon name="wrench" />
                </span>
                CampusFix
              </Link>
              <span className="role-pill">{roleLabel}</span>
              <div className="nav-user">
                <span className="nav-identity">
                  <span className="nav-name">{user.name}</span>
                  <span className="nav-role">{roleLabel}</span>
                </span>
                <button type="button" onClick={onLogout} disabled={signingOut}>
                  <Icon name="out" className="icon-sm" />
                  {signingOut ? "Logging out…" : "Log out"}
                </button>
              </div>
            </div>

            {/* Its own navigation region rather than a tier of the identity bar's,
                because the two are never both the destination carrier: below 1024px
                this is the app's only top-level nav, and at or above it the identity
                bar carries no destinations at all. */}
            <nav className="task-bar" aria-label="Sections">
              <ul className="nav-links">
                {links.map((link) => (
                  <li key={link.to}>
                    <NavLink
                      to={link.to}
                      end={link.to === "/reports"}
                      className={({ isActive }) =>
                        [
                          "nav-link",
                          isActive ? "nav-link-active" : "",
                          link.to === CTA_PATH ? "nav-link-cta" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")
                      }
                    >
                      <Icon name={NAV_ICONS[link.to] ?? "doc"} className="icon-sm" />
                      {link.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </header>

        <main
          className="app-main"
          id="main"
          // The skip link already targets #main, and Modal's focus return falls
          // back here when a removed action took its own trigger with it. Both
          // need this to be focusable without joining the tab order.
          tabIndex={-1}
        >
          <Outlet />
        </main>
      </div>

      <nav className="tab-bar" aria-label="Primary">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === "/reports"}
            className={({ isActive }) => (isActive ? "tab-link tab-link-active" : "tab-link")}
          >
            <Icon name={NAV_ICONS[link.to] ?? "doc"} />
            {link.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
