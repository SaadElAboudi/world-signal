import test from "node:test";
import assert from "node:assert/strict";
import { budgetState } from "../src/database/budget";

test("database budget states protect free-tier headroom before exhaustion", () => {
  assert.equal(budgetState(0.5), "safe");
  assert.equal(budgetState(0.7), "warning");
  assert.equal(budgetState(0.819), "warning");
  assert.equal(budgetState(0.82), "protect");
  assert.equal(budgetState(0.899), "protect");
  assert.equal(budgetState(0.9), "emergency");
});
