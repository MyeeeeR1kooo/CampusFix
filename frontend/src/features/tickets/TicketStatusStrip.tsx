/**
 * The binding header rule (§13.3): current status, current owner, and who acts
 * next. Every value comes from the detail response, so the strip cannot disagree
 * with the action zone beneath it.
 */

import type { TicketDetail } from "../../api";
import { PriorityBadge, StatusBadge } from "../../components";
import { NEXT_ACTION_LABELS, OWNER_PENDING, ROLE_LABELS } from "../../lib/labels";

export function TicketStatusStrip({ ticket }: { ticket: TicketDetail }) {
  const owner = ticket.current_assignee?.name ?? OWNER_PENDING[ticket.status] ?? "Unassigned";
  const next = ticket.current_responsible_role
    ? `${ROLE_LABELS[ticket.current_responsible_role]} · ${ticket.next_action ? NEXT_ACTION_LABELS[ticket.next_action] : "—"}`
    : "No further action";

  return (
    <section className="status-rail" aria-label="Ticket status and responsibility">
      <div className="rail-summary">
        <span className="rail-summary-badges">
          <StatusBadge status={ticket.status} />
          <span className="strip-item">
            <span className="strip-key">Priority</span>
            <PriorityBadge priority={ticket.priority} />
          </span>
        </span>
        <span className="strip-item">
          <span className="strip-key">Owner</span>
          <span className="strip-value">{owner}</span>
        </span>
        <span className="strip-item strip-next">
          <span className="strip-key">Next</span>
          <span className="strip-value">{next}</span>
        </span>
      </div>
    </section>
  );
}
