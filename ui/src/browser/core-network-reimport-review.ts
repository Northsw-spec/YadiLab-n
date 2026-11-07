import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalEnterpriseJson } from "../../../enterprise-model/src/canonical.js";
import { webCryptoImportHashProvider } from "../../../enterprise-import/src/hash.js";
import type { BrowserWorkspace } from "./types.js";
import type { NetworkTopologyImportPreview } from "./network-topology-import.js";

export type CoreReimportObjectCounts = Readonly<{
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}>;
export interface CoreReimportReview {
  readonly status: "REVIEW_REQUIRED";
  readonly kind: "LIVE_WORKSPACE_VS_INCOMING_ORIGINAL";
  /** Canonicalized LIVE workspace ScenarioSource hash; NOT previous original file hash. */
  readonly currentWorkspaceSourceSha256: string;
  /** Original bytes SHA-256 produced by the existing strict import adapter. */
  readonly incomingOriginalSourceSha256: string;
  readonly incomingOriginalByteSize: number;
  readonly currentWorkspaceMode: "builder" | "runtime";
  readonly currentWorkspaceRevision: number;
  readonly sourceLinkChoice?: "LINKS_SHEET" | "INLINE_CONNECTED_TO";
  readonly resources: CoreReimportObjectCounts;
  readonly connections: CoreReimportObjectCounts;
  readonly canAutoApply: false;
  readonly physicalTopologyVerified: false;
  readonly engineVerified: false;
}

const MAX_NETWORK_OBJECTS = 4096;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const SHA = /^[0-9a-f]{64}$/;
function blocked(code:"IC020_P2B_REIMPORT_NOT_COMPARABLE"|"IC020_P2B_BASELINE_CHANGED"):never {
  throw Object.assign(new Error(code),{code});
}
function checkedObjects<T extends { readonly id:string }>(
  values:readonly T[],entity:"resource"|"connection"
):Map<string,T> {
  if(!Array.isArray(values) || values.length > MAX_NETWORK_OBJECTS) blocked("IC020_P2B_REIMPORT_NOT_COMPARABLE");
  const found = new Map<string,T>();
  for(const x of values){
    if(!x || typeof x.id!=="string" || !ID.test(x.id) || found.has(x.id)) blocked("IC020_P2B_REIMPORT_NOT_COMPARABLE");
    if(entity==="connection"){
      const connection=x as T & {from?:{resource?:string};to?:{resource?:string}};
      if(typeof connection.from?.resource!=="string" || typeof connection.to?.resource!=="string")
        blocked("IC020_P2B_REIMPORT_NOT_COMPARABLE");
    }
    found.set(x.id,x);
  }
  return found;
}
function checkedScenario(source:ScenarioSource):{
  nodes:Map<string,ScenarioSource["resources"][number]>;
  edges:Map<string,ScenarioSource["connections"][number]>;
}{
  if(!source || !Array.isArray(source.resources) || !Array.isArray(source.connections))
    blocked("IC020_P2B_REIMPORT_NOT_COMPARABLE");
  const nodes=checkedObjects(source.resources,"resource");
  const edges=checkedObjects(source.connections,"connection");
  for(const link of edges.values()){
    if(!nodes.has(link.from.resource) || !nodes.has(link.to.resource))
      blocked("IC020_P2B_REIMPORT_NOT_COMPARABLE");
  }
  return {nodes,edges};
}
function counts<T>(before:Map<string,T>,after:Map<string,T>):CoreReimportObjectCounts{
  let added=0,removed=0,changed=0,unchanged=0;
  for(const [id,old] of before){
    const next=after.get(id);
    if(next===undefined)removed++;
    else if(canonicalEnterpriseJson(old)===canonicalEnterpriseJson(next))unchanged++;
    else changed++;
  }
  for(const id of after.keys())if(!before.has(id))added++;
  return Object.freeze({added,removed,changed,unchanged});
}

/**
 * Compare a LIVE Builder/Runtime snapshot with a new, already reviewed
 * original. This is non-mutating and not evidence of earlier original bytes.
 * Caller must supply the same source epoch + workspace identity at all awaits.
 */
export async function compareCoreNetworkReimport(
  workspace:BrowserWorkspace,
  incoming:NetworkTopologyImportPreview,
  isCurrent:()=>boolean,
):Promise<CoreReimportReview>{
  if(!isCurrent())blocked("IC020_P2B_BASELINE_CHANGED");
  const previous=workspace.source, next=incoming?.source;
  if(!previous || !next || !incoming.ok ||
     previous.scenarioId!=="imported_network" || next.scenarioId!==previous.scenarioId ||
     typeof incoming.sourceSha256!=="string" || !SHA.test(incoming.sourceSha256) ||
     !Number.isSafeInteger(incoming.sourceByteSize) || incoming.sourceByteSize<1 ||
     incoming.sourceByteSize>16*1024*1024 ||
     (incoming.linkSourceConflict && !incoming.linkSourceChoice))
    blocked("IC020_P2B_REIMPORT_NOT_COMPARABLE");
  const a=checkedScenario(previous),z=checkedScenario(next);
  // SHA covers the current live workspace source, never an asserted prior
  // original file. Source arrays are sorted by ID only for stable identity;
  // fields remain included and recursively canonically key sorted.
  const digestInput={
    ...previous,
    resources:[...previous.resources].sort((x,y)=>x.id.localeCompare(y.id,"en")),
    connections:[...previous.connections].sort((x,y)=>x.id.localeCompare(y.id,"en")),
  };
  const currentWorkspaceSourceSha256=await webCryptoImportHashProvider.sha256Utf8(
    canonicalEnterpriseJson(digestInput));
  if(!isCurrent())blocked("IC020_P2B_BASELINE_CHANGED");
  return Object.freeze({
    status:"REVIEW_REQUIRED" as const,
    kind:"LIVE_WORKSPACE_VS_INCOMING_ORIGINAL" as const,
    currentWorkspaceSourceSha256,
    incomingOriginalSourceSha256:incoming.sourceSha256,
    incomingOriginalByteSize:incoming.sourceByteSize,
    currentWorkspaceMode:workspace.mode,
    currentWorkspaceRevision:workspace.sourceRevision,
    ...(incoming.linkSourceChoice?{sourceLinkChoice:incoming.linkSourceChoice}:{}),
    resources:counts(a.nodes,z.nodes),
    connections:counts(a.edges,z.edges),
    canAutoApply:false as const,
    physicalTopologyVerified:false as const,
    engineVerified:false as const,
  });
}
