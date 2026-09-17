import { cellToParent, getResolution, isValidCell, latLngToCell } from "h3-js";
import type { WorldSignal } from "../core/types";
import type { GeographicScope } from "./types";
export function assignedCountry(country: string | null) {
  return country && country !== "Offshore / unassigned" ? country : null;
}
export function scopeForSignal(signal: WorldSignal): GeographicScope {
  return {
    kind: signal.type === "internet" ? "country" : "h3",
    country: assignedCountry(signal.country),
    ...(signal.type === "internet"
      ? {}
      : {
          cellId:
            signal.evidence?.cellId ??
            latLngToCell(signal.latitude, signal.longitude, 2),
        }),
    latitude: signal.latitude,
    longitude: signal.longitude,
  };
}
export function validScope(scope: GeographicScope) {
  return (
    Number.isFinite(scope.latitude) &&
    Math.abs(scope.latitude) <= 90 &&
    Number.isFinite(scope.longitude) &&
    Math.abs(scope.longitude) <= 180 &&
    (scope.kind === "country"
      ? Boolean(assignedCountry(scope.country))
      : Boolean(scope.cellId && isValidCell(scope.cellId)))
  );
}
export function geographicRelation(
  a: GeographicScope,
  b: GeographicScope,
): { score: number; scope: GeographicScope } | null {
  if (!validScope(a) || !validScope(b)) return null;
  if (a.kind === "country" || b.kind === "country") {
    if (!assignedCountry(a.country) || a.country !== b.country) return null;
    return { score: 0.8, scope: a.kind === "country" ? a : b };
  }
  // Local events are related through containment, not merely being in the same
  // large country. A finer H3 cell must share the coarser cell exactly.
  const resolution = Math.min(
    getResolution(a.cellId!),
    getResolution(b.cellId!),
  );
  const ac = cellToParent(a.cellId!, resolution);
  const bc = cellToParent(b.cellId!, resolution);
  if (ac !== bc) return null;
  return {
    score: a.cellId === b.cellId ? 1 : 0.9,
    scope: getResolution(a.cellId!) <= getResolution(b.cellId!) ? a : b,
  };
}
export function spatialKeys(
  scope: GeographicScope,
  operation: "read" | "write",
) {
  if (scope.kind === "country")
    return operation === "read"
      ? [`national:${scope.country}`, `member:${scope.country}`]
      : [`national:${scope.country}`];
  const cell = scope.cellId!;
  const resolution = getResolution(cell);
  const keys = assignedCountry(scope.country)
    ? [`${operation === "read" ? "national" : "member"}:${scope.country}`]
    : [];
  if (operation === "read") {
    keys.push(`descendant:${cell}`);
    for (let r = 0; r <= resolution; r++)
      keys.push(`local:${cellToParent(cell, r)}`);
  } else {
    keys.push(`local:${cell}`);
    for (let r = 0; r < resolution; r++)
      keys.push(`descendant:${cellToParent(cell, r)}`);
  }
  return keys;
}
