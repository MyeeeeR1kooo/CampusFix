import type { Key, ReactNode } from "react";

export interface TableColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  rows: readonly T[];
  columns: readonly TableColumn<T>[];
  rowKey: (row: T) => Key;
  caption: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyMessage?: string;
}

export function DataTable<T>({ rows, columns, rowKey, caption, loading = false, error, onRetry, emptyMessage = "No matching records." }: DataTableProps<T>) {
  return <div className="table-wrap" aria-busy={loading}>
    <table className="data-table">
      <caption className="visually-hidden">{caption}</caption>
      <thead><tr>{columns.map((column) => <th scope="col" key={column.key} className={column.className}>{column.label}</th>)}</tr></thead>
      <tbody>
        {loading || error || rows.length === 0 ? <tr><td colSpan={columns.length}>
          {loading ? <p role="status">Loading…</p> : error ? <div role="alert"><p>{error}</p>{onRetry && <button type="button" onClick={onRetry}>Retry</button>}</div> : <p role="status">{emptyMessage}</p>}
        </td></tr> : rows.map((row) => <tr key={rowKey(row)}>{columns.map((column) => <td key={column.key} data-label={column.label} className={column.className}>{column.render(row)}</td>)}</tr>)}
      </tbody>
    </table>
  </div>;
}
