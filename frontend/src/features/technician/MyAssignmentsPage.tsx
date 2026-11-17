import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";

import { api, type TicketSummary } from "../../api";
import { DeniedPage } from "../../app/StatePages";
import { DataTable, FilterBar, Pagination, PriorityBadge, StatusBadge, type TableColumn } from "../../components";
import { SelectField } from "../../components/Field";
import { classify } from "../../lib/errors";
import { STATUS_LABELS, STATUS_ORDER } from "../../lib/labels";
import { queryKeys } from "../../lib/queryClient";

const schema = z.object({ status: z.union([z.literal(""), z.enum(STATUS_ORDER)]) });
type Filters = z.infer<typeof schema>;
const defaults: Filters = { status: "" };
const columns: TableColumn<TicketSummary>[] = [
  { key: "ticket", label: "Ticket", render: (ticket) => <><Link to={`/tickets/${ticket.id}`}>{ticket.title}</Link><p className="page-sub">{ticket.code}</p></> },
  { key: "status", label: "Status", render: (ticket) => <StatusBadge status={ticket.status} /> },
  { key: "location", label: "Location", render: (ticket) => ticket.location_label_snapshot },
  { key: "priority", label: "Priority", render: (ticket) => <PriorityBadge priority={ticket.priority} /> },
  { key: "created", label: "Reported", render: (ticket) => <time dateTime={ticket.created_at}>{new Date(ticket.created_at).toLocaleString()}</time> },
];

/** The server derives assignment visibility from the session, before pagination. */
export function MyAssignmentsPage() {
  const [filters, setFilters] = useState(defaults);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const { register, handleSubmit, reset } = useForm({ defaultValues: defaults, resolver: zodResolver(schema) });
  const params = { status: filters.status || undefined, cursor: cursors.at(-1) ?? undefined, limit: 20 };
  const query = useQuery({
    queryKey: queryKeys.tickets.list(params),
    queryFn: ({ signal }) => api.listTickets(params, signal),
  });
  const error = query.error ? classify(query.error) : undefined;

  if (error?.kind === "permission") return <DeniedPage />;

  return <div className="page">
    <header className="page-head"><div>
      <h1>My assignments</h1>
      <p className="page-sub">Repairs assigned to you, newest reports first. Select a ticket to view its details.</p>
    </div></header>
    <FilterBar label="Filter my assignments" busy={query.isFetching}
      onSubmit={handleSubmit((values) => { setFilters(values); setCursors([null]); })}
      onReset={() => { reset(defaults); setFilters(defaults); setCursors([null]); }}>
      <SelectField id="assignments-status" label="Status" {...register("status")}>
        <option value="">All statuses</option>
        {STATUS_ORDER.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
      </SelectField>
    </FilterBar>
    <DataTable rows={query.data?.items ?? []} columns={columns} rowKey={(ticket) => ticket.id}
      caption="My assigned tickets" loading={query.isPending} error={error?.message}
      onRetry={() => { void query.refetch(); }}
      emptyMessage={filters.status ? "No assigned tickets match this status." : "No tickets are assigned to you yet."} />
    <Pagination nextCursor={query.data?.next_cursor ?? null} hasPrevious={cursors.length > 1}
      onNext={(cursor) => setCursors([...cursors, cursor])} onPrevious={() => setCursors(cursors.slice(0, -1))} busy={query.isFetching} />
  </div>;
}
