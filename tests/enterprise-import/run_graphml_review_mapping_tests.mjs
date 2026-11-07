import assert from "node:assert/strict";
import fs from "node:fs";
import { previewGraphmlReadOnly } from "../../dist-enterprise-import-test/enterprise-import/src/graphml-preview.js";
import { mapReviewedGraphmlToBuilder } from "../../dist-enterprise-import-test/enterprise-import/src/graphml-review-mapping.js";

let checks = 0;
const eq = (a, b, reason) => { assert.deepEqual(a, b, reason); checks++; };
const load = (name) => Uint8Array.from(fs.readFileSync(`tests/fixtures/import/graphml/${name}`));
const preview = await previewGraphmlReadOnly(load("valid-two-nodes.graphml"));
const base = { sourceSha256: preview.sourceSha256, graphId: preview.graphId, roles: [], modeledEdgeOrdinals: [], acknowledgeModeledConnections: false };
const unchecked = mapReviewedGraphmlToBuilder(preview, base);
eq(unchecked.status, "READY_FOR_COMPILATION");
eq(unchecked.selectedConnections, 0);
eq(unchecked.source.resources.map((x) => [x.id,x.type]), [["graph_node_1","resource.generic"],["graph_node_2","resource.generic"]]);
eq(unchecked.source.connections.length, 0, "No link without explicit per-edge selection");
eq(unchecked.source.notes[0].text.includes(preview.sourceSha256), true);
eq(unchecked.origins.map((x) => x.locator.kind), ["graphml-node", "graphml-node"]);
eq(unchecked.source.objectives[0].condition.path, "graphml_manual_verification", "No tautological green objective from workbook projector");
eq(unchecked.source.objectives[0].condition.value, "VERIFIED");
eq(Object.hasOwn(unchecked.source.resources[0].properties, "graphml_manual_verification"), false);
const withRole = mapReviewedGraphmlToBuilder(preview, {...base, roles: [{nodeOrdinal:0,type:"network.router"},{nodeOrdinal:1,type:"network.switch"}]});
eq(withRole.source.resources.map((x) => x.type), ["network.router","network.switch"]);
eq(withRole.origins.map((x) => x.decision), ["USER_SELECTED_ROLE", "USER_SELECTED_ROLE"]);
const noAck = mapReviewedGraphmlToBuilder(preview, {...base, modeledEdgeOrdinals:[0]});
eq(noAck.status, "BLOCKED");
eq(noAck.diagnostics[0].code, "GRAPHML_CONNECTION_ACK_REQUIRED");
const accepted = mapReviewedGraphmlToBuilder(preview, {...base, modeledEdgeOrdinals:[0], acknowledgeModeledConnections:true});
eq(accepted.status, "READY_FOR_COMPILATION");
eq(accepted.selectedConnections,1);
eq(accepted.source.connections.map((x) => [x.id,x.from.resource,x.to.resource,x.kind]), [["graph_link_1","graph_node_1","graph_node_2","network"]]);
eq(accepted.origins.at(-1).decision,"USER_MODELED_CONNECTION");
eq(accepted.origins.at(-1).locator.kind,"graphml-edge");
eq(accepted.source.connections[0].properties, {}, "Modeling links does not assert connectivity evidence");
eq(JSON.stringify(accepted),JSON.stringify(mapReviewedGraphmlToBuilder(preview,{...base,modeledEdgeOrdinals:[0],acknowledgeModeledConnections:true})),"Mapping deterministic");
const invalids = [
  [{...base,sourceSha256:"f".repeat(64)},"GRAPHML_REVIEW_STALE"],
  [{...base,graphId:"other"},"GRAPHML_REVIEW_STALE"],
  [{...base,roles:[{nodeOrdinal:0,type:"endpoint.windows"},{nodeOrdinal:0,type:"network.switch"}]},"GRAPHML_ROLE_DECISION_INVALID"],
  [{...base,roles:[{nodeOrdinal:0,type:"network.madeup"}]},"GRAPHML_ROLE_DECISION_INVALID"],
  [{...base,roles:[{nodeOrdinal:2,type:"network.switch"}]},"GRAPHML_ROLE_DECISION_INVALID"],
  [{...base,modeledEdgeOrdinals:[1],acknowledgeModeledConnections:true},"GRAPHML_EDGE_DECISION_INVALID"],
  [{...base,modeledEdgeOrdinals:[0,0],acknowledgeModeledConnections:true},"GRAPHML_EDGE_DECISION_INVALID"],
  [{...base,modeledEdgeOrdinals:[-1],acknowledgeModeledConnections:true},"GRAPHML_EDGE_DECISION_INVALID"],
];
for (const [decision, code] of invalids) {
  const r = mapReviewedGraphmlToBuilder(preview,decision);
  eq(r.status,"BLOCKED");
  eq(r.diagnostics[0].code,code);
  eq(Boolean(r.source),false,"Blocked result must not expose ScenarioSource");
}
const mixed=await previewGraphmlReadOnly(load("valid-mixed-directed.graphml"));
const mixedReview={...base,sourceSha256:mixed.sourceSha256,graphId:mixed.graphId};
const badDirection=mapReviewedGraphmlToBuilder(mixed,{...mixedReview,modeledEdgeOrdinals:[1],acknowledgeModeledConnections:true});
eq(badDirection.status,"BLOCKED");
eq(badDirection.diagnostics[0].code,"GRAPHML_DIRECTIONAL_EDGE_UNSUPPORTED");
const allowedUndirected=mapReviewedGraphmlToBuilder(mixed,{...mixedReview,modeledEdgeOrdinals:[0],acknowledgeModeledConnections:true});
eq(allowedUndirected.status,"READY_FOR_COMPILATION");
eq(allowedUndirected.source.connections.length,1);
console.log(`PASS GRAPHML-P2B manual mapping: ${checks} structural, provenance, no-inference and adversarial assertions; compilation/UI separately gated.`);
