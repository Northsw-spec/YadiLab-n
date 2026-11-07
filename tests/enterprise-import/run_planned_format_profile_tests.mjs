import assert from "node:assert/strict";
import {
  inspectPlannedExternalSource,
  plannedExternalSourceProfiles,
} from "../../dist-enterprise-import-test/enterprise-import/src/planned-format-profiles.js";
import {
  builtinEnterpriseImportAdapters,
  selectEnterpriseImportAdapter,
} from "../../dist-enterprise-import-test/enterprise-import/src/adapters.js";

let assertions = 0;
const eq = (actual, expected, note) => { assert.deepEqual(actual, expected, note); assertions++; };
const blocked = (file, code, expectedProfiles, explicit) => {
  const outcome = inspectPlannedExternalSource(file, explicit);
  eq(outcome.status, "BLOCKED", "This new profile must never be enabled by discovery");
  eq(outcome.code, code, "Wrong strict failure code");
  eq(outcome.candidateProfileIds, expectedProfiles, "Wrong independent candidate set");
};
// This registry CANNOT turn on external formats. File suffix alone is not a parser.
blocked("network.graphml", "IMPORT_PROFILE_NOT_IMPLEMENTED", ["graphml.structural.v1"]);
blocked("SCAN.XML", "IMPORT_PROFILE_AMBIGUOUS", ["diagrams.drawio.v1", "nessus.xml.v1", "nmap.xml.v1"]);
blocked("cml.yaml", "IMPORT_PROFILE_AMBIGUOUS", ["cisco-cml.yaml.v1", "inventory.yaml.v1"]);
blocked("network.unl", "IMPORT_PROFILE_NOT_IMPLEMENTED", ["eve-ng.unl.v1"]);
blocked("diagram.vsdx", "IMPORT_PROFILE_NOT_IMPLEMENTED", ["visio.vsdx.v1"]);
blocked("topology.gns3project", "IMPORT_PROFILE_NOT_IMPLEMENTED", ["gns3.project.v1"]);
blocked("report.docx", "IMPORT_PROFILE_NOT_IMPLEMENTED", ["office.docx-tables.v1"]);
blocked("report.odt", "IMPORT_PROFILE_NOT_IMPLEMENTED", ["office.odt-tables.v1"]);
blocked("session.pcapng", "IMPORT_PROFILE_NOT_IMPLEMENTED", ["capture.pcap.v1"]);
blocked("scan.nessus", "IMPORT_PROFILE_NOT_IMPLEMENTED", ["nessus.xml.v1"]);
blocked("export.tfstate", "IMPORT_PROFILE_NOT_IMPLEMENTED", ["terraform.state.v1"]);
blocked("commands.txt", "IMPORT_PROFILE_AMBIGUOUS", ["configuration.text.v1", "logs.text.v1"]);
blocked("unknown.bin", "IMPORT_PROFILE_UNKNOWN", []);
blocked("", "IMPORT_PROFILE_FILENAME_INVALID", []);
blocked("evil.graphml\0.txt", "IMPORT_PROFILE_FILENAME_INVALID", []);
blocked("export.xml", "IMPORT_PROFILE_NOT_IMPLEMENTED", ["nmap.xml.v1"], "nmap.xml.v1");
blocked("export.yaml", "IMPORT_PROFILE_NOT_IMPLEMENTED", ["inventory.yaml.v1"], "inventory.yaml.v1");
blocked("export.xml", "IMPORT_PROFILE_EXTENSION_MISMATCH", [], "graphml.structural.v1");
blocked("topology.graphml", "IMPORT_PROFILE_UNKNOWN", [], "invented.profile.v1");
// Registry metadata must remain immutable and unique; no unapproved duplication.
eq(new Set(plannedExternalSourceProfiles.map((p) => p.profileId)).size, plannedExternalSourceProfiles.length);
eq(Object.isFrozen(plannedExternalSourceProfiles), true);
eq(plannedExternalSourceProfiles.every((p) => Object.isFrozen(p) && Object.isFrozen(p.suffixes)), true);
// Independently attest that old adapters have NOT been replaced by the discovery hints.
eq(builtinEnterpriseImportAdapters.map((a) => a.id),
  ["builtin.json", "builtin.csv", "builtin.tsv", "builtin.xlsx", "builtin.ods"]);
eq(selectEnterpriseImportAdapter("application/json").id, "builtin.json");
eq(selectEnterpriseImportAdapter("text/csv").id, "builtin.csv");
eq(selectEnterpriseImportAdapter("text/tab-separated-values").id, "builtin.tsv");
eq(selectEnterpriseImportAdapter("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").id, "builtin.xlsx");
eq(selectEnterpriseImportAdapter("application/vnd.oasis.opendocument.spreadsheet").id, "builtin.ods");
assert.throws(
  () => selectEnterpriseImportAdapter("application/graphml+xml"),
  /No import adapter supports media type/,
  "GraphML MUST NOT silently become an active import adapter"
); assertions++;
console.log(`PASS CORE-001: ${assertions} fail-closed profile-discovery assertions; old five adapters remain registered, no new format enabled.`);
