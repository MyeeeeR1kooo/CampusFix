/**
 * Reporter's own tickets (#51).
 *
 * Visibility is the server's decision — this page never filters by reporter.
 * The only approved filter here is status; pagination is the contract's cursor
 * pair, so the page keeps a stack of cursors rather than inventing page numbers.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api, type TicketStatus } from "../../api";
import { FilterBar, Pagination, PriorityBadge, StatusBadge } from "../../components";
import { SelectField } from "../../components/Field";
import { classify } from "../../lib/errors";
import { CATEGORY_LABELS, NEXT_ACTOR, STATUS_LABELS, STATUS_ORDER } from "../../lib/labels";
import { queryKeys } from "../../lib/queryClient";

const PAGE_SIZE = 20;

export function MyReportsPage() {
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [draftStatus, setDraftStatus] = useState<TicketStatus | "">("");
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const cursor = cursors.at(-1) ?? null;

  const filters = {
    status: status || undefined,
    cursor: cursor ?? undefined,
    limit: PAGE_SIZE,
  };
  const query = useQuery({
    queryKey: queryKeys.tickets.list(filters),
    queryFn: ({ signal }) => api.listTickets(filters, signal),
  });

  const items = query.data?.items ?? [];
  const error = query.error ? classify(query.error) : undefined;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>My repairs</h1>
          <p className="page-sub">Reports you submitted, newest first.</p>
        </div>
        <Link className="button primary" to="/reports/new">Create a repair report</Link>
      </header>

      <FilterBar
        label="Filter my reports"
        busy={query.isFetching}
        onSubmit={() => {
          setStatus(draftStatus);
          setCursors([null]);
        }}
        onReset={() => {
          setDraftStatus("");
          setStatus("");
          setCursors([null]);
        }}
      >
        <SelectField
          id="reports-filter-status"
          label="Status"
          value={draftStatus}
          onChange={(event) => setDraftStatus(event.target.value as TicketStatus | "")}
        >
          <option value="">All statuses</option>
          {STATUS_ORDER.map((value) => (
            <option key={value} value={value}>{STATUS_LABELS[value]}</option>
          ))}
        </SelectField>
      </FilterBar>

      {error ? (
        <div className="banner banner-error" role="alert">
          <div className="banner-body">
            <span>{error.message}</span>
            <div className="banner-actions">
              <button type="button" onClick={() => { void query.refetch(); }}>Retry</button>
            </div>
          </div>
        </div>
      ) : null}

      {query.isPending ? (
        <p role="status">Loading your reports…</p>
      ) : items.length === 0 && !error ? (
        <div className="empty-state">
          <p className="empty-title">
            {status ? "No reports match this status." : "You have not submitted any reports yet."}
          </p>
          <p className="empty-body">
            {status
              ? "Choose another status or clear the filter to see all your reports."
              : "When something in a campus building needs repair, report it here and follow its progress."}
          </p>
          <div className="empty-action">
            <Link className="button primary" to="/reports/new">Create a repair report</Link>
          </div>
        </div>
      ) : items.length > 0 ? (
        <div className="ticket-cards" aria-label="My reports">
          {items.map((ticket) => (
            <article key={ticket.id} className="ticket-card">
              <div className="ticket-card-head">
                <StatusBadge status={ticket.status} />
                <PriorityBadge priority={ticket.priority} />
                <span className="ticket-card-code">{ticket.code}</span>
              </div>
              <Link className="ticket-card-title" to={`/tickets/${ticket.id}`}>
                {ticket.title}
              </Link>
              <p className="ticket-card-meta">
                {CATEGORY_LABELS[ticket.category]} · {ticket.location_label_snapshot}
              </p>
              <p className="ticket-card-meta">
                Reported {new Date(ticket.created_at).toLocaleString()}
              </p>
              <p className="ticket-card-next">{NEXT_ACTOR[ticket.status]}</p>
              <div className="ticket-card-foot">
                <Link className="button" to={`/tickets/${ticket.id}`}>View details</Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <Pagination
        nextCursor={query.data?.next_cursor ?? null}
        hasPrevious={cursors.length > 1}
        onNext={(next) => setCursors([...cursors, next])}
        onPrevious={() => setCursors(cursors.slice(0, -1))}
        busy={query.isFetching}
      />
    </div>
  );
}
