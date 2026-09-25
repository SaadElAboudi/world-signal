import assert from "node:assert/strict";
import test from "node:test";
import { countryContains } from "../src/components/map-markers";

test("country selection includes points in polygons and excludes holes", () => {
  const geometry = {
    type: "Polygon",
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  };
  assert.equal(countryContains(geometry, 2, 2), true);
  assert.equal(countryContains(geometry, 5, 5), false);
  assert.equal(countryContains(geometry, 12, 2), false);
});

test("country selection supports multi-polygon territories", () => {
  const geometry = {
    type: "MultiPolygon",
    coordinates: [
      [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
      [[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]]],
    ],
  };
  assert.equal(countryContains(geometry, 21, 21), true);
  assert.equal(countryContains(geometry, 10, 10), false);
});
