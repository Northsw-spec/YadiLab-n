import assert from "node:assert/strict";
import { buildTopologySearchIndex, filterTopologyNodes, searchTopology } from "../../dist-browser-test/ui/src/canvas/topology-navigation.js";
const nodes = [{ id: "n1", type: "resource", data: { semanticId: "n1", semanticKind: "resource", label: "N1", resourceType: "switch", zoneKind: "lan", vlanIds: ["20"], interfaces: [{ interfaceId: "eth0", label: "ETH0", addresses: ["10.0.0.2"] }] } }];
const index = buildTopologySearchIndex(nodes); assert.equal(searchTopology(index, "  eth0 ")[0].field, "interface"); assert.equal(searchTopology(index, "unknown").length, 0); assert.equal(searchTopology(index, "").length, 0); assert.equal(filterTopologyNodes(nodes, { query: "", vlan: "20", pathNodeIds: [] }).n1, "match"); assert.equal(filterTopologyNodes(nodes, { query: "", vlan: "30", pathNodeIds: [] }).n1, "dim");
console.log("PASS dev4 topology navigation adversarial: 5 fail-closed assertions");
