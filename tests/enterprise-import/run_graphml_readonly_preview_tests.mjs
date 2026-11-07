import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { EnterpriseImportError } from "../../dist-enterprise-import-test/enterprise-import/src/types.js";
import { previewGraphmlReadOnly } from "../../dist-enterprise-import-test/enterprise-import/src/graphml-preview.js";
import { selectEnterpriseImportAdapter } from "../../dist-enterprise-import-test/enterprise-import/src/adapters.js";

const root = "tests/fixtures/import/graphml";
const bytes = (name) => Uint8Array.from(fs.readFileSync(`${root}/${name}`));
const sha256 = (input) => crypto.createHash("sha256").update(input).digest("hex");
let assertions = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const rejectsCode = async (input, code) => {
  await assert.rejects(
    previewGraphmlReadOnly(input),
    (err) => err instanceof EnterpriseImportError && err.code === code,
    `Expected exactly ${code}`,
  );
  assertions++;
};

// PREP-002 independent oracle: 2 named nodes, one undirected GRAPH EDGE, no cable.
const simple = bytes("valid-two-nodes.graphml"), beforeSimple = sha256(simple);
const preview = await previewGraphmlReadOnly(simple);
eq(preview.status, "REVIEW_REQUIRED", "Must never activate by parser alone");
eq(preview.canActivate, false, "No automatic scenario activation");
eq(preview.profileId, "graphml.structural.v1");
eq(preview.semanticTrack, "TOPOLOGY_DECLARED");
eq(preview.sourceSha256, beforeSimple, "Source hash must match independent Node crypto");
eq(preview.graphId, "synthetic-site");
eq(preview.nodes.map((n) => ({ id: n.id, label: n.label })),
  [{ id: "router_1", label: "Router 1" }, { id: "switch_1", label: "Switch 1" }]);
eq(preview.edges.map((e) => ({ id: e.id, source: e.sourceId, target: e.targetId, directed: e.directed, kind: e.relationKind })),
  [{ id: "edge_1", source: "router_1", target: "switch_1", directed: false, kind: "GRAPH_EDGE" }]);
eq(preview.nodes[0].locator, { kind: "graphml-node", sourceSha256: beforeSimple, graphId: "synthetic-site", sourceOrdinal: 0, elementId: "router_1" });
eq(preview.edges[0].locator, { kind: "graphml-edge", sourceSha256: beforeSimple, graphId: "synthetic-site", sourceOrdinal: 0, elementId: "edge_1" });
eq(preview.diagnostics, []);
eq(sha256(simple), beforeSimple, "Source bytes not mutated");
eq(JSON.stringify(await previewGraphmlReadOnly(simple)), JSON.stringify(preview), "Deterministic replay");
eq(Object.hasOwn(preview.edges[0], "physicalLink"), false);
eq(Object.hasOwn(preview, "engineState"), false);
eq(Object.hasOwn(preview, "scenario"), false);

// GraphML permits edges before node declarations; do not infer their physical meaning.
const mixed = await previewGraphmlReadOnly(bytes("valid-mixed-directed.graphml"));
eq(mixed.nodes.map((n) => n.id), ["n1", "n2"]);
eq(mixed.edges.map((e) => ({ id: e.id, directed: e.directed, from: e.sourceId, to: e.targetId })),
  [{ id: "e2", directed: false, from: "n2", to: "n1" }, { id: "e1", directed: true, from: "n1", to: "n2" }]);
eq(mixed.edges.every((e) => e.relationKind === "GRAPH_EDGE"), true);
eq(mixed.nodes.every((n) => !Object.hasOwn(n, "label")), true, "Never infer node labels or OS from id");

// Invalid and hostile fixtures must fail closed, no partial scenario.
await rejectsCode(bytes("invalid-missing-endpoint.graphml"), "GRAPHML_DANGLING_EDGE");
await rejectsCode(bytes("invalid-duplicate-node.graphml"), "GRAPHML_DUPLICATE_NODE");
await rejectsCode(bytes("invalid-wrong-namespace.graphml"), "GRAPHML_UNSUPPORTED_NAMESPACE");
await rejectsCode(bytes("adversarial-xxe.graphml"), "IMPORT_XML_DTD_FORBIDDEN");

const wrap = (inner, graphAttrs='id="g" edgedefault="directed"') =>
  new TextEncoder().encode(`<?xml version="1.0"?><graphml xmlns="http://graphml.graphdrawing.org/xmlns"><graph ${graphAttrs}>${inner}</graph></graphml>`);
await rejectsCode(wrap('<node id="x"/><edge id="e" source="x" target="missing"/>'), "GRAPHML_DANGLING_EDGE");
await rejectsCode(wrap('<node id="x"/><node id="x"/>'), "GRAPHML_DUPLICATE_NODE");
await rejectsCode(wrap('<node id="x"/><graph id="nested" edgedefault="directed"/>'), "GRAPHML_UNSUPPORTED_ELEMENT");
await rejectsCode(wrap('<node id="x"/><hyperedge id="he1"/>'), "GRAPHML_UNSUPPORTED_ELEMENT");
await rejectsCode(wrap('<node id="x"/><edge source="x" target="x" directed="maybe"/>'), "GRAPHML_DIRECTED_INVALID");
await rejectsCode(wrap('<node id="x"/><node id="y"/><edge id="e" source="x" target="y"/><edge id="e" source="x" target="y"/>'), "GRAPHML_DUPLICATE_EDGE");
await rejectsCode(wrap('<node id="x"/>', 'id="g" edgedefault="maybe"'), "GRAPHML_EDGEDEFAULT_INVALID");
await rejectsCode(new Uint8Array(), "GRAPHML_SOURCE_SIZE_INVALID");
await rejectsCode(new Uint8Array(2 * 1024 * 1024 + 1), "GRAPHML_SOURCE_SIZE_INVALID");

const dangerousKey = new TextEncoder().encode(`<?xml version="1.0"?><graphml xmlns="http://graphml.graphdrawing.org/xmlns"><key id="l" for="node" attr.name="label" attr.type="int"/><graph id="g" edgedefault="directed"><node id="x"><data key="l">1</data></node></graph></graphml>`);
await rejectsCode(dangerousKey, "GRAPHML_LABEL_TYPE_INVALID");
// No GraphML adapter or any new-format success claim before separate integration gates.
assert.throws(() => selectEnterpriseImportAdapter("application/graphml+xml"), /No import adapter supports/); assertions++;
console.log(`PASS GraphML PREVIEW-ONLY: ${assertions} positive, negative, provenance, determinism and fail-closed assertions. No Engine/activation.`);
