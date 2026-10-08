import type { Priority, TicketStatus } from "../api";
import { PRIORITY_LABELS, STATUS_ICONS, STATUS_LABELS, STATUS_TONES } from "../lib/labels";
import { Icon } from "./Icon";

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge badge-${STATUS_TONES[status]}`}><Icon name={STATUS_ICONS[status]} />{STATUS_LABELS[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority | null }) {
  return <span className={`badge ${priority ? `badge-priority-${priority.toLowerCase()}` : "badge-unreviewed"}`}>
    {priority ? PRIORITY_LABELS[priority] : "Not reviewed"}
  </span>;
}
