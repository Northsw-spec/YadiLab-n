import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const folder = mkdtempSync(join(tmpdir(), "yadilab-av001-nested-"));
try {
  const bundle = join(folder, "topology-elk-adapter.mjs");
  await build({ entryPoints: ["ui/src/canvas/topology-elk-adapter.ts"], outfile: bundle, bundle: true, format: "esm", platform: "node", target: ["node22"], logLevel: "silent" });
  const { layoutHierarchicalTopologyView } = await import(pathToFileURL(bundle).href);

  const node = (id, parentId, family) => ({
    id,
    type: "resource",
    parentId,
    position: { x: 0, y: 0 },
    width: 168,
    height: 88,
    data: {
      semanticId: id,
      semanticKind: "resource",
      label: id,
      resourceType: family,
      deviceFamily: family,
      deviceRoleLabel: family,
      interfaces: [],
    },
    layoutStatus: "resolved",
  });
  const group = (id, label, memberIds) => ({
    id,
    type: "zone",
    position: { x: 0, y: 0 },
    width: 420,
    height: 300,
    data: {
      semanticId: id,
      semanticKind: "zone",
      label,
      zoneKind: "custom",
      presentationOnly: true,
      navigationGroupKind: "derived-navigation",
      memberIds,
    },
    layoutStatus: "resolved",
  });
  const links = [
    { id: "cross-a", source: "router-a", target: "switch-b" },
    { id: "cross-b", source: "switch-a", target: "router-b" },
    { id: "internal-a", source: "router-a", target: "switch-a" },
  ].map((edge) => ({
    ...edge,
    type: "semantic",
    data: { semanticId: edge.id, connectionKind: "network", properties: {}, visual: { tone: "network", kindLabel: "NETWORK", enabled: true, direction: "unspecified", accessibleLabel: "NETWORK" } },
  }));
  const projection = {
    scenarioId: "av001-nested-fixture",
    sourceHash: "av001-nested-fixture",
    nodes: [
      group("group-a", "A · core", ["router-a", "switch-a"]),
      group("group-b", "B · access", ["router-b", "switch-b"]),
      node("router-a", "group-a", "router"),
      node("switch-a", "group-a", "switch"),
      node("router-b", "group-b", "router"),
      node("switch-b", "group-b", "switch"),
    ],
    edges: links,
    diagnostics: [],
  };
  const view = {
    kind: "branch",
    rootId: "router-a",
    page: 1,
    pageCount: 1,
    nodeIds: ["router-a", "switch-a", "router-b", "switch-b"],
    edgeIds: links.map((edge) => edge.id),
    hiddenNodeCount: 0,
    hiddenConnectionCount: 0,
    hiddenNeighborCount: 0,
    hiddenBoundaryConnectionCount: 0,
    visibleConnectionCount: links.length,
    navigationGroups: [
      { id: "group-a", label: "A · core", memberIds: ["router-a", "switch-a"], kind: "derived-navigation", presentationOnly: true, level: 0 },
      { id: "group-b", label: "B · access", memberIds: ["router-b", "switch-b"], kind: "derived-navigation", presentationOnly: true, level: 1 },
    ],
    partition: { internal: [], boundary: [], external: [] },
    incompleteView: false,
    projection,
    layoutStrategy: "arvidsjaur-grouped-orthogonal",
    roleLabel: "Nested fixture",
  };
  const result = await layoutHierarchicalTopologyView(view, { sourceHash: projection.sourceHash, scope: "branch", rootId: "router-a", page: 1, viewportBucket: "wide" });
  const groups = new Map(result.projection.nodes.filter((candidate) => candidate.type === "zone").map((candidate) => [candidate.id, candidate]));
  assert.equal(groups.size, 2, "nested presentation groups were not retained");
  const resources = new Map(result.projection.nodes.filter((candidate) => candidate.type === "resource").map((candidate) => [candidate.id, candidate]));
  for (const [id, parentId] of [["router-a", "group-a"], ["switch-a", "group-a"], ["router-b", "group-b"], ["switch-b", "group-b"]]) {
    const resource = resources.get(id);
    const container = groups.get(parentId);
    assert.equal(resource?.parentId, parentId, `${id} lost its source-derived presentation parent`);
    assert.ok(resource && container && resource.position.x >= 0 && resource.position.y >= 0, `${id} has no local nested position`);
    assert.ok(resource.position.x + resource.width <= container.width + 1, `${id} escapes its group width`);
    assert.ok(resource.position.y + resource.height <= container.height + 1, `${id} escapes its group height`);
  }
  assert.equal(result.projection.edges.length, links.length, "cross-group fixture changed canonical link count");
  assert.ok(result.projection.edges.every((edge) => edge.data.routeOrigin === "elk" && edge.data.routeKind === "orthogonal"), "cross-group routes did not come from ELK orthogonal sections");
  assert.ok(result.projection.edges.every((edge) => edge.data.route?.every((point, index, route) => index === 0 || point.x === route[index - 1].x || point.y === route[index - 1].y)), "nested route contains a diagonal segment");
  assert.equal(result.quality.hardGate, "PASS", `nested fixture hard geometry failed: ${JSON.stringify(result.quality)}`);
  console.log("PASS AV-001 nested ELK groups, cross-group source links and orthogonal world-space routes");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
