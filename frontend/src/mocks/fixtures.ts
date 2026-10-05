import type { Category, Location, TicketDetail, TicketEvent, TicketStatus, User, UserSummary } from "../api";

/** Fictional, browser-only accounts. These are not the backend seed credentials. */
export const MOCK_PASSWORD = "campusfix-mock";
export const MOCK_ACCOUNTS: readonly Pick<User, "id" | "name" | "email" | "role" | "active">[] = [
  { id: 1, name: "Demo reporter A", email: "reporter01@campusfix.test", role: "REPORTER", active: true },
  { id: 2, name: "Demo technician A", email: "technician01@campusfix.test", role: "TECHNICIAN", active: true },
  { id: 3, name: "Demo dispatcher", email: "admin01@campusfix.test", role: "ADMIN", active: true },
  { id: 4, name: "Demo reporter B", email: "reporter02@campusfix.test", role: "REPORTER", active: true },
  { id: 5, name: "Demo technician B", email: "technician02@campusfix.test", role: "TECHNICIAN", active: true },
  { id: 6, name: "Inactive technician", email: "inactive@campusfix.test", role: "TECHNICIAN", active: false },
];

export function person(user: UserSummary): UserSummary {
  return { id: user.id, name: user.name, role: user.role };
}

export function locationLabel(location: Location): string {
  return `${location.building} / ${location.floor} / ${location.room_or_area}`;
}

const shanghaiCalendar = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

/** Ticket codes and daily trends share the contract's Shanghai calendar day. */
export function shanghaiDate(value: string | number): string {
  const parts = shanghaiCalendar.formatToParts(new Date(value));
  const { year, month, day } = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${year}-${month}-${day}`;
}

export function createFixtures(now: Date) {
  const at = (days: number, hours = 0) => new Date(now.getTime() - days * 86400000 + hours * 3600000).toISOString();
  const users: User[] = MOCK_ACCOUNTS.map((user) => ({ ...user, created_at: at(40), updated_at: at(40) }));
  const locations: Location[] = [
    { id: 1, building: "Teaching Building A", floor: "3", room_or_area: "301", active: true },
    { id: 2, building: "Library", floor: "2", room_or_area: "Reading room", active: true },
    { id: 3, building: "Residence B", floor: "1", room_or_area: "Washroom", active: true },
    { id: 4, building: "Sports Centre", floor: "1", room_or_area: "East entrance", active: false },
  ].map((location) => ({ ...location, created_at: at(40), updated_at: at(40) }));
  const scenarios: Array<{ title: string; description: string; category: Category; status: TicketStatus; location: number }> = [
    { title: "Classroom lights flicker", description: "The rear row of lights flickers during evening classes.", category: "LIGHTING_ELECTRICAL", status: "SUBMITTED", location: 1 },
    { title: "Reading room chair is loose", description: "The backrest on the chair beside shelf C is loose.", category: "FURNITURE", status: "PENDING_ASSIGNMENT", location: 2 },
    { title: "Washroom tap keeps dripping", description: "The second basin tap keeps dripping after closing.", category: "WATER_SANITARY", status: "ASSIGNED", location: 3 },
    { title: "Air conditioner makes a rattling noise", description: "A rattle returns when the fan runs at low speed.", category: "HVAC", status: "IN_PROGRESS", location: 1 },
    { title: "Reading room window cannot close", description: "The window near the north study desks does not latch.", category: "DOORS_WINDOWS_LOCKS", status: "PENDING_CONFIRMATION", location: 2 },
    { title: "Entrance sign bracket is loose", description: "The indoor wayfinding sign bracket needed tightening.", category: "OTHER_FACILITY", status: "CLOSED", location: 4 },
    { title: "Classroom projector does not connect", description: "Rejected because IT equipment is outside facilities maintenance.", category: "OTHER_FACILITY", status: "REJECTED", location: 1 },
    { title: "Duplicate report about a chair", description: "The reporter withdrew a duplicate report before review.", category: "FURNITURE", status: "CANCELLED", location: 2 },
    { title: "Second floor door handle sticks", description: "The reading room door handle is difficult to turn.", category: "DOORS_WINDOWS_LOCKS", status: "SUBMITTED", location: 2 },
    { title: "Corridor lamp needs replacement", description: "One corridor lamp remains off during normal opening hours.", category: "LIGHTING_ELECTRICAL", status: "ASSIGNED", location: 1 },
  ];
  const stages: Array<[TicketEvent["type"], TicketStatus, User]> = [
    ["TICKET_SUBMITTED", "SUBMITTED", users[0]], ["TICKET_APPROVED", "PENDING_ASSIGNMENT", users[2]],
    ["TICKET_ASSIGNED", "ASSIGNED", users[1]], ["WORK_STARTED", "IN_PROGRESS", users[1]],
    ["RESOLUTION_SUBMITTED", "PENDING_CONFIRMATION", users[1]], ["TICKET_CLOSED", "CLOSED", users[0]],
  ];
  const tickets: TicketDetail[] = scenarios.map((scenario, index) => {
    const id = index + 1;
    const reporter = person(users[index >= 8 ? 3 : 0]);
    const technician = person(users[index >= 8 ? 4 : 1]);
    const location = locations[scenario.location - 1];
    const end = stages.findIndex(([, status]) => status === scenario.status);
    const history = stages.slice(0, end < 0 ? 1 : end + 1);
    if (scenario.status === "REJECTED") history.push(["TICKET_REJECTED", "REJECTED", users[2]]);
    if (scenario.status === "CANCELLED") history.push(["TICKET_CANCELLED", "CANCELLED", users[0]]);
    const timeline: TicketEvent[] = history.map(([type, status, actor], step) => ({
      kind: "EVENT", id: id * 100 + step, ticket_id: id,
      actor: type === "TICKET_ASSIGNED" ? person(users[2]) : actor.role === "REPORTER" ? reporter : actor.role === "TECHNICIAN" ? technician : person(actor),
      type, from_status: step ? history[step - 1][1] : null, to_status: status,
      note: type === "RESOLUTION_SUBMITTED" ? "Repaired and checked during normal operation." : type === "TICKET_REJECTED" ? "Please use the existing IT support channel." : null,
      visibility: "PUBLIC", created_at: at(12 - index, step),
    }));
    const assigned = end >= 2;
    return {
      id, code: `CF-${shanghaiDate(timeline[0].created_at).replaceAll("-", "")}-${String(id).padStart(6, "0")}`,
      reporter, location_id: location.id, location_label_snapshot: locationLabel(location),
      title: scenario.title, description: scenario.description, category: scenario.category,
      priority: end >= 1 ? (["LOW", "MEDIUM", "HIGH"] as const)[index % 3] : null,
      status: scenario.status, current_assignee: assigned ? technician : null, version: timeline.length,
      created_at: timeline[0].created_at, updated_at: timeline.at(-1)!.created_at,
      closed_at: scenario.status === "CLOSED" ? timeline.at(-1)!.created_at : null,
      current_responsible_role: null, next_action: null, allowed_actions: [],
      report_photos: [], resolution_photos: [],
      assignments: assigned ? [{ id, ticket_id: id, technician, assigned_by: person(users[2]), assigned_at: timeline[2].created_at, ended_at: null, reason: null }] : [],
      timeline: [...timeline, { kind: "COMMENT", id, ticket_id: id, author: person(users[2]), body: "Demo internal scheduling note.", visibility: "ADMIN_ONLY", created_at: timeline[0].created_at }],
    };
  });
  return { users, locations, tickets };
}
