import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type ManagedRole, type User } from "../../api";
import { ConfirmDialog, DataTable, FilterBar, Pagination, type TableColumn } from "../../components";
import { SelectField } from "../../components/Field";
import { classify } from "../../lib/errors";
import { ROLE_LABELS } from "../../lib/labels";
import { queryKeys } from "../../lib/queryClient";

type Filters = { role: ManagedRole | ""; active: "" | "true" | "false" };
const emptyFilters: Filters = { role: "", active: "" };

export function AccountManagementPage() {
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [toDisable, setToDisable] = useState<User | null>(null);
  const [actionError, setActionError] = useState<string>();
  const queryClient = useQueryClient();
  const params = {
    role: filters.role || undefined,
    active: filters.active === "" ? undefined : filters.active === "true",
    cursor: cursors.at(-1),
    limit: 20,
  };
  const query = useQuery({
    queryKey: queryKeys.users.list(params),
    queryFn: ({ signal }) => api.listUsers(params, signal),
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setUserActive(id, { active }),
    onSuccess: async () => {
      setCursors([null]);
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });

  const columns: TableColumn<User>[] = [
    { key: "name", label: "Name", render: (row) => row.name },
    { key: "email", label: "Email", render: (row) => row.email },
    { key: "role", label: "Role", render: (row) => ROLE_LABELS[row.role] },
    { key: "status", label: "Status", render: (row) => <span className={`badge ${row.active ? "badge-success" : "badge-muted"}`}>{row.active ? "Active" : "Inactive"}</span> },
    { key: "actions", label: "Actions", render: (row) => <div className="cell-actions">
      <button type="button" disabled={toggle.isPending} onClick={() => {
        setActionError(undefined);
        if (row.active) setToDisable(row);
        else void toggle.mutateAsync({ id: row.id, active: true }).catch((failure) => setActionError(classify(failure).message));
      }}>{row.active ? "Disable" : "Enable"}</button>
    </div> },
  ];

  return <div className="page">
    <h1>Account management</h1>
    <FilterBar label="Filter accounts" busy={query.isFetching}
      onSubmit={() => { setFilters(draft); setCursors([null]); }}
      onReset={() => { setDraft(emptyFilters); setFilters(emptyFilters); setCursors([null]); }}>
      <SelectField id="account-role" label="Role" value={draft.role}
        onChange={(event) => setDraft({ ...draft, role: event.target.value as Filters["role"] })}>
        <option value="">All roles</option>
        <option value="REPORTER">Reporter</option>
        <option value="TECHNICIAN">Technician</option>
      </SelectField>
      <SelectField id="account-status" label="Status" value={draft.active}
        onChange={(event) => setDraft({ ...draft, active: event.target.value as Filters["active"] })}>
        <option value="">All statuses</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </SelectField>
    </FilterBar>
    {actionError && <p role="alert">{actionError}</p>}
    <DataTable rows={query.data?.items ?? []} columns={columns} rowKey={(row) => row.id}
      caption="Managed accounts" loading={query.isPending}
      error={query.error ? classify(query.error).message : undefined}
      onRetry={() => { void query.refetch(); }} emptyMessage="No accounts match these filters." />
    <Pagination nextCursor={query.data?.next_cursor ?? null} hasPrevious={cursors.length > 1}
      onNext={(cursor) => setCursors([...cursors, cursor])}
      onPrevious={() => setCursors(cursors.slice(0, -1))} busy={query.isFetching} />
    <ConfirmDialog open={toDisable !== null} title="Disable account?"
      description="This account will lose access on its next request. Existing reports remain available to administrators."
      confirmLabel="Disable account" danger pending={toggle.isPending}
      onCancel={() => setToDisable(null)} onConfirm={async () => {
        if (!toDisable) return;
        await toggle.mutateAsync({ id: toDisable.id, active: false });
        setToDisable(null);
      }} />
  </div>;
}
