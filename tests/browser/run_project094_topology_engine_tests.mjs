import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const folder = mkdtempSync(join(tmpdir(), "yadilab-project094-engine-"));
try {
  const bundle = join(folder, "topology-elk-adapter.mjs");
  await build({ entryPoints: ["ui/src/canvas/topology-elk-adapter.ts"], outfile: bundle, bundle: true, format: "esm", platform: "node", target: ["node22"], logLevel: "silent" });
  const { layoutHierarchicalTopologyView, createTopologyRequestKey } = await import(pathToFileURL(bundle).href);
  const iconBundle = join(folder, "icon-registry.mjs");
  await build({ entryPoints: ["ui/src/canvas/icon-registry.ts"], outfile: iconBundle, bundle: true, format: "esm", platform: "node", target: ["node22"], logLevel: "silent" });
  const { iconRegistry } = await import(pathToFileURL(iconBundle).href);
  const descriptors = iconRegistry();
  assert.ok(descriptors.length >= 67, `semantic icon registry is incomplete: ${descriptors.length}`);
  assert.ok(new Set(descriptors.map((descriptor) => descriptor.path)).size >= 50, "semantic icon silhouettes are not distinct enough");
  const validationBundle = join(folder, "layout-validation.mjs");
  await build({ entryPoints: ["layout/src/validation.ts"], outfile: validationBundle, bundle: true, format: "esm", platform: "node", target: ["node22"], logLevel: "silent" });
  const { validateBackendPorts, validateBackendEdges } = await import(pathToFileURL(validationBundle).href);
  const validationGraph = {
    id: "__root__",
    children: [{ id: "source", kind: "resource", width: 168, height: 88, children: [], ports: [{ id: "out:source:eth0", ownerId: "source", interfaceId: "eth0", direction: "output" }] }],
    edges: [{ id: "link-1", sourceNode: "source", targetNode: "target", sourcePort: "out:source:eth0", targetPort: "in:target:eth0" }],
  };
  const badPortDiagnostics = validateBackendPorts(validationGraph, [{ id: "out:source:eth0", ownerId: "wrong-owner", x: 0, y: 0, width: 8, height: 8 }]);
  assert.ok(badPortDiagnostics.some((diagnostic) => diagnostic.code === "LAYOUT_PORT_OWNER_MISMATCH"), "port owner mismatch was not observable");
  const badEdgeDiagnostics = validateBackendEdges(validationGraph, [{
    id: "link-1", sourceNode: "wrong-source", targetNode: "target", sourcePort: "out:source:eth0", targetPort: "in:target:eth0",
    sections: [{ id: "section-1", startPoint: { x: 0, y: 0 }, bendPoints: [{ x: 10, y: 10 }], endPoint: { x: 20, y: 10 } }],
  }]);
  assert.ok(badEdgeDiagnostics.some((diagnostic) => diagnostic.code === "LAYOUT_EDGE_ENDPOINT_MISMATCH"), "edge endpoint mismatch was not observable");
  assert.ok(badEdgeDiagnostics.some((diagnostic) => diagnostic.code === "TOPOLOGY_LAYOUT_EDGE_NON_ORTHOGONAL"), "diagonal route was not observable");
  const ids = ["distribution-0004", "access-0025", ...Array.from({ length: 38 }, (_, index) => `client-${String(index + 895).padStart(5, "0")}`)];
  const rows = [
    ["link-00059", "access-0025", "distribution-0004"],
    ...Array.from({ length: 38 }, (_, index) => [`link-${String(index + 1185).padStart(5, "0")}`, "access-0025", `client-${String(index + 895).padStart(5, "0")}`]),
  ];
  const resource = (id) => ({
    id,
    type: id.startsWith("client") ? "endpoint.windows" : id.startsWith("access") ? "network.access" : "network.distribution",
    label: id,
    interfaces: [],
    data: {},
  });
  const resources = ids.map(resource);
  const nodes = resources.map((item) => ({
    id: item.id,
    type: "resource",
    position: { x: 0, y: 0 },
    width: 168,
    height: 88,
    data: {
      semanticId: item.id,
      semanticKind: "resource",
      label: item.label,
      resourceType: item.type,
      deviceFamily: item.type === "endpoint.windows" ? "client" : "switch",
      deviceRoleLabel: "Network device",
      interfaces: [],
    },
    layoutStatus: "resolved",
  }));
  const edges = rows.map(([id, source, target]) => ({
    id,
    type: "semantic",
    source,
    target,
    data: {
      semanticId: id,
      connectionKind: "network",
      properties: {},
      visual: { tone: "network", kindLabel: "NETWORK", enabled: true, direction: "unspecified", accessibleLabel: "NETWORK" },
    },
  }));
  const groups = [
    { id: "group-distribution", label: "Distribution", memberIds: ["distribution-0004"], kind: "derived-navigation", presentationOnly: true, level: 0 },
    { id: "group-access", label: "Access", memberIds: ["access-0025"], kind: "derived-navigation", presentationOnly: true, level: 0 },
    ...Array.from({ length: 5 }, (_, index) => ({ id: `group-client-${index + 1}`, label: `Clients ${index + 1}`, memberIds: ids.slice(2 + index * 8, 2 + Math.min(38, (index + 1) * 8)), kind: "derived-navigation", presentationOnly: true, level: 1 })),
  ];
  const groupNodes = groups.map((group) => ({
    id: group.id,
    type: "zone",
    position: { x: 0, y: 0 },
    width: 720,
    height: 480,
    data: { semanticId: group.id, semanticKind: "zone", label: group.label, zoneKind: "custom", presentationOnly: true, navigationGroupKind: "derived-navigation", memberIds: group.memberIds },
    layoutStatus: "resolved",
  }));
  const view = {
    kind: "branch",
    rootId: "access-0025",
    page: 1,
    pageCount: 1,
    nodeIds: ids,
    edgeIds: rows.map(([id]) => id),
    hiddenNodeCount: 0,
    hiddenConnectionCount: 0,
    hiddenNeighborCount: 0,
    hiddenBoundaryConnectionCount: 0,
    visibleConnectionCount: rows.length,
    navigationGroups: groups,
    partition: { internal: [], boundary: [], external: [] },
    incompleteView: false,
    projection: { scenarioId: "project094-access25", sourceHash: "project094-fixture", nodes: [...groupNodes, ...nodes], edges, diagnostics: [] },
    layoutStrategy: "arvidsjaur-grouped-orthogonal",
    roleLabel: "Access branch",
  };
  const request = { sourceHash: "project094-fixture", scope: "branch", rootId: "access-0025", page: 1, viewportBucket: "wide" };
  const result = await layoutHierarchicalTopologyView(view, request);
  assert.equal(result.engine, "elk.layered");
  assert.equal(result.quality.candidates.length, 3, "A/B/C bake-off must run all three candidates");
  assert.deepEqual(result.quality.candidates.map((candidate) => candidate.id).sort(), ["A-flat-right", "B-flat-down-high-degree", "C-role-aware-fanout"]);
  assert.equal(result.projection.nodes.filter((node) => node.type === "resource").length, 40);
  assert.equal(result.projection.edges.length, 39);
  assert.equal(result.projection.nodes.filter((node) => node.type === "zone").length, 7);
  assert.equal(new Set(result.projection.edges.map((edge) => edge.id)).size, 39);
  assert.ok(result.projection.edges.every((edge) => edge.data.routeKind === "orthogonal" && edge.data.routeOrigin === "elk"));
  assert.ok(result.projection.edges.every((edge) => edge.sourceHandle?.startsWith("__visual_port__:") && edge.targetHandle?.startsWith("__visual_port__:")));
  const access = result.projection.nodes.find((node) => node.id === "access-0025");
  assert.equal(access?.type, "resource");
  assert.equal(access?.data.visualAttachmentHandles?.length, 39, "missing source ports receive distinct view-only attachment slots");
  assert.equal(createTopologyRequestKey(request), createTopologyRequestKey({ ...request, configVersion: "project-094-elk-v1" }));
  assert.notEqual(createTopologyRequestKey(request), createTopologyRequestKey({ ...request, page: 2 }));
  const repeat = await layoutHierarchicalTopologyView(view, request);
  assert.equal(repeat.quality.deterministicHash, result.quality.deterministicHash, "same source/scope/config must be deterministic");
  console.log("PASS PROJECT-094 ELK node/port/edge pipeline, A/B/C bake-off, exact Access25 identity and determinism");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
