import type {ScenarioSource} from "../../core-model/src/generated/contracts.js";
import {EnterpriseImportError, type ImportDocument, type ImportRecord} from "./types.js";
import {webCryptoImportHashProvider} from "./hash.js";
import {previewDocxTableStructure, SCALE_OFFICE_LARGE_STRUCTURE_PROFILE as DOCX_LARGE, SCALE_OFFICE_S2_STRUCTURE_PROFILE as DOCX_S2} from "./docx-tables-structural-preview.js";
import {previewOdtTableStructure, SCALE_OFFICE_LARGE_STRUCTURE_PROFILE as ODT_LARGE, SCALE_OFFICE_S2_STRUCTURE_PROFILE as ODT_S2} from "./odt-tables-structural-preview.js";
import {
  revealReviewedOfficeBatch, revealReviewedOfficeBatchesV2,
  OFFICE_SCALED_BATCH_PROFILE, OFFICE_SCALED_BATCH_PROFILE_V2,
  type OfficeScaledBatchDecision, type OfficeScaledCellLocator,
  type OfficeScaledDisclosedRow, type OfficeScaledBatchDisclosure,
  type OfficeScaledBatchFormat,
} from "./office-large-batch-review.js";
import {GRAPHML_MANUAL_ROLE_OPTIONS} from "./graphml-review-mapping.js";
import {mapNetworkWorkbookToScenario} from "./workbook-mapping.js";

/**
 * SCALE-001 P1b2. Explicitly consented source rows to an ordinary editable
 * ScenarioSource candidate. Not wired to the live UI or Runtime/Engine. The
 * same original ZIP is validated and rebound per 100-row approved batch, not
 * once per cell. P2 must re-read the real File + Builder epoch before commit.
 */
export const OFFICE_SCALED_TOPOLOGY_PROFILE = "office.scaled-reviewed-topology.v1" as const;
/** P3b: new opt-in source candidate, not a Builder activation. */
export const OFFICE_SCALED_TOPOLOGY_PROFILE_V2 = "office.scaled-reviewed-topology.v2" as const;
export interface OfficeScaledTopologyDecision {
  readonly capacityProfile: typeof OFFICE_SCALED_TOPOLOGY_PROFILE | typeof OFFICE_SCALED_TOPOLOGY_PROFILE_V2;
  readonly format: OfficeScaledBatchFormat;
  readonly sourceSha256: string;
  readonly nodeBatches: readonly OfficeScaledBatchDecision[];
  readonly linkBatches: readonly OfficeScaledBatchDecision[];
  readonly acknowledgeModeledResources: true;
  readonly acknowledgeModeledConnections: true;
}
export interface OfficeScaledNodeOrigin {
  readonly nodeId: string;
  readonly idLocator: OfficeScaledCellLocator;
  readonly roleLocator: OfficeScaledCellLocator;
}
export interface OfficeScaledLinkOrigin {
  readonly linkId: string;
  readonly fromLocator: OfficeScaledCellLocator;
  readonly toLocator: OfficeScaledCellLocator;
  readonly sourcePortLocator: OfficeScaledCellLocator;
  readonly targetPortLocator: OfficeScaledCellLocator;
}
export interface OfficeScaledTopologyCandidate {
  readonly status: "READY_FOR_COMPILATION";
  readonly profileId: typeof OFFICE_SCALED_TOPOLOGY_PROFILE | typeof OFFICE_SCALED_TOPOLOGY_PROFILE_V2;
  readonly sourceSha256: string;
  readonly source: ScenarioSource;
  readonly origins: Readonly<{
    nodes: readonly OfficeScaledNodeOrigin[];
    links: readonly OfficeScaledLinkOrigin[];
  }>;
  readonly canActivate: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
}

type BlockCode =
  | "SCALE_P1B2_SELECTION_INVALID"
  | "SCALE_P1B2_CONSENT_REQUIRED"
  | "SCALE_P1B2_BATCH_COVERAGE_INVALID"
  | "SCALE_P1B2_SOURCE_CHANGED"
  | "SCALE_P1B2_DUPLICATE_NODE_ID"
  | "SCALE_P1B2_LINK_ENDPOINT_UNKNOWN"
  | "SCALE_P1B2_PORT_REUSED"
  | "SCALE_P1B2_ROLE_UNSUPPORTED"
  | "SCALE_P1B2_SOURCE_BLOCKED";
function block(code:BlockCode):never {
  // Stable errors only. Never propagate original source or ZIP parser text.
  throw new EnterpriseImportError(code,code);
}
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const DECISION_KEYS=["capacityProfile","format","sourceSha256",
  "nodeBatches","linkBatches","acknowledgeModeledResources","acknowledgeModeledConnections"];
const BATCH_KEYS=["format","sourceSha256","capacityProfile","tableOrdinal",
  "rowStart","rowEnd","columns","acknowledgeSelectedRange","acknowledgeDisclosure"];
const COLUMN_KEYS=["cellOrdinal","acknowledge"];
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&(n as number)>=0;
const exact=(v:unknown,keys:readonly string[]):boolean=>
  !!v&&typeof v==="object"&&!Array.isArray(v)&&
  Object.keys(v).sort().join(",")===[...keys].sort().join(",");

/** Must cover ALL source rows 1..N contiguously, with only consented columns. */
function plan(
  batches:readonly OfficeScaledBatchDecision[]|undefined,
  format:OfficeScaledBatchFormat,sha:string,columns:readonly number[],v2=false,
):Readonly<{tableOrdinal:number;rowCount:number}> {
  if(!Array.isArray(batches)||batches.length<1||batches.length>(v2?50:10))
    block("SCALE_P1B2_BATCH_COVERAGE_INVALID");
  const tableOrdinal=batches[0]?.tableOrdinal;
  if(!integer(tableOrdinal)||tableOrdinal>=20)block("SCALE_P1B2_SELECTION_INVALID");
  let expectedRow=1;
  for(const batch of batches){
    if(!exact(batch,BATCH_KEYS) || batch.format!==format ||
      batch.sourceSha256!==sha ||
      batch.capacityProfile!==(v2?OFFICE_SCALED_BATCH_PROFILE_V2:OFFICE_SCALED_BATCH_PROFILE) ||
      batch.tableOrdinal!==tableOrdinal)
      block("SCALE_P1B2_SELECTION_INVALID");
    if(batch.acknowledgeSelectedRange!==true || batch.acknowledgeDisclosure!==true ||
      batch.columns?.some((c:OfficeScaledBatchDecision["columns"][number])=>c?.acknowledge!==true))
      block("SCALE_P1B2_CONSENT_REQUIRED");
    if(!integer(batch.rowStart)||!integer(batch.rowEnd) ||
      batch.rowStart!==expectedRow||batch.rowEnd<expectedRow ||
      batch.rowEnd>(v2?5000:1000) || batch.rowEnd-batch.rowStart>=100)
      block("SCALE_P1B2_BATCH_COVERAGE_INVALID");
    if(!Array.isArray(batch.columns)||batch.columns.length!==columns.length ||
      batch.columns.some((c:OfficeScaledBatchDecision["columns"][number],i:number)=>!exact(c,COLUMN_KEYS)||c.cellOrdinal!==columns[i]))
      block("SCALE_P1B2_SELECTION_INVALID");
    expectedRow=batch.rowEnd+1;
  }
  return Object.freeze({tableOrdinal,rowCount:expectedRow-1});
}
function record(table:string,row:number,fields:Record<string,string>):ImportRecord {
  return Object.freeze({recordIndex:row,
    fields:Object.freeze(Object.fromEntries(Object.entries(fields).map(([name,value])=>
      [name,Object.freeze({value,locator:Object.freeze({
        kind:"record-row" as const,table,row,
      })})]))),
  });
}
function requiredText(row:OfficeScaledDisclosedRow,index:number):string {
  const val=row.cells[index]?.text;
  if(typeof val!=="string")block("SCALE_P1B2_SELECTION_INVALID");
  return val;
}
function locator(row:OfficeScaledDisclosedRow,index:number):OfficeScaledCellLocator {
  const val=row.cells[index]?.locator;
  if(!val)block("SCALE_P1B2_SELECTION_INVALID");
  return val;
}
async function selectedRows(bytes:Uint8Array,
  batches:readonly OfficeScaledBatchDecision[],
):Promise<readonly OfficeScaledDisclosedRow[]> {
  const selected:OfficeScaledDisclosedRow[]=[];
  for(const batch of batches){
    let disclosed;
    try {disclosed=await revealReviewedOfficeBatch(bytes,batch);}
    catch {block("SCALE_P1B2_SOURCE_BLOCKED");}
    if(disclosed.status!=="REVEALED_UNVERIFIED"||disclosed.canActivate!==false||
      disclosed.engineVerified!==false||disclosed.physicalTopologyVerified!==false||
      disclosed.tableOrdinal!==batch.tableOrdinal||
      disclosed.rows.length!==batch.rowEnd-batch.rowStart+1)
      block("SCALE_P1B2_SOURCE_BLOCKED");
    for(let r=0;r<disclosed.rows.length;r++){
      const row=disclosed.rows[r]!;
      if(row.rowOrdinal!==batch.rowStart+r || row.cells.length!==batch.columns.length ||
        row.cells.some((c,i)=>c.locator.tableOrdinal!==batch.tableOrdinal ||
          c.locator.rowOrdinal!==row.rowOrdinal ||
          c.locator.cellOrdinal!==batch.columns[i]?.cellOrdinal ||
          c.locator.sourceSha256!==batch.sourceSha256))
        block("SCALE_P1B2_SOURCE_BLOCKED");
      selected.push(row);
    }
  }
  return Object.freeze(selected);
}

/**
 * Revalidate each disclosed v2 group against the exact independent decision,
 * including each original cell locator, BEFORE any source mapping begins.
 */
function validatedApprovedGroups(
  groups:readonly OfficeScaledBatchDisclosure[],
  batches:readonly OfficeScaledBatchDecision[],
):readonly OfficeScaledDisclosedRow[]{
  if(groups.length!==batches.length)block("SCALE_P1B2_SOURCE_BLOCKED");
  const selected:OfficeScaledDisclosedRow[]=[];
  for(let i=0;i<batches.length;i++){
    const batch=batches[i]!,disclosed=groups[i]!;
    if(disclosed.status!=="REVEALED_UNVERIFIED"||
       disclosed.capacityProfile!==OFFICE_SCALED_BATCH_PROFILE_V2||
       disclosed.canActivate!==false||disclosed.engineVerified!==false||
       disclosed.physicalTopologyVerified!==false||
       disclosed.tableOrdinal!==batch.tableOrdinal||
       disclosed.sourceSha256!==batch.sourceSha256||
       disclosed.rows.length!==batch.rowEnd-batch.rowStart+1)
      block("SCALE_P1B2_SOURCE_BLOCKED");
    for(let r=0;r<disclosed.rows.length;r++){
      const row=disclosed.rows[r]!;
      if(row.rowOrdinal!==batch.rowStart+r||
         row.cells.length!==batch.columns.length||
         row.cells.some((cell,c)=>
           cell.locator.tableOrdinal!==batch.tableOrdinal||
           cell.locator.rowOrdinal!==row.rowOrdinal||
           cell.locator.cellOrdinal!==batch.columns[c]?.cellOrdinal||
           cell.locator.sourceSha256!==batch.sourceSha256))
        block("SCALE_P1B2_SOURCE_BLOCKED");
      selected.push(row);
    }
  }
  return Object.freeze(selected);
}

/** All-or-nothing source candidate: no caller workspace is ever mutated. */
export async function mapReviewedOfficeBatchesToSource(
  original:Uint8Array, decision:OfficeScaledTopologyDecision,
):Promise<OfficeScaledTopologyCandidate> {
  if(!exact(decision,DECISION_KEYS))block("SCALE_P1B2_SELECTION_INVALID");
  if(decision.acknowledgeModeledResources!==true ||
    decision.acknowledgeModeledConnections!==true)
    block("SCALE_P1B2_CONSENT_REQUIRED");
  const v2=decision.capacityProfile===OFFICE_SCALED_TOPOLOGY_PROFILE_V2;
  if((decision.capacityProfile!==OFFICE_SCALED_TOPOLOGY_PROFILE && !v2) ||
    (decision.format!=="docx"&&decision.format!=="odt") ||
    typeof decision.sourceSha256!=="string" || !SHA.test(decision.sourceSha256) ||
    !(original instanceof Uint8Array)||original.byteLength<4||
    original.byteLength>16*1024*1024)
    block("SCALE_P1B2_SELECTION_INVALID");
  // One immutable snapshot; refuse source swaps rather than trusting filename.
  const bytes=Uint8Array.from(original);
  const hash=await webCryptoImportHashProvider.sha256Bytes(bytes);
  if(hash!==decision.sourceSha256)block("SCALE_P1B2_SOURCE_CHANGED");
  // A v1 topology decision cannot borrow v2 range permissions (or vice versa).
  // Reject that profile confusion as an invalid grant, not as incomplete
  // coverage, even when 50 v2 ranges would exceed the legacy ten-batch cap.
  const expectedBatchProfile=v2?OFFICE_SCALED_BATCH_PROFILE_V2:OFFICE_SCALED_BATCH_PROFILE;
  const mixedProfile=(batches:readonly OfficeScaledBatchDecision[]|undefined):boolean=>
    Array.isArray(batches)&&batches.some((batch:OfficeScaledBatchDecision)=>
      batch?.capacityProfile!==expectedBatchProfile);
  if(mixedProfile(decision.nodeBatches)||mixedProfile(decision.linkBatches))
    block("SCALE_P1B2_SELECTION_INVALID");
  const nodePlan=plan(decision.nodeBatches,decision.format,hash,[0,1],v2);
  const linkPlan=plan(decision.linkBatches,decision.format,hash,[0,1,2,3],v2);
  if(nodePlan.tableOrdinal===linkPlan.tableOrdinal)
    block("SCALE_P1B2_SELECTION_INVALID");

  // Independent current-source structural gate: reject silently missing
  // unreviewed rows instead of claiming full original-table coverage.
  let structure;
  try {
    structure=decision.format==="docx"
      ?await previewDocxTableStructure(bytes,{capacityProfile:v2?DOCX_S2:DOCX_LARGE})
      :await previewOdtTableStructure(bytes,{capacityProfile:v2?ODT_S2:ODT_LARGE});
  }catch{block("SCALE_P1B2_SOURCE_BLOCKED");}
  if(structure.sourceSha256!==hash)block("SCALE_P1B2_SOURCE_CHANGED");
  if(structure.tables[nodePlan.tableOrdinal]?.rows.length!==nodePlan.rowCount+1 ||
    structure.tables[linkPlan.tableOrdinal]?.rows.length!==linkPlan.rowCount+1)
    block("SCALE_P1B2_BATCH_COVERAGE_INVALID");
  let nodeRows:readonly OfficeScaledDisclosedRow[];
  let linkRows:readonly OfficeScaledDisclosedRow[];
  if(v2){
    // One approved immutable original snapshot across 100 independently
    // acknowledged ranges, not 100 full ZIP/structural reparse cycles.
    let groups:readonly OfficeScaledBatchDisclosure[];
    try{
      groups=await revealReviewedOfficeBatchesV2(bytes,
        [...decision.nodeBatches,...decision.linkBatches]);
    }catch{block("SCALE_P1B2_SOURCE_BLOCKED");}
    if(groups.length!==decision.nodeBatches.length+decision.linkBatches.length)
      block("SCALE_P1B2_SOURCE_BLOCKED");
    nodeRows=validatedApprovedGroups(groups.slice(0,decision.nodeBatches.length),
      decision.nodeBatches);
    linkRows=validatedApprovedGroups(groups.slice(decision.nodeBatches.length),
      decision.linkBatches);
  }else{
    nodeRows=await selectedRows(bytes,decision.nodeBatches);
    linkRows=await selectedRows(bytes,decision.linkBatches);
  }
  if(nodeRows.length!==nodePlan.rowCount||linkRows.length!==linkPlan.rowCount)
    block("SCALE_P1B2_BATCH_COVERAGE_INVALID");

  const nodes:ImportRecord[]=[];
  const interfaces:ImportRecord[]=[];
  const links:ImportRecord[]=[];
  const originsNodes:OfficeScaledNodeOrigin[]=[];
  const originsLinks:OfficeScaledLinkOrigin[]=[];
  const declared=new Set<string>();
  for(const row of nodeRows){
    const id=requiredText(row,0),role=requiredText(row,1);
    if(!ID.test(id))block("SCALE_P1B2_SELECTION_INVALID");
    if(declared.has(id))block("SCALE_P1B2_DUPLICATE_NODE_ID");
    if(!GRAPHML_MANUAL_ROLE_OPTIONS.some(type=>type===role))
      block("SCALE_P1B2_ROLE_UNSUPPORTED");
    declared.add(id);
    nodes.push(record("Nodes",row.rowOrdinal,{
      nodeId:id,displayName:id,type:role,
    }));
    originsNodes.push(Object.freeze({
      nodeId:id,idLocator:locator(row,0),roleLocator:locator(row,1),
    }));
  }

  // Each explicit pair of port-bearing link cells constitutes its own
  // source-grounded reference. Reuse of one physical endpoint+port is
  // ambiguous; never silently combine duplicate/parallel edges.
  const usedPorts=new Set<string>();
  let interfaceRow=0;
  for(const row of linkRows){
    const from=requiredText(row,0),to=requiredText(row,1),
      fromPort=requiredText(row,2),toPort=requiredText(row,3);
    if(!declared.has(from)||!declared.has(to))
      block("SCALE_P1B2_LINK_ENDPOINT_UNKNOWN");
    if(from===to || !ID.test(fromPort)||!ID.test(toPort))
      block("SCALE_P1B2_SELECTION_INVALID");
    const a=JSON.stringify([from,fromPort]),b=JSON.stringify([to,toPort]);
    if(a===b||usedPorts.has(a)||usedPorts.has(b))
      block("SCALE_P1B2_PORT_REUSED");
    usedPorts.add(a);usedPorts.add(b);
    // These interface IDs are the explicit original Links port strings,
    // NOT addresses, MACs, physical discoveries or invented port labels.
    interfaces.push(record("Interfaces",++interfaceRow,{
      nodeId:from,interfaceId:fromPort,name:fromPort,
    }));
    interfaces.push(record("Interfaces",++interfaceRow,{
      nodeId:to,interfaceId:toPort,name:toPort,
    }));
    const linkId="office_link_t"+linkPlan.tableOrdinal+"_r"+row.rowOrdinal;
    links.push(record("Links",row.rowOrdinal,{
      linkId,nodeA:from,nodeB:to,interfaceA:fromPort,interfaceB:toPort,
      kind:"network",
    }));
    originsLinks.push(Object.freeze({
      linkId,fromLocator:locator(row,0),toLocator:locator(row,1),
      sourcePortLocator:locator(row,2),targetPortLocator:locator(row,3),
    }));
  }
  const doc:ImportDocument={tables:[
    {tableId:"Metadata",records:[record("Metadata",1,{
      scenarioId:"reviewed_office_scaled",title:"Reviewed Office Topology",
    })]},
    {tableId:"Nodes",records:nodes},
    {tableId:"Interfaces",records:interfaces},
    {tableId:"Links",records:links},
  ]};
  // Reuse canonical cross-reference and port validation, never a second
  // proprietary topology model. Do not leak raw diagnostics into errors.
  const mapped=mapNetworkWorkbookToScenario(doc);
  if(!mapped.ok||!mapped.source||mapped.diagnostics.some(d=>d.severity==="error"))
    block("SCALE_P1B2_SOURCE_BLOCKED");
  return Object.freeze({
    status:"READY_FOR_COMPILATION",
    profileId:decision.capacityProfile,
    sourceSha256:hash,source:mapped.source,
    origins:Object.freeze({
      nodes:Object.freeze(originsNodes),links:Object.freeze(originsLinks),
    }),
    canActivate:false,engineVerified:false,physicalTopologyVerified:false,
  });
}

/** P4c2b opt-in 10k original source topology is a separate, versioned module;
 * v1/v2 implementations above intentionally remain untouched. */
export {
  OFFICE_SCALED_TOPOLOGY_PROFILE_V3,
  mapReviewedOfficeBatchesV3ToSource,
} from "./office-scaled-v3-source-candidate.js";
export type {
  OfficeScaledTopologyDecisionV3,OfficeScaledTopologyCandidateV3,
} from "./office-scaled-v3-source-candidate.js";
