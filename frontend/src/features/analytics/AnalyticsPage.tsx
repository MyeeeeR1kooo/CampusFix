import { useQuery } from "@tanstack/react-query";

import { api, type Analytics, type Category, type TicketStatus } from "../../api";
import { classify } from "../../lib/errors";
import { CATEGORY_LABELS, STATUS_LABELS } from "../../lib/labels";
import { queryKeys } from "../../lib/queryClient";

function Distribution({ title, items, label }: { title: string; items: readonly { count: number; [key: string]: string | number }[]; label: (item: { [key: string]: string | number }) => string }) {
  const maximum = Math.max(...items.map((item) => item.count), 0);
  return <section className="card" aria-labelledby={`${title}-heading`}>
    <h2 id={`${title}-heading`}>{title}</h2>
    {items.length === 0 ? <p className="muted" role="status">No data yet.</p> : <ul className="distribution">
      {items.map((item) => <li className="distribution-row" key={label(item)}>
        <span className="distribution-label">{label(item)}</span>
        <span className="distribution-bar" aria-hidden="true"><span className="distribution-fill" style={{ width: `${maximum ? (item.count / maximum) * 100 : 0}%` }} /></span>
        <span className="distribution-count">{item.count}</span>
      </li>)}
    </ul>}
  </section>;
}

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} hr`;
  return `${(hours / 24).toFixed(1)} days`;
}

function Trend({ data }: { data: Analytics["daily_trend"] }) {
  const maximum = Math.max(...data.flatMap((day) => [day.created_count, day.closed_count]), 0);
  return <section className="card" aria-labelledby="trend-heading">
    <h2 id="trend-heading">30-day trend</h2>
    {data.length === 0 ? <p className="muted" role="status">No trend data yet.</p> : <div className="trend-table-wrap">
      <table className="data-table trend-table"><caption className="visually-hidden">Daily created and closed tickets</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Created</th><th scope="col">Closed</th><th scope="col">Activity</th></tr></thead>
        <tbody>{data.map((day) => <tr key={day.date}>
          <th scope="row">{day.date}</th><td>{day.created_count}</td><td>{day.closed_count}</td>
          <td><span className="trend-bars" aria-label={`${day.created_count} created, ${day.closed_count} closed`}>
            <span className="trend-bar trend-bar-created" style={{ height: `${maximum ? Math.max(2, (day.created_count / maximum) * 100) : 0}%` }} />
            <span className="trend-bar trend-bar-closed" style={{ height: `${maximum ? Math.max(2, (day.closed_count / maximum) * 100) : 0}%` }} />
          </span></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}

export function AnalyticsPage() {
  const query = useQuery({ queryKey: queryKeys.analytics(), queryFn: ({ signal }) => api.getAnalytics(signal) });
  if (query.isPending) return <div className="page"><h1>Statistics</h1><p role="status">Loading statistics…</p></div>;
  if (query.error) return <div className="page"><h1>Statistics</h1><div role="alert"><p>{classify(query.error).message}</p><button type="button" onClick={() => { void query.refetch(); }}>Retry</button></div></div>;
  const analytics = query.data;
  return <div className="page analytics-page">
    <h1>Statistics</h1><p className="muted">Live ticket totals and activity from the database.</p>
    <div className="stat-cards">
      <section className="stat-card stat-card-backlog"><h2>Current backlog</h2><p className="stat-value">{analytics.backlog_count}</p><p className="stat-note">All non-terminal tickets</p></section>
      <section className="stat-card stat-card-duration"><h2>Average time to close</h2><p className="stat-value">{durationLabel(analytics.average_close_seconds)}</p><p className="stat-note">From creation to closure, including confirmation</p></section>
    </div>
    <div className="distribution-grid">
      <Distribution title="By status" items={analytics.by_status} label={(item) => STATUS_LABELS[item.status as TicketStatus]} />
      <Distribution title="By category" items={analytics.by_category} label={(item) => CATEGORY_LABELS[item.category as Category]} />
      <Distribution title="By building" items={analytics.by_building} label={(item) => String(item.building)} />
    </div>
    <Trend data={analytics.daily_trend} />
  </div>;
}
