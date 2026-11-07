import assert from "node:assert/strict";
import fs from "node:fs";
import {
  builtinEnterpriseImportAdapters, selectEnterpriseImportAdapter,
} from "../../dist-enterprise-import-test/enterprise-import/src/adapters.js";
import {
  plannedExternalSourceProfiles, inspectPlannedExternalSource,
} from "../../dist-enterprise-import-test/enterprise-import/src/planned-format-profiles.js";
import { previewGraphmlReadOnly } from "../../dist-enterprise-import-test/enterprise-import/src/graphml-preview.js";
import { mapReviewedGraphmlToBuilder } from "../../dist-enterprise-import-test/enterprise-import/src/graphml-review-mapping.js";
import { previewNmapXmlObservations } from "../../dist-enterprise-import-test/enterprise-import/src/nmap-xml-preview.js";
import { previewAnsibleStaticInventory } from "../../dist-enterprise-import-test/enterprise-import/src/ansible-yaml-preview.js";
import { previewAnsibleIniStaticInventory } from "../../dist-enterprise-import-test/enterprise-import/src/ansible-ini-preview.js";

const MATRIX_FILE = "docs/architecture/import-capability-matrix.v1.json";
const matrix = JSON.parse(fs.readFileSync(MATRIX_FILE, "utf8"));
const mainSource = fs.readFileSync("ui/app/main.mjs", "utf8");
const requiredWorkflow = fs.readFileSync(".github/workflows/required-ci.yml", "utf8");
const releaseWorkflow = fs.readFileSync(".github/workflows/release-identity.yml", "utf8");
let assertions = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); assertions++; };
const yes = (condition, label) => { assert.ok(condition, label); assertions++; };
const rejects = (value, label) => { assert.equal(value, false, label); assertions++; };
const idSet = new Set();
const validTracks = ["TOPOLOGY_DECLARED", "CONFIG_DOCUMENTED", "EVIDENCE_OBSERVED"];
const validRegistries = ["ACTIVE_ADAPTER", "NATIVE_SCENARIO", "PLANNED_HINT"];
const stages = ["detect", "parse", "preview", "review", "projection", "builder", "modeledProbe", "replay", "ui"];
const expectedActive = ["builtin.json", "builtin.csv", "builtin.tsv", "builtin.xlsx", "builtin.ods"];
const active = builtinEnterpriseImportAdapters.map(x => x.id);
const expectedDedicated = new Set([
  "graphml.structural.v1", "nmap.xml.v1", "nessus.xml.v1",
  "diagrams.drawio.v1", "inventory.yaml.v1", "ansible.inventory.ini.v1",
  "office.docx-tables.v1", "office.odt-tables.v1",
]);
const expectedUI = [
  "data-network-import-primary", "data-network-import-runtime",
  "data-inspect-graphml", "data-inspect-nmap", "data-inspect-nessus",
  "data-inspect-drawio", "data-inspect-ansible", "data-inspect-ansible-ini",
  "data-inspect-docx", "data-inspect-odt",
];
const validSha = x => typeof x === "string" && /^[a-f0-9]{40}$/.test(x);
function consistent(m) {
  if (m.formatId !== "yadilab.import.capability-audit"
    || m.schemaVersion !== "1.0.0"
    || m.status !== "SOURCE_AUDIT_NOT_FUNCTIONAL_CERTIFICATION"
    || !Array.isArray(m.profiles)
    || m.profiles.length !== 27
    || !validSha(m.auditBaseline?.mainSha)
    || !validSha(m.auditBaseline?.treeSha)) return false;
  const ids = new Set();
  const planned = new Set(plannedExternalSourceProfiles.map(p => p.profileId));
  for (const p of m.profiles) {
    if (!p || typeof p.id !== "string" || ids.has(p.id)
      || !validTracks.includes(p.track)
      || !validRegistries.includes(p.registry)
      || !Array.isArray(p.extensions) || !p.extensions.length
      || p.extensions.some(x => typeof x !== "string" || !/^\.[a-z0-9]+$/.test(x))
      || !p.stage || stages.some(s => typeof p.stage[s] !== "string" || !p.stage[s])
      || !Array.isArray(p.sources) || !p.sources.length
      || !Array.isArray(p.tests) || !p.tests.length
      || !p.nextCheckpoint || !(
        /^IC-\d{3}$/.test(p.nextCheckpoint) ||
        (["graphml.structural.v1","diagrams.drawio.v1"].includes(p.id) &&
          p.nextCheckpoint === "IC-040_AFTER_VERIFIED_P3_RELEASE")
      )
      || typeof p.risk !== "string" || p.risk.length < 20
      || typeof p.ciCoverage !== "string") return false;
    ids.add(p.id);
    if (p.registry === "ACTIVE_ADAPTER" && !expectedActive.includes(p.id)) return false;
    if (p.registry === "NATIVE_SCENARIO" && p.id !== "native.scenario.json") return false;
    if (p.registry === "PLANNED_HINT") {
      const graphml = p.id === "graphml.structural.v1";
      const drawio = p.id === "diagrams.drawio.v1";
      const expectedDetect = graphml ? "SPECIALIZED_GRAPHML_FILE_ENTRY"
        : drawio ? "SPECIALIZED_DRAWIO_P1P6_XML_READ_ONLY_AND_P2B_DRAWIO_ONLY"
        : expectedDedicated.has(p.id) ? "SPECIALIZED_FILE_ENTRY" : "HINT_ONLY_BLOCKED";
      const expectedParse = graphml ? "BOUNDED_GRAPHML_ORIGINAL_XML_SHA"
        : drawio ? "BOUNDED_2MIB_16P_1000V_2000E_RAW_DEFLATE_SHA"
        : expectedDedicated.has(p.id) ? "BOUNDED_READ_ONLY" : "NONE";
      const expectedProbe = graphml || drawio ? "NOT_ATTESTED_NO_AUTOMATIC_RUNTIME" : "NONE";
      const expectedProjection = graphml ? "EXPLICIT_REVIEWED_GRAPHML_WORKBOOK_CANDIDATE"
        : drawio ? "P2B_EXPLICIT_REVIEWED_DRAWIO_GRAPH_CANDIDATE_ONLY" : "NONE";
      const expectedBuilder = graphml ? "REAL_COMPILER_ELK_ORIGINAL_REREAD_WORKSPACE_GATE"
        : drawio ? "P2B_REAL_COMPILER_ELK_LAST_ORIGINAL_REREAD_WORKSPACE_GATE" : "NONE";
      if (!planned.has(p.id) ||
          p.stage.detect !== expectedDetect ||
          p.stage.parse !== expectedParse ||
          p.stage.modeledProbe !== expectedProbe ||
          p.stage.projection !== expectedProjection ||
          p.stage.builder !== expectedBuilder ||
          p.stage.builder === "DIRECT_ACTIVATION") return false;
      // These are explicitly scoped SPECIALIZED UI paths, never generic
      // enterprise adapters nor automatic Engine/Runtime or physical truth.
      if (!expectedDedicated.has(p.id) && stages.some(s =>
        s !== "detect" && p.stage[s] !== "NONE")) return false;
      const canonical = plannedExternalSourceProfiles.find(x => x.profileId === p.id);
      if (p.track !== canonical.semanticTrack
        || JSON.stringify(p.extensions) !== JSON.stringify(canonical.suffixes))
        return false;
    }
    for (const path of [...p.sources, ...p.tests]) {
      if (!/^(enterprise-import\/src\/|ui\/src\/browser\/|ui\/app\/|tests\/|\.github\/workflows\/)/.test(path)
        || !fs.existsSync(path) || !fs.statSync(path).isFile()) return false;
    }
  }
  if (expectedActive.some(x => !ids.has(x)) || !ids.has("native.scenario.json")
    || [...planned].some(x => !ids.has(x))) return false;
  return true;
}
eq(active, expectedActive, "exact five active adapter identities from production registry");
yes(consistent(matrix), "27 source-bound records match current code and planned registry");
eq(matrix.profiles.filter(p => p.registry === "ACTIVE_ADAPTER").length,5,"five baseline adapters");
eq(matrix.profiles.filter(p => p.registry === "NATIVE_SCENARIO").length,1,"native scenario separate");
eq(matrix.profiles.filter(p => p.registry === "PLANNED_HINT").length,21,"all planned profiles covered");
eq(matrix.profiles.filter(p => p.stage.parse === "BOUNDED_READ_ONLY").length,6,
  "six existing specialized read-only parser stages remain unchanged");
eq(matrix.profiles.filter(p => expectedDedicated.has(p.id) && p.stage.parse !== "NONE").length,8,
  "all eight specialized parsers remain source-supported, including scoped GraphML and drawio");
eq(matrix.profiles.filter(p => p.stage.parse === "NONE").length,13,
  "thirteen registry-only profiles have no parser");
for (const source of plannedExternalSourceProfiles) {
  const p = matrix.profiles.find(x => x.id === source.profileId);
  eq(p.track,source.semanticTrack,"track grounded in current registry");
  eq(p.extensions,source.suffixes,"suffix profile grounded in source");
  const proposed = inspectPlannedExternalSource("example"+source.suffixes[0],p.id);
  eq(proposed.status,"BLOCKED","planned hint never authorizes actual parse");
  eq(proposed.code,"IMPORT_PROFILE_NOT_IMPLEMENTED","planned explicit profile still blocked");
}
eq(inspectPlannedExternalSource("site.xml").code,"IMPORT_PROFILE_AMBIGUOUS",
  "generic XML cannot silently choose diagram, Nmap or Nessus");
eq(inspectPlannedExternalSource("site.yaml").code,"IMPORT_PROFILE_AMBIGUOUS",
  "generic YAML cannot silently choose Ansible or CML");
for (const mime of ["application/graphml+xml","application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/xml","text/yaml"]) {
  assert.throws(() => selectEnterpriseImportAdapter(mime),
    /No import adapter supports media type/,"specialized/unsupported MIME still blocked");
  assertions++;
}
for (const [mime,id] of [
  ["application/json","builtin.json"],["text/csv","builtin.csv"],
  ["text/tab-separated-values","builtin.tsv"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","builtin.xlsx"],
  ["application/vnd.oasis.opendocument.spreadsheet","builtin.ods"],
]) eq(selectEnterpriseImportAdapter(mime).id,id,"active MIME dispatch preserved");
for (const marker of expectedUI) yes(mainSource.includes(marker),
  "production UI marker exists: "+marker);
yes(mainSource.includes("mapReviewedGraphmlToBuilder(sourcePreview, decisions)"),
  "GraphML explicit mapping wired to user UI");
yes(mainSource.includes("setWorkspace(layout.workspace)"),
  "GraphML compiler/layout only before Builder mutation");
yes(mainSource.includes("Open modeled Runtime + Probes"),
  "existing main inventory import opens modeled Runtime explicitly");
for (const workflow of [requiredWorkflow, releaseWorkflow]) {
  yes(workflow.includes("npm run test:network-topology-import"),
    "existing core import tests remain mandatory");
  yes(workflow.includes("npm run test:imported-probes"),
    "existing imported modeled probe regression remains mandatory");
  yes(workflow.includes("npm run test:ic000-capabilities"),
    "this exact capability safety audit runs before/after merge");
}
const graph = await previewGraphmlReadOnly(
  Uint8Array.from(fs.readFileSync("tests/fixtures/import/graphml/valid-two-nodes.graphml")));
eq(graph.status,"REVIEW_REQUIRED","GraphML preview is not activated source");
eq(graph.canActivate,false,"GraphML read-only parser never authorizes activation");
eq(graph.edges.length,1,"fixture contains drawn graph edge");
const review = mapReviewedGraphmlToBuilder(graph, {
  sourceSha256:graph.sourceSha256,graphId:graph.graphId,roles:[],
  modeledEdgeOrdinals:[],acknowledgeModeledConnections:false,
});
eq(review.status,"READY_FOR_COMPILATION","GraphML source supports reviewed manual Builder candidate");
eq(review.source.connections.length,0,
  "GraphML edges do not turn into unreviewed modeled network links");
const noAck = mapReviewedGraphmlToBuilder(graph, {
  sourceSha256:graph.sourceSha256,graphId:graph.graphId,roles:[],
  modeledEdgeOrdinals:[0],acknowledgeModeledConnections:false,
});
eq(noAck.status,"BLOCKED","no modeled link without explicit acknowledgement");
const nmap = await previewNmapXmlObservations(
  Uint8Array.from(fs.readFileSync("tests/fixtures/import/nmap-xml/valid-observed-hosts.xml")));
eq(nmap.status,"EVIDENCE_ONLY","Nmap scan observations never get scenario truth");
eq(nmap.canActivate,false,"Nmap scan cannot activate Builder or Engine");
const yaml=await previewAnsibleStaticInventory(
  Uint8Array.from(fs.readFileSync("tests/fixtures/import/ansible-yaml/valid-nested.yml")));
eq(yaml.status,"REVIEW_REQUIRED","Ansible YAML preview remains documentation only");
eq(yaml.canActivate,false,"Ansible YAML cannot activate runtime");
const ini=await previewAnsibleIniStaticInventory(
  Uint8Array.from(fs.readFileSync("tests/fixtures/import/ansible-ini/valid-ungrouped.ini")));
eq(ini.status,"REVIEW_REQUIRED","Ansible INI preview remains documentation only");
eq(ini.canActivate,false,"Ansible INI cannot activate runtime");

// Mutation oracles: schema and inventories must fail closed on overclaims.
// A file existing or a test name is never evidence of an active adapter.
const changed=transform=>{
  const next=structuredClone(matrix); transform(next);
  return consistent(next);
};
rejects(changed(x=>x.profiles.push({...x.profiles[0]})),"duplicate profile blocked");
rejects(changed(x=>x.profiles.find(p=>p.id==="pdf.digital-tables.v1").stage.parse="ACTIVE_TABULAR"),
  "PDF cannot be promoted by documentation-only capability metadata");
rejects(changed(x=>x.profiles.find(p=>p.id==="nmap.xml.v1").stage.builder="DIRECT_ACTIVATION"),
  "Nmap cannot become scenario activation evidence");
rejects(changed(x=>x.profiles.find(p=>p.id==="nessus.xml.v1").stage.projection="SCENARIO_SOURCE"),
  "Nessus evidence cannot be turned into a network scenario by matrix metadata");
rejects(changed(x=>x.profiles.find(p=>p.id==="office.docx-tables.v1").stage.modeledProbe="YES"),
  "DOCX source reference is not an Engine probe");
rejects(changed(x=>x.profiles.find(p=>p.id==="graphml.structural.v1").registry="ACTIVE_ADAPTER"),
  "GraphML dedicated review does not join active enterprise adapters");
rejects(changed(x=>x.profiles.find(p=>p.id==="graphml.structural.v1").stage.modeledProbe="IMPORTED_MODELED_RUNTIME_VERIFIED"),
  "GraphML review must not become automatic Engine/probe proof by matrix edit");
rejects(changed(x=>x.profiles.find(p=>p.id==="graphml.structural.v1").stage.builder="DIRECT_ACTIVATION"),
  "GraphML cannot bypass reviewed Builder via capability metadata");
rejects(changed(x=>x.profiles.find(p=>p.id==="diagrams.drawio.v1").stage.builder="NONE"),
  "P2b reviewed Builder cannot silently vanish from source-truth audit");
rejects(changed(x=>x.profiles.find(p=>p.id==="diagrams.drawio.v1").stage.projection="UNVERIFIED_AUTOMATIC_NETWORK"),
  "Drawio drawn links cannot become inferred active network by metadata");
rejects(changed(x=>x.profiles.find(p=>p.id==="diagrams.drawio.v1").stage.modeledProbe="TRUE"),
  "Drawio source-only review is not independently attested probe result");

rejects(changed(x=>x.profiles.find(p=>p.id==="builtin.csv").sources=["nonexistent.csv"]),
  "missing source evidence cannot be counted");
rejects(changed(x=>x.profiles.find(p=>p.id==="inventory.yaml.v1").extensions=[".xml"]),
  "YAML-specific parser may not silently cross profile boundaries");
rejects(changed(x=>x.profiles.find(p=>p.id==="visio.vsdx.v1").stage.ui="SPECIALIZED_MODAL"),
  "planned-only Visio cannot be declared implemented in UI");
rejects(changed(x=>x.profiles.find(p=>p.id==="builtin.xlsx").id="invented.active"),
  "unknown adapters not accepted");
rejects(changed(x=>x.profiles.find(p=>p.id==="nmap.xml.v1").track="TOPOLOGY_DECLARED"),
  "observed Nmap scans cannot be relabeled declared physical topology");
rejects(changed(x=>x.profiles.find(p=>p.id==="native.scenario.json").stage.detect=""),
  "all capabilities require explicit statuses");
console.log("PASS IC-000 source capability audit: "+assertions+
  " assertions; five native enterprise adapters, one native source, "+
  "eight specialized review profiles, thirteen planned-only profiles; "+
  "no new imports or probe sources activated.");
