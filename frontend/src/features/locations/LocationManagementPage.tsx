import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { api, type Location } from "../../api";
import { ConfirmDialog, DataTable, Pagination, type TableColumn } from "../../components";
import { TextField } from "../../components/Field";
import { classify } from "../../lib/errors";
import { queryKeys } from "../../lib/queryClient";

// Location names are preserved as written; do not silently trim or fold them.
const locationSchema = z.object({
  building: z.string().min(1, "Enter a building.").max(255, "Building must be 255 characters or fewer."),
  floor: z.string().min(1, "Enter a floor."),
  room_or_area: z.string().min(1, "Enter a room or area."),
});
type LocationFields = z.infer<typeof locationSchema>;

function LocationForm({ initial, onSave, onCancel }: {
  initial: Location | null;
  onSave: (values: LocationFields) => Promise<void>;
  onCancel: () => void;
}) {
  const [requestError, setRequestError] = useState<string>();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<LocationFields>({
    resolver: zodResolver(locationSchema),
    defaultValues: initial
      ? { building: initial.building, floor: initial.floor, room_or_area: initial.room_or_area }
      : { building: "", floor: "", room_or_area: "" },
  });

  const submit = handleSubmit(async (values) => {
    setRequestError(undefined);
    try {
      await onSave(values);
    } catch (failure) {
      const error = classify(failure);
      setRequestError(error.message);
      for (const field of ["building", "floor", "room_or_area"] as const) {
        if (error.fields[field]) setError(field, { message: error.fields[field] });
      }
    }
  }, () => setRequestError("Check the required location fields."));

  return <section className="card" aria-label={initial ? "Edit location" : "New location"}>
    <h2>{initial ? "Edit location" : "New location"}</h2>
    <form className="form form-inline" onSubmit={(event) => { void submit(event); }} noValidate>
      <TextField id="location-building" label="Building" required disabled={isSubmitting} error={errors.building?.message} {...register("building")} />
      <TextField id="location-floor" label="Floor" required disabled={isSubmitting} error={errors.floor?.message} {...register("floor")} />
      <TextField id="location-room" label="Room or area" required disabled={isSubmitting} error={errors.room_or_area?.message} {...register("room_or_area")} />
      <div className="form-actions">
        <button className="primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save location"}</button>
        <button type="button" onClick={onCancel} disabled={isSubmitting}>Cancel</button>
      </div>
    </form>
    {requestError && <p role="alert">{requestError}</p>}
  </section>;
}

export function LocationManagementPage() {
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [editing, setEditing] = useState<Location | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toDisable, setToDisable] = useState<Location | null>(null);
  const [actionError, setActionError] = useState<string>();
  const queryClient = useQueryClient();
  const params = { cursor: cursors.at(-1), limit: 20 };
  const query = useQuery({
    queryKey: queryKeys.locations.admin(params),
    queryFn: ({ signal }) => api.listAdminLocations(params, signal),
  });

  async function refreshLocations() {
    setCursors([null]);
    await queryClient.invalidateQueries({ queryKey: queryKeys.locations.all });
  }

  const save = useMutation({
    mutationFn: ({ initial, values }: { initial: Location | null; values: LocationFields }) =>
      initial ? api.updateLocation(initial.id, values) : api.createLocation({ ...values, active: true }),
    onSuccess: async () => {
      setFormOpen(false);
      setEditing(null);
      await refreshLocations();
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.updateLocation(id, { active }),
    onSuccess: refreshLocations,
  });

  const columns: TableColumn<Location>[] = [
    { key: "building", label: "Building", render: (row) => row.building },
    { key: "floor", label: "Floor", render: (row) => row.floor },
    { key: "room", label: "Room or area", render: (row) => row.room_or_area },
    { key: "status", label: "Status", render: (row) => <span className={`badge ${row.active ? "badge-success" : "badge-muted"}`}>{row.active ? "Active" : "Inactive"}</span> },
    { key: "actions", label: "Actions", render: (row) => <div className="cell-actions">
      <button type="button" disabled={toggle.isPending || save.isPending} onClick={() => { setEditing(row); setFormOpen(true); setActionError(undefined); }}>Edit</button>
      <button type="button" disabled={toggle.isPending || save.isPending} onClick={() => {
        setActionError(undefined);
        if (row.active) setToDisable(row);
        else void toggle.mutateAsync({ id: row.id, active: true }).catch((failure) => setActionError(classify(failure).message));
      }}>{row.active ? "Disable" : "Enable"}</button>
    </div> },
  ];

  return <div className="page">
    <h1>Location management</h1>
    <p>Manage the building, floor and room or area available for new reports. Existing reports keep their original location name.</p>
    {!formOpen && <div className="form-actions"><button className="primary" type="button" onClick={() => { setEditing(null); setFormOpen(true); setActionError(undefined); }}>New location</button></div>}
    {formOpen && <LocationForm key={editing?.id ?? "new"} initial={editing} onSave={async (values) => { await save.mutateAsync({ initial: editing, values }); }} onCancel={() => { setFormOpen(false); setEditing(null); }} />}
    {actionError && <p role="alert">{actionError}</p>}
    <DataTable rows={query.data?.items ?? []} columns={columns} rowKey={(row) => row.id} caption="All locations" loading={query.isPending} error={query.error ? classify(query.error).message : undefined} onRetry={() => { void query.refetch(); }} emptyMessage="No locations yet." />
    <Pagination nextCursor={query.data?.next_cursor ?? null} hasPrevious={cursors.length > 1} onNext={(cursor) => setCursors([...cursors, cursor])} onPrevious={() => setCursors(cursors.slice(0, -1))} busy={query.isFetching} />
    <ConfirmDialog open={toDisable !== null} title="Disable location?" description="This location will no longer be available for new reports. Existing reports retain their saved location name." confirmLabel="Disable location" danger pending={toggle.isPending} onCancel={() => setToDisable(null)} onConfirm={async () => {
      if (!toDisable) return;
      await toggle.mutateAsync({ id: toDisable.id, active: false });
      setToDisable(null);
    }} />
  </div>;
}
