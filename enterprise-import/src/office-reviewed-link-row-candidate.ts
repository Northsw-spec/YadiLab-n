import type {ScenarioSource, Scenariosourceconnection, Scenariosourceresource} from "../../core-model/src/generated/contracts.js";
import {EnterpriseImportError} from "./types.js";
import {previewDocxTableStructure, type DocxTableCellLocator} from "./docx-tables-structural-preview.js";
import {previewOdtTableStructure, type OdtCellLocator} from "./odt-tables-structural-preview.js";
import {discloseReviewedDocxCell} from "./docx-cell-disclosure.js";
import {discloseReviewedOdtCell} from "./odt-cell-disclosure.js";
import {
  mapReviewedOfficeOriginalToNodes, OFFICE_REVIEWED_NODES_PROFILE,
  OFFICE_REVIEWED_NODES_MAX, type OfficeReviewedNodesCandidate,
  type OfficeReviewedNodesDecision, type OfficeOriginalLocator,
} from "./office-reviewed-node-candidate.js";

/**
 * IC-040 P4: a separate original Links table has independent FROM and TO
 * endpoint cells in each selected row. Multiple rows may share one switch.
 * No link ever comes from a hostname pattern, IP, header or nearby row.
 */
export interface OfficeReviewedLinkRowSelection {
  readonly tableOrdinal: number;
  readonly rowOrdinal: number;
  readonly fromCellOrdinal: number;
  readonly toCellOrdinal: number;
  readonly sourcePortCellOrdinal: number | null;
  readonly targetPortCellOrdinal: number | null;
  readonly acknowledgeFromCell: boolean;
  readonly acknowledgeToCell: boolean;
  readonly acknowledgeSourcePortCell: boolean;
  readonly acknowledgeTargetPortCell: boolean;
}
export interface OfficeReviewedLinkRowsDecision extends OfficeReviewedNodesDecision {
  readonly linkRows: readonly OfficeReviewedLinkRowSelection[];
  readonly acknowledgeModeledLinkRows: boolean;
}
export interface OfficeReviewedLinkRowOrigin {
  readonly targetId: string;
  readonly fromNodeId: string;
  readonly peerNodeId: string;
  readonly fromLocator: OfficeOriginalLocator;
  readonly toLocator: OfficeOriginalLocator;
  readonly sourcePortLocator?: OfficeOriginalLocator;
  readonly targetPortLocator?: OfficeOriginalLocator;
  readonly decision: "USER_CONSENTED_ORIGINAL_SEPARATE_LINK_ROW";
}
export interface OfficeReviewedLinkRowsCandidate extends OfficeReviewedNodesCandidate {
  readonly selectedConnections: number;
  readonly connectionOrigins: readonly OfficeReviewedLinkRowOrigin[];
  readonly linkRowOrigins: readonly OfficeReviewedLinkRowOrigin[];
  readonly portOrigins: readonly {
    readonly targetLinkId: string;
    readonly sourcePortLocator: OfficeOriginalLocator;
    readonly peerPortLocator: OfficeOriginalLocator;
  }[];
}
const SHA = /^[0-9a-f]{64}$/;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const ordinal=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const exact=(v:unknown,keys:readonly string[]):boolean=>!!v&&typeof v==="object"&&
  !Array.isArray(v)&&Object.keys(v).sort().join(",")===[...keys].sort().join(",");
const decisionKeys=["format","sourceSha256","nodes","acknowledgeModeledResources",
  "linkRows","acknowledgeModeledLinkRows"];
const rowKeys=["tableOrdinal","rowOrdinal","fromCellOrdinal","toCellOrdinal",
  "sourcePortCellOrdinal","targetPortCellOrdinal","acknowledgeFromCell",
  "acknowledgeToCell","acknowledgeSourcePortCell","acknowledgeTargetPortCell"];
function blocked(sha:string,code:string):OfficeReviewedLinkRowsCandidate {
  return {
    status:"BLOCKED",profileId:OFFICE_REVIEWED_NODES_PROFILE,sourceSha256:sha,
    selectedResources:0,selectedConnections:0,origins:[],connectionOrigins:[],
    linkRowOrigins:[],portOrigins:[],canActivate:false,engineVerified:false,
    physicalTopologyVerified:false,diagnostics:[{code}],
  };
}
function cellKey(row:OfficeReviewedLinkRowSelection,col:number):string {
  return [row.tableOrdinal,row.rowOrdinal,col].join(":");
}
export async function mapReviewedOfficeOriginalToLinkRows(
  original:Uint8Array,decision:OfficeReviewedLinkRowsDecision,
  capacity?:{readonly maxNodes:6|8|10|12;readonly maxLinks:5|7|9|11;readonly allowParallelPorts?:true},
):Promise<OfficeReviewedLinkRowsCandidate> {
  const sha=typeof decision?.sourceSha256==="string"&&SHA.test(decision.sourceSha256)
    ?decision.sourceSha256:"";
  // Existing P5/P6 6/5, P7 parallel 6/5, P8 parallel 8/7 and P9
  // parallel 10/9 remain exact. Only P10 opts into 12/11 source-port rows.
  const parallel=capacity?.allowParallelPorts===true;
  const oldCap=capacity?.maxNodes===6&&capacity.maxLinks===5&&
    (parallel?exact(capacity,["maxNodes","maxLinks","allowParallelPorts"]):
      exact(capacity,["maxNodes","maxLinks"]));
  const expandedCap=capacity?.maxNodes===8&&capacity.maxLinks===7&&parallel&&
    exact(capacity,["maxNodes","maxLinks","allowParallelPorts"]);
  const tenCap=capacity?.maxNodes===10&&capacity.maxLinks===9&&parallel&&
    exact(capacity,["maxNodes","maxLinks","allowParallelPorts"]);
  const twelveCap=capacity?.maxNodes===12&&capacity.maxLinks===11&&parallel&&
    exact(capacity,["maxNodes","maxLinks","allowParallelPorts"]);
  if(capacity!==undefined&&!oldCap&&!expandedCap&&!tenCap&&!twelveCap)
    return blocked(sha,"IC040_P5_CAPACITY_DECISION_INVALID");
  const linkLimit=capacity?.maxLinks??OFFICE_REVIEWED_NODES_MAX;
  if(!(original instanceof Uint8Array)||!exact(decision,decisionKeys)||
    (decision.format!=="docx"&&decision.format!=="odt")||!sha||
    !Array.isArray(decision.nodes)||!Array.isArray(decision.linkRows)||
    decision.linkRows.length<1||decision.linkRows.length>linkLimit||
    decision.acknowledgeModeledResources!==true||
    decision.acknowledgeModeledLinkRows!==true)
    return blocked(sha,"IC040_P4_DECISION_INVALID");
  const selectedRows=new Set<string>();
  const nodeTables=new Set(decision.nodes.map(n=>n.tableOrdinal));
  for(const row of decision.linkRows){
    if(!exact(row,rowKeys)||!ordinal(row.tableOrdinal)||row.tableOrdinal>=4||
      !ordinal(row.rowOrdinal)||row.rowOrdinal===0||row.rowOrdinal>20||
      !ordinal(row.fromCellOrdinal)||row.fromCellOrdinal>=4||
      !ordinal(row.toCellOrdinal)||row.toCellOrdinal>=4||
      row.fromCellOrdinal===row.toCellOrdinal||
      row.acknowledgeFromCell!==true||row.acknowledgeToCell!==true)
      return blocked(sha,"IC040_P4_LINK_DECISION_INVALID");
    if(nodeTables.has(row.tableOrdinal))
      return blocked(sha,"IC040_P4_NOT_SEPARATE_LINK_TABLE");
    const key=[row.tableOrdinal,row.rowOrdinal].join(":");
    if(selectedRows.has(key))return blocked(sha,"IC040_P4_DUPLICATE_ROW");
    selectedRows.add(key);
    const portsPresent=row.sourcePortCellOrdinal!==null||row.targetPortCellOrdinal!==null;
    if(portsPresent){
      if(!ordinal(row.sourcePortCellOrdinal)||row.sourcePortCellOrdinal>=4||
        !ordinal(row.targetPortCellOrdinal)||row.targetPortCellOrdinal>=4||
        row.acknowledgeSourcePortCell!==true||row.acknowledgeTargetPortCell!==true||
        new Set([row.fromCellOrdinal,row.toCellOrdinal,
          row.sourcePortCellOrdinal,row.targetPortCellOrdinal]).size!==4)
        return blocked(sha,"IC040_P4_LINK_DECISION_INVALID");
    }else if(row.acknowledgeSourcePortCell!==false||
      row.acknowledgeTargetPortCell!==false)
      return blocked(sha,"IC040_P4_LINK_DECISION_INVALID");
  }
  const nodeDecision:OfficeReviewedNodesDecision={
    format:decision.format,sourceSha256:sha,nodes:decision.nodes,
    acknowledgeModeledResources:decision.acknowledgeModeledResources,
  };
  try {
    const base=await mapReviewedOfficeOriginalToNodes(original,nodeDecision,
      capacity?.maxNodes??OFFICE_REVIEWED_NODES_MAX);
    if(base.status!=="READY_FOR_COMPILATION"||!base.source)
      return blocked(sha,base.diagnostics[0]?.code??"IC040_P4_NODE_BLOCKED");
    const structure=decision.format==="docx"
      ?await previewDocxTableStructure(original):await previewOdtTableStructure(original);
    if(structure.sourceSha256!==sha)return blocked(sha,"IC040_P4_SOURCE_CHANGED");
    const known=new Set(base.source.resources.map(resource=>resource.id));
    const perResource=new Map<string,Set<string>>();
    const seenPairs=new Set<string>();
    const seenOriginalPortPairs=new Set<string>();
    const origins:OfficeReviewedLinkRowOrigin[]=[];
    const ports:OfficeReviewedLinkRowsCandidate["portOrigins"][number][]=[];
    const connections:Scenariosourceconnection[]=[];
    const usedCells=new Set<string>();
    for(const [index,row] of decision.linkRows.entries()){
      const structuralRow=structure.tables[row.tableOrdinal]?.rows[row.rowOrdinal];
      if(!structuralRow)return blocked(sha,"IC040_P4_LINK_ROW_NOT_FOUND");
      const reveal=async (col:number)=>{
        const found=structuralRow.cells[col];
        if(!found)throw new EnterpriseImportError("IC040_P4_CELL_NOT_FOUND","IC040_P4_CELL_NOT_FOUND");
        const k=cellKey(row,col);
        if(usedCells.has(k))
          throw new EnterpriseImportError("IC040_P4_DUPLICATE_CELL","IC040_P4_DUPLICATE_CELL");
        usedCells.add(k);
        return decision.format==="docx"
          ?discloseReviewedDocxCell(original,sha,found.locator as DocxTableCellLocator,true)
          :discloseReviewedOdtCell(original,sha,found.locator as OdtCellLocator,true);
      };
      const fromCell=await reveal(row.fromCellOrdinal);
      const toCell=await reveal(row.toCellOrdinal);
      const from=fromCell.text,to=toCell.text;
      if(!ID.test(from)||!ID.test(to)||!known.has(from)||!known.has(to))
        return blocked(sha,"IC040_P4_LINK_ENDPOINT_UNKNOWN");
      if(from===to)return blocked(sha,"IC040_P4_SELF_CONNECTION");
      const pair=[from,to].sort().join("\u0000");
      if(seenPairs.has(pair)&&!parallel)
        return blocked(sha,"IC040_P4_DUPLICATE_ENDPOINT_PAIR");
      // P7 may have multiple rows for one *device* pair only when all
      // source+target port cells are separately consented and non-reused.
      if(seenPairs.has(pair)&&parallel&&
        (row.sourcePortCellOrdinal===null||row.targetPortCellOrdinal===null))
        return blocked(sha,"IC040_P7_PARALLEL_PORTS_REQUIRED");
      seenPairs.add(pair);
      let sourcePort:string|undefined,targetPort:string|undefined;
      let sourcePortLocator:OfficeOriginalLocator|undefined;
      let targetPortLocator:OfficeOriginalLocator|undefined;
      if(row.sourcePortCellOrdinal!==null&&row.targetPortCellOrdinal!==null){
        const a=await reveal(row.sourcePortCellOrdinal);
        const b=await reveal(row.targetPortCellOrdinal);
        sourcePort=a.text;targetPort=b.text;
        sourcePortLocator=a.locator;targetPortLocator=b.locator;
        if(!ID.test(sourcePort)||!ID.test(targetPort))
          return blocked(sha,"IC040_P4_PORT_INVALID");
        if(parallel){
          // Order-independent physical-port identity: reversing FROM/TO does
          // not make the same two original endpoint ports a new cable.
          const distinctPortPair=[[from,sourcePort],[to,targetPort]]
            .map(([resource,port])=>resource+"\u0000"+port).sort().join("\u0001");
          if(seenOriginalPortPairs.has(distinctPortPair))
            return blocked(sha,"IC040_P7_DUPLICATE_PORT_PAIR");
          seenOriginalPortPairs.add(distinctPortPair);
        }
        for(const [id,port] of [[from,sourcePort],[to,targetPort]] as const){
          const ids=perResource.get(id)??new Set<string>();
          if(ids.has(port))return blocked(sha,"IC040_P4_PORT_REUSED");
          ids.add(port);perResource.set(id,ids);
        }
      }
      const id="office_link_row_"+(index+1);
      connections.push({
        id,kind:"network",
        from:{resource:from,...(sourcePort?{port:sourcePort}:{})},
        to:{resource:to,...(targetPort?{port:targetPort}:{})},
        properties:{},
      });
      origins.push({
        targetId:id,fromNodeId:from,peerNodeId:to,
        fromLocator:Object.freeze({...fromCell.locator}),
        toLocator:Object.freeze({...toCell.locator}),
        ...(sourcePortLocator&&targetPortLocator?{
          sourcePortLocator:Object.freeze({...sourcePortLocator}),
          targetPortLocator:Object.freeze({...targetPortLocator})}:{}),
        decision:"USER_CONSENTED_ORIGINAL_SEPARATE_LINK_ROW",
      });
      if(sourcePortLocator&&targetPortLocator)
        ports.push({targetLinkId:id,sourcePortLocator,peerPortLocator:targetPortLocator});
    }
    const resources:Scenariosourceresource[]=base.source.resources.map(resource=>({
      ...resource,
      ...(perResource.has(resource.id)?{
        interfaces:[...(resource.interfaces??[]),...[...perResource.get(resource.id)!]
          .sort().map(id=>({id}))]}:{}),
    }));
    const source:ScenarioSource={
      ...base.source,resources,connections,
      notes:(base.source.notes??[]).map(note=>note.id==="office_source_boundary"
        ?{...note,text:"Source SHA-256: "+sha+"; "+base.selectedResources+
          " individually selected node IDs and "+connections.length+
          " independently reviewed two-endpoint original Links-table rows. "+
          "Ports (if present) were separately consented original cells. "+
          "These are MODELED references; no physical cabling, external device, "+
          "Engine reachability or Runtime PASS has been verified."}
        :note),
    };
    return {...base,status:"READY_FOR_COMPILATION",source,
      selectedConnections:connections.length,
      connectionOrigins:Object.freeze(origins),
      linkRowOrigins:Object.freeze(origins),
      portOrigins:Object.freeze(ports)};
  }catch(error){
    const code=error instanceof EnterpriseImportError&&
      /^(?:DOCX_|ODT_|IMPORT_|IC040_)[A-Z0-9_]+$/.test(error.code)
      ?error.code:"IC040_P4_SOURCE_BLOCKED";
    return blocked(sha,code);
  }
}
