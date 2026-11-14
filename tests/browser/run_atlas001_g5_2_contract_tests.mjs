import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contract = JSON.parse(fs.readFileSync(
  path.join(root, "docs/design/atlas-001/ATLAS001_G5_2_BINDING_CONTRACT.json"),
  "utf8",
));
const markdown = fs.readFileSync(
  path.join(root, "docs/design/atlas-001/ATLAS001_G5_2_BINDING_CONTRACT.md"),
  "utf8",
);

const checks = [];
function check(condition, message) {
  assert.ok(condition, message);
  checks.push(message);
}

// Contract identity and the approved architecture decisions.
check(contract.contractId === "yadilab.docx-physical-page-evidence", "contract id is stable");
check(contract.schemaVersion === "1.0.0", "side-evidence schema is versioned");
check(contract.status === "CONTRACT_FROZEN", "contract is frozen, not merely proposed");
check(contract.implementationStatus === "NOT_STARTED", "product implementation remains disabled");
check(contract.sourceFormat === "docx", "pilot is DOCX-only");
check(contract.odtPolicy === "PRESERVE_IC040_UNCHANGED", "IC-040 ODT policy is preserved");
check(contract.canonicalModel === "EXISTING_SCENARIO_SOURCE", "existing ScenarioSource is reused");
check(contract.atlasProjection === "EXISTING_BUILD_ATLAS_INDEX_AND_PROJECT_ATLAS_PAGE", "existing Atlas projection is reused");
check(contract.topologyInference === "FORBIDDEN", "page evidence cannot infer topology");
check(contract.approvedDecisions.canonicalResourceMaximum === 12, "canonical resource ceiling is 12");
check(contract.approvedDecisions.declaredConnectionMaximum === 11, "declared connection ceiling is 11");
check(contract.approvedDecisions.derivedResourceMaximum === 0, "derived resources are forbidden");
check(contract.approvedDecisions.derivedConnectionMaximum === 0, "derived connections are forbidden");
check(contract.approvedDecisions.derivedPortMaximum === 0, "derived ports are forbidden");
check(contract.approvedDecisions.derivedZoneMaximum === 0, "derived zones are forbidden");
check(contract.approvedDecisions.rendererProfile === "atlas001-g5.0.github-ubuntu-24.04-renderer.v1", "G5.0 renderer is the baseline");
check(contract.approvedDecisions.officeReviewedProvenance === "yadilab.office-reviewed-provenance@1.0.0", "G5.1 provenance remains compatible");

const requiredEvidence = new Set(contract.evidenceRecord.required);
for (const field of [
  "evidenceId", "source.sha256", "source.profileId", "source.part",
  "provenance.formatId", "provenance.schemaVersion", "provenance.sourceIdentity",
  "provenance.sourceRevision", "provenance.factId", "fact.targetId", "fact.field",
  "locator.tableOrdinal", "locator.rowOrdinal", "locator.cellOrdinal",
  "renderer.profileId", "renderer.fingerprint", "renderer.fontFingerprint",
  "renderer.locale", "renderer.pageNumber", "renderer.pageCount",
  "verification.method", "verification.evidenceRef",
]) check(requiredEvidence.has(field), `evidence requires ${field}`);
for (const status of ["VERIFIED", "UNKNOWN", "BLOCKED"]) {
  check(contract.evidenceRecord.statuses.includes(status), `evidence status ${status} is explicit`);
}
check(contract.evidenceRecord.physicalPageWhenUnknown === null, "UNKNOWN has no page number");
check(contract.evidenceRecord.rawDocxBytesEmbedded === false, "raw DOCX bytes are excluded");
check(contract.evidenceRecord.rawCellValuesEmbedded === false, "raw cell values are excluded");
check(contract.evidenceRecord.textOnlyMatchingSufficient === false, "text-only matching is insufficient");

// Test-local oracle: this models only the frozen decision contract. It is not
// production code and deliberately does not create or mutate a ScenarioSource.
function decideEvidenceStatus(input) {
  if (input.format !== "docx" || input.rendererProfile !== contract.approvedDecisions.rendererProfile) return "BLOCKED";
  if (input.sourceShaMatches !== true || input.sourceRevisionMatches !== true || input.sourceIdentityMatches !== true) return "BLOCKED";
  if (input.targetExists !== true || input.factExists !== true || input.locatorValid !== true) return "BLOCKED";
  if (input.resources > contract.approvedDecisions.canonicalResourceMaximum) return "BLOCKED";
  if (input.connections > contract.approvedDecisions.declaredConnectionMaximum) return "BLOCKED";
  if (input.rendererComparable !== true || input.pageNumber === null || input.repeatedRenderedText === true || input.splitTableUnentailed === true) return "UNKNOWN";
  if (input.historicalReplay === true || input.builderChanged === true) return "BLOCKED";
  return "VERIFIED";
}

const valid = {
  format: "docx",
  rendererProfile: contract.approvedDecisions.rendererProfile,
  sourceShaMatches: true,
  sourceRevisionMatches: true,
  sourceIdentityMatches: true,
  targetExists: true,
  factExists: true,
  locatorValid: true,
  resources: 12,
  connections: 11,
  rendererComparable: true,
  pageNumber: 42,
  repeatedRenderedText: false,
  splitTableUnentailed: false,
  historicalReplay: false,
  builderChanged: false,
};
check(decideEvidenceStatus(valid) === "VERIFIED", "entitled mapping is VERIFIED");
check(decideEvidenceStatus({ ...valid, pageNumber: null }) === "UNKNOWN", "missing page proof is UNKNOWN");
check(decideEvidenceStatus({ ...valid, repeatedRenderedText: true }) === "UNKNOWN", "repeated text is UNKNOWN");
check(decideEvidenceStatus({ ...valid, splitTableUnentailed: true }) === "UNKNOWN", "unentailed split table is UNKNOWN");
for (const [field, label] of [
  ["sourceShaMatches", "wrong source SHA"],
  ["sourceRevisionMatches", "wrong source revision"],
  ["sourceIdentityMatches", "wrong canonical source identity"],
  ["targetExists", "unknown target"],
  ["factExists", "unknown fact"],
  ["locatorValid", "forged locator"],
]) check(decideEvidenceStatus({ ...valid, [field]: false }) === "BLOCKED", `${label} is BLOCKED`);
check(decideEvidenceStatus({ ...valid, rendererComparable: false }) === "UNKNOWN", "renderer drift requires UNKNOWN/reverification");
check(decideEvidenceStatus({ ...valid, format: "odt" }) === "BLOCKED", "ODT cannot use DOCX profile");
check(decideEvidenceStatus({ ...valid, resources: 13 }) === "BLOCKED", "13 resources are BLOCKED");
check(decideEvidenceStatus({ ...valid, connections: 12 }) === "BLOCKED", "12 connections are BLOCKED");
check(decideEvidenceStatus({ ...valid, historicalReplay: true }) === "BLOCKED", "historical replay is BLOCKED");
check(decideEvidenceStatus({ ...valid, builderChanged: true }) === "BLOCKED", "Builder change invalidates evidence");

// The contract requires no topology mutation. A frozen snapshot must be byte-
// equivalent after adding metadata-only evidence.
const canonical = { resources: ["r1", "r2"], connections: ["c1"] };
const before = JSON.stringify(canonical);
const evidenceOnly = { ...canonical, pageEvidence: [{ evidenceId: "e1", status: "VERIFIED" }] };
check(JSON.stringify(canonical) === before, "canonical model is not mutated by side evidence");
check(JSON.stringify(evidenceOnly.resources) === JSON.stringify(canonical.resources), "resource IDs remain canonical");
check(JSON.stringify(evidenceOnly.connections) === JSON.stringify(canonical.connections), "connection IDs remain canonical");

for (const marker of [
  "G5.0 kontroll A/B", "G5.1", "Save/Open", "HISTORICAL",
  "renderer", "font", "locale", "IC-040", "global ELK", "UNKNOWN", "BLOCKED",
]) check(markdown.includes(marker), `contract documents ${marker}`);

console.log(`PASS ATLAS-001 G5.2 binding contract: ${checks.length} assertions; no product implementation activated.`);
