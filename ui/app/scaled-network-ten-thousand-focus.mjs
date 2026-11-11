import {runAutoLayout} from "../../layout/src/auto-layout.js";
import {ElkLayoutBackend} from "../../layout/src/elk-backend.js";
import {validateVisualLayout} from "../../layout/src/visual-validation.js";
import {projectScenarioToCanvas} from "../src/canvas/projection.js";
import {buildTopologyFocusPage} from "../src/canvas/topology-navigation.ts";

/** P4b1: explicitly consented original CSV 10000/10000 source row focus.
 * All 10000 nodes/links remain in canonical Builder; only a source-identity
 * subset enters ELK/ReactFlow, never invented/aggregated edges or Engine.
 */
const NODES=10000,LINKS=10000,ROW_SIZE=100,MAX_PEERS=16,MAX_EDGES=250;
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const fail=(code,diagnostics)=>{const e=new Error(code);e.code=code;if(diagnostics)e.diagnostics=diagnostics;throw e;};
const validId=x=>typeof x==="string"&&ID.test(x);
const has=x=>Array.isArray(x);

function boundedDeterministicLayout(model, rootId) {
  const resources = [...model.resources].sort((a,b) => a.id.localeCompare(b.id, "en"));
  const maxLabel = resources.reduce((max, resource) => Math.max(max, [...String(resource.label ?? resource.id)].length), 0);
  const width = Math.max(180, Math.min(520, 24 + Math.max(22, maxLabel) * 7));
  const height = 96;
  const gapX = 56;
  const gapY = 72;
  const rowStep = width + gapX;
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const adjacency = new Map(resources.map((resource) => [resource.id, new Set()]));
  for (const connection of model.connections) {
    if (!byId.has(connection.from.resource) || !byId.has(connection.to.resource)) continue;
    adjacency.get(connection.from.resource)?.add(connection.to.resource);
    adjacency.get(connection.to.resource)?.add(connection.from.resource);
  }
  const anchor = rootId && byId.has(rootId)
    ? rootId
    : resources.slice().sort((a, b) => (adjacency.get(b.id)?.size ?? 0) - (adjacency.get(a.id)?.size ?? 0) || a.id.localeCompare(b.id, "en"))[0]?.id;
  const levels = new Map();
  const queue = anchor ? [anchor] : [];
  if (anchor) levels.set(anchor, 0);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const neighbor of [...(adjacency.get(current) ?? [])].sort((a, b) => a.localeCompare(b, "en"))) {
      if (levels.has(neighbor)) continue;
      levels.set(neighbor, (levels.get(current) ?? 0) + 1);
      queue.push(neighbor);
    }
  }
  const maxLevel = Math.max(0, ...levels.values());
  for (const resource of resources) if (!levels.has(resource.id)) levels.set(resource.id, maxLevel + 1);
  const grouped = new Map();
  for (const resource of resources) {
    const level = levels.get(resource.id) ?? 0;
    const items = grouped.get(level) ?? [];
    items.push(resource);
    grouped.set(level, items);
  }
  const rowWidth = Math.max(1, Math.min(12, Math.ceil(Math.sqrt(resources.length))));
  const positions = new Map();
  let nextLevelY = 40;
  // A high-degree focus is easier to read when a documented hub/connector is
  // given its own band instead of being sorted into the same row as dozens of
  // endpoint leaves. This uses only canonical adjacency and documented type;
  // it does not infer a physical direction or add a link.
  if (anchor) {
    const directNeighbors = [...(adjacency.get(anchor) ?? [])].sort((a, b) => a.localeCompare(b, "en"));
    const connectors = directNeighbors
      .filter((id) => (adjacency.get(id)?.size ?? 0) > 1 || /(?:core|distribution|router|gateway|firewall)/i.test(String(byId.get(id)?.type ?? "")))
      .sort((a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0) || a.localeCompare(b, "en"));
    if (directNeighbors.length >= 8 && connectors.length > 0 && connectors.length < directNeighbors.length) {
      const centerX = 40 + ((Math.min(12, rowWidth) - 1) / 2) * rowStep;
      positions.set(anchor, { x: centerX, y: nextLevelY });
      const placeBand = (ids, y, columns) => ids.forEach((id, index) => {
        const count = Math.min(columns, ids.length);
        positions.set(id, {
          x: (index % columns - (count - 1) / 2) * rowStep + centerX,
          y: y + Math.floor(index / columns) * (height + gapY),
        });
      });
      placeBand(connectors, nextLevelY + height + gapY, Math.min(4, connectors.length));
      const leaves = directNeighbors.filter((id) => !connectors.includes(id));
      const leafColumns = Math.min(12, Math.max(4, Math.ceil(Math.sqrt(leaves.length))));
      const connectorRows = Math.max(1, Math.ceil(connectors.length / Math.min(4, connectors.length)));
      placeBand(leaves, nextLevelY + (connectorRows + 1) * (height + gapY), leafColumns);
      const leafRows = Math.max(1, Math.ceil(leaves.length / leafColumns));
      nextLevelY += (connectorRows + leafRows + 2) * (height + gapY);
    }
  }
  for (const [level, items] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    const ordered = items.filter((resource) => !positions.has(resource.id)).slice().sort((a, b) => (adjacency.get(b.id)?.size ?? 0) - (adjacency.get(a.id)?.size ?? 0) || a.id.localeCompare(b.id, "en"));
    if (!ordered.length) continue;
    const rows = Math.max(1, Math.ceil(ordered.length / rowWidth));
    ordered.forEach((resource, index) => {
      const row = Math.floor(index / rowWidth);
      const column = index % rowWidth;
      const count = Math.min(rowWidth, ordered.length - row * rowWidth);
      const centerX = 40 + ((rowWidth - 1) / 2) * rowStep;
      const x = (column - (count - 1) / 2) * rowStep + centerX;
      const y = nextLevelY + row * (height + gapY);
      positions.set(resource.id, { x, y });
    });
    // Every level receives a real vertical band. The next level starts after
    // the last row's bottom edge plus a deterministic safety margin, so a
    // multi-row level can never collide with the level below it.
    nextLevelY += rows * height + Math.max(0, rows - 1) * gapY + gapY;
  }
  return {
    formatId: "infrastructure-cyber-lab.layout",
    schemaVersion: "0.1.0",
    scenarioId: model.scenarioId,
    // LayoutDocument keeps the historical schema engine field for compatibility;
    // callers must use layoutStrategy to distinguish this deterministic fallback
    // from a document actually produced by ELK.
    engine: "elk.layered",
    nodes: resources.map((resource, index) => ({
      id: resource.id,
      x: positions.get(resource.id)?.x ?? (index % rowWidth) * (width + gapX),
      y: positions.get(resource.id)?.y ?? Math.floor(index / rowWidth) * (height + gapY),
      width,
      height,
    })),
  };
}

function maxParallelEdges(model) {
  const counts = new Map();
  for (const connection of model.connections) {
    const pair = [connection.from.resource, connection.to.resource].sort((a, b) => a.localeCompare(b, "en")).join("\u0000");
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

function validateFallbackLayout(model, document) {
  // Node overlap, finite/positive geometry, label fit and canvas invariants
  // remain enforced by the shared validator. Parallel source-declared links
  // are intentionally allowed to share endpoints because their individual IDs
  // are navigated separately under the edge budget.
  const diagnostics = validateVisualLayout(model, document, {
    maxCoincidentEdges: Math.max(2, maxParallelEdges(model)),
  });
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length) fail("SCALE_P4B1_LAYOUT_VALIDATION_FAILED", errors);
  return diagnostics;
}

function fallbackCauseDiagnostics(diagnostics) {
  return (diagnostics ?? []).map((diagnostic) => diagnostic.severity === "error"
    ? { ...diagnostic, severity: "warning", message: `ELK fallback trigger (not fallback geometry): ${diagnostic.message}` }
    : diagnostic);
}

function sourceSubset(model, page) {
  const pageInfo = buildTopologyFocusPage({ resources: model.resources, connections: model.connections }, page.rootId, page.page, page.maxNodes, page.maxEdges);
  const selected = new Set(pageInfo.nodeIds);
  const selectedEdges = new Set(pageInfo.edgeIds);
  const portsByResource = new Map(pageInfo.nodeIds.map((id) => [id, new Set()]));
  for (const connection of model.connections) {
    if (!selectedEdges.has(connection.id)) continue;
    if (connection.from.port) portsByResource.get(connection.from.resource)?.add(connection.from.port);
    if (connection.to.port) portsByResource.get(connection.to.resource)?.add(connection.to.port);
  }
  const resources = model.resources.filter((resource) => selected.has(resource.id)).map((resource) => ({
    ...resource,
    interfaces: resource.interfaces.filter((iface) => !portsByResource.get(resource.id)?.size || portsByResource.get(resource.id).has(iface.id)),
  }));
  const connections = model.connections.filter((connection) => selectedEdges.has(connection.id));
  return { pageInfo, bounded: { ...model, zones: [], resources, connections } };
}

async function buildRootFocus(model, rootId, pageNumber) {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) fail("SCALE_P4B1_SELECTION_BLOCKED");
  const pageProbe = buildTopologyFocusPage({ resources: model.resources, connections: model.connections }, rootId, 1, 100, MAX_EDGES);
  if (pageNumber > pageProbe.pageCount) fail("SCALE_P4B1_SELECTION_BLOCKED");
  const { pageInfo, bounded } = sourceSubset(model, { rootId, page: pageNumber, maxNodes: 100, maxEdges: MAX_EDGES });
  let layout;
  let layoutDiagnostics = [];
  let usedFallback = false;
  // A focused interaction must remain responsive even when the imported
  // source contains a high-degree switch. The bounded interactive projection
  // uses the deterministic topology-aware fallback; ELK remains available to
  // the source-row page path and is only used here for a degenerate no-edge
  // singleton where it cannot block the interaction.
  if (bounded.resources.length <= 1 && bounded.connections.length === 0) {
    try { layout = await runAutoLayout(bounded, new ElkLayoutBackend()); }
    catch (cause) { layout = { ok: false, diagnostics: [{ severity: "error", code: "LAYOUT_BACKEND_FAILED", message: cause instanceof Error ? cause.message : String(cause) }] }; }
  } else {
    layout = { ok: false, diagnostics: [{ severity: "warning", code: "LAYOUT_BACKEND_FAILED", message: "ELK is bounded out for high-degree interactive focus; topology-aware fallback preserves responsiveness and source identity." }] };
  }
  if (!layout?.ok || !layout.document || layout.document.scenarioId !== model.scenarioId) {
    usedFallback = true;
    layoutDiagnostics = fallbackCauseDiagnostics(layout?.diagnostics);
    const document = boundedDeterministicLayout(bounded, rootId);
    const visualDiagnostics = validateFallbackLayout(bounded, document);
    layout = {
      ok: true,
      document,
      diagnostics: [...layoutDiagnostics, ...visualDiagnostics, { severity: "warning", code: "SCALE_P4B1_LAYOUT_FALLBACK", message: "ELK validation rejected this bounded projection; deterministic topology-aware fallback retained all selected source nodes and links." }],
    };
    layoutDiagnostics = layout.diagnostics;
  }
  const focusCanvas = projectScenarioToCanvas(bounded, layout.document);
  if (focusCanvas.nodes.length !== pageInfo.nodeIds.length || focusCanvas.edges.length !== pageInfo.edgeIds.length ||
      focusCanvas.diagnostics?.some((diagnostic) => diagnostic.severity === "error") ||
      focusCanvas.nodes.some((node) => !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) || !(node.width > 0) || !(node.height > 0)) ||
      focusCanvas.edges.some((edge) => !pageInfo.edgeIds.includes(edge.id))) fail("SCALE_P4B1_PROJECTION_BLOCKED");
  return {
    page: pageInfo.page,
    pageCount: pageInfo.pageCount,
    rowFirst: 1,
    rowLast: NODES,
    canonicalNodes: NODES,
    canonicalLinks: LINKS,
    focusedNodes: focusCanvas.nodes.length,
    focusedEdges: focusCanvas.edges.length,
    hiddenOriginalLinks: LINKS - pageInfo.totalVisibleLinks,
    focusCanvas,
    contextNodeIds: Object.freeze(pageInfo.nodeIds.filter((id) => id !== rootId)),
    focusRoot: rootId,
    focusPage: Object.freeze(pageInfo),
    layoutStrategy: usedFallback ? "bounded-deterministic-topology" : "elk.layered",
    layoutDiagnostics: Object.freeze((layoutDiagnostics ?? []).map((diagnostic) => Object.freeze({ ...diagnostic }))),
    canActivate: false, engineVerified: false, physicalTopologyVerified: false,
  };
}

export async function buildScaledNetworkTenThousandFocus(model,sourceRowIds,page,options={}){
  const focusRequest = Boolean(options?.rootId);
  if(!Number.isSafeInteger(page)||page<1||(!focusRequest&&page>100))
    fail("SCALE_P4B1_SELECTION_BLOCKED");
  if(!model||typeof model!=="object"||!has(model.resources)||
     !has(model.connections)||!has(sourceRowIds)||
     model.resources.length!==NODES||model.connections.length!==LINKS||
     sourceRowIds.length!==NODES)
    fail("SCALE_P4B1_SOURCE_BLOCKED");

  const nodeById=new Map(),portsById=new Map(),ordinal=new Map();
  for(let i=0;i<NODES;i++){
    const row=model.resources[i],id=sourceRowIds[i];
    if(!row||!validId(row.id)||row.id!==id||nodeById.has(id)||
       !has(row.interfaces)||!validId(id))
      fail("SCALE_P4B1_SOURCE_BLOCKED");
    const ports=new Set();
    for(const port of row.interfaces){
      if(!port||!validId(port.id)||ports.has(port.id))
        fail("SCALE_P4B1_SOURCE_BLOCKED");
      ports.add(port.id);
    }
    nodeById.set(id,row);
    portsById.set(id,ports);
    ordinal.set(id,i);
  }
  const edges=new Set();
  for(const edge of model.connections){
    if(!edge||!validId(edge.id)||edges.has(edge.id)||
       !edge.from||!edge.to||
       !validId(edge.from.resource)||!validId(edge.to.resource)||
       !nodeById.has(edge.from.resource)||!nodeById.has(edge.to.resource)||
       edge.from.resource===edge.to.resource)
      fail("SCALE_P4B1_SOURCE_BLOCKED");
    edges.add(edge.id);
    for(const side of ["from","to"]){
      const p=edge[side].port;
      if(p!==undefined&&(!validId(p)||!portsById.get(edge[side].resource)?.has(p)))
        fail("SCALE_P4B1_SOURCE_BLOCKED");
    }
  }

  if (options?.rootId) return buildRootFocus(model, options.rootId, page);

  const first=(page-1)*ROW_SIZE,last=page*ROW_SIZE;
  const base=new Set(sourceRowIds.slice(first,last));
  if(base.size!==ROW_SIZE)fail("SCALE_P4B1_SOURCE_BLOCKED");
  // Only independently declared links create graph neighbors. Deterministic
  // sorted source row order, not geography, subnet heuristics or inference.
  const peerIds=new Set();
  for(const edge of model.connections){
    const a=base.has(edge.from.resource),b=base.has(edge.to.resource);
    if(a&&!b)peerIds.add(edge.to.resource);
    else if(b&&!a)peerIds.add(edge.from.resource);
  }
  const context=[...peerIds].sort((a,b)=>
    ordinal.get(a)-ordinal.get(b)).slice(0,MAX_PEERS);
  const shown=new Set([...base,...context]);
  if(shown.size>ROW_SIZE+MAX_PEERS)
    fail("SCALE_P4B1_SELECTION_BLOCKED");
  const visible=model.connections.filter(edge=>
    shown.has(edge.from.resource)&&shown.has(edge.to.resource)&&
    (base.has(edge.from.resource)||base.has(edge.to.resource)));
  if(visible.length>MAX_EDGES)
    fail("SCALE_P4B1_SELECTION_BLOCKED");
  const visibleIds=new Set(visible.map(x=>x.id));
  if(visibleIds.size!==visible.length)
    fail("SCALE_P4B1_SOURCE_BLOCKED");
  const requested=new Map([...shown].map(x=>[x,new Set()]));
  for(const edge of visible){
    if(edge.from.port!==undefined)requested.get(edge.from.resource).add(edge.from.port);
    if(edge.to.port!==undefined)requested.get(edge.to.resource).add(edge.to.port);
  }
  const resources=model.resources.filter(x=>shown.has(x.id)).map(x=>({
    ...x,interfaces:x.interfaces.filter(p=>requested.get(x.id).has(p.id))
  }));
  if(resources.length!==shown.size||
     resources.some(x=>x.interfaces.length!==requested.get(x.id).size))
    fail("SCALE_P4B1_SOURCE_BLOCKED");
  const bounded={...model,zones:[],resources,connections:visible};
  let layout;
  let layoutDiagnostics=[];
  let usedFallback=false;
  try{layout=await runAutoLayout(bounded,new ElkLayoutBackend());}
  catch(cause){layout={ok:false,diagnostics:[{severity:"error",code:"LAYOUT_BACKEND_FAILED",message:cause instanceof Error?cause.message:String(cause)}]};}
  if(!layout?.ok||!layout.document||layout.document.scenarioId!==model.scenarioId){
    usedFallback=true;
    layoutDiagnostics=fallbackCauseDiagnostics(layout?.diagnostics);
    const document = boundedDeterministicLayout(bounded);
    const visualDiagnostics = validateFallbackLayout(bounded, document);
    layout={ok:true,document,diagnostics:[...layoutDiagnostics,...visualDiagnostics,{severity:"warning",code:"SCALE_P4B1_LAYOUT_FALLBACK",message:"ELK validation rejected this bounded projection; deterministic topology-aware fallback retained all selected source nodes and links."}]};
    layoutDiagnostics = layout.diagnostics;
  }
  let canvas;
  try{canvas=projectScenarioToCanvas(bounded,layout.document);}
  catch{fail("SCALE_P4B1_PROJECTION_BLOCKED");}
  if(!has(canvas?.nodes)||!has(canvas?.edges)||
     canvas.nodes.length!==shown.size||canvas.edges.length!==visible.length||
     canvas.diagnostics?.some(d=>d.severity==="error")||
     new Set(canvas.nodes.map(n=>n.id)).size!==shown.size||
     new Set(canvas.edges.map(e=>e.id)).size!==visible.length||
     canvas.nodes.some(n=>!shown.has(n.id)||n.layoutStatus!=="resolved"||
       !Number.isFinite(n.position?.x)||!Number.isFinite(n.position?.y)||
       !(n.width>0)||!(n.height>0))||
     canvas.edges.some(e=>!visibleIds.has(e.id)))
    fail("SCALE_P4B1_PROJECTION_BLOCKED");
  return Object.freeze({
    page,pageCount:100,rowFirst:first+1,rowLast:last,
    canonicalNodes:NODES,canonicalLinks:LINKS,
    focusedNodes:canvas.nodes.length,focusedEdges:canvas.edges.length,
    hiddenOriginalLinks:LINKS-visible.length,
    focusCanvas:canvas,contextNodeIds:Object.freeze(context),
    layoutStrategy:usedFallback?"bounded-deterministic-topology":"elk.layered",
    layoutDiagnostics:Object.freeze(layoutDiagnostics.map(d=>Object.freeze({...d}))),
    canActivate:false,engineVerified:false,physicalTopologyVerified:false
  });
}
