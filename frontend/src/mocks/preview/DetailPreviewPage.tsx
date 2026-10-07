import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, type TicketSummary } from "../../api";
import { ConfirmDialog, DataTable, PriorityBadge, StatusBadge, Timeline, type TableColumn } from "../../components";
import { NEXT_ACTOR } from "../../lib/labels";
import { queryKeys } from "../../lib/queryClient";

const columns: TableColumn<TicketSummary>[] = [
  { key: "code", label: "Code", className: "cell-primary", render: (ticket) => ticket.code },
  { key: "status", label: "Status", render: (ticket) => <StatusBadge status={ticket.status} /> },
  { key: "priority", label: "Priority", render: (ticket) => <PriorityBadge priority={ticket.priority} /> },
  { key: "owner", label: "Technician", render: (ticket) => ticket.current_assignee?.name ?? "Awaiting assignment" },
];

export function DetailPreviewPage() {
  const id = Number(useParams().id);
  const [open, setOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const client = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.tickets.detail(id), queryFn: ({ signal }) => api.getTicket(id, signal) });
  const cancel = useMutation({
    mutationFn: ({ id: ticketId, version }: { id: number; version: number }) => api.cancelTicket(ticketId, { expected_version: version }),
    // Refresh before restoring focus, since the updated actions can remove the trigger.
    onSuccess: async () => { await client.invalidateQueries({ queryKey: queryKeys.tickets.all }); setOpen(false); },
  });
  const ticket = query.data;
  return <>
    <Link to="/queue">Back to queue</Link>
    <h1 ref={heading} tabIndex={-1}>Ticket detail · component preview</h1>
    <DataTable rows={ticket ? [ticket] : []} columns={columns} rowKey={(item) => item.id} caption="Ticket summary" loading={query.isPending} error={query.error?.message} onRetry={() => { void query.refetch(); }} />
    {ticket && !query.error && <>
      <section className="card"><h2>{ticket.title}</h2><p>{ticket.description}</p><p>{ticket.location_label_snapshot}</p><p>{NEXT_ACTOR[ticket.status]}</p>
        {ticket.allowed_actions.includes("CANCEL") && <button type="button" onClick={() => setOpen(true)}>Cancel report</button>}
      </section>
      <section className="card"><h2>Timeline</h2><Timeline entries={ticket.timeline} /></section>
      <ConfirmDialog
        open={open}
        title="Cancel this report?"
        description={ticket.allowed_actions.includes("CANCEL")
          ? "Cancellation is available before review. This demo updates the in-memory ticket."
          : "This ticket can no longer be cancelled. Close this dialog to review the updated details."}
        confirmLabel="Cancel report"
        danger
        pending={cancel.isPending}
        fallbackFocusRef={heading}
        disabled={query.isFetching || !ticket.allowed_actions.includes("CANCEL")}
        onCancel={() => setOpen(false)}
        onConfirm={() => cancel.mutateAsync({ id, version: ticket.version })}
      />
    </>}
  </>;
}
