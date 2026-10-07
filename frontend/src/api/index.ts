/**
 * The API seam (#48).
 *
 * Baseline §13.2 forbids a second, hand-maintained set of enums and fields, so every
 * contract type in the app comes from here and nowhere else. `generated/schema.d.ts`
 * is overwritten by `npm run gen:api`; keeping the re-export in one file means a #46
 * freeze is a re-run plus whatever this file has to rename, instead of a search across
 * every page that happened to import a type directly.
 *
 * The aliases are the contract's own names, not a translation of them. If a name here
 * stops matching the generated file the build fails and says which one — that is the
 * whole point of the seam.
 */

import type { components } from "./generated/schema";

type Schema = components["schemas"];

export type Id = Schema["Id"];
export type Version = Schema["Version"];
export type UtcDateTime = Schema["UtcDateTime"];

export type Role = Schema["Role"];
/** Roles an Admin may manage — the contract keeps this narrower than `Role`. */
export type ManagedRole = Schema["ManagedRole"];
export type TicketStatus = Schema["TicketStatus"];
export type Category = Schema["Category"];
export type Priority = Schema["Priority"];
export type Visibility = Schema["Visibility"];
export type AttachmentPurpose = Schema["AttachmentPurpose"];
export type EventType = Schema["EventType"];
export type TicketAction = Schema["TicketAction"];
export type NextAction = NonNullable<Schema["TicketFields"]["next_action"]>;

export type ErrorCode = Schema["ErrorCode"];
export type FieldError = Schema["FieldError"];
export type ErrorResponse = Schema["ErrorResponse"];

export type User = Schema["User"];
export type UserSummary = Schema["UserSummary"];
export type LoginRequest = Schema["LoginRequest"];

export type TicketFields = Schema["TicketFields"];
export type TicketSummary = Schema["TicketSummary"];
export type TicketDetail = Schema["TicketDetail"];
export type CreateTicketRequest = Schema["CreateTicketRequest"];

export type ReviewRequest = Schema["ReviewRequest"];
export type ApproveRequest = Schema["ApproveRequest"];
export type RejectRequest = Schema["RejectRequest"];
export type AssignRequest = Schema["AssignRequest"];
export type StartRequest = Schema["StartRequest"];
export type ResolveRequest = Schema["ResolveRequest"];
export type ReworkRequest = Schema["ReworkRequest"];
export type CancelRequest = Schema["CancelRequest"];
export type CommentRequest = Schema["CommentRequest"];
export type VersionRequest = Schema["VersionRequest"];

export type Attachment = Schema["Attachment"];
export type Assignment = Schema["Assignment"];
export type TicketEvent = Schema["TicketEvent"];
export type Comment = Schema["Comment"];
export type TimelineEntry = TicketEvent | Comment;

export type Location = Schema["Location"];
export type CreateLocationRequest = Schema["CreateLocationRequest"];
export type UpdateLocationRequest = Schema["UpdateLocationRequest"];
export type UserActiveRequest = Schema["UserActiveRequest"];

export type Analytics = Schema["Analytics"];

/**
 * The list envelope, named once so three pages can share one type. This restates the
 * shape, so it is pinned to the generated schemas below: if #46 changes `items` or
 * `next_cursor`, that check fails instead of this quietly drifting.
 */
export type Page<T> = { items: T[]; next_cursor: string | null };

export type TicketPage = Page<TicketSummary>;
export type LocationPage = Page<Location>;
export type UserPage = Page<User>;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
// Compile-time only: the three envelopes the contract actually declares.
const _pagePinned: [
  Same<Page<TicketSummary>, Schema["TicketList"]>,
  Same<Page<Location>, Schema["LocationList"]>,
  Same<Page<User>, Schema["UserList"]>,
] = [true, true, true];
void _pagePinned;

export { ApiError, http, buildQuery, setUnauthorizedHandler } from "./client";
export * as api from "./endpoints";
