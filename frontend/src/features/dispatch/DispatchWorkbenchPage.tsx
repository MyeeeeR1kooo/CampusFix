import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { api, type TicketStatus, type TicketSummary } from "../../api";
import { DataTable, FilterBar, Pagination, PriorityBadge, StatusBadge, type TableColumn } from "../../components";
import { SelectField } from "../../components/Field";
import { CATEGORY_LABELS, PRIORITY_LABELS, PRIORITY_ORDER } from "../../lib/labels";
import { classify } from "../../lib/errors";
import { queryKeys } from "../../lib/queryClient";

const filterSchema = z.object({ priority: z.union([z.literal(""), z.enum(PRIORITY_ORDER)]) });
type Filters = z.infer<typeof filterSchema>;
const defaults: Filters = { priority: "" };

/** Lists use server-side status/priority filters and opaque cursor pagination. */
export function DispatchQueue({ status, title, actionLabel }: {
  status: TicketStatus;
  title: string;
  actionLabel: string;
}) {
  const [filters, setFilters] = useState(defaults);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const { register, handleSubmit, reset } = useForm({ defaultValues: defaults, resolver: zodResolver(filterSchema) });
  const params = { status, priority: filters.priority || undefined, cursor: cursors.at(-1) ?? undefined, limit: 20 };
  const query = useQuery({
    queryKey: queryKeys.tickets.list(params),
    queryFn: ({ signal }) => api.listTickets(params, signal),
  });
  const columns: TableColumn<TicketSummary>[] = [
    { key: "ticket", label: "Ticket", render: (ticket) => <><Link to={`/tickets/${ticket.id}`}>{ticket.title}</Link><p className="page-sub">{ticket.code}</p></> },
    { key: "category", label: "Category", render: (ticket) => CATEGORY_LABELS[ticket.category] },
    { key: "priority", label: "Priority", render: (ticket) => <PriorityBadge priority={ticket.priority} /> },
    { key: "status", label: "Status", render: (ticket) => <StatusBadge status={ticket.status} /> },
    { key: "location", label: "Location", render: (ticket) => ticket.location_label_snapshot },
    { key: "owner", label: "Current owner", render: (ticket) => ticket.current_assignee?.name ?? "Unassigned" },
    { key: "action", label: "Action", render: (ticket) => <Link className="button" to={`/tickets/${ticket.id}`}>{actionLabel}</Link> },
  ];
  return <section className="page" aria-label={title}>
    <h2>{title}</h2>
    <FilterBar label={`Filter ${title.toLowerCase()}`} busy={query.isFetching}
      onSubmit={handleSubmit((values) => { setFilters(values); setCursors([null]); })}
      onReset={() => { reset(defaults); setFilters(defaults); setCursors([null]); }}>
      <SelectField id="dispatch-priority" label="Priority" {...register("priority")}>
        <option value="">All priorities</option>
        {PRIORITY_ORDER.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
      </SelectField>
    </FilterBar>
    <DataTable rows={query.data?.items ?? []} columns={columns} rowKey={(ticket) => ticket.id} caption={title}
      loading={query.isPending} error={query.error ? classify(query.error).message : undefined}
      onRetry={() => { void query.refetch(); }} emptyMessage={`No tickets in ${title.toLowerCase()}.`} />
    <Pagination nextCursor={query.data?.next_cursor ?? null} hasPrevious={cursors.length > 1}
      busy={query.isFetching} onNext={(cursor) => setCursors([...cursors, cursor])} onPrevious={() => setCursors(cursors.slice(0, -1))} />
  </section>;
}

export function DispatchWorkbenchPage() {
  const [search] = useSearchParams();
  const assignment = search.get("queue") === "assignment";
  return <div className="page">
    <header className="page-head"><div><h1>Dispatch workbench</h1><p className="page-sub">Review submitted reports and assign approved repairs to an active technician.</p></div></header>
    <nav className="form-actions" aria-label="Dispatch queues">
      <Link className={`button${!assignment ? " primary" : ""}`} aria-current={!assignment ? "page" : undefined} to="/workbench">Review queue</Link>
      <Link className={`button${assignment ? " primary" : ""}`} aria-current={assignment ? "page" : undefined} to="/workbench?queue=assignment">Pending assignment</Link>
    </nav>
    <DispatchQueue key={assignment ? "assignment" : "review"} status={assignment ? "PENDING_ASSIGNMENT" : "SUBMITTED"}
      title={assignment ? "Pending assignment" : "Review queue"} actionLabel={assignment ? "Assign ticket" : "Review ticket"} />
  </div>;
}
