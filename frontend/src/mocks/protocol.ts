import { z } from "zod";
import type { ErrorCode, ErrorResponse, FieldError, Page } from "../api";
import { CATEGORY_ORDER, PRIORITY_ORDER, STATUS_ORDER } from "../lib/labels";

let requestSequence = 0;
export function requestId(): string { return `req_mock_${++requestSequence}`; }
export function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "X-Request-ID": requestId() },
  });
}

export class MockFailure extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, message: string, readonly fields: FieldError[] = []) { super(message); }
  response(): Response {
    const id = requestId();
    const body: ErrorResponse = { error: { code: this.code, message: this.message, request_id: id, field_errors: this.fields } };
    return new Response(JSON.stringify(body), { status: this.status, headers: { "Content-Type": "application/json", "X-Request-ID": id } });
  }
}

export function invalid(field: string, message: string, status = 422): never {
  throw new MockFailure(status, "VALIDATION_ERROR", "Input validation failed.", [{ field, message, type: "value_error" }]);
}
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new MockFailure(422, "VALIDATION_ERROR", "Input validation failed.", result.error.issues.map((issue) => ({
    field: issue.path.join("."), message: issue.message, type: issue.code,
  })));
  return result.data;
}

// Runtime validation of the reviewed draft's constraints; response types remain generated.
// Validate required text without rewriting it or shortening it before maxLength checks.
const text = z.string().min(1).refine((value) => value.trim().length > 0, "Enter a non-blank value.");
const id = z.number().int().positive();
const version = { expected_version: id };
export const schemas = {
  login: z.object({ email: z.email(), password: z.string().min(1) }).strict(),
  create: z.object({ title: text.max(120), description: text.max(4000), category: z.enum(CATEGORY_ORDER), location_id: id }).strict(),
  review: z.discriminatedUnion("decision", [
    z.object({ decision: z.literal("APPROVE"), category: z.enum(CATEGORY_ORDER), priority: z.enum(PRIORITY_ORDER), ...version }).strict(),
    z.object({ decision: z.literal("REJECT"), reason: text, ...version }).strict(),
  ]),
  assign: z.object({ technician_id: id, ...version }).strict(),
  start: z.object({ note: z.string().optional(), ...version }).strict(),
  resolve: z.object({ resolution_note: text, ...version }).strict(),
  confirm: z.object(version).strict(),
  rework: z.object({ reason: text, ...version }).strict(),
  cancel: z.object({ reason: z.string().optional(), ...version }).strict(),
  comment: z.object({ body: text.max(2000), visibility: z.enum(["PUBLIC", "ADMIN_ONLY"]) }).strict(),
  location: z.object({ building: text, floor: text, room_or_area: text, active: z.boolean().default(true) }).strict(),
  locationPatch: z.object({ building: text.optional(), floor: text.optional(), room_or_area: text.optional(), active: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one field."),
  active: z.object({ active: z.boolean() }).strict(),
  filters: z.object({ status: z.enum(STATUS_ORDER).optional(), category: z.enum(CATEGORY_ORDER).optional(), priority: z.enum(PRIORITY_ORDER).optional(), building: text.optional(), q: text.optional(), created_from: z.iso.datetime().optional(), created_before: z.iso.datetime().optional(), current_assignee_id: z.coerce.number().int().positive().optional() }).strict(),
  users: z.object({ role: z.enum(["REPORTER", "TECHNICIAN"]).optional(), active: z.enum(["true", "false"]).optional() }).strict(),
};

type Ordered = { id: number; created_at: string };
export function descending(a: Ordered, b: Ordered) { return Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id; }

/** Opaque in-memory tokens bind the keyset anchor to the viewer, path and filters. */
export function createPaginator() {
  const cursors = new Map<string, { scope: string; anchor: Ordered }>();
  let sequence = 0;
  return <T extends Ordered>(items: T[], url: URL, userId: number): Page<T> => {
    const params = new URLSearchParams(url.search);
    const cursor = params.get("cursor");
    const limitText = params.get("limit") ?? "20";
    const limit = Number(limitText);
    if (!/^\d+$/.test(limitText) || !Number.isInteger(limit) || limit < 1 || limit > 100) invalid("limit", "Use 1–100.");
    params.delete("cursor"); params.delete("limit"); params.sort();
    const scope = `${userId}:${url.pathname}?${params}`;
    const saved = cursor ? cursors.get(cursor) : undefined;
    if (cursor !== null && (!saved || saved.scope !== scope)) invalid("cursor", "Invalid cursor for these filters.", 400);
    const ordered = [...items].sort(descending).filter((item) => !saved || descending(item, saved.anchor) > 0);
    const page = ordered.slice(0, limit);
    let next: string | null = null;
    if (ordered.length > limit) {
      next = `mock-cursor-${++sequence}`;
      cursors.set(next, { scope, anchor: { id: page.at(-1)!.id, created_at: page.at(-1)!.created_at } });
    }
    return { items: page, next_cursor: next };
  };
}

export function filters(url: URL) {
  const params = Object.fromEntries(url.searchParams);
  delete params.cursor; delete params.limit;
  return params;
}
