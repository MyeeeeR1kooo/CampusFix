import type { Analytics, Attachment, Comment, Location, Role, TicketAction, TicketDetail, TicketEvent, TicketStatus, TicketSummary, User } from "../api";
import type { MockRequest, MockResponder } from "../api/mockBridge";
import { CATEGORY_ORDER, isTerminal, STATUS_ORDER } from "../lib/labels";
import { createFixtures, locationLabel, MOCK_PASSWORD, person } from "./fixtures";
import { createPaginator, filters, invalid, json, MockFailure, parse, schemas } from "./protocol";

const responsibility: Record<TicketStatus, Pick<TicketSummary, "current_responsible_role" | "next_action">> = {
  SUBMITTED: { current_responsible_role: "ADMIN", next_action: "REVIEW" },
  PENDING_ASSIGNMENT: { current_responsible_role: "ADMIN", next_action: "ASSIGN" },
  ASSIGNED: { current_responsible_role: "TECHNICIAN", next_action: "START" },
  IN_PROGRESS: { current_responsible_role: "TECHNICIAN", next_action: "RESOLVE" },
  PENDING_CONFIRMATION: { current_responsible_role: "REPORTER", next_action: "CONFIRM_OR_REWORK" },
  CLOSED: { current_responsible_role: null, next_action: null },
  REJECTED: { current_responsible_role: null, next_action: null },
  CANCELLED: { current_responsible_role: null, next_action: null },
};

function visible(ticket: TicketDetail, user: User): boolean {
  return user.role === "ADMIN" || (user.role === "REPORTER" ? ticket.reporter.id === user.id : ticket.current_assignee?.id === user.id);
}

function actions(ticket: TicketDetail, user: User): TicketAction[] {
  if (!visible(ticket, user) || isTerminal(ticket.status)) return [];
  const allowed: TicketAction[] = ["COMMENT_PUBLIC"];
  if (user.role === "ADMIN") {
    allowed.push("COMMENT_ADMIN_ONLY");
    if (ticket.status === "SUBMITTED") allowed.push("REVIEW");
    if (ticket.status === "PENDING_ASSIGNMENT") allowed.push("ASSIGN");
  } else if (user.role === "REPORTER") {
    if (ticket.status === "SUBMITTED") allowed.push("CANCEL");
    if (ticket.status === "PENDING_CONFIRMATION") allowed.push("CONFIRM", "REWORK");
  } else {
    if (ticket.status === "ASSIGNED") allowed.push("START");
    if (ticket.status === "IN_PROGRESS") allowed.push("RESOLVE");
  }
  return allowed;
}

function summary(ticket: TicketDetail, user: User): TicketSummary {
  const { description: _description, report_photos: _reports, resolution_photos: _results, assignments: _assignments, timeline: _timeline, ...fields } = ticket;
  return { ...fields, ...responsibility[ticket.status], allowed_actions: actions(ticket, user) };
}

function detail(ticket: TicketDetail, user: User): TicketDetail {
  return { ...ticket, ...summary(ticket, user), timeline: ticket.timeline
    .filter((entry) => entry.visibility === "PUBLIC" || user.role === "ADMIN")
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.kind.localeCompare(b.kind) || a.id - b.id) };
}

function requireRole(user: User, role: Role) {
  if (user.role !== role) throw new MockFailure(403, "FORBIDDEN", "This action is not allowed for your role.");
}

function sameLocation(a: Pick<Location, "building" | "floor" | "room_or_area">, b: Pick<Location, "building" | "floor" | "room_or_area">) {
  return a.building === b.building && a.floor === b.floor && a.room_or_area === b.room_or_area;
}

function checkVersion(ticket: TicketDetail, version: number) {
  if (ticket.version !== version) throw new MockFailure(409, "TICKET_VERSION_CONFLICT", "The ticket has already been updated.");
}

function checkState(ticket: TicketDetail, status: TicketStatus) {
  if (ticket.status !== status) throw new MockFailure(409, "CONFLICT", "This action is not available in the current ticket state.");
}

function formBody(request: MockRequest) {
  if (!request.form) invalid("body", "Use multipart/form-data.", 400);
  const body: Record<string, unknown> = Object.fromEntries(request.form);
  delete body.photos;
  for (const field of ["location_id", "expected_version"]) if (field in body) body[field] = Number(body[field]);
  return body;
}

/** A fresh instance isolates each test or browser boot. No cookies/tokens/localStorage are imitated. */
export function createMockApi(options: { now?: () => Date; emptyTickets?: boolean } = {}) {
  const now = options.now ?? (() => new Date());
  const store = createFixtures(now());
  if (options.emptyTickets) store.tickets = [];
  const paginate = createPaginator();
  const blobs = new Map<number, { bytes: Uint8Array; mime: string }>();
  let userId: number | null = null;
  let expiresAt = 0;
  let nextTicket = Math.max(0, ...store.tickets.map((ticket) => ticket.id)) + 1;
  let nextEntry = 10000;
  let nextAttachment = 1;
  const timestamp = () => now().toISOString();

  function currentUser(): User {
    const user = store.users.find((item) => item.id === userId);
    if (!user || !user.active || now().getTime() >= expiresAt) {
      userId = null;
      throw new MockFailure(401, "UNAUTHORIZED", "Please log in again.");
    }
    return user;
  }

  function findTicket(id: number, user: User) {
    const ticket = store.tickets.find((item) => item.id === id);
    if (!ticket || !visible(ticket, user)) throw new MockFailure(404, "NOT_FOUND", "Ticket not found.");
    return ticket;
  }

  function transition(ticket: TicketDetail, user: User, status: TicketStatus, type: TicketEvent["type"], note: string | null = null) {
    const from = ticket.status;
    ticket.status = status;
    ticket.version += 1;
    ticket.updated_at = timestamp();
    ticket.closed_at = status === "CLOSED" ? ticket.updated_at : null;
    ticket.timeline.push({ kind: "EVENT", id: nextEntry++, ticket_id: ticket.id, actor: person(user), type,
      from_status: from, to_status: status, note, visibility: "PUBLIC", created_at: ticket.updated_at });
  }

  async function photos(request: MockRequest, existing = 0) {
    const files = request.form?.getAll("photos") ?? [];
    const checked: Array<{ file: File; bytes: Uint8Array }> = [];
    if (files.length + existing > 5) invalid("photos", "At most five images per purpose.");
    for (const [index, value] of files.entries()) {
      const field = `photos.${index}`;
      if (!(value instanceof File)) invalid(field, "Select an image file.");
      if (!["image/jpeg", "image/png", "image/webp"].includes(value.type)) invalid(field, "Use JPEG, PNG or WebP.", 415);
      if (value.size > 5 * 1024 * 1024) invalid(field, "The image exceeds 5 MiB.", 413);
      if (!value.size) invalid(field, "The image is empty.");
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(new MockFailure(422, "VALIDATION_ERROR", "The image could not be read."));
        reader.readAsArrayBuffer(value);
      });
      const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
      const mime = starts(0xff, 0xd8, 0xff) ? "image/jpeg" : starts(137, 80, 78, 71, 13, 10, 26, 10) ? "image/png"
        : starts(82, 73, 70, 70) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" ? "image/webp" : null;
      if (mime !== value.type) invalid(field, "Image content does not match an allowed type.", 415);
      // Browser decoding exercises damaged-file feedback without a second image library.
      const url = URL.createObjectURL(value);
      try {
        await new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => reject(new MockFailure(422, "VALIDATION_ERROR", "Invalid image.", [{ field, message: "The image cannot be decoded.", type: "value_error" }]));
          image.src = url;
        });
      } finally { URL.revokeObjectURL(url); }
      checked.push({ file: value, bytes });
    }
    return checked;
  }

  function attach(files: Array<{ file: File; bytes: Uint8Array }>, ticket: TicketDetail, user: User, purpose: Attachment["purpose"]) {
    for (const { file, bytes } of files) {
      const id = nextAttachment++;
      const attachment: Attachment = { id, ticket_id: ticket.id, uploader: person(user), original_name: file.name,
        mime: file.type as Attachment["mime"], size: file.size, purpose, created_at: timestamp(), download_url: `/api/attachments/${id}` };
      blobs.set(id, { bytes, mime: file.type });
      (purpose === "REPORT_PHOTO" ? ticket.report_photos : ticket.resolution_photos).push(attachment);
    }
  }

  function analytics(): Analytics {
    const tickets = store.tickets;
    const closed = tickets.filter((ticket) => ticket.status === "CLOSED" && ticket.closed_at);
    // Adding eight hours before taking the UTC date gives the Shanghai calendar date.
    const date = (value: string | number) => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10);
    const buildings = [...new Set(tickets.map((ticket) => store.locations.find((location) => location.id === ticket.location_id)!.building))];
    return {
      by_status: STATUS_ORDER.map((status) => ({ status, count: tickets.filter((ticket) => ticket.status === status).length })),
      by_category: CATEGORY_ORDER.map((category) => ({ category, count: tickets.filter((ticket) => ticket.category === category).length })),
      by_building: buildings.map((building) => ({ building, count: tickets.filter((ticket) => store.locations.find((location) => location.id === ticket.location_id)?.building === building).length })),
      backlog_count: tickets.filter((ticket) => !isTerminal(ticket.status)).length,
      average_close_seconds: closed.length ? closed.reduce((sum, ticket) => sum + (Date.parse(ticket.closed_at!) - Date.parse(ticket.created_at)) / 1000, 0) / closed.length : 0,
      daily_trend: Array.from({ length: 30 }, (_, index) => {
        const day = date(now().getTime() - (29 - index) * 86400000);
        return { date: day, created_count: tickets.filter((ticket) => date(ticket.created_at) === day).length,
          closed_count: closed.filter((ticket) => date(ticket.closed_at!) === day).length };
      }),
    };
  }

  async function handle(request: MockRequest): Promise<Response | null> {
    const url = new URL(request.path, "http://mock.invalid");
    const path = url.pathname;
    const method = request.method.toUpperCase();
    if (!path.startsWith("/api/")) return null;

    if (method === "POST" && path === "/api/auth/login") {
      const body = parse(schemas.login, request.json);
      const user = store.users.find((item) => item.email === body.email && item.active);
      if (!user || body.password !== MOCK_PASSWORD) throw new MockFailure(401, "UNAUTHORIZED", "Email or password is not correct.");
      userId = user.id; expiresAt = now().getTime() + 8 * 3600000;
      return json(user);
    }
    const user = currentUser();
    if (method === "GET" && path === "/api/me") return json(user);
    if (method === "POST" && path === "/api/auth/logout") { userId = null; return json(null, 204); }
    if (path.startsWith("/api/admin/")) requireRole(user, "ADMIN");

    if (path === "/api/tickets" && method === "GET") {
      const query = parse(schemas.filters, filters(url));
      if (query.current_assignee_id !== undefined) requireRole(user, "ADMIN");
      const keyword = query.q?.toLowerCase();
      const tickets = store.tickets.filter((ticket) => visible(ticket, user)
        && (!query.status || ticket.status === query.status) && (!query.category || ticket.category === query.category)
        && (!query.priority || ticket.priority === query.priority)
        && (!query.building || store.locations.find((location) => location.id === ticket.location_id)?.building === query.building)
        && (!query.current_assignee_id || ticket.current_assignee?.id === query.current_assignee_id)
        && (!query.created_from || Date.parse(ticket.created_at) >= Date.parse(query.created_from))
        && (!query.created_before || Date.parse(ticket.created_at) < Date.parse(query.created_before))
        && (!keyword || [ticket.code, ticket.title].some((value) => value.toLowerCase().includes(keyword))));
      return json(paginate(tickets.map((ticket) => summary(ticket, user)), url, user.id));
    }
    if (path === "/api/tickets" && method === "POST") {
      requireRole(user, "REPORTER");
      const body = parse(schemas.create, formBody(request));
      const location = store.locations.find((item) => item.id === body.location_id && item.active);
      if (!location) invalid("location_id", "Select an active location.");
      const files = await photos(request);
      const id = nextTicket++;
      const created = timestamp();
      const ticket: TicketDetail = {
        ...body, id, code: `CF-${created.slice(0, 10).replaceAll("-", "")}-${String(id).padStart(6, "0")}`,
        reporter: person(user), location_label_snapshot: locationLabel(location), status: "SUBMITTED", version: 1,
        priority: null, current_assignee: null, created_at: created, updated_at: created, closed_at: null,
        ...responsibility.SUBMITTED, allowed_actions: [], report_photos: [], resolution_photos: [], assignments: [],
        timeline: [{ kind: "EVENT", id: nextEntry++, ticket_id: id, actor: person(user), type: "TICKET_SUBMITTED", from_status: null, to_status: "SUBMITTED", note: null, visibility: "PUBLIC", created_at: created }],
      };
      attach(files, ticket, user, "REPORT_PHOTO");
      store.tickets.push(ticket);
      const response = json(summary(ticket, user), 201);
      response.headers.set("Location", `/api/tickets/${id}`);
      return response;
    }

    const ticketMatch = path.match(/^\/api\/tickets\/(\d+)(?:\/(\w+))?$/);
    if (ticketMatch) {
      const ticket = findTicket(Number(ticketMatch[1]), user);
      const action = ticketMatch[2];
      if (!action && method === "GET") return json(detail(ticket, user));
      if (method === "POST") {
        switch (action) {
          case "comments": {
            const body = parse(schemas.comment, request.json);
            if (body.visibility === "ADMIN_ONLY") requireRole(user, "ADMIN");
            if (isTerminal(ticket.status)) throw new MockFailure(409, "CONFLICT", "Closed, rejected and cancelled tickets are read-only.");
            const comment: Comment = { ...body, kind: "COMMENT", id: nextEntry++, ticket_id: ticket.id, author: person(user), created_at: timestamp() };
            ticket.timeline.push(comment);
            return json(comment, 201);
          }
          case "review": {
            requireRole(user, "ADMIN");
            const body = parse(schemas.review, request.json);
            checkVersion(ticket, body.expected_version); checkState(ticket, "SUBMITTED");
            if (body.decision === "APPROVE") {
              ticket.category = body.category; ticket.priority = body.priority;
              transition(ticket, user, "PENDING_ASSIGNMENT", "TICKET_APPROVED");
            } else transition(ticket, user, "REJECTED", "TICKET_REJECTED", body.reason);
            break;
          }
          case "assign": {
            requireRole(user, "ADMIN");
            const body = parse(schemas.assign, request.json);
            const technician = store.users.find((item) => item.id === body.technician_id && item.active && item.role === "TECHNICIAN");
            if (!technician) invalid("technician_id", "Select an active technician.");
            checkVersion(ticket, body.expected_version); checkState(ticket, "PENDING_ASSIGNMENT");
            ticket.current_assignee = person(technician);
            ticket.assignments.push({ id: nextEntry++, ticket_id: ticket.id, technician: person(technician), assigned_by: person(user), assigned_at: timestamp(), ended_at: null, reason: null });
            transition(ticket, user, "ASSIGNED", "TICKET_ASSIGNED");
            break;
          }
          case "start": {
            requireRole(user, "TECHNICIAN");
            const body = parse(schemas.start, request.json);
            checkVersion(ticket, body.expected_version); checkState(ticket, "ASSIGNED");
            transition(ticket, user, "IN_PROGRESS", "WORK_STARTED", body.note ?? null);
            break;
          }
          case "resolve": {
            requireRole(user, "TECHNICIAN");
            const body = parse(schemas.resolve, formBody(request));
            checkVersion(ticket, body.expected_version); checkState(ticket, "IN_PROGRESS");
            const files = await photos(request, ticket.resolution_photos.length);
            attach(files, ticket, user, "RESOLUTION_PHOTO");
            transition(ticket, user, "PENDING_CONFIRMATION", "RESOLUTION_SUBMITTED", body.resolution_note);
            break;
          }
          case "confirm": {
            requireRole(user, "REPORTER");
            const body = parse(schemas.confirm, request.json);
            checkVersion(ticket, body.expected_version); checkState(ticket, "PENDING_CONFIRMATION");
            transition(ticket, user, "CLOSED", "TICKET_CLOSED"); break;
          }
          case "rework": {
            requireRole(user, "REPORTER");
            const body = parse(schemas.rework, request.json);
            checkVersion(ticket, body.expected_version); checkState(ticket, "PENDING_CONFIRMATION");
            transition(ticket, user, "IN_PROGRESS", "REWORK_REQUESTED", body.reason); break;
          }
          case "cancel": {
            requireRole(user, "REPORTER");
            const body = parse(schemas.cancel, request.json);
            checkVersion(ticket, body.expected_version); checkState(ticket, "SUBMITTED");
            transition(ticket, user, "CANCELLED", "TICKET_CANCELLED", body.reason ?? null); break;
          }
          default: throw new MockFailure(404, "NOT_FOUND", "Mock endpoint not found.");
        }
        return json(summary(ticket, user));
      }
    }

    const attachmentMatch = path.match(/^\/api\/attachments\/(\d+)$/);
    if (method === "GET" && attachmentMatch) {
      const id = Number(attachmentMatch[1]);
      const ticket = store.tickets.find((item) => [...item.report_photos, ...item.resolution_photos].some((photo) => photo.id === id));
      if (!ticket || !visible(ticket, user) || !blobs.has(id)) throw new MockFailure(404, "NOT_FOUND", "Attachment not found.");
      const blob = blobs.get(id)!;
      return new Response(new Uint8Array(blob.bytes), { headers: { "Content-Type": blob.mime, "X-Request-ID": `mock-attachment-${id}` } });
    }

    if (method === "GET" && (path === "/api/locations" || path === "/api/admin/locations")) {
      return json(paginate(store.locations.filter((location) => path.includes("/admin/") || location.active), url, user.id));
    }
    if (method === "POST" && path === "/api/admin/locations") {
      const body = parse(schemas.location, request.json);
      if (store.locations.some((location) => sameLocation(location, body))) throw new MockFailure(409, "CONFLICT", "This location already exists.");
      const location = { ...body, id: Math.max(0, ...store.locations.map((item) => item.id)) + 1, created_at: timestamp(), updated_at: timestamp() };
      store.locations.push(location);
      return json(location, 201);
    }
    const locationMatch = path.match(/^\/api\/admin\/locations\/(\d+)$/);
    if (method === "PATCH" && locationMatch) {
      const location = store.locations.find((item) => item.id === Number(locationMatch[1]));
      if (!location) throw new MockFailure(404, "NOT_FOUND", "Location not found.");
      const next = { ...location, ...parse(schemas.locationPatch, request.json) };
      if (store.locations.some((item) => item.id !== next.id && sameLocation(item, next))) throw new MockFailure(409, "CONFLICT", "This location already exists.");
      Object.assign(location, next, { updated_at: timestamp() });
      return json(location);
    }
    if (method === "GET" && path === "/api/admin/users") {
      const query = parse(schemas.users, filters(url));
      return json(paginate(store.users.filter((item) => item.role !== "ADMIN" && (!query.role || item.role === query.role)
        && (query.active === undefined || item.active === (query.active === "true"))), url, user.id));
    }
    const userMatch = path.match(/^\/api\/admin\/users\/(\d+)\/active$/);
    if (method === "PATCH" && userMatch) {
      const target = store.users.find((item) => item.id === Number(userMatch[1]));
      if (!target) throw new MockFailure(404, "NOT_FOUND", "Account not found.");
      if (target.role === "ADMIN") throw new MockFailure(403, "FORBIDDEN", "Admin accounts cannot be managed here.");
      Object.assign(target, parse(schemas.active, request.json), { updated_at: timestamp() });
      return json(target);
    }
    if (method === "GET" && path === "/api/admin/analytics") return json(analytics());
    // Fail closed within /api, so a miss cannot accidentally write to a live backend.
    throw new MockFailure(404, "NOT_FOUND", `Mock endpoint not found: ${method} ${path}`);
  }

  // Serialize mutations including asynchronous photo decoding, preserving the old-version rule.
  let queue: Promise<unknown> = Promise.resolve();
  const responder: MockResponder = (request) => {
    const response = queue.then(() => handle(request)).catch((error: unknown) => {
      if (error instanceof MockFailure) return error.response();
      throw error;
    });
    queue = response.catch(() => undefined);
    return response;
  };
  return { responder, expireSession: () => { expiresAt = 0; } };
}
