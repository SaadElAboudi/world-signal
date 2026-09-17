import { readFileSync } from "node:fs";
import { join } from "node:path";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { cellToLatLng, cellArea, UNITS, latLngToCell } from "h3-js";
import type { Feature, Polygon, MultiPolygon } from "geojson";
let countries:
  | {
      feature: Feature<Polygon | MultiPolygon, { ADMIN: string }>;
      bbox: [number, number, number, number];
    }[]
  | undefined;
const cache = new Map<string, string>();
function loadCountries() {
  if (!countries) {
    const data = JSON.parse(
      readFileSync(join(process.cwd(), "public/geo/countries.geojson"), "utf8"),
    );
    countries = data.features.map(
      (feature: Feature<Polygon | MultiPolygon, { ADMIN: string }>) => {
        const points = (
          feature.geometry.type === "Polygon"
            ? feature.geometry.coordinates.flat()
            : feature.geometry.coordinates.flat(2)
        ) as number[][];
        return {
          feature,
          bbox: [
            Math.min(...points.map((p) => p[0])),
            Math.min(...points.map((p) => p[1])),
            Math.max(...points.map((p) => p[0])),
            Math.max(...points.map((p) => p[1])),
          ],
        };
      },
    );
  }
  return countries!;
}
export function countryAt(latitude: number, longitude: number) {
  const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key)!;
  const result = loadCountries().find(
    ({ feature, bbox: [west, south, east, north] }) =>
      longitude >= west &&
      longitude <= east &&
      latitude >= south &&
      latitude <= north &&
      booleanPointInPolygon([longitude, latitude], feature),
  );
  const country = result?.feature.properties.ADMIN ?? "Offshore / unassigned";
  if (cache.size > 10000) cache.clear();
  cache.set(key, country);
  return country;
}
export function geographicCell(
  latitude: number,
  longitude: number,
  type: "earthquake" | "wildfire",
) {
  return latLngToCell(latitude, longitude, type === "wildfire" ? 3 : 2);
}
export function cellGeography(cell: string) {
  const [latitude, longitude] = cellToLatLng(cell);
  return {
    latitude,
    longitude,
    country: countryAt(latitude, longitude),
    areaKm2: cellArea(cell, UNITS.km2),
  };
}
