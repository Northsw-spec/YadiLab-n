import assert from "node:assert/strict";
import { compareSelectedRuns, selectBaselineRun } from "../../dist-browser-test/ui/src/browser/multi-run.js";
const make = (id, hash = "a".repeat(64), flow = "flow-1") => ({ run: { runId: id, scenarioHash: hash, sourceRevision: 0, runtimeRevision: 1, flowId: flow, outcome: "DROP", eventIds: [], eventCount: 0, faultState: "HEALTHY", archived: true }, evidence: { scenarioHash: hash, runtimeRevision: 1, flowId: flow, outcome: { kind: "DROP" }, records: [] } });
assert.throws(() => selectBaselineRun(compareSelectedRuns([make("a")]), "missing"), /MULTI_RUN_BASELINE_NOT_SELECTED/);
const comparison = compareSelectedRuns([make("a"), make("b", "b".repeat(64))]);
assert.equal(comparison.rows[0].comparability, "NOT COMPARABLE");
assert.equal(comparison.factualDifferences.length, 0);
console.log("PASS v1.5 Dev2 adversarial: baseline selection and non-comparable runs fail closed without causal claims");
