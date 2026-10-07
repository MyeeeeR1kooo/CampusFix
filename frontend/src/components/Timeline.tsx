import type { TimelineEntry } from "../api";
import { EVENT_LABELS, STATUS_LABELS } from "../lib/labels";

export function Timeline({ entries, label = "Ticket timeline" }: { entries: readonly TimelineEntry[]; label?: string }) {
  const sorted = [...entries].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.kind.localeCompare(b.kind) || a.id - b.id);
  if (!sorted.length) return <p role="status">No timeline entries yet.</p>;
  return <ol className="timeline" aria-label={label}>{sorted.map((entry) => <li
    key={`${entry.kind}-${entry.id}`}
    className={`timeline-item ${entry.kind === "COMMENT" ? "timeline-comment" : ""} ${entry.visibility === "ADMIN_ONLY" ? "timeline-internal" : ""}`}
  >
    <span className="timeline-marker" aria-hidden="true" />
    <div className="timeline-content">
      <div className="timeline-meta">
        <span className="timeline-actor">{entry.kind === "EVENT" ? entry.actor.name : entry.author.name}</span>
        <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time>
        {entry.visibility === "ADMIN_ONLY" && <span className="tag tag-internal">Internal note</span>}
      </div>
      {entry.kind === "EVENT" ? <div className="timeline-text">
        <strong>{EVENT_LABELS[entry.type]}</strong>
        <span className="timeline-transition">{entry.from_status ? `${STATUS_LABELS[entry.from_status]} → ` : ""}{STATUS_LABELS[entry.to_status]}</span>
        {entry.note && <p className="timeline-note">{entry.note}</p>}
      </div> : <p className="timeline-note timeline-comment-body">{entry.body}</p>}
    </div>
  </li>)}</ol>;
}
