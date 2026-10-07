/**
 * Canonical presentation vocabulary (P0 Baseline §11.1, §13.1).
 *
 * Every key is a contract enum member imported through the `src/api` seam, and each map
 * is typed as a complete `Record<Enum, …>`. That is deliberate: when #46 freezes and a
 * value is renamed or dropped, this file fails to compile rather than rendering an
 * `undefined` badge in front of a user.
 *
 * The `…_ORDER` lists are read off the maps, so no enum is written twice. Object key
 * order is insertion order, which is why the maps are declared in the order the UI needs.
 */

import type { IconName } from "../components/Icon";
import type { Category, EventType, Priority, Role, TicketAction, TicketStatus } from "../api";

/** Status labels — exactly the eight `TicketStatus` members the contract carries. */
export const STATUS_LABELS: Record<TicketStatus, string> = {
  SUBMITTED: "Submitted",
  PENDING_ASSIGNMENT: "Pending Assignment",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  PENDING_CONFIRMATION: "Pending Confirmation",
  CLOSED: "Closed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/**
 * Badge tone per status. Text is always rendered too — colour is never the only carrier.
 * Each status gets its own tone rather than sharing three, so a dispatcher scanning a
 * queue can tell "reviewed, needs an owner" from "owner set" without reading the label.
 */
export type Tone = "info" | "indigo" | "teal" | "elevated" | "success" | "muted" | "danger";

export const STATUS_TONES: Record<TicketStatus, Tone> = {
  SUBMITTED: "info",
  PENDING_ASSIGNMENT: "indigo",
  ASSIGNED: "teal",
  IN_PROGRESS: "elevated",
  PENDING_CONFIRMATION: "success",
  CLOSED: "muted",
  REJECTED: "danger",
  CANCELLED: "muted",
};

/** One glyph per status, so a badge carries colour + shape + text. */
export const STATUS_ICONS: Record<TicketStatus, IconName> = {
  SUBMITTED: "clock",
  PENDING_ASSIGNMENT: "users",
  ASSIGNED: "wrench",
  IN_PROGRESS: "sync",
  PENDING_CONFIRMATION: "check",
  CLOSED: "check-double",
  REJECTED: "x-circle",
  CANCELLED: "minus-circle",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

/** Six categories, exactly as the contract declares them. */
export const CATEGORY_LABELS: Record<Category, string> = {
  LIGHTING_ELECTRICAL: "Lighting & Electrical",
  DOORS_WINDOWS_LOCKS: "Doors, Windows & Locks",
  FURNITURE: "Furniture",
  HVAC: "HVAC",
  WATER_SANITARY: "Water & Sanitary",
  OTHER_FACILITY: "Other Facility",
};

export const ROLE_LABELS: Record<Role, string> = {
  REPORTER: "Reporter",
  ADMIN: "Administrator",
  TECHNICIAN: "Technician",
};

/** Timeline event labels — the nine `EventType` members, no invented ones. */
export const EVENT_LABELS: Record<EventType, string> = {
  TICKET_SUBMITTED: "Submitted",
  TICKET_APPROVED: "Reviewed — approved for assignment",
  TICKET_REJECTED: "Rejected",
  TICKET_CANCELLED: "Cancelled",
  TICKET_ASSIGNED: "Assigned",
  WORK_STARTED: "Processing started",
  RESOLUTION_SUBMITTED: "Result submitted",
  TICKET_CLOSED: "Confirmed — closed",
  REWORK_REQUESTED: "Rework requested",
};

/**
 * Action labels. The server sends `allowed_actions` on every ticket, so the UI never
 * infers a capability from status; typing this as a full `Record` means an action the
 * frontend has never heard of stops the build instead of silently rendering nothing.
 */
export const ACTION_LABELS: Record<TicketAction, string> = {
  REVIEW: "Review",
  ASSIGN: "Assign",
  START: "Start work",
  RESOLVE: "Submit result",
  CONFIRM: "Confirm completion",
  REWORK: "Request rework",
  CANCEL: "Cancel request",
  COMMENT_PUBLIC: "Add comment",
  COMMENT_ADMIN_ONLY: "Add internal note",
};

/** "Who acts next" per status, for the detail header strip. */
export const NEXT_ACTOR: Record<TicketStatus, string> = {
  SUBMITTED: "Next: the dispatcher reviews this ticket",
  PENDING_ASSIGNMENT: "Next: the dispatcher assigns a technician",
  ASSIGNED: "Next: the assigned technician starts the repair",
  IN_PROGRESS: "Next: the assigned technician submits the result",
  PENDING_CONFIRMATION: "Next: the reporter confirms or requests rework",
  CLOSED: "No further action — this ticket is closed",
  REJECTED: "No further action — this ticket was rejected",
  CANCELLED: "No further action — this ticket was cancelled",
};

/** Owner column wording while a ticket has no assignee. */
export const OWNER_PENDING: Partial<Record<TicketStatus, string>> = {
  SUBMITTED: "Awaiting review",
  PENDING_ASSIGNMENT: "Awaiting assignment",
};

/** Terminal statuses render a persistent, non-dismissible banner. */
export const TERMINAL_STATUSES: readonly TicketStatus[] = ["CLOSED", "REJECTED", "CANCELLED"];

export function isTerminal(status: TicketStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/* ==========================================================================
   Responsibility rail

   The rail is the visual form of the detail header rule: current status, current
   owner, who acts next. It derives entirely from data the detail endpoint already
   returns (status + timeline), so it adds no contract surface:

     • which step the ticket is on      ← the status
     • which steps were reached         ← the timeline events
     • who performed each reached step  ← the event actor
     • how many rework rounds happened  ← REWORK_REQUESTED events

   Rework is deliberately not a step: it returns the ticket to the repair phase, so the
   rail renders it as a badge on that step rather than as new progress.
   ========================================================================== */

export type RailStepState = "done" | "current" | "upcoming" | "failed" | "cancelled" | "dead";

export interface RailStepDefinition {
  key: string;
  label: string;
  /** The lifecycle event that marks this step as reached. */
  event: EventType;
}

export const RAIL_STEPS: RailStepDefinition[] = [
  { key: "submitted", label: "Submitted", event: "TICKET_SUBMITTED" },
  { key: "review", label: "Review", event: "TICKET_APPROVED" },
  { key: "assign", label: "Assign", event: "TICKET_ASSIGNED" },
  { key: "repair", label: "Repair", event: "WORK_STARTED" },
  { key: "confirm", label: "Confirm", event: "RESOLUTION_SUBMITTED" },
  { key: "closed", label: "Closed", event: "TICKET_CLOSED" },
];

/**
 * Which milestone a status sits on. ASSIGNED and IN_PROGRESS share the repair milestone
 * on purpose — both are in the repair phase, and the difference between "owner set, not
 * started" and "being worked on" belongs to the status badge and the action zone, which
 * can express it without blurring the track.
 *
 * Terminal statuses stop where they were decided: a rejection at review, a cancellation
 * at submission.
 */
export const STATUS_STEP: Record<TicketStatus, number> = {
  SUBMITTED: 1,
  PENDING_ASSIGNMENT: 2,
  ASSIGNED: 3,
  IN_PROGRESS: 3,
  PENDING_CONFIRMATION: 4,
  CLOSED: 5,
  REJECTED: 1,
  CANCELLED: 0,
};

/** How a terminal status colours the step it stopped on. */
export const TERMINAL_STEP: Partial<Record<TicketStatus, RailStepState>> = {
  REJECTED: "failed",
  CANCELLED: "cancelled",
};

export function statusStep(status: TicketStatus): number {
  return STATUS_STEP[status];
}

export function hasAction(actions: readonly TicketAction[], token: TicketAction): boolean {
  return actions.includes(token);
}

/** Display order, read off the maps so each enum is written exactly once. */
export const STATUS_ORDER = Object.keys(STATUS_LABELS) as TicketStatus[];
export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as Category[];
/** Highest first — the one order that is a display choice rather than the map's own. */
export const PRIORITY_ORDER: Priority[] = ["HIGH", "MEDIUM", "LOW"];

export function statusLabel(status: TicketStatus): string {
  return STATUS_LABELS[status];
}

export function categoryLabel(category: Category | null): string {
  return category ? CATEGORY_LABELS[category] : "—";
}

export function priorityLabel(priority: Priority | null): string {
  return priority ? PRIORITY_LABELS[priority] : "—";
}
