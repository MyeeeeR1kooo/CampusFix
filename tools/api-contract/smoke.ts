// Compile-only proof that frontend consumers can use generated contract types.
import type { components, operations, paths } from "../../.contract-artifacts/schema";

type Summary = components["schemas"]["TicketSummary"];
type Detail = paths["/api/tickets/{id}"]["get"]["responses"][200]["content"]["application/json"];
type Review = operations["reviewTicket"]["requestBody"]["content"]["application/json"];
type Page = operations["listTickets"]["responses"][200]["content"]["application/json"];
type TicketListQuery = NonNullable<operations["listTickets"]["parameters"]["query"]>;
type ListForbidden = operations["listTickets"]["responses"][403];

const approve: Review = {
  decision: "APPROVE",
  category: "LIGHTING_ELECTRICAL",
  priority: "HIGH",
  expected_version: 1,
};
const reject: Review = { decision: "REJECT", reason: "示例驳回原因", expected_version: 1 };
const empty: Page = { items: [], next_cursor: null };
const adminFilters: TicketListQuery = {
  current_assignee_id: 2,
  created_from: "2026-10-01T00:00:00Z",
  created_before: "2026-10-07T00:00:00Z",
};
const forbiddenList: ListForbidden = {
  headers: { "X-Request-ID": "req_example" },
  content: {
    "application/json": {
      error: {
        code: "FORBIDDEN",
        message: "Only Admin can filter by the current technician.",
        request_id: "req_example",
        field_errors: [],
      },
    },
  },
};

// These invalid cases must be rejected by the generated TypeScript types.
// @ts-expect-error APPROVE must contain category and priority.
const invalidApproval: Review = { decision: "APPROVE", expected_version: 1 };
// @ts-expect-error REJECT must contain a reason.
const invalidRejection: Review = { decision: "REJECT", expected_version: 1 };
// @ts-expect-error A cursor is a string or null, never a numeric offset.
const invalidPage: Page = { items: [], next_cursor: 10 };
// @ts-expect-error Query names come from the contract, not a handwritten second shape.
const invalidFilterName: TicketListQuery = { created_beeefore: "2026-10-07T00:00:00Z" };
// @ts-expect-error The current technician ID is numeric, not a string.
const invalidAssignee: TicketListQuery = { current_assignee_id: "2" };

function readDetail(detail: Detail): Summary {
  detail.timeline.forEach((item) => {
    if (item.kind === "EVENT") item.type;
    else item.body;
  });
  detail.report_photos.forEach((photo) => photo.download_url);
  detail.assignments.forEach((assignment) => assignment.technician.id);
  detail.allowed_actions.includes("CONFIRM");
  // @ts-expect-error No private storage key is exposed by the contract.
  detail.report_photos[0]?.storage_key;
  return detail;
}

void [
  approve, reject, empty, adminFilters, forbiddenList,
  invalidApproval, invalidRejection, invalidPage, invalidFilterName, invalidAssignee, readDetail,
];
