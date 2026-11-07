import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { previewNmapXmlObservations } from "../../dist-enterprise-import-test/enterprise-import/src/nmap-xml-preview.js";
import { EnterpriseImportError } from "../../dist-enterprise-import-test/enterprise-import/src/types.js";
import { selectEnterpriseImportAdapter } from "../../dist-enterprise-import-test/enterprise-import/src/adapters.js";

const root = "tests/fixtures/import/nmap-xml/";
const file = (name) => Uint8Array.from(fs.readFileSync(root + name));
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
let assertions = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const blocks = async (name, code) => {
  await assert.rejects(previewNmapXmlObservations(file(name)),
    (error) => error instanceof EnterpriseImportError && error.code === code,
    "Expected exact rejection " + code + " for " + name);
  assertions++;
};

const source = file("valid-observed-hosts.xml");
const initial = await previewNmapXmlObservations(source);
eq(initial.status, "EVIDENCE_ONLY");
eq(initial.canActivate, false);
eq(initial.profileId, "nmap.xml.observations.v1");
eq(initial.semanticTrack, "EVIDENCE_OBSERVED");
eq(initial.sourceSha256, hash(source), "Hash original bytes, not transformed strings");
eq(initial.hosts.length, 2);
eq(initial.observationsCount, 2);
eq(initial.hosts[0].ipv4, "192.0.2.10");
eq(initial.hosts[0].observedStatus, "up");
eq(initial.hosts[1].observedStatus, "down");
eq(initial.hosts[1].ports, []);
eq(initial.hosts[0].hostnames, ["training-host.invalid"]);
eq(initial.hosts[0].ports.map((p) => [p.protocol, p.port, p.observedState]),
  [["tcp",22,"open"],["tcp",443,"closed"]]);
eq(initial.hosts[0].ports[0].serviceName, "ssh");
eq(initial.hosts[0].ports[0].serviceMethod, "table");
eq(initial.hosts[0].ports[0].serviceConfidence, 3);
eq(initial.hosts[0].locator,
  {kind:"nmap-host",sourceSha256:hash(source),hostOrdinal:0});
eq(initial.hosts[0].ports[0].locator,
  {kind:"nmap-port",sourceSha256:hash(source),hostOrdinal:0,portOrdinal:0});
eq(Object.hasOwn(initial, "scenario"), false);
eq(Object.hasOwn(initial, "connections"), false);
eq(Object.hasOwn(initial, "engineState"), false);
eq(Object.hasOwn(initial, "verified"), false);
eq(JSON.stringify(await previewNmapXmlObservations(source)), JSON.stringify(initial), "Repeat deterministic");
eq(hash(source), initial.sourceSha256, "Original bytes unchanged");
const withStylesheet = file("valid-stylesheet-reference.xml");
const styled = await previewNmapXmlObservations(withStylesheet);
eq(styled.sourceSha256, hash(withStylesheet), "Hash includes ignored stylesheet original bytes");
eq(styled.hosts.map((h) => [h.ipv4,h.observedStatus]),
  [["198.51.100.50","up"]]);
eq(styled.hosts[0].ports.map((p) => [p.port,p.observedState]), [[80,"open"]]);
eq(Object.hasOwn(styled, "stylesheet"), false, "External stylesheet URL must not propagate");

await blocks("invalid-wrong-root.xml", "NMAP_XML_ROOT_INVALID");
await blocks("adversarial-external-dtd.xml", "IMPORT_XML_DTD_FORBIDDEN");
await blocks("adversarial-xxe.xml", "IMPORT_XML_DTD_FORBIDDEN");
await blocks("invalid-port-range.xml", "NMAP_XML_NUMBER_INVALID");
await blocks("invalid-duplicate-observation.xml", "NMAP_XML_DUPLICATE_PORT");
await blocks("invalid-malformed.xml", "IMPORT_XML_MALFORMED");
await blocks("invalid-stylesheet-script.xml", "IMPORT_XML_PROCESSING_INSTRUCTION_FORBIDDEN");

const encoding = new TextEncoder();
const mutated = (src) => encoding.encode(src);
const text = new TextDecoder().decode(source);
await assert.rejects(previewNmapXmlObservations(new Uint8Array()),
  (e) => e instanceof EnterpriseImportError && e.code === "NMAP_XML_SOURCE_SIZE_INVALID"); assertions++;
await assert.rejects(previewNmapXmlObservations(new Uint8Array(2*1024*1024+1)),
  (e) => e instanceof EnterpriseImportError && e.code === "NMAP_XML_SOURCE_SIZE_INVALID"); assertions++;
await assert.rejects(previewNmapXmlObservations(mutated(text.replace('state="open"', 'state="invented"'))),
  (e) => e instanceof EnterpriseImportError && e.code === "NMAP_XML_PORT_STATE_UNSUPPORTED"); assertions++;
await assert.rejects(previewNmapXmlObservations(mutated(text.replace('protocol="tcp" portid="22"', 'protocol="sctp" portid="22"'))),
  (e) => e instanceof EnterpriseImportError && e.code === "NMAP_XML_PROTOCOL_UNSUPPORTED"); assertions++;
await assert.rejects(previewNmapXmlObservations(mutated(text.replace('addr="192.0.2.10"', 'addr="999.0.2.10"'))),
  (e) => e instanceof EnterpriseImportError && e.code === "NMAP_XML_IPV4_INVALID"); assertions++;
await assert.rejects(previewNmapXmlObservations(mutated(text.replace('</ports>', '<port protocol="tcp" portid="42"><state state="open"/><script id="unsafe" output="secret"/></port></ports>'))),
  (e) => e instanceof EnterpriseImportError && e.code === "NMAP_XML_UNSUPPORTED_ELEMENT"); assertions++;
await assert.rejects(previewNmapXmlObservations(mutated(text.replace('scanner="nmap"', 'scanner="not-nmap"'))),
  (e) => e instanceof EnterpriseImportError && e.code === "NMAP_XML_ROOT_INVALID"); assertions++;
assert.throws(() => selectEnterpriseImportAdapter("application/x-nmap+xml"), /No import adapter supports/); assertions++;
console.log("PASS NMAP-XML-P1 " + assertions + " independent observations, profile, semantic-boundary, XXE and adverse-input assertions. No activated adapter or Engine.");
