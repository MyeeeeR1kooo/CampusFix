import type { FormEventHandler, ReactNode } from "react";

export interface FilterBarProps {
  children: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onReset: () => void;
  busy?: boolean;
  label?: string;
}

/** Callers own filter values and reset their cursor when applying a new filter. */
export function FilterBar({ children, onSubmit, onReset, busy = false, label = "Filter records" }: FilterBarProps) {
  return <form className="filter-bar" aria-label={label} aria-busy={busy} onSubmit={(event) => { event.preventDefault(); if (!busy) onSubmit(event); }}>
    {children}
    <div className="filter-actions">
      <button type="submit" className="primary" disabled={busy}>Apply filters</button>{" "}
      <button type="button" onClick={onReset} disabled={busy}>Clear filters</button>
    </div>
  </form>;
}
