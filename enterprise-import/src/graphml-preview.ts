import { webCryptoImportHashProvider } from "./hash.js";
import { EnterpriseImportError } from "./types.js";
import { attr, childElements, localName, parseSafeXml, xmlText, type XmlNode } from "./xml-lite.js";

export const GRAPHML_PREVIEW_PROFILE = "graphml.structural.v1" as const;
const GRAPHML_NAMESPACE = "http://graphml.graphdrawing.org/xmlns";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 2_000;
const MAX_EDGES = 5_000;
const MAX_KEYS = 128;
const MAX_LABEL_LENGTH = 512;

export interface GraphmlSourceLocator {
  readonly kind: "graphml-node" | "graphml-edge";
  readonly sourceSha256: string;
  readonly graphId: string;
  readonly sourceOrdinal: number;
  readonly elementId?: string;
}
export interface GraphmlPreviewNode {
  readonly id: string;
  readonly label?: string;
  readonly locator: GraphmlSourceLocator;
}
export interface GraphmlPreviewEdge {
  readonly id?: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly directed: boolean;
  readonly relationKind: "GRAPH_EDGE";
  readonly locator: GraphmlSourceLocator;
}
export interface GraphmlReadOnlyPreview {
  readonly status: "REVIEW_REQUIRED";
  readonly canActivate: false;
  readonly profileId: typeof GRAPHML_PREVIEW_PROFILE;
  readonly semanticTrack: "TOPOLOGY_DECLARED";
  readonly sourceSha256: string;
  readonly graphId: string;
  readonly nodes: readonly GraphmlPreviewNode[];
  readonly edges: readonly GraphmlPreviewEdge[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

function fail(code: string, message: string): never {
  throw new EnterpriseImportError(code, message);
}
function coreName(node: XmlNode): string {
  if (node.name.includes(":") ||
      (Object.hasOwn(node.attributes, "xmlns") && node.attributes.xmlns !== GRAPHML_NAMESPACE)) {
    fail("GRAPHML_UNSUPPORTED_NAMESPACE", "Only unprefixed GraphML core elements in the GraphML namespace are supported.");
  }
  return localName(node.name);
}
function onlyChildren(node: XmlNode, allowed: readonly string[]): void {
  for (const child of node.children) {
    const name = coreName(child);
    if (!allowed.includes(name)) fail("GRAPHML_UNSUPPORTED_ELEMENT", `Unsupported GraphML core element ${name}.`);
  }
}
function requiredId(node: XmlNode, field: string): string {
  const value = attr(node, field);
  if (!value || !/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(value)) {
    fail("GRAPHML_INVALID_ID", `GraphML element has invalid or missing ${field} identifier.`);
  }
  return value;
}
function dataValues(node: XmlNode, keys: ReadonlyMap<string, { target: string; name: string }>): Map<string, string> {
  onlyChildren(node, ["data", "desc"]);
  const values = new Map<string, string>();
  for (const data of childElements(node, "data")) {
    onlyChildren(data, []);
    const key = requiredId(data, "key");
    if (!keys.has(key)) fail("GRAPHML_UNKNOWN_KEY", `GraphML data references undeclared key ${key}.`);
    if (values.has(key)) fail("GRAPHML_DUPLICATE_DATA_KEY", `GraphML data repeats key ${key}.`);
    const value = xmlText(data);
    if (value.length > MAX_LABEL_LENGTH) fail("GRAPHML_DATA_TOO_LONG", "GraphML data value exceeds the bounded preview limit.");
    values.set(key, value);
  }
  return values;
}

/**
 * Read-only profile preview. GraphML edges are graph relations, NEVER physical
 * cables or Engine-verified connectivity. This function cannot activate a
 * scenario, import into a workspace, or set Engine truth values.
 *
 * Its strict subset deliberately rejects embedded graphs, hyperedges, foreign
 * namespaces, default-value semantics, complex SVG/yFiles data and external XML.
 */
export async function previewGraphmlReadOnly(bytes: Uint8Array): Promise<GraphmlReadOnlyPreview> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_BYTES) {
    fail("GRAPHML_SOURCE_SIZE_INVALID", "GraphML source must be nonempty and at most 2 MiB.");
  }
  const root = parseSafeXml(bytes, "GraphML source");
  if (coreName(root) !== "graphml" || root.attributes.xmlns !== GRAPHML_NAMESPACE) {
    fail("GRAPHML_ROOT_INVALID", "GraphML root element or namespace does not match the supported profile.");
  }
  onlyChildren(root, ["key", "graph", "desc"]);
  const graphs = childElements(root, "graph");
  if (graphs.length !== 1) fail("GRAPHML_GRAPH_COUNT_INVALID", "This preview requires exactly one GraphML graph.");
  const graph = graphs[0]!;
  const graphId = requiredId(graph, "id");
  const defaultDirection = attr(graph, "edgedefault");
  if (defaultDirection !== "directed" && defaultDirection !== "undirected") {
    fail("GRAPHML_EDGEDEFAULT_INVALID", "GraphML graph requires edgedefault directed or undirected.");
  }
  onlyChildren(graph, ["node", "edge", "desc"]);

  const keys = childElements(root, "key");
  if (keys.length > MAX_KEYS) fail("GRAPHML_TOO_MANY_KEYS", "GraphML key budget exceeded.");
  const keyMap = new Map<string, { target: string; name: string }>();
  for (const key of keys) {
    onlyChildren(key, []);
    const keyId = requiredId(key, "id");
    if (keyMap.has(keyId)) fail("GRAPHML_DUPLICATE_KEY", `Duplicate GraphML key ${keyId}.`);
    keyMap.set(keyId, { target: attr(key, "for") ?? "", name: attr(key, "attr.name") ?? "" });
    if (attr(key, "attr.name") === "label" && attr(key, "attr.type") !== "string") {
      fail("GRAPHML_LABEL_TYPE_INVALID", "Only string GraphML label attributes are supported.");
    }
  }
  const labelKeys = [...keyMap].filter(([, v]) => (v.target === "node" || v.target === "all") && v.name === "label").map(([k]) => k);
  if (labelKeys.length > 1) fail("GRAPHML_LABEL_AMBIGUOUS", "Multiple node label keys require an explicit future mapping profile.");

  const sourceSha256 = await webCryptoImportHashProvider.sha256Bytes(bytes);
  const nodeElements = childElements(graph, "node");
  const edgeElements = childElements(graph, "edge");
  if (nodeElements.length === 0 || nodeElements.length > MAX_NODES || edgeElements.length > MAX_EDGES) {
    fail("GRAPHML_GRAPH_SIZE_INVALID", "GraphML graph exceeds node/edge budget or has no nodes.");
  }
  const nodeIds = new Set<string>();
  const nodes: GraphmlPreviewNode[] = [];
  let ignored = 0;
  for (const [ordinal, node] of nodeElements.entries()) {
    const id = requiredId(node, "id");
    if (nodeIds.has(id)) fail("GRAPHML_DUPLICATE_NODE", `Duplicate GraphML node ${id}.`);
    nodeIds.add(id);
    const values = dataValues(node, keyMap);
    const label = labelKeys.length ? values.get(labelKeys[0]!) : undefined;
    for (const idKey of values.keys()) if (idKey !== labelKeys[0]) ignored++;
    nodes.push({
      id,
      ...(label === undefined ? {} : { label }),
      locator: { kind: "graphml-node", sourceSha256, graphId, sourceOrdinal: ordinal, elementId: id },
    });
  }
  const edgeIds = new Set<string>();
  const edges: GraphmlPreviewEdge[] = [];
  for (const [ordinal, edge] of edgeElements.entries()) {
    const id = attr(edge, "id");
    if (id !== undefined && !/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(id)) {
      fail("GRAPHML_INVALID_ID", "GraphML edge id is invalid.");
    }
    if (id !== undefined) {
      if (edgeIds.has(id)) fail("GRAPHML_DUPLICATE_EDGE", `Duplicate GraphML edge id ${id}.`);
      edgeIds.add(id);
    }
    const sourceId = requiredId(edge, "source");
    const targetId = requiredId(edge, "target");
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) {
      fail("GRAPHML_DANGLING_EDGE", "GraphML edge references an undeclared node.");
    }
    const explicitDirection = attr(edge, "directed");
    if (explicitDirection !== undefined && explicitDirection !== "true" && explicitDirection !== "false") {
      fail("GRAPHML_DIRECTED_INVALID", "GraphML edge directed must be true or false.");
    }
    const values = dataValues(edge, keyMap);
    ignored += values.size;
    edges.push({
      ...(id === undefined ? {} : { id }),
      sourceId,
      targetId,
      directed: explicitDirection === undefined ? defaultDirection === "directed" : explicitDirection === "true",
      relationKind: "GRAPH_EDGE",
      locator: {
        kind: "graphml-edge", sourceSha256, graphId, sourceOrdinal: ordinal,
        ...(id === undefined ? {} : { elementId: id }),
      },
    });
  }
  return {
    status: "REVIEW_REQUIRED",
    canActivate: false,
    profileId: GRAPHML_PREVIEW_PROFILE,
    semanticTrack: "TOPOLOGY_DECLARED",
    sourceSha256,
    graphId,
    nodes,
    edges,
    diagnostics: ignored === 0 ? [] : [{
      code: "GRAPHML_UNMAPPED_DATA_IGNORED",
      message: `${ignored} GraphML data value(s) have no approved mapping and were not imported.`,
    }],
  };
}
