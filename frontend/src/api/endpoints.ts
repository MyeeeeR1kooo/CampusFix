/**
 * One function per contracted operation (#48).
 *
 * The names follow `operationId` in `docs/api/openapi.yaml`, and nothing here invents a
 * path: the draft contract declares 22 business operations and this module has 22
 * functions. `src/test/endpoints.test.ts` asserts that pairing by URL, so a route added
 * here without a contract entry fails the build instead of reaching a running backend.
 *
 * Two shapes are easy to get wrong and are pinned by that test:
 *   • responses are bare objects — login returns a `User`, not `{ user: … }`;
 *   • lists are `items` + `next_cursor`, with `cursor`/`limit` params and no total.
 */

import { buildQuery, http } from "./client";
import type {
  Analytics,
  AssignRequest,
  CancelRequest,
  Category,
  Comment,
  CommentRequest,
  CreateLocationRequest,
  Id,
  Location,
  LocationPage,
  LoginRequest,
  Priority,
  ReviewRequest,
  ReworkRequest,
  StartRequest,
  TicketDetail,
  TicketPage,
  TicketStatus,
  TicketSummary,
  UpdateLocationRequest,
  User,
  UserActiveRequest,
  UserPage,
  Version,
  VersionRequest,
} from "./index";

/** The ticket fields that travel as multipart text parts alongside `photos`. */
export interface NewTicket {
  title: string;
  description: string;
  category: Category;
  location_id: Id;
  photos?: File[];
}

const TICKETS = "/api/tickets";

// ---------------------------------------------------------------- auth (3)

/** POST /api/auth/login — 200, bare `User`. The session itself is the HttpOnly cookie. */
export function login(body: LoginRequest): Promise<User> {
  return http.post<User>("/api/auth/login", body);
}

/** POST /api/auth/logout — 204, no body to parse. */
export function logout(): Promise<void> {
  return http.post<void>("/api/auth/logout");
}

/** GET /api/me — 200, bare `User`. Named for the contract's `operationId`. */
export function getCurrentUser(signal?: AbortSignal): Promise<User> {
  return http.get<User>("/api/me", signal);
}

// ---------------------------------------------------------------- tickets (11)

export interface TicketFilters {
  cursor?: string | null;
  limit?: number;
  status?: TicketStatus;
  category?: Category;
  priority?: Priority | null;
  building?: string;
  created_from?: string;
  created_before?: string;
  q?: string;
  /** Admin-only filter, per the contract. */
  current_assignee_id?: Id;
}

/** GET /api/tickets — visibility is decided server-side from the session, not by filters. */
export function listTickets(filters: TicketFilters = {}, signal?: AbortSignal): Promise<TicketPage> {
  return http.get<TicketPage>(`${TICKETS}${buildQuery({ ...filters })}`, signal);
}

/** POST /api/tickets — 201. Fields and photos share one multipart request. */
export function createTicket(input: NewTicket): Promise<TicketSummary> {
  const form = new FormData();
  form.set("title", input.title);
  form.set("description", input.description);
  form.set("category", input.category);
  form.set("location_id", String(input.location_id));
  for (const photo of input.photos ?? []) form.append("photos", photo);
  return http.multipart<TicketSummary>(TICKETS, form);
}

/** GET /api/tickets/{id} — 200, includes the server-filtered timeline. */
export function getTicket(id: number, signal?: AbortSignal): Promise<TicketDetail> {
  return http.get<TicketDetail>(`${TICKETS}/${id}`, signal);
}

/** POST /api/tickets/{id}/review — approve carries category+priority, reject a reason. */
export function reviewTicket(id: number, body: ReviewRequest): Promise<TicketSummary> {
  return http.post<TicketSummary>(`${TICKETS}/${id}/review`, body);
}

export function assignTicket(id: number, body: AssignRequest): Promise<TicketSummary> {
  return http.post<TicketSummary>(`${TICKETS}/${id}/assign`, body);
}

export function startTicket(id: number, body: StartRequest): Promise<TicketSummary> {
  return http.post<TicketSummary>(`${TICKETS}/${id}/start`, body);
}

/** POST /api/tickets/{id}/resolve — multipart: note, expected_version, optional photos. */
export function resolveTicket(id: number, input: {
  resolution_note: string;
  expected_version: Version;
  photos?: File[];
}): Promise<TicketSummary> {
  const form = new FormData();
  form.set("resolution_note", input.resolution_note);
  form.set("expected_version", String(input.expected_version));
  for (const photo of input.photos ?? []) form.append("photos", photo);
  return http.multipart<TicketSummary>(`${TICKETS}/${id}/resolve`, form);
}

export function confirmTicket(id: number, body: VersionRequest): Promise<TicketSummary> {
  return http.post<TicketSummary>(`${TICKETS}/${id}/confirm`, body);
}

export function reworkTicket(id: number, body: ReworkRequest): Promise<TicketSummary> {
  return http.post<TicketSummary>(`${TICKETS}/${id}/rework`, body);
}

/** 撤销 — only before review; the server enforces it and answers 409 afterwards. */
export function cancelTicket(id: number, body: CancelRequest): Promise<TicketSummary> {
  return http.post<TicketSummary>(`${TICKETS}/${id}/cancel`, body);
}

/** POST /api/tickets/{id}/comments — 201. Comments never change status or version. */
export function createComment(id: number, body: CommentRequest): Promise<Comment> {
  return http.post<Comment>(`${TICKETS}/${id}/comments`, body);
}

// ---------------------------------------------------------------- attachments (1)

/**
 * GET /api/attachments/{id} — image bytes, and the server re-checks ticket visibility on
 * every read. For display, `Attachment.download_url` in an <img src> is the cheaper path:
 * the session cookie rides along and the same check still runs.
 */
export function downloadAttachment(id: number, signal?: AbortSignal): Promise<Blob> {
  return http.blob(`/api/attachments/${id}`, signal);
}

// ---------------------------------------------------------------- locations (4)

export function listActiveLocations(
  params: { cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<LocationPage> {
  return http.get<LocationPage>(`/api/locations${buildQuery({ ...params })}`, signal);
}

export function listAdminLocations(
  params: { cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<LocationPage> {
  return http.get<LocationPage>(`/api/admin/locations${buildQuery({ ...params })}`, signal);
}

/** POST /api/admin/locations — 201. Duplicate building/floor/room is a 409. */
export function createLocation(body: CreateLocationRequest): Promise<Location> {
  return http.post<Location>("/api/admin/locations", body);
}

/** PATCH /api/admin/locations/{id} — display fields and active; there is no delete. */
export function updateLocation(id: number, body: UpdateLocationRequest): Promise<Location> {
  return http.patch<Location>(`/api/admin/locations/${id}`, body);
}

// ---------------------------------------------------------------- users (2)

export interface UserFilters {
  cursor?: string | null;
  limit?: number;
  role?: "REPORTER" | "TECHNICIAN";
  active?: boolean;
}

/** GET /api/admin/users — the dispatch dropdown is this filtered on TECHNICIAN + active. */
export function listUsers(filters: UserFilters = {}, signal?: AbortSignal): Promise<UserPage> {
  return http.get<UserPage>(`/api/admin/users${buildQuery({ ...filters })}`, signal);
}

/** PATCH /api/admin/users/{id}/active — accounts are switched off, never deleted. */
export function setUserActive(id: number, body: UserActiveRequest): Promise<User> {
  return http.patch<User>(`/api/admin/users/${id}/active`, body);
}

// ---------------------------------------------------------------- analytics (1)

export function getAnalytics(signal?: AbortSignal): Promise<Analytics> {
  return http.get<Analytics>("/api/admin/analytics", signal);
}
