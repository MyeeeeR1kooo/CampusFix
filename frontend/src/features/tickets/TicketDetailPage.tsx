/**
 * Ticket detail, shared by every role (#91).
 *
 * The route is one page for Reporter, Technician and Admin; visibility and the
 * available operations are decided by the server on every read. This page only
 * composes the status strip, the operation area, the photos and the timeline —
 * it adds no permission logic of its own.
 *
 * Photos and the conversation composer arrive with #54; both consume the
 * server-filtered detail response and the server's `allowed_actions`.
 */

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { api } from "../../api";
import { Timeline } from "../../components";
import { classify } from "../../lib/errors";
import { CATEGORY_LABELS } from "../../lib/labels";
import { queryKeys } from "../../lib/queryClient";
import { landingFor, useAuth } from "../auth/AuthContext";
import { TicketAssignmentHistory } from "../dispatch/TicketAssignmentHistory";
import { DeniedPage, NotFoundPage } from "../../app/StatePages";
import { CommentComposer } from "./CommentComposer";
import { TicketActionZone, allowedLifecycleActions } from "./TicketActionZone";
import { TicketPhotoGallery } from "./TicketPhotoGallery";
import { TicketStatusStrip } from "./TicketStatusStrip";

export function TicketDetailPage() {
  const { ticketId } = useParams();
  const { user } = useAuth();
  const heading = useRef<HTMLHeadingElement>(null);
  const id = Number(ticketId);
  const validId = Number.isInteger(id) && id > 0;
  const query = useQuery({
    queryKey: queryKeys.tickets.detail(id),
    queryFn: ({ signal }) => api.getTicket(id, signal),
    enabled: validId,
  });

  // A completed action can remove the button that opened its dialog. When that
  // empties the operation area, the dialog's focus return has nowhere to land;
  // the heading is the stable place to continue reading from (§13.3 keyboard).
  const hadActions = useRef(false);
  const hasActions = query.data
    ? allowedLifecycleActions(query.data.allowed_actions).length > 0
    : false;
  useEffect(() => {
    if (hadActions.current && !hasActions) heading.current?.focus();
    hadActions.current = hasActions;
  }, [hasActions]);

  if (!validId) return <NotFoundPage />;

  if (query.isPending) {
    return <div className="page"><p role="status">Loading ticket…</p></div>;
  }

  if (query.error) {
    const error = classify(query.error);
    if (error.kind === "notfound") return <NotFoundPage />;
    if (error.kind === "permission") return <DeniedPage />;
    return (
      <div className="page">
        <div className="banner banner-error" role="alert">
          <div className="banner-body"><span>{error.message}</span></div>
        </div>
        <button type="button" onClick={() => { void query.refetch(); }}>Retry</button>
      </div>
    );
  }

  const ticket = query.data;
  return (
    <div className="page">
      <p className="back-link"><Link to={landingFor(user?.role)}>← Back</Link></p>

      <header className="page-head">
        <div>
          <h1 ref={heading} tabIndex={-1}>{ticket.title}</h1>
          <p className="page-sub">
            Ticket <strong>{ticket.code}</strong> · {ticket.location_label_snapshot}
          </p>
        </div>
      </header>

      <TicketStatusStrip ticket={ticket} />
      <TicketActionZone key={ticket.id} ticket={ticket} focusFallback={heading} />

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card" aria-labelledby="detail-issue-heading">
            <h2 id="detail-issue-heading">Issue</h2>
            <p className="detail-description">{ticket.description}</p>
            <dl className="detail-facts">
              <div>
                <dt>Category</dt>
                <dd>{CATEGORY_LABELS[ticket.category]}</dd>
              </div>
              <div>
                <dt>Reported by</dt>
                <dd>{ticket.reporter.name}</dd>
              </div>
              <div>
                <dt>Reported</dt>
                <dd>{new Date(ticket.created_at).toLocaleString()}</dd>
              </div>
              {ticket.closed_at ? (
                <div>
                  <dt>Closed</dt>
                  <dd>{new Date(ticket.closed_at).toLocaleString()}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <TicketAssignmentHistory assignments={ticket.assignments} />
          <TicketPhotoGallery ticket={ticket} />
        </div>

        <aside className="detail-side">
          <section className="card" aria-labelledby="detail-timeline-heading">
            <h2 id="detail-timeline-heading">Timeline</h2>
            <Timeline entries={ticket.timeline} />
            <CommentComposer ticket={ticket} />
          </section>
        </aside>
      </div>
    </div>
  );
}
