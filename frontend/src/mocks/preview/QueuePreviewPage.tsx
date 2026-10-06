import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "react-router-dom";
import { api, type TicketSummary } from "../../api";
import { DataTable, FilterBar, Pagination, PriorityBadge, StatusBadge, type TableColumn } from "../../components";
import { SelectField, TextField } from "../../components/Field";
import { STATUS_LABELS, STATUS_ORDER } from "../../lib/labels";
import { queryKeys } from "../../lib/queryClient";

const schema = z.object({ q: z.string(), status: z.union([z.literal(""), z.enum(STATUS_ORDER)]) });
const defaults: z.infer<typeof schema> = { q: "", status: "" };
const columns: TableColumn<TicketSummary>[] = [
  { key: "title", label: "Ticket", className: "cell-primary", render: (ticket) => <Link to={`/detail/${ticket.id}`}>{ticket.title}</Link> },
  { key: "code", label: "Code", className: "col-secondary", render: (ticket) => ticket.code },
  { key: "status", label: "Status", render: (ticket) => <StatusBadge status={ticket.status} /> },
  { key: "priority", label: "Priority", render: (ticket) => <PriorityBadge priority={ticket.priority} /> },
  { key: "location", label: "Location", render: (ticket) => ticket.location_label_snapshot },
];

export function QueuePreviewPage() {
  const [values, setValues] = useState(defaults);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const { register, handleSubmit, reset } = useForm({ defaultValues: defaults, resolver: zodResolver(schema) });
  const filters = { q: values.q, status: values.status || undefined, cursor: cursors.at(-1) ?? undefined, limit: 4 };
  const query = useQuery({ queryKey: queryKeys.tickets.list(filters), queryFn: ({ signal }) => api.listTickets(filters, signal) });
  return <>
    <h1>Ticket queue · component preview</h1>
    <FilterBar onSubmit={handleSubmit((next) => { setValues(next); setCursors([null]); })} onReset={() => { reset(defaults); setValues(defaults); setCursors([null]); }} busy={query.isFetching}>
      <TextField id="preview-search" label="Code or title" {...register("q")} />
      <SelectField id="preview-status" label="Status" {...register("status")}><option value="">All statuses</option>{STATUS_ORDER.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</SelectField>
    </FilterBar>
    <DataTable rows={query.data?.items ?? []} columns={columns} rowKey={(ticket) => ticket.id} caption="Visible tickets" loading={query.isPending} error={query.error?.message} onRetry={() => { void query.refetch(); }} />
    <Pagination nextCursor={query.data?.next_cursor ?? null} hasPrevious={cursors.length > 1} onNext={(cursor) => setCursors([...cursors, cursor])} onPrevious={() => setCursors(cursors.slice(0, -1))} busy={query.isFetching} />
  </>;
}
