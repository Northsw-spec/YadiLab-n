import type { LayoutDocument, NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import type { LayoutDiagnostic } from "./types.js";
import { ZONE_HEADER_RESERVED_HEIGHT } from "./geometry-policy.js";

export interface VisualCanvasBounds {
  readonly width: number;
  readonly height: number;
}
export interface VisualValidationOptions {
  readonly canvas?: VisualCanvasBounds;
  readonly overlapTolerance?: number;
  readonly whitespaceAreaRatio?: number;
  readonly maxCoincidentEdges?: number;
}

interface Rect { readonly id:string; readonly x:number; readonly y:number; readonly width:number; readonly height:number; readonly parent?:string; }
const DEFAULT_OVERLAP_TOLERANCE = 1;
const DEFAULT_WHITESPACE_AREA_RATIO = 8;
const DEFAULT_MAX_COINCIDENT_EDGES = 2;

function intersects(a: Rect, b: Rect, tolerance: number): boolean {
  const w=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
  const h=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
  return w>tolerance && h>tolerance;
}
function labelCapacity(width:number,height:number,kind:"zone"|"resource"): number {
  const usable=Math.max(0,width-24);
  const charsPerLine=Math.max(1,Math.floor(usable/7));
  const lines=kind==="zone"?1:Math.max(1,Math.min(2,Math.floor(Math.max(0,height-24)/18)));
  return charsPerLine*lines;
}
function absoluteRect(id:string, byId:ReadonlyMap<string,Rect>, stack=new Set<string>()):Rect|undefined {
  const node=byId.get(id); if(!node)return undefined;
  if(!node.parent)return node;
  if(stack.has(id))return undefined;
  stack.add(id);
  const parent=absoluteRect(node.parent,byId,stack); stack.delete(id);
  if(!parent)return undefined;
  return {...node,x:parent.x+node.x,y:parent.y+node.y};
}

export function validateVisualLayout(
  scenario: NormalizedScenario,
  layout: LayoutDocument,
  options: VisualValidationOptions = {},
): readonly LayoutDiagnostic[] {
  const diagnostics:LayoutDiagnostic[]=[];
  if(layout.scenarioId!==scenario.scenarioId) {
    return [{severity:"error",code:"LAYOUT_VISUAL_SCENARIO_MISMATCH",message:`Layout scenario '${layout.scenarioId}' does not match '${scenario.scenarioId}'.`}];
  }
  const tolerance=options.overlapTolerance??DEFAULT_OVERLAP_TOLERANCE;
  const whitespaceRatio=options.whitespaceAreaRatio??DEFAULT_WHITESPACE_AREA_RATIO;
  const maxCoincident=options.maxCoincidentEdges??DEFAULT_MAX_COINCIDENT_EDGES;
  const byId=new Map<string,Rect>(layout.nodes.map(n=>[n.id,n]));
  const zones=new Map(scenario.zones.map(z=>[z.id,z]));
  const resources=new Map(scenario.resources.map(r=>[r.id,r]));
  const semanticIds=new Set([...zones.keys(),...resources.keys()]);

  // Sibling overlap: layout coordinates are parent-relative, so only compare nodes in the same space.
  const siblings=new Map<string,Rect[]>();
  for(const node of layout.nodes){
    if(!semanticIds.has(node.id))continue;
    const key=node.parent??"__root__"; const list=siblings.get(key)??[]; list.push(node); siblings.set(key,list);
  }
  for(const [parent,list] of siblings){
    const ordered=[...list].sort((a,b)=>a.id.localeCompare(b.id));
    for(let i=0;i<ordered.length;i++) for(let j=i+1;j<ordered.length;j++) {
      const a=ordered[i]!,b=ordered[j]!;
      if(intersects(a,b,tolerance)) diagnostics.push({severity:"error",code:"LAYOUT_NODE_OVERLAP",objectId:a.id,message:`Sibling nodes '${a.id}' and '${b.id}' overlap in '${parent}'.`});
    }
    if(ordered.length>=2){
      const minX=Math.min(...ordered.map(n=>n.x)),minY=Math.min(...ordered.map(n=>n.y));
      const maxX=Math.max(...ordered.map(n=>n.x+n.width)),maxY=Math.max(...ordered.map(n=>n.y+n.height));
      const bbox=Math.max(1,(maxX-minX)*(maxY-minY));
      const occupied=ordered.reduce((sum,n)=>sum+n.width*n.height,0);
      if(bbox/Math.max(1,occupied)>whitespaceRatio) diagnostics.push({severity:"error",code:"LAYOUT_UNREASONABLE_WHITESPACE",...(parent!=="__root__"?{objectId:parent}:{}),message:`Sibling layout in '${parent}' has excessive whitespace (area ratio ${(bbox/Math.max(1,occupied)).toFixed(2)} > ${whitespaceRatio}).`});
    }
  }

  // Parent containment / zone overflow.
  const overflowed=new Set<string>();
  for(const node of layout.nodes){
    if(!node.parent)continue;
    const parent=byId.get(node.parent); if(!parent || !zones.has(node.parent))continue;
    const outside=node.x<0||node.y<0||node.x+node.width>parent.width||node.y+node.height>parent.height;
    if(outside){
      diagnostics.push({severity:"error",code:"LAYOUT_NODE_OUTSIDE_ZONE",objectId:node.id,message:`Node '${node.id}' extends outside parent zone '${node.parent}'.`});
      overflowed.add(node.parent);
    }
    if(node.y<ZONE_HEADER_RESERVED_HEIGHT){
      diagnostics.push({severity:"error",code:"LAYOUT_ZONE_HEADER_OVERLAP",objectId:node.id,message:`Node '${node.id}' intrudes into the reserved ${ZONE_HEADER_RESERVED_HEIGHT}px header area of zone '${node.parent}'.`});
    }
  }
  for(const zoneId of [...overflowed].sort()) diagnostics.push({severity:"error",code:"LAYOUT_ZONE_OVERFLOW",objectId:zoneId,message:`Zone '${zoneId}' does not contain all child geometry.`});

  // Root canvas bounds. Without explicit bounds, the canonical canvas still has a non-negative origin.
  for(const node of layout.nodes.filter(n=>!n.parent)){
    const negative=node.x<0||node.y<0;
    const outsideExplicit=options.canvas!==undefined && (node.x+node.width>options.canvas.width||node.y+node.height>options.canvas.height);
    if(negative||outsideExplicit) diagnostics.push({severity:"error",code:"LAYOUT_NODE_OUTSIDE_CANVAS",objectId:node.id,message:`Root node '${node.id}' lies outside the validated canvas bounds.`});
  }

  // Conservative deterministic label-fit validation.
  for(const node of layout.nodes){
    const zone=zones.get(node.id),resource=resources.get(node.id); const label=zone?.label??resource?.label; if(!label)continue;
    const kind=zone?"zone" as const:"resource" as const;
    const length=[...label].length;
    if(length>labelCapacity(node.width,node.height,kind)) diagnostics.push({severity:"error",code:"LAYOUT_LABEL_UNREADABLE",objectId:node.id,message:`Label for '${node.id}' cannot fit the validated node geometry without clipping/wrapping beyond policy.`});
  }

  // Coincident semantic edges (same visual endpoints) are indistinguishable without routing offsets.
  const routeGroups=new Map<string,string[]>();
  for(const edge of scenario.connections){
    const a=absoluteRect(edge.from.resource,byId),b=absoluteRect(edge.to.resource,byId); if(!a||!b)continue;
    const ax=a.x+a.width/2, ay=a.y+a.height/2, bx=b.x+b.width/2, by=b.y+b.height/2;
    const p1=`${ax.toFixed(3)},${ay.toFixed(3)}`,p2=`${bx.toFixed(3)},${by.toFixed(3)}`;
    const key=p1<p2?`${p1}|${p2}`:`${p2}|${p1}`; const ids=routeGroups.get(key)??[];ids.push(edge.id);routeGroups.set(key,ids);
  }
  for(const ids of routeGroups.values()) if(ids.length>maxCoincident) { const sorted=ids.slice().sort(); const first=sorted[0]!; diagnostics.push({severity:"error",code:"LAYOUT_EDGE_OVERLAP_EXCESSIVE",objectId:first,message:`${ids.length} semantic connections share the same straight-line visual route (${sorted.join(", ")}).`}); }

  return diagnostics;
}
