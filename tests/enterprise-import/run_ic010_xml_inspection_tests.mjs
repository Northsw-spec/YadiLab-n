import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inspectStructuredXmlSourceReadOnly } from "../../dist-enterprise-import-test/enterprise-import/src/structured-xml-source-inspection.js";
import { inspectPlannedExternalSource } from "../../dist-enterprise-import-test/enterprise-import/src/planned-format-profiles.js";
import { builtinEnterpriseImportAdapters, selectEnterpriseImportAdapter } from "../../dist-enterprise-import-test/enterprise-import/src/adapters.js";

let assertions = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const yes = (condition, label) => { assert.ok(condition, label); assertions++; };
const encoder = new TextEncoder();
const encode = x => encoder.encode(x);
const sha = b => createHash("sha256").update(b).digest("hex");
const source = path => Uint8Array.from(readFileSync(path));
const inspect = inspectStructuredXmlSourceReadOnly;
const blocked = async (name, bytes, code, explicitProfileId) => {
  const result = await inspect(name, bytes, explicitProfileId);
  eq(result.status, "BLOCKED", name + " must not be accepted");
  eq(result.code, code, name + " fixed safe denial code");
  eq(result.canActivate, false);
  eq(result.modelMutated, false);
  eq(result.engineVerified, false);
  eq(result.physicalTopologyVerified, false);
  yes(!Object.hasOwn(result, "sourceSha256"), "No partially trusted source hash on rejection");
  yes(!Object.hasOwn(result, "summary"), "No partially trusted source summary on rejection");
};

function checked(result, id, track, status, bytes, summary) {
  eq(result.status, status);
  eq(result.profileId, id);
  eq(result.semanticTrack, track);
  eq(result.sourceSha256, sha(bytes), "Original bytes, independently SHA-256 verified");
  eq(result.documentLocator, { kind: "source-document", profileId: id, sourceSha256: sha(bytes) });
  eq(result.summary, summary, "Numeric summary comes from full original producer parser");
  eq(result.canActivate, false);
  eq(result.modelMutated, false);
  eq(result.engineVerified, false);
  eq(result.physicalTopologyVerified, false);
  yes(Object.isFrozen(result), "Result is immutable");
  yes(Object.isFrozen(result.documentLocator), "Locator is immutable");
  yes(Object.isFrozen(result.summary), "Summary is immutable");
  for (const forbidden of ["scenario", "connections", "engineState", "hostnames", "rawXml", "verified", "originalDocument"]) {
    eq(Object.hasOwn(result, forbidden), false, "Metadata-only: " + forbidden);
  }
}

const graph = source("tests/fixtures/import/graphml/valid-two-nodes.graphml");
const graphResult = await inspect("site.graphml", graph);
checked(graphResult, "graphml.structural.v1", "TOPOLOGY_DECLARED", "REVIEW_REQUIRED", graph,
  { kind: "GRAPH_STRUCTURE", nodes: 2, graphEdges: 1 });
eq(graphResult.status === "REVIEW_REQUIRED" && graphResult.canActivate, false, "Discovery never activates; review is not authorization");
eq(sha(graph), graphResult.sourceSha256, "Does not mutate input");

const nmap = source("tests/fixtures/import/nmap-xml/valid-observed-hosts.xml");
checked(await inspect("scan.xml", nmap), "nmap.xml.v1", "EVIDENCE_OBSERVED", "EVIDENCE_ONLY", nmap,
  { kind: "NMAP_OBSERVATIONS", observedHosts: 2, reportedPorts: 2 });
const styled = source("tests/fixtures/import/nmap-xml/valid-stylesheet-reference.xml");
const styledResult = await inspect("scan.xml", styled);
eq(styledResult.profileId, "nmap.xml.v1", "Nmap-specific harmless stylesheet retained");
eq(styledResult.sourceSha256, sha(styled), "Stylesheet prolog included in original SHA");
yes(!JSON.stringify(styledResult).includes("xsl"), "No stylesheet URL in report");

const nessus = encode('<NessusClientData_v2><Report name="SENSITIVE_REPORT"><ReportHost name="SENSITIVE_HOST"><ReportItem severity="4" pluginID="100" port="443" protocol="tcp"/></ReportHost></Report></NessusClientData_v2>');
checked(await inspect("report.nessus", nessus), "nessus.xml.v1", "EVIDENCE_OBSERVED", "EVIDENCE_ONLY", nessus,
  { kind: "NESSUS_REPORT", reportedHosts: 1, reportedFindings: 1 });
checked(await inspect("report.xml", nessus), "nessus.xml.v1", "EVIDENCE_OBSERVED", "EVIDENCE_ONLY", nessus,
  { kind: "NESSUS_REPORT", reportedHosts: 1, reportedFindings: 1 });
yes(!JSON.stringify(await inspect("report.xml", nessus)).includes("SENSITIVE"), "No report or host name leak");

const drawio = encode('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n1" parent="1" vertex="1"/><mxCell id="n2" parent="1" vertex="1"/><mxCell id="link" parent="1" edge="1" source="n1" target="n2"/></root></mxGraphModel>');
checked(await inspect("diagram.drawio", drawio), "diagrams.drawio.v1", "TOPOLOGY_DECLARED", "PREVIEW_ONLY", drawio,
  { kind: "DRAWIO_DIAGRAM", pages: 1, vertices: 2, drawnEdges: 1 });
checked(await inspect("diagram.xml", drawio), "diagrams.drawio.v1", "TOPOLOGY_DECLARED", "PREVIEW_ONLY", drawio,
  { kind: "DRAWIO_DIAGRAM", pages: 1, vertices: 2, drawnEdges: 1 });

const explicit = await inspect("scan.xml", nmap, "nmap.xml.v1");
eq(explicit.profileId, "nmap.xml.v1", "Operator explicit profile checked against real content");
await blocked("scan.xml", nmap, "IC010_XML_CONTENT_UNRECOGNIZED", "nessus.xml.v1");
await blocked("scan.nessus", nmap, "IC010_XML_CONTENT_UNRECOGNIZED");
await blocked("diagram.graphml", drawio, "IC010_XML_CONTENT_UNRECOGNIZED");
await blocked("graph.xml", graph, "IC010_XML_CONTENT_UNRECOGNIZED");
await blocked("mismatch.graphml", graph, "IC010_XML_PROFILE_EXTENSION_MISMATCH", "nmap.xml.v1");
await blocked("scan.xml", nmap, "IC010_XML_PROFILE_UNSUPPORTED", "unknown.v1");
await blocked("network.yaml", encode("all:\n  hosts: {}"), "IC010_XML_EXTENSION_UNSUPPORTED");
await blocked("report.pdf", encode("%PDF"), "IC010_XML_EXTENSION_UNSUPPORTED");
await blocked("evil.xml", encode('<script>alert("hijack")</script>'), "IC010_XML_CONTENT_UNRECOGNIZED");
await blocked("nmap.xml", encode('<nmaprun scanner="not-nmap"/>'), "IC010_XML_CONTENT_UNRECOGNIZED");
await blocked("scan.xml", encode('<!DOCTYPE nmaprun [<!ENTITY e SYSTEM "file:///etc/passwd">]><nmaprun scanner="nmap"/>'), "IC010_XML_CONTENT_UNRECOGNIZED");
await blocked("scan.xml", source("tests/fixtures/import/nmap-xml/adversarial-xxe.xml"), "IC010_XML_CONTENT_UNRECOGNIZED");
await blocked("scan.xml", source("tests/fixtures/import/nmap-xml/invalid-stylesheet-script.xml"), "IC010_XML_CONTENT_UNRECOGNIZED");
await blocked("scan.xml", Uint8Array.from([0xff, 0xfe, 0x00]), "IC010_XML_CONTENT_UNRECOGNIZED");
await blocked("scan.xml", new Uint8Array(0), "IC010_XML_SOURCE_SIZE_INVALID");
await blocked("scan.xml", new Uint8Array(2 * 1024 * 1024 + 1), "IC010_XML_SOURCE_SIZE_INVALID");
await blocked("dir/scan.xml", nmap, "IC010_XML_FILENAME_INVALID");
await blocked("dir\\scan.xml", nmap, "IC010_XML_FILENAME_INVALID");
await blocked("scan.xml\0.txt", nmap, "IC010_XML_FILENAME_INVALID");
await blocked("scan.xml ", nmap, "IC010_XML_FILENAME_INVALID");
await blocked("", nmap, "IC010_XML_FILENAME_INVALID");
await blocked("x".repeat(255) + ".xml", nmap, "IC010_XML_FILENAME_INVALID");

// The caller may change its own Uint8Array after initiation. The async
// classifier must inspect exactly the immutable snapshot it copied first.
const mutable = Uint8Array.from(nmap);
const originalHash = sha(mutable);
const pending = inspect("scan.xml", mutable);
mutable.fill(0);
const snapshotResult = await pending;
eq(snapshotResult.profileId, "nmap.xml.v1", "Source mutation after inspection begins cannot alter profile");
eq(snapshotResult.sourceSha256, originalHash, "Snapshot SHA equals inspected original bytes");

eq(inspectPlannedExternalSource("scan.xml").status, "BLOCKED", "Original generic hints remain BLOCKED");
eq(inspectPlannedExternalSource("scan.xml").code, "IMPORT_PROFILE_AMBIGUOUS", "Generic XML still ambiguous");
eq(inspectPlannedExternalSource("scan.xml", "nmap.xml.v1").status, "BLOCKED", "Explicit hint is not an adapter");
eq(builtinEnterpriseImportAdapters.map(x => x.id), ["builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods"], "Five active adapters unchanged");
eq(selectEnterpriseImportAdapter("text/csv").id, "builtin.csv", "Existing CSV handler untouched");
assert.throws(() => selectEnterpriseImportAdapter("application/xml"), /No import adapter supports/); assertions++;
assert.throws(() => selectEnterpriseImportAdapter("application/graphml+xml"), /No import adapter supports/); assertions++;

console.log("PASS IC-010 P1 XML metadata-only source inspection: " + assertions + " source, spoof, privacy, source-hash and truth-barrier assertions. No UI/Builder/Engine activation.");
