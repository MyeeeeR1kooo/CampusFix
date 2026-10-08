/**
 * Icon set.
 *
 * One system: 1.5px linear strokes on a 24×24 grid, inheriting `currentColor`,
 * never multi-coloured, never decorative. Icons exist to reinforce a label that
 * is already there — status, priority and navigation always render text as well,
 * so colour is never the sole carrier of meaning (Baseline §13.3).
 *
 * The paths are inlined rather than fetched from an icon package: this needs no
 * runtime icon service, and a sprite endpoint would be one more thing to serve.
 */

import type { ReactNode } from "react";

export type IconName =
  | "clock"
  | "users"
  | "wrench"
  | "sync"
  | "check"
  | "check-double"
  | "x-circle"
  | "minus-circle"
  | "alert"
  | "info"
  | "plus"
  | "doc"
  | "chart"
  | "building"
  | "out"
  | "camera"
  | "pin"
  | "shield"
  | "menu"
  | "chevron-down";

const PATHS: Record<IconName, ReactNode> = {
  /* SUBMITTED — waiting for review */
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  /* PENDING_ASSIGNMENT — reviewed, needs an owner */
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </>
  ),
  /* ASSIGNED — owner set, work not started */
  wrench: (
    <>
      <path d="M14.7 6.3a4 4 0 1 0 5 5L21 12l-9 9-3-3 9-9z" />
      <path d="M6 18l-2 2" />
    </>
  ),
  /* IN_PROGRESS — also the rework glyph */
  sync: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </>
  ),
  /* PENDING_CONFIRMATION — success-leaning */
  check: <path d="M20 6L9 17l-5-5" />,
  /* CLOSED — terminal, muted */
  "check-double": (
    <>
      <path d="M2 13l4 4L14 9" />
      <path d="M11 13l4 4 7-8" />
    </>
  ),
  /* REJECTED — terminal, danger */
  "x-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </>
  ),
  /* CANCELLED — terminal, withdrawn */
  "minus-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </>
  ),
  alert: (
    <>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  doc: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  chart: (
    <>
      <path d="M3 21h18" />
      <path d="M6 21V10M11 21V5M16 21v-7M21 21v-4" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
      <path d="M16 9h3a1 1 0 0 1 1 1v11" />
      <path d="M8 7h4M8 11h4M8 15h4" />
    </>
  ),
  out: (
    <>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5M15 12H3" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 5-3.4 8.4-8 9.9C7.4 20.4 4 17 4 12V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
