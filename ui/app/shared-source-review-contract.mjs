/**
 * IC-010 P3d: final structural acceptance gate between the eight existing,
 * already-validated read-only producers and their shared React display.
 * This does NOT authenticate arbitrary JavaScript or re-parse a source file.
 * Trusted originals are still verified by their producer from file bytes.
 */
const HEX = /^[a-f0-9]{64}$/;
const BARRIERS = Object.freeze([
  "canActivate","modelMutated","engineVerified","physicalTopologyVerified",
]);
const SUCCESS_KEYS = Object.freeze([
  "status","profileId","semanticTrack","sourceSha256","documentLocator","summary",
  ...BARRIERS,
]);
const BLOCKED_KEYS = Object.freeze(["status","code",...BARRIERS]);
const BLOCKED_XML_KEYS = Object.freeze([...BLOCKED_KEYS,"candidateProfileIds"]);
const XML_PROFILES = Object.freeze([
  "graphml.structural.v1","nmap.xml.v1","nessus.xml.v1","diagrams.drawio.v1",
]);
const EXPECTED = Object.freeze({
  "graphml.structural.v1": Object.freeze({
    status:"REVIEW_REQUIRED",semanticTrack:"TOPOLOGY_DECLARED",
    kind:"GRAPH_STRUCTURE",keys:["nodes","graphEdges"],
  }),
  "diagrams.drawio.v1": Object.freeze({
    status:"PREVIEW_ONLY",semanticTrack:"TOPOLOGY_DECLARED",
    kind:"DRAWIO_DIAGRAM",keys:["pages","vertices","drawnEdges"],
  }),
  "nmap.xml.v1": Object.freeze({
    status:"EVIDENCE_ONLY",semanticTrack:"EVIDENCE_OBSERVED",
    kind:"NMAP_OBSERVATIONS",keys:["observedHosts","reportedPorts"],
  }),
  "nessus.xml.v1": Object.freeze({
    status:"EVIDENCE_ONLY",semanticTrack:"EVIDENCE_OBSERVED",
    kind:"NESSUS_REPORT",keys:["reportedHosts","reportedFindings"],
  }),
  "ansible.inventory.static.yaml.v1": Object.freeze({
    status:"REVIEW_REQUIRED",semanticTrack:"CONFIG_DOCUMENTED",
    kind:"ANSIBLE_YAML_INVENTORY",
    keys:["documentedHosts","documentedGroups","originalHostLocatorCount"],
  }),
  "ansible.inventory.static.ini.v1": Object.freeze({
    status:"REVIEW_REQUIRED",semanticTrack:"CONFIG_DOCUMENTED",
    kind:"ANSIBLE_INI_INVENTORY",
    keys:["documentedHosts","documentedGroups","originalHostLocatorCount"],
  }),
  "office.docx-tables.structural.v1": Object.freeze({
    status:"REVIEW_REQUIRED",semanticTrack:"CONFIG_DOCUMENTED",
    kind:"DOCX_TABLE_STRUCTURE",
    keys:["declaredTables","declaredRows","structuralCells","sourceBoundCellLocators"],
  }),
  "office.odt-tables.structural.v1": Object.freeze({
    status:"REVIEW_REQUIRED",semanticTrack:"CONFIG_DOCUMENTED",
    kind:"ODT_TABLE_STRUCTURE",
    keys:["declaredTables","declaredRows","structuralCells","sourceBoundCellLocators"],
  }),
});
const BLOCKED_CODES = new Set([
  "IC010_XML_FILENAME_INVALID","IC010_XML_SOURCE_SIZE_INVALID",
  "IC010_XML_EXTENSION_UNSUPPORTED","IC010_XML_PROFILE_UNSUPPORTED",
  "IC010_XML_PROFILE_EXTENSION_MISMATCH","IC010_XML_CONTENT_UNRECOGNIZED",
  "IC010_XML_CONTENT_AMBIGUOUS",
  "IC010_STATIC_FILENAME_INVALID","IC010_STATIC_SOURCE_SIZE_INVALID",
  "IC010_STATIC_EXTENSION_UNSUPPORTED","IC010_STATIC_CONTENT_UNRECOGNIZED",
  "IC010_STATIC_SOURCE_LOCATOR_INVALID",
  "IC010_P3C_FILENAME_INVALID","IC010_P3C_EXTENSION_UNSUPPORTED",
  "IC010_P3C_SOURCE_SIZE_INVALID","IC010_P3C_CONTENT_UNRECOGNIZED",
  "IC010_P3C_LOCATOR_INVALID",
]);
function invalid(){
  const error = new Error("IC010_P3D_RESULT_INVALID");
  error.code = "IC010_P3D_RESULT_INVALID";
  throw error;
}
function plainFrozen(value){
  return value !== null && typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
     Object.getPrototypeOf(value) === null) &&
    Object.isFrozen(value);
}
function fields(value,expected){
  return Reflect.ownKeys(value).length === expected.length &&
    expected.every(k=>Object.hasOwn(value,k));
}
function count(n){return Number.isSafeInteger(n) && n >= 0;}
function sourceReview(result){
  if(!plainFrozen(result) || !fields(result,SUCCESS_KEYS) ||
     BARRIERS.some(k=>result[k]!==false) ||
     typeof result.profileId!=="string" ||
     !Object.hasOwn(EXPECTED,result.profileId) ||
     typeof result.sourceSha256!=="string" ||
     !HEX.test(result.sourceSha256))invalid();
  const e=EXPECTED[result.profileId];
  if(result.status!==e.status || result.semanticTrack!==e.semanticTrack ||
     !plainFrozen(result.documentLocator) ||
     !fields(result.documentLocator,["kind","profileId","sourceSha256"]) ||
     result.documentLocator.kind!=="source-document" ||
     result.documentLocator.profileId!==result.profileId ||
     result.documentLocator.sourceSha256!==result.sourceSha256 ||
     !plainFrozen(result.summary) ||
     !fields(result.summary,["kind",...e.keys]) ||
     result.summary.kind!==e.kind ||
     e.keys.some(k=>!count(result.summary[k])))invalid();
  if(e.kind.startsWith("ANSIBLE_") &&
     result.summary.originalHostLocatorCount < result.summary.documentedHosts)
    invalid();
  if(e.kind==="DOCX_TABLE_STRUCTURE" || e.kind==="ODT_TABLE_STRUCTURE"){
    if(result.summary.sourceBoundCellLocators!==result.summary.structuralCells ||
       result.summary.declaredRows < result.summary.declaredTables ||
       result.summary.structuralCells < result.summary.declaredRows)invalid();
  }
  return result;
}
function deniedReview(result){
  if(!plainFrozen(result) || result.status!=="BLOCKED" ||
     BARRIERS.some(k=>result[k]!==false) ||
     typeof result.code!=="string" || !BLOCKED_CODES.has(result.code))
    invalid();
  const xml=result.code.startsWith("IC010_XML_");
  if(xml){
    if(!fields(result,BLOCKED_XML_KEYS) ||
       !Array.isArray(result.candidateProfileIds) ||
       !Object.isFrozen(result.candidateProfileIds) ||
       result.candidateProfileIds.some(x=>!XML_PROFILES.includes(x)) ||
       new Set(result.candidateProfileIds).size!==result.candidateProfileIds.length)
      invalid();
  }else if(!fields(result,BLOCKED_KEYS))invalid();
  return result;
}

/**
 * Return original verified metadata unchanged: P3b's original-file re-read
 * compares exact serialized key order. Do not append fields to this record.
 */
export function validateSharedSourceReviewResult(result){
  if(!result || typeof result!=="object")invalid();
  return result.status==="BLOCKED" ? deniedReview(result) : sourceReview(result);
}
export const SHARED_SOURCE_TRACK_MEANINGS = Object.freeze({
  TOPOLOGY_DECLARED:
    "Topology as described in a source document, not validated physical cabling or Engine truth.",
  EVIDENCE_OBSERVED:
    "Historical observations from a report or scan, not a current probe, live inventory or Engine PASS.",
  CONFIG_DOCUMENTED:
    "Documented configuration or Office structure, not an independently verified network asset or Engine probe.",
});
export function sharedSourceTrackMeaning(track){
  return Object.hasOwn(SHARED_SOURCE_TRACK_MEANINGS,track)
    ? SHARED_SOURCE_TRACK_MEANINGS[track]
    : "No verified source classification.";
}

/**
 * One derived state, not another mutable state machine. No source text, file
 * name or content is returned. Call only with already validated result data.
 */
export function sharedReviewLifecycle({selected=false,consent=false,busy=false,
                                      result=null,error=""}={}){
  if(!selected)return "NO_SOURCE";
  if(error)return "BLOCKED";
  if(busy)return "INSPECTING";
  if(result && ["BLOCKED","REVIEW_REQUIRED","PREVIEW_ONLY","EVIDENCE_ONLY"].includes(result.status))
    return result.status;
  return consent ? "READY_TO_INSPECT" : "AWAITING_CONSENT";
}
