import type { ScenarioSource } from "../../core-model/src/generated/contracts.js";
import type { ImportCell, ImportDocument, ImportRecord } from "./types.js";
import { EnterpriseImportError } from "./types.js";
import { previewDrawioStructure, DRAWIO_PREVIEW_PROFILE } from "./drawio-structural-preview.js";
import { validDrawioSummary } from "./drawio-association-review.js";
import { decodeDrawioCompressedPage } from "./drawio-compressed-page.js";
import { parseSafeXml, type XmlNode } from "./xml-lite.js";
import { mapNetworkWorkbookToScenario } from "./workbook-mapping.js";
import { GRAPHML_MANUAL_ROLE_OPTIONS, type GraphmlManualRole } from "./graphml-review-mapping.js";

export const DRAWIO_GRAPH_CANDIDATE_PROFILE = "diagrams.drawio.reviewed-candidate.v1" as const;
export const DRAWIO_GRAPH_MAX_SELECTED = 20;
const fail = (code: string): never => { throw new EnterpriseImportError(code, code); };
const validOrdinal = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export interface DrawioOrdinalVertex {
  readonly pageOrdinal: number;
  readonly vertexOrdinal: number;
}
export interface DrawioOrdinalEdge {
  readonly pageOrdinal: number;
  readonly edgeOrdinal: number;
  readonly sourceVertexOrdinal: number;
  readonly targetVertexOrdinal: number;
}
export interface DrawioOrdinalGraph {
  readonly status: "REVIEW_REQUIRED";
  readonly profileId: typeof DRAWIO_GRAPH_CANDIDATE_PROFILE;
  readonly sourceProfileId: typeof DRAWIO_PREVIEW_PROFILE;
  readonly sourceSha256: string;
  readonly pageCount: number;
  readonly vertexCount: number;
  readonly drawnEdgeCount: number;
  readonly compressedPageCount: number;
  readonly vertices: readonly DrawioOrdinalVertex[];
  readonly edges: readonly DrawioOrdinalEdge[];
  readonly canActivate: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
}
export interface DrawioGraphReviewDecision {
  readonly sourceSha256: string;
  readonly nodes: readonly (DrawioOrdinalVertex & { readonly type?: GraphmlManualRole })[];
  readonly edges: readonly { readonly pageOrdinal: number; readonly edgeOrdinal: number }[];
  readonly acknowledgeModeledConnections: boolean;
}
export interface DrawioGraphOrigin {
  readonly targetId: string;
  readonly locator: {
    readonly kind: "drawio-vertex-ordinal" | "drawio-edge-ordinal";
    readonly sourceSha256: string;
    readonly pageOrdinal: number;
    readonly vertexOrdinal?: number;
    readonly edgeOrdinal?: number;
  };
  readonly decision: "USER_SELECTED_VERTEX" | "USER_SELECTED_ROLE" | "USER_MODELED_CONNECTION";
}
export interface DrawioGraphCandidate {
  readonly status: "READY_FOR_COMPILATION" | "BLOCKED";
  readonly sourceSha256: string;
  readonly source?: ScenarioSource;
  readonly selectedResources: number;
  readonly selectedConnections: number;
  readonly origins: readonly DrawioGraphOrigin[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}
const blocked = (sha: string, code: string): DrawioGraphCandidate => ({
  status: "BLOCKED", sourceSha256: sha, selectedResources: 0,
  selectedConnections: 0, origins: [], diagnostics: [{ code, message: code }],
});
const positionKey = (p: { readonly pageOrdinal: number; readonly vertexOrdinal: number }) =>
  p.pageOrdinal + ":" + p.vertexOrdinal;
const edgeKey = (p: { readonly pageOrdinal: number; readonly edgeOrdinal: number }) =>
  p.pageOrdinal + ":" + p.edgeOrdinal;
const cell = (text: string, table: string, row: number, column: string): ImportCell =>
  ({ value: text, locator: { kind: "table-cell", sheet: table, row, column } });
const record = (table: string, row: number, items: Readonly<Record<string, string>>): ImportRecord => ({
  recordIndex: row, fields: Object.fromEntries(
    Object.entries(items).map(([column, value]) => [column, cell(value, table, row, column)]),
  ),
});

/**
 * A second bounded projection of an already strictly validated diagrams.net
 * original. Unlike the P1/P3 aggregate preview, this contains safe ORDINAL
 * positions/endpoints, never mxCell IDs, values, page labels, network data,
 * coordinates, styles, addresses, asset identities or verified cables.
 *
 * Calls the existing strict original preview FIRST; its 2 MiB/16 pages/
 * 1000-vertex/2000-edge, XML and streaming inflate budgets remain normative.
 */
export async function extractDrawioOrdinalGraph(original: Uint8Array): Promise<DrawioOrdinalGraph> {
  const summary = await previewDrawioStructure(original);
  if (!validDrawioSummary(summary)) fail("DRAWIO_CANDIDATE_SOURCE_INVALID");
  const document = parseSafeXml(original, "drawio-ordinal");
  const pages = document.name === "mxfile"
    ? document.children.filter(p => p.name === "diagram") : [document];
  const inflation = { inflatedBytes: 0 };
  const vertices: DrawioOrdinalVertex[] = [], edges: DrawioOrdinalEdge[] = [];
  for (const [pageOrdinal, page] of pages.entries()) {
    let model: XmlNode;
    if (page.name === "mxGraphModel") model = page;
    else if (page.children.length) model = page.children[0]!;
    else {
      const decoded = await decodeDrawioCompressedPage(page.text, inflation);
      model = parseSafeXml(decoded, "drawio-ordinal-decompressed");
    }
    if (model.name !== "mxGraphModel") fail("DRAWIO_CANDIDATE_SOURCE_INVALID");
    const root = model.children.find(p => p.name === "root");
    if (!root) throw new EnterpriseImportError("DRAWIO_CANDIDATE_SOURCE_INVALID", "DRAWIO_CANDIDATE_SOURCE_INVALID");
    const cells = root.children.filter(p => p.name === "mxCell");
    const originalVertices = cells.filter(p => p.attributes.vertex === "1");
    const originalEdges = cells.filter(p => p.attributes.edge === "1");
    const index = new Map(originalVertices.map((v, ordinal) => [v.attributes.id, ordinal]));
    if (index.size !== originalVertices.length) fail("DRAWIO_CANDIDATE_SOURCE_INVALID");
    for (let vertexOrdinal = 0; vertexOrdinal < originalVertices.length; vertexOrdinal++) {
      vertices.push(Object.freeze({ pageOrdinal, vertexOrdinal }));
    }
    for (const [edgeOrdinal, edge] of originalEdges.entries()) {
      const sourceVertexOrdinal = index.get(edge.attributes.source);
      const targetVertexOrdinal = index.get(edge.attributes.target);
      if (sourceVertexOrdinal === undefined || targetVertexOrdinal === undefined) {
        throw new EnterpriseImportError("DRAWIO_CANDIDATE_EDGE_ENDPOINT_INVALID", "DRAWIO_CANDIDATE_EDGE_ENDPOINT_INVALID");
      }
      edges.push(Object.freeze({
        pageOrdinal, edgeOrdinal, sourceVertexOrdinal, targetVertexOrdinal,
      }));
    }
  }
  if (pages.length !== summary.pageCount || vertices.length !== summary.vertexCount ||
      edges.length !== summary.drawnEdgeCount ||
      pages.some((_, i) => vertices.filter(p => p.pageOrdinal === i).length !== summary.pages[i]?.vertexCount ||
        edges.filter(p => p.pageOrdinal === i).length !== summary.pages[i]?.drawnEdgeCount)) {
    fail("DRAWIO_CANDIDATE_SOURCE_INVALID");
  }
  return Object.freeze({
    status: "REVIEW_REQUIRED",
    profileId: DRAWIO_GRAPH_CANDIDATE_PROFILE, sourceProfileId: DRAWIO_PREVIEW_PROFILE,
    sourceSha256: summary.sourceSha256, pageCount: summary.pageCount,
    vertexCount: summary.vertexCount, drawnEdgeCount: summary.drawnEdgeCount,
    compressedPageCount: summary.compressedPageCount,
    vertices: Object.freeze(vertices), edges: Object.freeze(edges),
    canActivate: false, engineVerified: false, physicalTopologyVerified: false,
  });
}

function validStructure(graph: DrawioOrdinalGraph): boolean {
  if (!graph || graph.status !== "REVIEW_REQUIRED" ||
      graph.profileId !== DRAWIO_GRAPH_CANDIDATE_PROFILE ||
      graph.sourceProfileId !== DRAWIO_PREVIEW_PROFILE ||
      graph.canActivate !== false || graph.engineVerified !== false ||
      graph.physicalTopologyVerified !== false ||
      !/^[a-f0-9]{64}$/.test(graph.sourceSha256) ||
      !validOrdinal(graph.pageCount) || graph.pageCount < 1 || graph.pageCount > 16 ||
      !validOrdinal(graph.vertexCount) || graph.vertexCount > 1000 ||
      !validOrdinal(graph.drawnEdgeCount) || graph.drawnEdgeCount > 2000 ||
      !validOrdinal(graph.compressedPageCount) || graph.compressedPageCount > graph.pageCount ||
      !Array.isArray(graph.vertices) || graph.vertices.length !== graph.vertexCount ||
      !Array.isArray(graph.edges) || graph.edges.length !== graph.drawnEdgeCount) return false;
  const vertexPositions = new Set<string>(), edgePositions = new Set<string>();
  for (const node of graph.vertices) {
    if (!node || !validOrdinal(node.pageOrdinal) || node.pageOrdinal >= graph.pageCount ||
        !validOrdinal(node.vertexOrdinal)) return false;
    const key = positionKey(node);
    if (vertexPositions.has(key)) return false;
    vertexPositions.add(key);
  }
  for (const edge of graph.edges) {
    if (!edge || !validOrdinal(edge.pageOrdinal) || edge.pageOrdinal >= graph.pageCount ||
        !validOrdinal(edge.edgeOrdinal) || !validOrdinal(edge.sourceVertexOrdinal) ||
        !validOrdinal(edge.targetVertexOrdinal)) return false;
    if (!vertexPositions.has(edge.pageOrdinal + ":" + edge.sourceVertexOrdinal) ||
        !vertexPositions.has(edge.pageOrdinal + ":" + edge.targetVertexOrdinal)) return false;
    const key = edgeKey(edge);
    if (edgePositions.has(key)) return false;
    edgePositions.add(key);
  }
  return true;
}

/**
 * Accept only an explicitly reviewed graph bound to the actual original.
 * Re-extract from bytes: even a forged expected structure with a plausible SHA
 * cannot silently substitute edges, roles or endpoint positions.
 * UI activation and independent last-moment File + live Builder checks are P2b.
 */
export async function mapReviewedDrawioOriginalToBuilder(
  original: Uint8Array, expected: DrawioOrdinalGraph,
  decision: DrawioGraphReviewDecision,
): Promise<DrawioGraphCandidate> {
  const sha = typeof expected?.sourceSha256 === "string" ? expected.sourceSha256 : "";
  if (!validStructure(expected)) return blocked(sha, "DRAWIO_CANDIDATE_SOURCE_INVALID");
  const actual = await extractDrawioOrdinalGraph(original);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return blocked(sha, "DRAWIO_CANDIDATE_SOURCE_CHANGED");
  }
  if (!decision || decision.sourceSha256 !== actual.sourceSha256) {
    return blocked(sha, "DRAWIO_CANDIDATE_REVIEW_STALE");
  }
  if (!Array.isArray(decision.nodes) || decision.nodes.length < 1 ||
      decision.nodes.length > DRAWIO_GRAPH_MAX_SELECTED ||
      !Array.isArray(decision.edges) || decision.edges.length > DRAWIO_GRAPH_MAX_SELECTED ||
      typeof decision.acknowledgeModeledConnections !== "boolean") {
    return blocked(sha, "DRAWIO_CANDIDATE_SELECTION_COUNT_INVALID");
  }
  const positions = new Set(actual.vertices.map(positionKey));
  const accepted = new Map<string, { node: DrawioOrdinalVertex; type: GraphmlManualRole }>();
  for (const item of decision.nodes) {
    if (!item || !validOrdinal(item.pageOrdinal) || !validOrdinal(item.vertexOrdinal) ||
        !positions.has(positionKey(item)) || accepted.has(positionKey(item)) ||
        (item.type !== undefined && !GRAPHML_MANUAL_ROLE_OPTIONS.includes(item.type))) {
      return blocked(sha, "DRAWIO_CANDIDATE_NODE_SELECTION_INVALID");
    }
    accepted.set(positionKey(item), { node: item, type: item.type ?? "resource.generic" });
  }
  const graphEdges = new Map(actual.edges.map(item => [edgeKey(item), item]));
  const selectedEdges = new Set<string>();
  for (const item of decision.edges) {
    if (!item || !validOrdinal(item.pageOrdinal) || !validOrdinal(item.edgeOrdinal) ||
        !graphEdges.has(edgeKey(item)) || selectedEdges.has(edgeKey(item))) {
      return blocked(sha, "DRAWIO_CANDIDATE_EDGE_SELECTION_INVALID");
    }
    selectedEdges.add(edgeKey(item));
    const drawn = graphEdges.get(edgeKey(item))!;
    if (!accepted.has(drawn.pageOrdinal + ":" + drawn.sourceVertexOrdinal) ||
        !accepted.has(drawn.pageOrdinal + ":" + drawn.targetVertexOrdinal)) {
      return blocked(sha, "DRAWIO_CANDIDATE_EDGE_ENDPOINT_UNSELECTED");
    }
  }
  if (selectedEdges.size && !decision.acknowledgeModeledConnections) {
    return blocked(sha, "DRAWIO_CANDIDATE_CONNECTION_ACK_REQUIRED");
  }
  const sorted = [...accepted.values()].sort((a, b) =>
    a.node.pageOrdinal - b.node.pageOrdinal ||
    a.node.vertexOrdinal - b.node.vertexOrdinal);
  const nodeIds = new Map(sorted.map(({ node }) =>
    [positionKey(node), `drawio_node_p${node.pageOrdinal + 1}_v${node.vertexOrdinal + 1}`]));
  const origins: DrawioGraphOrigin[] = [];
  const nodes = sorted.map(({ node, type }, ordinal) => {
    const id = nodeIds.get(positionKey(node))!;
    origins.push({
      targetId: id,
      locator: { kind: "drawio-vertex-ordinal", sourceSha256: sha,
        pageOrdinal: node.pageOrdinal, vertexOrdinal: node.vertexOrdinal },
      decision: type === "resource.generic" ? "USER_SELECTED_VERTEX" : "USER_SELECTED_ROLE",
    });
    return record("Nodes", ordinal + 1, {
      nodeId: id,
      displayName: `Drawn vertex page ${node.pageOrdinal + 1} position ${node.vertexOrdinal + 1}`,
      type,
    });
  });
  const chosenEdges = actual.edges.filter(edge => selectedEdges.has(edgeKey(edge)));
  const links = chosenEdges.map((edge, index) => {
    const linkId = `drawio_link_p${edge.pageOrdinal + 1}_e${edge.edgeOrdinal + 1}`;
    origins.push({
      targetId: linkId,
      locator: { kind: "drawio-edge-ordinal", sourceSha256: sha,
        pageOrdinal: edge.pageOrdinal, edgeOrdinal: edge.edgeOrdinal },
      decision: "USER_MODELED_CONNECTION",
    });
    return record("Links", index + 1, {
      linkId,
      nodeA: nodeIds.get(edge.pageOrdinal + ":" + edge.sourceVertexOrdinal)!,
      nodeB: nodeIds.get(edge.pageOrdinal + ":" + edge.targetVertexOrdinal)!,
    });
  });
  const document: ImportDocument = { tables: [
    { tableId: "Metadata", records: [record("Metadata", 1, {
      scenarioId: "drawio_reviewed", title: "User-reviewed diagrams.net candidate",
      description: "Selected graph evidence is user-modeled, not observed network or verified physical cabling.",
    })] },
    { tableId: "Nodes", records: nodes },
    { tableId: "Links", records: links },
  ] };
  const mapped = mapNetworkWorkbookToScenario(document);
  if (!mapped.ok || !mapped.source) {
    return { ...blocked(sha, "DRAWIO_CANDIDATE_WORKBOOK_INVALID"),
      diagnostics: mapped.diagnostics.map(x => ({ code: x.code, message: x.code })) };
  }
  const condition = { op: "equals" as const, target: nodeIds.get(positionKey(sorted[0]!.node))!,
    path: "drawio_manual_verification", value: "VERIFIED" };
  const source: ScenarioSource = {
    ...mapped.source,
    objectives: [{ id: "drawio_manual_verification",
      title: "Independently verify reviewed diagrams.net model",
      category: "import-review", required: true, condition }],
    completion: condition,
    notes: [{
      id: "drawio_evidence_boundary", title: "Diagrams.net source and modeling limitations",
      text: `Original SHA-256: ${sha}. ${sorted.length} drawn vertex position(s) explicitly modeled as resources and ${chosenEdges.length} drawn edge(s) explicitly modeled as connections by user choice. No physical cables, device identity, reachability, routing, OS or Engine PASS independently verified.`,
    }],
  };
  return {
    status: "READY_FOR_COMPILATION", sourceSha256: sha, source,
    selectedResources: sorted.length, selectedConnections: chosenEdges.length,
    origins, diagnostics: [],
  };
}
