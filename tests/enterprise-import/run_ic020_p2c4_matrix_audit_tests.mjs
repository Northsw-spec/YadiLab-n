import assert from "node:assert/strict";
import fs from "node:fs";

const read = file => fs.readFileSync(file, "utf8");
const matrix = JSON.parse(read("docs/architecture/import-capability-matrix.v1.json"));
const required = read(".github/workflows/required-ci.yml");
const release = read(".github/workflows/release-identity.yml");
const expected = ["builtin.json", "builtin.csv", "builtin.tsv", "builtin.xlsx", "builtin.ods"];
const baselineSha = "3c2d00d73c1204827c12be276b9d15855aadbd7f";
const baselineTree = "25ab69f011f86dd22c4528b79846a8592f0e43e3";
const sourceOracles = [
  "tests/browser/run_ic020_p1_core_source_freshness_tests.mjs",
  "tests/browser/run_ic020_p2a_dual_link_review_tests.mjs",
  "tests/browser/run_ic020_p2b_reimport_review_tests.mjs",
  "tests/browser/run_ic020_p2c1_saved_report_replay_tests.mjs",
  "tests/browser/run_ic020_p2c3_unmapped_inventory_tests.mjs",
];
const browserOracles = [
  "tests/acceptance/run_ic020_p1_core_inventory_real_browser.py",
  "tests/acceptance/run_ic020_p2a_link_review_real_browser.py",
  "tests/acceptance/run_ic020_p2b_reimport_real_browser.py",
  "tests/acceptance/run_ic020_p2c1_saved_report_real_browser.py",
  "tests/acceptance/run_ic020_p2c3_unmapped_real_browser.py",
];
const requiredCommands = [
  "npm run test:ic000-capabilities",
  "npm run test:ic020-p1-source-freshness",
  "npm run test:ic020-p2a-link-review",
  "npm run test:ic020-p2b-reimport-review",
  "npm run test:ic020-p2c1-sidecar-replay",
  "npm run test:ic020-p2c2-multisheet",
  "npm run test:ic020-p2c3-unmapped",
  "npm run test:ic020-p2c4-matrix",
];
let assertions = 0;
function ok(value, label) { assert.ok(value, label); assertions++; }
function eq(actual, expected, label) { assert.deepEqual(actual, expected, label); assertions++; }
function rejects(model, label) { eq(consistent(model), false, label); }
function consistent(model) {
  if (model.formatId !== "yadilab.import.capability-audit"
    || model.schemaVersion !== "1.0.0"
    || model.status !== "SOURCE_AUDIT_NOT_FUNCTIONAL_CERTIFICATION"
    || !Array.isArray(model.profiles) || model.profiles.length !== 27
    || model.auditBaseline.mainSha !== "56d2b9c11f65e8ce7b205a924db40c8d1d711219"
    || model.auditRefreshP2c4?.evidenceMainSha !== baselineSha
    || model.auditRefreshP2c4?.evidenceTreeSha !== baselineTree
    || model.auditRefreshP2c4?.releaseRun !== 41234186594
    || model.auditRefreshP2c4?.basis !== "SOURCE_BACKED_SUBSET_REFRESH_NOT_FULL_FUNCTIONAL_CERTIFICATION") return false;
  const active = model.profiles.filter(p => p.registry === "ACTIVE_ADAPTER");
  if (JSON.stringify(active.map(p=>p.id)) !== JSON.stringify(expected)
    || model.profiles.filter(p=>p.registry==="NATIVE_SCENARIO").length !== 1
    || model.profiles.filter(p=>p.registry==="PLANNED_HINT").length !== 21
    || model.profiles.filter(p=>p.ic020Refresh).length !== 5) return false;
  if (model.profiles.some(p=>p.registry==="PLANNED_HINT" &&
    (p.stage.modeledProbe==="YES" || p.stage.builder==="DIRECT_ACTIVATION" ||
      p.ic020Refresh !== undefined))) return false;
  for (const p of active) {
    const v = p.ic020Refresh;
    if (!v || v.checkpoint !== "IC-020 P2c4"
      || v.evidenceMainSha !== baselineSha || v.evidenceTreeSha !== baselineTree
      || v.independentLinuxRelease?.runId !== 41234186594
      || v.independentLinuxRelease?.headSha !== baselineSha
      || v.independentLinuxRelease?.conclusion !== "success"
      || v.sourceBoundOriginalShaRecheck !== "ATTESTED_P1_ALL_FIVE"
      || v.manualCompetingLinkSourceChoice !== "ATTESTED_P2A_SUPPORTED_INVENTORY"
      || v.consentedLiveReimport !== "ATTESTED_P2B"
      || v.readOnlySavedReimportReview !== "ATTESTED_P2C1"
      || v.ambiguousInventoryAndUnmappedColumns !== "ATTESTED_P2C3_ALL_FIVE"
      || v.compiledChromiumFileToBuilder !== "ATTESTED_P1_ALL_FIVE"
      || v.importedNegativeUnknownVerdictsInChromium !== "NOT_ATTESTED"
      || v.crossRowContradictoryFactsReconciliation !== "NOT_ATTESTED"
      || v.nativeParrotAndPhysicalNetwork !== "NOT_RUN"
      || p.stage.review !== "SOURCE_BOUND_EXPLICIT_LINK_CHOICE_AND_REIMPORT_APPROVAL"
      || p.stage.builder !== "CONSENTED_QUICK_NETWORK_BUILDER_WITH_FRESH_SOURCE_RECHECK"
      || p.stage.replay !== "SOURCE_BOUND_REIMPORT_REVIEW_AND_READ_ONLY_SAVED_REPORT"
      || p.ciCoverage !== "REQUIRED_IC020_P1_TO_P2C6_SOURCE_AND_BROWSER; SCOPED_EXIT_TRUTH_REGRESSION"
      || p.nextCheckpoint !== "IC-030") return false;
    const office = p.id === "builtin.xlsx" || p.id === "builtin.ods";
    const chromiumRuntime = p.id === "builtin.csv" ? "ATTESTED_P1_CSV"
      : p.id === "builtin.ods" ? "ATTESTED_P2C2_ODS" : "NOT_ATTESTED_FOR_THIS_SUBTYPE";
    if (v.compiledChromiumImportedModeledRuntime !== chromiumRuntime
      || v.typedOriginalPortChecks !== (office ? "ATTESTED_P2C2_SIX_SHEET" : "NOT_CLAIMED_FOR_THIS_SUBTYPE")
      || p.stage.modeledProbe !== "IMPORTED_MODELED_RUNTIME_SOURCE_AND_CHROMIUM_VERIFIED") return false;
    const expectedOracles = [...sourceOracles, ...browserOracles,
      ...(office ? ["tests/browser/run_ic020_p2c2_multisheet_tests.mjs",
        "tests/acceptance/run_ic020_p2c2_multisheet_real_browser.py"] : [])];
    if (!expectedOracles.every(path => p.tests.includes(path) && fs.existsSync(path))) return false;
    if (new Set(p.tests).size !== p.tests.length) return false;
    if (!p.sources.every(path => fs.existsSync(path))) return false;
  }
  return true;
}
ok(consistent(matrix), "historical P2c4 source evidence intact alongside current five-format P2c6 coverage");
for (const p of matrix.profiles.filter(p=>p.registry==="ACTIVE_ADAPTER")) {
  for (const file of [...p.sources,...p.tests]) ok(fs.existsSync(file),"source/test exists: "+file);
}
for (const cmd of requiredCommands) {
  ok(required.includes(cmd), "exact-head CI executes "+cmd);
  ok(release.includes(cmd), "exact-main release executes "+cmd);
}
for (const p of [...sourceOracles,...browserOracles]) ok(fs.existsSync(p), "existing acceptance source exists: "+p);
for (const token of ["IC_020_P2C4_CAPABILITY_AND_EXIT_AUDIT_ORACLES.md",
  "IC_020_P2C4_EXIT_GATE_AUDIT.md"]) {
  ok(fs.existsSync("docs/architecture/"+token), "P2c4 frozen + outcome docs kept");
}
const changed = fn => { const clone = structuredClone(matrix); fn(clone); return clone; };
rejects(changed(m=>m.profiles.find(p=>p.id==="builtin.xlsx").ic020Refresh.compiledChromiumImportedModeledRuntime="ATTESTED_P1_XLSX"),
  "cannot invent XLSX real-browser modeled Runtime");
rejects(changed(m=>m.profiles.find(p=>p.id==="builtin.tsv").ic020Refresh.importedNegativeUnknownVerdictsInChromium="ATTESTED"),
  "cannot invent source-imported FALSE/UNKNOWN browser verdict");
rejects(changed(m=>m.profiles.find(p=>p.id==="builtin.csv").ic020Refresh.nativeParrotAndPhysicalNetwork="PASS"),
  "cannot claim native/physical probing");
rejects(changed(m=>m.profiles.find(p=>p.id==="builtin.ods").ic020Refresh.independentLinuxRelease.headSha="0".repeat(40)),
  "cannot mismatch release and commit");
rejects(changed(m=>m.profiles.find(p=>p.id==="builtin.csv").tests=[]),
  "cannot lose regression evidence paths");
rejects(changed(m=>m.profiles.find(p=>p.id==="pdf.digital-tables.v1").stage.builder="DIRECT_ACTIVATION"),
  "blocked PDF must never acquire Builder");
rejects(changed(m=>m.profiles.find(p=>p.id==="builtin.json").ic020Refresh.crossRowContradictoryFactsReconciliation="PASS"),
  "cannot declare undocumented conflicts reconciled");
rejects(changed(m=>m.auditRefreshP2c4.releaseRun=41222732843),
  "cannot swap P2c3 release identity");
console.log("PASS IC-020 P2c4 historical evidence preserved alongside five-format P2c6 progress: "+
  assertions+" read-only, offline assertions");
