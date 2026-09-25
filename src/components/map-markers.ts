import type { WorldSignal } from "@/core/types";
import type { WorldEvent } from "@/events/types";

export type MapMarkerKind =
  | "all"
  | "earthquake"
  | "fire"
  | "weather"
  | "ocean"
  | "network"
  | "aviation"
  | "correlation"
  | "other";

export const MAP_MARKERS: Array<{
  id: MapMarkerKind;
  symbol: string;
  en: string;
  fr: string;
}> = [
  { id: "all", symbol: "●", en: "All", fr: "Tout" },
  { id: "earthquake", symbol: "◉", en: "Earthquakes", fr: "Séismes" },
  { id: "fire", symbol: "▲", en: "Wildfires", fr: "Feux" },
  { id: "weather", symbol: "✦", en: "Weather", fr: "Météo" },
  { id: "ocean", symbol: "≈", en: "Oceans", fr: "Océans" },
  { id: "network", symbol: "⬡", en: "Networks", fr: "Réseaux" },
  { id: "aviation", symbol: "✈", en: "Aviation", fr: "Aviation" },
  { id: "correlation", symbol: "◎", en: "Links", fr: "Liens" },
];

export function signalMarkerKind(signal: WorldSignal): MapMarkerKind {
  if (signal.type === "earthquake") return "earthquake";
  if (signal.type === "wildfire") return "fire";
  if (signal.type === "internet") return "network";
  if (signal.type === "aviation") return "aviation";
  return "other";
}

export function eventMarkerKind(event: WorldEvent): MapMarkerKind {
  if (event.type === "earthquake") return "earthquake";
  if (event.type === "wildfire") return "fire";
  if (["marine_heatwave", "water_anomaly", "sea_lake_ice"].includes(event.type)) return "ocean";
  if (["internet_outage", "power_grid_anomaly"].includes(event.type)) return "network";
  if (event.type === "aviation_disruption") return "aviation";
  if (event.category === "climate") return "weather";
  return "other";
}

export function markerSymbol(kind: MapMarkerKind) {
  return MAP_MARKERS.find((marker) => marker.id === kind)?.symbol ?? "◆";
}

export function countryContains(
  geometry: { type: string; coordinates: unknown },
  latitude: number,
  longitude: number,
) {
  const pointInRing = (ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersects =
        yi > latitude !== yj > latitude &&
        longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  };
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates as number[][][]]
      : (geometry.coordinates as number[][][][]);
  return polygons.some(
    (polygon) =>
      pointInRing(polygon[0]) && !polygon.slice(1).some(pointInRing),
  );
}
