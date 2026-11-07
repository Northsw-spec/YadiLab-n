import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createTroubleshootingCase, computeCaseSourceIdentity } from "../../dist-browser-test/ui/src/browser/troubleshooting-case.js";
import { createExperimentBranch, replaceExperimentWorkingSource } from "../../dist-browser-test/ui/src/browser/experiment-branch.js";
import { generateChangeSet } from "../../dist-browser-test/ui/src/browser/change-set.js";
import { createPromotionPreview, promoteWithPreview, rollbackPromotion } from "../../dist-browser-test/ui/src/browser/promotion.js";

const source = JSON.parse(await fs.readFile("tests/fixtures/valid/scenario-source.json", "utf8"));
const caseValue = await createTroubleshootingCase({ source, title: "Dev4 promotion case" });
const baseIdentity = await computeCaseSourceIdentity(caseValue.workingSource);
const makeExperiment = async (label) => {
  const branch = await createExperimentBranch({ source: caseValue.workingSource, title: "Duplicate title", parentCaseId: caseValue.caseId, forkSource: "BASELINE" });
  return replaceExperimentWorkingSource(branch, { ...branch.workingSource, metadata: { ...branch.workingSource.metadata, description: `${branch.workingSource.metadata.description ?? ""} ${label}` } });
};
const a = await makeExperiment("A");
const changeA = await generateChangeSet({ baseSource: caseValue.workingSource, targetSource: a.workingSource, baseRevision: 0, targetRevision: 1 });
const previewA = await createPromotionPreview({ caseValue, caseWorkingRevision: 0, experiment: a, changeSet: changeA, suiteSummary: { PASS: 4, FAIL: 0, UNMODELED: 0 } });
await assert.rejects(() => promoteWithPreview({ preview: previewA, caseValue: { ...caseValue, workingSource: { ...caseValue.workingSource, metadata: { ...caseValue.workingSource.metadata, description: "TARGET DRIFT" } } }, caseWorkingRevision: 0, experiment: a }), /TARGET_CHANGED/);
const sourceDrift = await replaceExperimentWorkingSource(a, { ...a.workingSource, metadata: { ...a.workingSource.metadata, description: "SOURCE DRIFT" } });
await assert.rejects(() => promoteWithPreview({ preview: previewA, caseValue, caseWorkingRevision: 0, experiment: sourceDrift }), /SOURCE_CHANGED/);
const promotedA = await promoteWithPreview({ preview: previewA, caseValue, caseWorkingRevision: 0, experiment: a });
assert.equal(await computeCaseSourceIdentity(promotedA.caseValue.workingSource), a.workingSourceIdentity);
assert.equal(await computeCaseSourceIdentity(promotedA.snapshot.source), baseIdentity);
assert.equal(promotedA.history[0].kind, "PROMOTION");
await assert.rejects(() => promoteWithPreview({ preview: promotedA.preview, caseValue: promotedA.caseValue, caseWorkingRevision: promotedA.workingRevision, experiment: a }), /ALREADY_CONSUMED/);
const tampered = { ...promotedA, snapshot: { ...promotedA.snapshot, sourceIdentity: "f".repeat(64) } };
await assert.rejects(() => rollbackPromotion({ state: tampered }), /SNAPSHOT_INTEGRITY/);
const rolledA = await rollbackPromotion({ state: promotedA });
assert.equal(await computeCaseSourceIdentity(rolledA.caseValue.workingSource), baseIdentity);
assert.equal(rolledA.history[1].kind, "ROLLBACK");
await assert.rejects(() => rollbackPromotion({ state: rolledA }), /ROLLBACK_CURRENT_SOURCE_DRIFTED/);
let state = rolledA;
for (const label of ["B", "C"]) {
  const experiment = await makeExperiment(label);
  const change = await generateChangeSet({ baseSource: state.caseValue.workingSource, targetSource: experiment.workingSource, baseRevision: state.workingRevision, targetRevision: state.workingRevision + 1 });
  const preview = await createPromotionPreview({ caseValue: state.caseValue, caseWorkingRevision: state.workingRevision, experiment, changeSet: change });
  state = await promoteWithPreview({ preview, caseValue: state.caseValue, caseWorkingRevision: state.workingRevision, experiment, history: state.history });
  assert.equal(await computeCaseSourceIdentity(state.caseValue.workingSource), experiment.workingSourceIdentity);
  state = await rollbackPromotion({ state });
  assert.equal(await computeCaseSourceIdentity(state.caseValue.workingSource), baseIdentity);
}
console.log("PASS v1.6 Dev4 promotion: explicit preview, target/source drift guards, exact snapshot promotion, consumed preview, tamper-safe rollback, replay block and repeated A/B/C cycles");
