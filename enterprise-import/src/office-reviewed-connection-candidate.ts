import type { ScenarioSource, Scenariosourceconnection } from "../../core-model/src/generated/contracts.js";
import { EnterpriseImportError } from "./types.js";
import { previewDocxTableStructure, type DocxTableCellLocator } from "./docx-tables-structural-preview.js";
import { previewOdtTableStructure, type OdtCellLocator } from "./odt-tables-structural-preview.js";
import { discloseReviewedDocxCell } from "./docx-cell-disclosure.js";
import { discloseReviewedOdtCell } from "./odt-cell-disclosure.js";
import {
  mapReviewedOfficeOriginalToNodes, OFFICE_REVIEWED_NODES_PROFILE,
  OFFICE_REVIEWED_NODES_MAX, type OfficeReviewedNodesDecision,
  type OfficeReviewedNodesCandidate, type OfficeOriginalLocator,
} from "./office-reviewed-node-candidate.js";

/** IC-040 P2 is an explicit, bounded ORIGINAL peer-cell selection, never
 * an inferred link based on IP, gateway, position or node role. */
export interface OfficeReviewedConnectionSelection {
  readonly fromNodeIndex: number;
  readonly peerCellOrdinal: number;
  readonly acknowledgePeerCell: boolean;
}
export interface OfficeReviewedConnectionsDecision extends OfficeReviewedNodesDecision {
  readonly connections: readonly OfficeReviewedConnectionSelection[];
  readonly acknowledgeModeledConnections: boolean;
}
export interface OfficeReviewedConnectionOrigin {
  readonly targetId: string;
  readonly fromNodeId: string;
  readonly peerNodeId: string;
  readonly fromLocator: OfficeOriginalLocator;
  readonly peerLocator: OfficeOriginalLocator;
  readonly decision: "USER_CONSENTED_ORIGINAL_PEER_CELL";
}
export interface OfficeReviewedConnectionsCandidate extends OfficeReviewedNodesCandidate {
  readonly selectedConnections: number;
  readonly connectionOrigins: readonly OfficeReviewedConnectionOrigin[];
}
const VALID_SHA=/^[0-9a-f]{64}$/;
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const whole=(x:unknown)=>Number.isSafeInteger(x)&&(x as number)>=0;
const exact=(x:unknown,keys:readonly string[])=>!!x&&typeof x==="object"&&!Array.isArray(x)&&
  Object.keys(x).sort().join(",")===[...keys].sort().join(",");
function blocked(sha:string,code:string):OfficeReviewedConnectionsCandidate {
  return {
    status:"BLOCKED",profileId:OFFICE_REVIEWED_NODES_PROFILE,sourceSha256:sha,
    origins:[],selectedResources:0,selectedConnections:0,connectionOrigins:[],
    canActivate:false,engineVerified:false,physicalTopologyVerified:false,
    diagnostics:[{code}],
  };
}
export async function mapReviewedOfficeOriginalToConnections(
  original:Uint8Array,decision:OfficeReviewedConnectionsDecision,
):Promise<OfficeReviewedConnectionsCandidate> {
  const sha=typeof decision?.sourceSha256==="string"&&VALID_SHA.test(decision.sourceSha256)
    ?decision.sourceSha256:"";
  if(!(original instanceof Uint8Array)||!exact(decision,[
    "format","sourceSha256","nodes","acknowledgeModeledResources",
    "connections","acknowledgeModeledConnections",
  ])||(decision.format!=="docx"&&decision.format!=="odt")||!sha||
     decision.acknowledgeModeledConnections!==true||
     !Array.isArray(decision.connections)||decision.connections.length<1||
     decision.connections.length>OFFICE_REVIEWED_NODES_MAX) {
    return blocked(sha,"IC040_P2_DECISION_INVALID");
  }
  for(const link of decision.connections){
    if(!exact(link,["fromNodeIndex","peerCellOrdinal","acknowledgePeerCell"])||
       !whole(link.fromNodeIndex)||!whole(link.peerCellOrdinal)||
       link.fromNodeIndex>=decision.nodes.length||link.peerCellOrdinal>=4||
       link.acknowledgePeerCell!==true){
      return blocked(sha,"IC040_P2_LINK_DECISION_INVALID");
    }
  }
  const nodeDecision:OfficeReviewedNodesDecision={
    format:decision.format,sourceSha256:sha,nodes:decision.nodes,
    acknowledgeModeledResources:decision.acknowledgeModeledResources,
  };
  try{
    const base=await mapReviewedOfficeOriginalToNodes(original,nodeDecision);
    if(base.status!=="READY_FOR_COMPILATION"||!base.source){
      return blocked(sha,base.diagnostics[0]?.code??"IC040_P2_NODE_BLOCKED");
    }
    const structural=decision.format==="docx"
      ?await previewDocxTableStructure(original):await previewOdtTableStructure(original);
    if(structural.sourceSha256!==sha)return blocked(sha,"IC040_P2_SOURCE_CHANGED");
    const known=new Set(base.source.resources.map(x=>x.id));
    const connections:Scenariosourceconnection[]=[];
    const origins:OfficeReviewedConnectionOrigin[]=[];
    const selectedCells=new Set<string>(),selectedPairs=new Set<string>();
    for(const [index,selection] of decision.connections.entries()){
      const node=decision.nodes[selection.fromNodeIndex]!;
      if(selection.peerCellOrdinal===node.nodeIdCellOrdinal){
        return blocked(sha,"IC040_P2_LINK_DECISION_INVALID");
      }
      const cellKey=[node.tableOrdinal,node.rowOrdinal,selection.peerCellOrdinal].join(":");
      if(selectedCells.has(cellKey))return blocked(sha,"IC040_P2_DUPLICATE_LINK_CELL");
      selectedCells.add(cellKey);
      const located=structural.tables[node.tableOrdinal]?.rows[node.rowOrdinal]?.cells[selection.peerCellOrdinal];
      if(!located)return blocked(sha,"IC040_P2_PEER_CELL_NOT_FOUND");
      // P3 disclosure revalidates original ZIP/hash, row+column header and each
      // exact selected peer cell. Unreviewed cells never enter the model.
      const revealed=decision.format==="docx"
        ?await discloseReviewedDocxCell(original,sha,located.locator as DocxTableCellLocator,true)
        :await discloseReviewedOdtCell(original,sha,located.locator as OdtCellLocator,true);
      const peer=revealed.text;
      const from=base.source.resources[selection.fromNodeIndex]!.id;
      if(revealed.sourceSha256!==sha||!ID.test(peer)||!known.has(peer)){
        return blocked(sha,"IC040_P2_LINK_ENDPOINT_UNKNOWN");
      }
      if(peer===from)return blocked(sha,"IC040_P2_SELF_CONNECTION");
      // P2 has no port identity. Reverse declarations of the same peer pair
      // are not evidence of two distinct physical cables; reject the second.
      const pair=[from,peer].sort().join("\u0000");
      if(selectedPairs.has(pair))return blocked(sha,"IC040_P2_DUPLICATE_CONNECTION");
      selectedPairs.add(pair);
      const id="office_link_"+(index+1);
      connections.push({id,kind:"network",from:{resource:from},to:{resource:peer},properties:{}});
      origins.push({
        targetId:id,fromNodeId:from,peerNodeId:peer,
        fromLocator:Object.freeze({...base.origins[selection.fromNodeIndex]!.locator}),
        peerLocator:Object.freeze({...revealed.locator}),
        decision:"USER_CONSENTED_ORIGINAL_PEER_CELL",
      });
    }
    const source:ScenarioSource={
      ...base.source,connections,
      notes:[...(base.source.notes??[]).map(note=>note.id==="office_source_boundary"
        ?{...note,text:"Source SHA-256: "+sha+"; "+base.selectedResources+
          " explicitly consented original node-ID cells, operator roles and "+
          connections.length+" distinct reviewed peer cells. Peer declarations are MODELED and not proven physical cabling or Engine reachability. No IP, port, route or network PASS was inferred."}
        :note)],
    };
    return {...base,source,selectedConnections:connections.length,
      connectionOrigins:Object.freeze(origins)};
  }catch(error){
    const code=error instanceof EnterpriseImportError&&
      /^(?:DOCX_|ODT_|IMPORT_|IC040_)[A-Z0-9_]+$/.test(error.code)
      ?error.code:"IC040_P2_SOURCE_BLOCKED";
    return blocked(sha,code);
  }
}
