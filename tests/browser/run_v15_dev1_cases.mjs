import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createTroubleshootingCase, computeCaseSourceIdentity, addTroubleshootingBookmark, addTroubleshootingCaseNote, attachCaseRun, resetTroubleshootingCase, replaceTroubleshootingCaseWorkingSource, exportTroubleshootingCase, importTroubleshootingCase, verifyTroubleshootingCase, resolveCaseBookmark } from "../../dist-browser-test/ui/src/browser/troubleshooting-case.js";
import { compareSelectedRuns, openRunPairDiff, selectBaselineRun } from "../../dist-browser-test/ui/src/browser/multi-run.js";
import { createSavedDiagnosticSession, exportSavedDiagnosticSession, importSavedDiagnosticSession } from "../../dist-browser-test/ui/src/browser/diagnostic-session.js";
import { createReproductionRecipe, reproduceWithEngine } from "../../dist-browser-test/ui/src/browser/reproduction-recipe.js";

const source = JSON.parse(await fs.readFile("tests/fixtures/valid/scenario-source.json", "utf8"));
const evidence = (revision, outcome, flow = "flow-1") => ({ scenarioHash: "a".repeat(64), runtimeRevision: revision, flowId: flow, outcome: { kind: outcome }, records: [{ eventId: `event-${revision}`, sequence: 1, runtimeRevision: revision, scenarioHash: "a".repeat(64), flowId: flow, domain: "Outcome", eventType: "flow.outcome", sourceResourceId: "r1", truth: outcome, summary: `modeled ${outcome}`, provenance: "Engine", evidenceRefs: [] }] });

let value = await createTroubleshootingCase({ source, title: "DNS investigation", description: "Reproducible case", selectedFlowIds: ["flow-1"] });
assert.equal((await verifyTroubleshootingCase(value)).ok, true);
const originalIdentity = value.caseIdentity;
value = await addTroubleshootingCaseNote(value, "Misstänker routing.", true);
assert.equal(value.notes[0].label, "HYPOTHESIS / USER NOTE");
value = await addTroubleshootingBookmark(value, "EVIDENCE", "event-missing", "Initial evidence");
value = await attachCaseRun(value, evidence(1, "DROP"), 0);
assert.equal(value.runs.length, 1);
const changed = { ...source, metadata: { ...source.metadata, title: "edited working copy" } };
value = await replaceTroubleshootingCaseWorkingSource(value, changed);
assert.equal(value.workingSource.metadata.title, "edited working copy");
value = await resetTroubleshootingCase(value);
assert.deepEqual(value.workingSource, value.startingSource);
assert.ok(value.caseId.length >= 8);
assert.equal(value.caseIdentity === originalIdentity, false);
assert.equal(resolveCaseBookmark(value, value.bookmarks[0]).available, false);
const exportedCase = exportTroubleshootingCase(value);
assert.equal((await importTroubleshootingCase(exportedCase)).ok, true);

const run1 = { run: value.runs[0], evidence: evidence(1, "DROP") };
value = await attachCaseRun(value, evidence(2, "DROP"), 1);
value = await attachCaseRun(value, evidence(3, "SUCCESS"), 2);
const run2 = { run: value.runs.find((r) => r.runtimeRevision === 2), evidence: evidence(2, "DROP") };
const run3 = { run: value.runs.find((r) => r.runtimeRevision === 3), evidence: evidence(3, "SUCCESS") };
const comparison = compareSelectedRuns([run1, run2, run3]);
assert.equal(comparison.rows.length, 3);
assert.deepEqual(comparison.outcomeMatrix.map((r) => r.outcome), ["DROP", "DROP", "SUCCESS"]);
assert.match(comparison.factualDifferences.join(" "), /outcome changed/);
assert.equal(selectBaselineRun(comparison, run1.run.runId).baselineRunId, run1.run.runId);
assert.equal(openRunPairDiff(run1, run3).comparable, true);

const session = await createSavedDiagnosticSession({ sessionId: "session-1", case: value, runs: [run1, run2, run3], comparisons: [comparison] });
assert.equal((await importSavedDiagnosticSession(exportSavedDiagnosticSession(session))).ok, true);
assert.equal(session.runs.every((r) => r.run.archived), true);

const recipe = await createReproductionRecipe(value, "flow-1", 0, { runId: run1.run.runId, outcome: "DROP" });
const reproduction = await reproduceWithEngine(recipe, async () => evidence(99, "SUCCESS"));
assert.equal(reproduction.status, "DIFFERENT OUTCOME");
assert.equal(reproduction.reproducedOutcome, "SUCCESS");
assert.notEqual(reproduction.reproducedOutcome, recipe.originalOutcome);
console.log("PASS v1.5 Dev1 cases: create/open/isolation/reset/run/bookmark/note/integrity/export/import + Dev2/3/4 orchestration smoke");
