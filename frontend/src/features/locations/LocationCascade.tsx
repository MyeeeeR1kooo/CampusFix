import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api, type Location } from "../../api";
import { SelectField } from "../../components/Field";
import { classify } from "../../lib/errors";
import { queryKeys } from "../../lib/queryClient";

async function loadActiveLocations(signal: AbortSignal): Promise<Location[]> {
  const locations: Location[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await api.listActiveLocations({ cursor, limit: 100 }, signal);
    locations.push(...page.items);
    cursor = page.next_cursor;
    if (cursor && seen.has(cursor)) throw new Error("The location list could not be completed.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return locations;
}

/** Controlled location ID for #51's form; three options are derived from every active page. */
export function LocationCascade({ value, onChange, error }: {
  value: number | null;
  onChange: (id: number | null) => void;
  error?: string;
}) {
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const query = useQuery({
    queryKey: queryKeys.locations.active({ all: true }),
    queryFn: ({ signal }) => loadActiveLocations(signal),
  });
  const locations = query.data ?? [];

  useEffect(() => {
    if (value === null || !query.data) return;
    const selected = query.data.find((location) => location.id === value);
    if (selected) { setBuilding(selected.building); setFloor(selected.floor); }
    else onChange(null);
  }, [value, query.data, onChange]);

  const buildings = useMemo(() => [...new Set(locations.map((location) => location.building))].sort(), [locations]);
  const floors = useMemo(() => [...new Set(locations.filter((location) => location.building === building).map((location) => location.floor))].sort(), [locations, building]);
  const rooms = locations.filter((location) => location.building === building && location.floor === floor);
  const unavailable = query.isPending || query.isError;

  return <div className="location-picker" aria-busy={query.isPending}>
    {query.isPending && <p role="status">Loading locations…</p>}
    {query.isError && <p role="alert">{classify(query.error).message} <button type="button" onClick={() => { void query.refetch(); }}>Retry</button></p>}
    <SelectField id="report-building" label="Building" required value={building} disabled={unavailable} onChange={(event) => { setBuilding(event.target.value); setFloor(""); onChange(null); }}>
      <option value="">Choose a building</option>
      {buildings.map((name) => <option key={name} value={name}>{name}</option>)}
    </SelectField>
    <SelectField id="report-floor" label="Floor" required value={floor} disabled={unavailable || !building} onChange={(event) => { setFloor(event.target.value); onChange(null); }}>
      <option value="">Choose a floor</option>
      {floors.map((name) => <option key={name} value={name}>{name}</option>)}
    </SelectField>
    <SelectField id="report-room" label="Room or area" required value={value ?? ""} disabled={unavailable || !floor} error={error} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">Choose a room or area</option>
      {rooms.map((location) => <option key={location.id} value={location.id}>{location.room_or_area}</option>)}
    </SelectField>
  </div>;
}
