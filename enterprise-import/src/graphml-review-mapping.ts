import type { ScenarioSource } from "../../core-model/src/generated/contracts.js";
import type { ImportCell, ImportDocument, ImportRecord } from "./types.js";
import type { GraphmlReadOnlyPreview, GraphmlSourceLocator } from "./graphml-preview.js";
import { mapNetworkWorkbookToScenario } from "./workbook-mapping.js";

export const GRAPHML_MANUAL_ROLE_OPTIONS = [
  "resource.generic", "network.switch", "network.router", "network.firewall",
  "server.generic", "endpoint.windows", "endpoint.linux",
  "virtualization.hypervisor", "virtualization.proxmox",
] as const;
export type GraphmlManualRole = typeof GRAPHML_MANUAL_ROLE_OPTIONS[number];

export interface GraphmlManualReview {
  readonly sourceSha256: string;
  readonly graphId: string;
  /** Only explicitly chosen roles; other nodes remain resource.generic. */
  readonly roles: readonly { readonly nodeOrdinal: number; readonly type: GraphmlManualRole }[];
  /** A separate affirmative choice is required for EACH included undirected edge. */
  readonly modeledEdgeOrdinals: readonly number[];
  readonly acknowledgeModeledConnections: boolean;
}
export interface GraphmlMappedOrigin {
  readonly targetId: string;
  readonly locator: GraphmlSourceLocator;
  readonly decision: "GENERIC_NODE" | "USER_SELECTED_ROLE" | "USER_MODELED_CONNECTION";
}
export interface GraphmlBuilderMapping {
  readonly status: "READY_FOR_COMPILATION" | "BLOCKED";
  readonly source?: ScenarioSource;
  readonly sourceSha256: string;
  readonly origins: readonly GraphmlMappedOrigin[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
  readonly selectedConnections: number;
}

function blocked(preview: GraphmlReadOnlyPreview, code: string, message: string): GraphmlBuilderMapping {
  return { status: "BLOCKED", sourceSha256: preview.sourceSha256, origins: [], selectedConnections: 0, diagnostics: [{ code, message }] };
}
const validOrdinal = (n: number, size: number): boolean => Number.isSafeInteger(n) && n >= 0 && n < size;
const cell = (value: string, table: string, row: number, column: string): ImportCell =>
  ({ value, locator: { kind: "table-cell", sheet: table, row, column } });
function record(table: string, row: number, values: Record<string, string>): ImportRecord {
  return { recordIndex: row, fields: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, cell(v, table, row, k)])) };
}

/**
 * The GraphML source remains graph evidence. This versioned manual decision
 * produces a candidate through the existing workbook schema; it NEVER claims
 * GraphML edges are verified physical cables. Confirmation must happen in UI.
 * Generated table-cell locators describe the intermediate workbook only;
 * the authentic GraphML locators are kept separately in origins.
 */
export function mapReviewedGraphmlToBuilder(
  preview: GraphmlReadOnlyPreview,
  decision: GraphmlManualReview,
): GraphmlBuilderMapping {
  if (preview.profileId !== "graphml.structural.v1" || preview.status !== "REVIEW_REQUIRED" || preview.canActivate !== false) {
    return blocked(preview, "GRAPHML_PREVIEW_INVALID", "Only validated read-only GraphML previews can enter manual mapping.");
  }
  if (!/^[0-9a-f]{64}$/.test(preview.sourceSha256) ||
      decision.sourceSha256 !== preview.sourceSha256 || decision.graphId !== preview.graphId) {
    return blocked(preview, "GRAPHML_REVIEW_STALE", "Source identity differs from the reviewed GraphML file.");
  }
  if (!Array.isArray(decision.roles) || !Array.isArray(decision.modeledEdgeOrdinals) ||
      typeof decision.acknowledgeModeledConnections !== "boolean") {
    return blocked(preview, "GRAPHML_REVIEW_INVALID", "Review decisions have an invalid shape.");
  }
  const roles = new Map<number, GraphmlManualRole>();
  for (const item of decision.roles) {
    if (!item || !validOrdinal(item.nodeOrdinal, preview.nodes.length) ||
        !GRAPHML_MANUAL_ROLE_OPTIONS.includes(item.type) || roles.has(item.nodeOrdinal)) {
      return blocked(preview, "GRAPHML_ROLE_DECISION_INVALID", "Role decisions must specify a unique valid node and an approved type.");
    }
    roles.set(item.nodeOrdinal, item.type);
  }
  const selected = new Set<number>();
  for (const ordinal of decision.modeledEdgeOrdinals) {
    if (!validOrdinal(ordinal, preview.edges.length) || selected.has(ordinal)) {
      return blocked(preview, "GRAPHML_EDGE_DECISION_INVALID", "Edge decisions must specify unique valid graph edge ordinals.");
    }
    selected.add(ordinal);
  }
  if (selected.size && !decision.acknowledgeModeledConnections) {
    return blocked(preview, "GRAPHML_CONNECTION_ACK_REQUIRED", "Modeling graph edges as network connections requires a separate explicit acknowledgement.");
  }
  if ([...selected].some((i) => preview.edges[i]!.directed)) {
    return blocked(preview, "GRAPHML_DIRECTIONAL_EDGE_UNSUPPORTED", "Directed GraphML edges cannot be mapped into an undirected network connection.");
  }
  const nodes: ImportRecord[] = [];
  const links: ImportRecord[] = [];
  const origins: GraphmlMappedOrigin[] = [];
  const ids = new Map<string, string>();
  for (const [i, node] of preview.nodes.entries()) {
    const id = `graph_node_${i + 1}`;
    if (ids.has(node.id)) return blocked(preview, "GRAPHML_DUPLICATE_NODE", "Duplicate source node id.");
    ids.set(node.id, id);
    nodes.push(record("Nodes", i + 1, {
      nodeId: id, displayName: node.label ?? node.id, type: roles.get(i) ?? "resource.generic",
    }));
    origins.push({ targetId: id, locator: node.locator, decision: roles.has(i) ? "USER_SELECTED_ROLE" : "GENERIC_NODE" });
  }
  for (const ordinal of [...selected].sort((a, b) => a - b)) {
    const edge = preview.edges[ordinal]!;
    const source = ids.get(edge.sourceId);
    const target = ids.get(edge.targetId);
    if (!source || !target) return blocked(preview, "GRAPHML_DANGLING_EDGE", "Selected graph edge has an unknown endpoint.");
    const id = `graph_link_${ordinal + 1}`;
    links.push(record("Links", ordinal + 1, { linkId: id, nodeA: source, nodeB: target }));
    origins.push({ targetId: id, locator: edge.locator, decision: "USER_MODELED_CONNECTION" });
  }
  const doc: ImportDocument = { tables: [
    { tableId: "Metadata", records: [record("Metadata", 1, {
      scenarioId: "graphml_reviewed", title: "User-reviewed GraphML topology",
      description: "Manual graph mapping. GRAPH_EDGE is not independent evidence of a physical cable or reachability.",
    })] },
    { tableId: "Nodes", records: nodes },
    { tableId: "Links", records: links },
  ] };
  const mapped = mapNetworkWorkbookToScenario(doc);
  if (!mapped.ok || !mapped.source) {
    return { status: "BLOCKED", sourceSha256: preview.sourceSha256, origins: [], selectedConnections: 0,
      diagnostics: mapped.diagnostics.map((d) => ({ code: d.code, message: d.message })) };
  }
  // The workbook importer has a convenience tautological objective based on
  // resource.type. It must NOT yield a green result for imported graph evidence.
  // Replace its condition with an explicit unset manual-verification property.
  const condition = { op: "equals" as const, target: mapped.source.resources[0]!.id,
    path: "graphml_manual_verification", value: "VERIFIED" };
  const source: ScenarioSource = {
    ...mapped.source,
    objectives: [{ id: "graphml_manual_verification", title: "Verify modeled topology independently",
      category: "import-review", required: true, condition }],
    completion: condition,
    notes: [{
      id: "graphml_evidence_boundary", title: "GraphML provenance and epistemic boundary",
      text: `GraphML SHA-256: ${preview.sourceSha256}. ${selected.size} graph edge(s) explicitly modeled by the user as connections; no physical cables, routes, protocol outcomes or reachability have been independently verified.`,
    }],
  };
  return { status: "READY_FOR_COMPILATION", source, sourceSha256: preview.sourceSha256,
    origins, selectedConnections: selected.size, diagnostics: [] };
}
