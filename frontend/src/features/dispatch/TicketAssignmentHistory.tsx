import type { Assignment } from "../../api";
import { DataTable, type TableColumn } from "../../components";

const columns: TableColumn<Assignment>[] = [
  { key: "technician", label: "Technician", render: (assignment) => assignment.technician.name },
  { key: "by", label: "Assigned by", render: (assignment) => assignment.assigned_by.name },
  { key: "at", label: "Assigned at", render: (assignment) => <time dateTime={assignment.assigned_at}>{new Date(assignment.assigned_at).toLocaleString()}</time> },
  { key: "reason", label: "Note", render: (assignment) => assignment.reason ?? "—" },
];

/** Server-authorized records; the current owner remains the detail's current_assignee. */
export function TicketAssignmentHistory({ assignments }: { assignments: readonly Assignment[] }) {
  const rows = [...assignments].sort((a, b) => Date.parse(b.assigned_at) - Date.parse(a.assigned_at) || b.id - a.id);
  return <section className="card" aria-label="Assignment history">
    <h2>Assignment history</h2>
    <DataTable rows={rows} columns={columns} rowKey={(assignment) => assignment.id} caption="Assignment records" emptyMessage="No assignments yet." />
  </section>;
}
