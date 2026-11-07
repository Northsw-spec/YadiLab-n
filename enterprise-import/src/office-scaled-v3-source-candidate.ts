import type {ScenarioSource} from "../../core-model/src/generated/contracts.js";
import {EnterpriseImportError, type ImportDocument, type ImportRecord} from "./types.js";
import {webCryptoImportHashProvider} from "./hash.js";
import {
  revealReviewedOfficeBatchesV3,OFFICE_SCALED_BATCH_PROFILE_V3,
  type OfficeScaledBatchDecisionV3,type OfficeScaledBatchDisclosureV3,
  type OfficeScaledCellLocator,type OfficeScaledDisclosedRow,
  type OfficeScaledBatchFormat,
} from "./office-large-batch-review.js";
import {GRAPHML_MANUAL_ROLE_OPTIONS} from "./graphml-review-mapping.js";
import {mapNetworkWorkbookToScenario} from "./workbook-mapping.js";

/**
 * P4c2b: independent 10k original source-only topology candidate.
 * Never extend v1/v2 Office topology profile limits or mutate a Builder.
 * The v3 batch disclosure internally checks the actual original ZIP,
 * every selected column, privacy policy and the v3-only XML parser cap.
 */
export const OFFICE_SCALED_TOPOLOGY_PROFILE_V3 =
  "office.scaled-reviewed-topology.v3" as const;

export interface OfficeScaledTopologyDecisionV3 {
  readonly capacityProfile:typeof OFFICE_SCALED_TOPOLOGY_PROFILE_V3;
  readonly format:OfficeScaledBatchFormat;
  readonly sourceSha256:string;
  readonly nodeBatches:readonly OfficeScaledBatchDecisionV3[];
  readonly linkBatches:readonly OfficeScaledBatchDecisionV3[];
  readonly acknowledgeModeledResources:true;
  readonly acknowledgeModeledConnections:true;
}
export interface OfficeScaledTopologyCandidateV3 {
  readonly status:"READY_FOR_COMPILATION";
  readonly profileId:typeof OFFICE_SCALED_TOPOLOGY_PROFILE_V3;
  readonly sourceSha256:string;
  readonly source:ScenarioSource;
  readonly origins:Readonly<{
    nodes:readonly Readonly<{
      nodeId:string;idLocator:OfficeScaledCellLocator;
      roleLocator:OfficeScaledCellLocator;
    }>[];
    links:readonly Readonly<{
      linkId:string;fromLocator:OfficeScaledCellLocator;
      toLocator:OfficeScaledCellLocator;
      sourcePortLocator:OfficeScaledCellLocator;
      targetPortLocator:OfficeScaledCellLocator;
    }>[];
  }>;
  readonly canActivate:false;
  readonly engineVerified:false;
  readonly physicalTopologyVerified:false;
}
type BlockCode =
  |"SCALE_P1B2_SELECTION_INVALID"
  |"SCALE_P1B2_CONSENT_REQUIRED"
  |"SCALE_P1B2_BATCH_COVERAGE_INVALID"
  |"SCALE_P1B2_SOURCE_CHANGED"
  |"SCALE_P1B2_SOURCE_BLOCKED"
  |"SCALE_P1B2_DUPLICATE_NODE_ID"
  |"SCALE_P1B2_LINK_ENDPOINT_UNKNOWN"
  |"SCALE_P1B2_PORT_REUSED"
  |"SCALE_P1B2_ROLE_UNSUPPORTED";
function block(code:BlockCode):never{
  // Stable, source-text-free diagnostics for both success and deny paths.
  throw new EnterpriseImportError(code,code);
}
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const TOP_KEYS=["capacityProfile","format","sourceSha256",
  "nodeBatches","linkBatches","acknowledgeModeledResources",
  "acknowledgeModeledConnections"];
const BATCH_KEYS=["format","sourceSha256","capacityProfile",
  "tableOrdinal","rowStart","rowEnd","columns",
  "acknowledgeSelectedRange","acknowledgeDisclosure"];
const COLUMN_KEYS=["cellOrdinal","acknowledge"];
const exact=(o:unknown,keys:readonly string[]):boolean=>
  !!o&&typeof o==="object"&&!Array.isArray(o)&&
  Object.keys(o).sort().join(",")===[...keys].sort().join(",");

/** Each canonical 10k candidate must cover EVERY original data row with
 * exactly 100 independently reviewed 100-row source selections per table.
 * This is checked before opening an original ZIP or allocating 10k results.
 */
function plan(
  grants:readonly OfficeScaledBatchDecisionV3[]|undefined,
  format:OfficeScaledBatchFormat,sha:string,tableOrdinal:number,
  columns:readonly number[],
):void{
  if(!Array.isArray(grants)||grants.length!==100)
    block("SCALE_P1B2_BATCH_COVERAGE_INVALID");
  for(let i=0;i<100;i++){
    const grant:OfficeScaledBatchDecisionV3=grants[i]!;
    if(!exact(grant,BATCH_KEYS)||
       grant?.format!==format||
       grant.sourceSha256!==sha||
       grant.capacityProfile!==OFFICE_SCALED_BATCH_PROFILE_V3||
       grant.tableOrdinal!==tableOrdinal)
      block("SCALE_P1B2_SELECTION_INVALID");
    if(grant.acknowledgeSelectedRange!==true||
       grant.acknowledgeDisclosure!==true||
       grant.columns?.some(col=>col?.acknowledge!==true))
      block("SCALE_P1B2_CONSENT_REQUIRED");
    if(grant.rowStart!==i*100+1||
       grant.rowEnd!==(i+1)*100)
      block("SCALE_P1B2_BATCH_COVERAGE_INVALID");
    if(!Array.isArray(grant.columns)||grant.columns.length!==columns.length||
       grant.columns.some((col,j)=>!exact(col,COLUMN_KEYS)||
         col.cellOrdinal!==columns[j]||col.acknowledge!==true))
      block("SCALE_P1B2_SELECTION_INVALID");
  }
}
function rowRecord(table:string,index:number,fields:Record<string,string>):ImportRecord{
  return Object.freeze({
    recordIndex:index,
    fields:Object.freeze(Object.fromEntries(
      Object.entries(fields).map(([name,value])=>[
        name,Object.freeze({value,locator:Object.freeze({
          kind:"record-row" as const,table,row:index
        })})
      ])
    ))
  });
}
function text(row:OfficeScaledDisclosedRow,i:number):string{
  const value=row.cells[i]?.text;
  if(typeof value!=="string")block("SCALE_P1B2_SOURCE_BLOCKED");
  return value;
}
function locate(row:OfficeScaledDisclosedRow,i:number):OfficeScaledCellLocator{
  const o=row.cells[i]?.locator;
  if(!o)block("SCALE_P1B2_SOURCE_BLOCKED");
  return o;
}
/** Verify every *returned* disclosure, not just the corresponding input
 * grant. No forged/shifted/wrong SHA locator may form a canonical resource.
 */
function validatedRows(
  groups:readonly OfficeScaledBatchDisclosureV3[],
  grants:readonly OfficeScaledBatchDecisionV3[],
  originalSha:string,
):readonly OfficeScaledDisclosedRow[]{
  if(groups.length!==grants.length)
    block("SCALE_P1B2_SOURCE_BLOCKED");
  const selected:OfficeScaledDisclosedRow[]=[];
  for(let i=0;i<grants.length;i++){
    const grant=grants[i]!,output=groups[i]!;
    if(!output||
       output.status!=="REVEALED_UNVERIFIED"||
       output.capacityProfile!==OFFICE_SCALED_BATCH_PROFILE_V3||
       output.sourceSha256!==originalSha||
       output.tableOrdinal!==grant.tableOrdinal||
       output.canActivate!==false||
       output.engineVerified!==false||
       output.physicalTopologyVerified!==false||
       output.rows.length!==100)
      block("SCALE_P1B2_SOURCE_BLOCKED");
    for(let r=0;r<100;r++){
      const sourceRow=output.rows[r],ordinal=grant.rowStart+r;
      if(!sourceRow||sourceRow.rowOrdinal!==ordinal||
         sourceRow.cells.length!==grant.columns.length)
        block("SCALE_P1B2_SOURCE_BLOCKED");
      for(let c=0;c<grant.columns.length;c++){
        const cell=sourceRow.cells[c];
        if(!cell||!cell.locator||
           cell.locator.sourceSha256!==originalSha||
           cell.locator.tableOrdinal!==grant.tableOrdinal||
           cell.locator.rowOrdinal!==ordinal||
           cell.locator.cellOrdinal!==grant.columns[c]?.cellOrdinal)
          block("SCALE_P1B2_SOURCE_BLOCKED");
      }
      selected.push(sourceRow);
    }
  }
  if(selected.length!==10000)block("SCALE_P1B2_BATCH_COVERAGE_INVALID");
  return selected;
}

/** All-or-nothing modelled source candidate. No GUI or Builder mutation. */
export async function mapReviewedOfficeBatchesV3ToSource(
  original:Uint8Array,decision:OfficeScaledTopologyDecisionV3,
):Promise<OfficeScaledTopologyCandidateV3>{
  if(!exact(decision,TOP_KEYS))block("SCALE_P1B2_SELECTION_INVALID");
  if(decision.acknowledgeModeledResources!==true||
     decision.acknowledgeModeledConnections!==true)
    block("SCALE_P1B2_CONSENT_REQUIRED");
  if(decision.capacityProfile!==OFFICE_SCALED_TOPOLOGY_PROFILE_V3||
     (decision.format!=="docx"&&decision.format!=="odt")||
     typeof decision.sourceSha256!=="string"||
     !SHA.test(decision.sourceSha256)||
     !(original instanceof Uint8Array)||
     original.byteLength<4||original.byteLength>16*1024*1024)
    block("SCALE_P1B2_SELECTION_INVALID");
  // Compare the actual original ZIP SHA BEFORE validating row-plan source
  // identity. A changed original must report SOURCE_CHANGED rather than
  // presenting a misleading batch-selection error. No values are disclosed.
  const bytes=Uint8Array.from(original);
  const hash=await webCryptoImportHashProvider.sha256Bytes(bytes);
  if(hash!==decision.sourceSha256)block("SCALE_P1B2_SOURCE_CHANGED");
  plan(decision.nodeBatches,decision.format,decision.sourceSha256,0,[0,1]);
  plan(decision.linkBatches,decision.format,decision.sourceSha256,1,[0,1,2,3]);

  // ONE P4c2a v3 disclosure invocation for all 200 approved groups.
  // That function does exactly one original structural validation + one
  // additional v3-bounded XML parse, not one ZIP parse per original row.
  let disclosures:readonly OfficeScaledBatchDisclosureV3[];
  try{
    disclosures=await revealReviewedOfficeBatchesV3(bytes,[
      ...decision.nodeBatches,...decision.linkBatches
    ]);
  }catch{block("SCALE_P1B2_SOURCE_BLOCKED");}
  if(disclosures.length!==200)block("SCALE_P1B2_SOURCE_BLOCKED");
  const nodes=validatedRows(disclosures.slice(0,100),decision.nodeBatches,hash);
  const links=validatedRows(disclosures.slice(100),decision.linkBatches,hash);

  const nodeRecords:ImportRecord[]=[];
  const linkRecords:ImportRecord[]=[];
  const interfaceRecords:ImportRecord[]=[];
  const nodeOrigins:OfficeScaledTopologyCandidateV3["origins"]["nodes"][number][]=[];
  const linkOrigins:OfficeScaledTopologyCandidateV3["origins"]["links"][number][]=[];
  const declared=new Set<string>();
  for(const row of nodes){
    const id=text(row,0),role=text(row,1);
    if(!ID.test(id))block("SCALE_P1B2_SELECTION_INVALID");
    if(declared.has(id))block("SCALE_P1B2_DUPLICATE_NODE_ID");
    if(!GRAPHML_MANUAL_ROLE_OPTIONS.some(allowed=>allowed===role))
      block("SCALE_P1B2_ROLE_UNSUPPORTED");
    declared.add(id);
    nodeRecords.push(rowRecord("Nodes",row.rowOrdinal,{
      nodeId:id,displayName:id,type:role
    }));
    nodeOrigins.push(Object.freeze({
      nodeId:id,idLocator:locate(row,0),roleLocator:locate(row,1)
    }));
  }
  if(declared.size!==10000)block("SCALE_P1B2_BATCH_COVERAGE_INVALID");
  const usedPorts=new Set<string>();
  let interfaceRow=0;
  for(const row of links){
    const from=text(row,0),to=text(row,1),
      fromPort=text(row,2),toPort=text(row,3);
    if(!declared.has(from)||!declared.has(to))
      block("SCALE_P1B2_LINK_ENDPOINT_UNKNOWN");
    if(from===to||!ID.test(fromPort)||!ID.test(toPort))
      block("SCALE_P1B2_SELECTION_INVALID");
    const a=JSON.stringify([from,fromPort]),b=JSON.stringify([to,toPort]);
    if(a===b||usedPorts.has(a)||usedPorts.has(b))
      block("SCALE_P1B2_PORT_REUSED");
    usedPorts.add(a);usedPorts.add(b);
    interfaceRecords.push(rowRecord("Interfaces",++interfaceRow,{
      nodeId:from,interfaceId:fromPort,name:fromPort
    }));
    interfaceRecords.push(rowRecord("Interfaces",++interfaceRow,{
      nodeId:to,interfaceId:toPort,name:toPort
    }));
    const linkId="office_link_t1_r"+row.rowOrdinal;
    linkRecords.push(rowRecord("Links",row.rowOrdinal,{
      linkId,nodeA:from,nodeB:to,interfaceA:fromPort,
      interfaceB:toPort,kind:"network"
    }));
    linkOrigins.push(Object.freeze({
      linkId,fromLocator:locate(row,0),toLocator:locate(row,1),
      sourcePortLocator:locate(row,2),targetPortLocator:locate(row,3)
    }));
  }
  if(linkRecords.length!==10000||linkOrigins.length!==10000||
     interfaceRecords.length!==20000)
    block("SCALE_P1B2_BATCH_COVERAGE_INVALID");

  const document:ImportDocument={tables:[
    {tableId:"Metadata",records:[rowRecord("Metadata",1,{
      scenarioId:"reviewed_office_scaled_10000",
      title:"Reviewed Office 10000 source topology (unverified)"
    })]},
    {tableId:"Nodes",records:nodeRecords},
    {tableId:"Interfaces",records:interfaceRecords},
    {tableId:"Links",records:linkRecords},
  ]};
  // Actual shared canonical mapping, not invented networking facts.
  const result=mapNetworkWorkbookToScenario(document);
  if(!result.ok||!result.source||
     result.diagnostics.some(d=>d.severity==="error"))
    block("SCALE_P1B2_SOURCE_BLOCKED");
  if(result.source.resources.length!==10000||
     result.source.connections.length!==10000)
    block("SCALE_P1B2_SOURCE_BLOCKED");
  return Object.freeze({
    status:"READY_FOR_COMPILATION",
    profileId:OFFICE_SCALED_TOPOLOGY_PROFILE_V3,
    sourceSha256:hash,source:result.source,
    origins:Object.freeze({
      nodes:Object.freeze(nodeOrigins),
      links:Object.freeze(linkOrigins)
    }),
    canActivate:false,engineVerified:false,physicalTopologyVerified:false,
  });
}
