import { webCryptoImportHashProvider } from "./hash.js";
import { EnterpriseImportError } from "./types.js";
import { attr, childElements, parseSafeXml, type XmlNode } from "./xml-lite.js";

export const NESSUS_EVIDENCE_PROFILE = "nessus.xml.severity-summary.v1" as const;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_HOSTS = 256;
const MAX_FINDINGS = 10_000;

export interface NessusSeveritySummary {
  readonly status: "EVIDENCE_ONLY";
  readonly profileId: typeof NESSUS_EVIDENCE_PROFILE;
  readonly semanticTrack: "EVIDENCE_OBSERVED";
  readonly sourceSha256: string;
  readonly hostCount: number;
  readonly findingCount: number;
  /** Severity indices 0 informational, 1 low, 2 medium, 3 high, 4 critical. */
  readonly severityCounts: readonly [number, number, number, number, number];
  readonly canActivate: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
}
function deny(code: string): never { throw new EnterpriseImportError(code,code); }
function one(node: XmlNode, key: string, required: boolean): XmlNode | undefined {
  const nodes=childElements(node,key);
  if(nodes.length>1 || (required && nodes.length!==1)) deny("NESSUS_XML_CARDINALITY_INVALID");
  return nodes[0];
}
function digits(raw: string | undefined, low: number, high: number, code: string): number {
  if(typeof raw!=="string" || !/^(0|[1-9][0-9]*)$/.test(raw)) deny(code);
  const value=Number(raw);
  if(!Number.isSafeInteger(value)||value<low||value>high) deny(code);
  return value;
}
function allowedChildren(node: XmlNode, allowed: readonly string[]): void {
  for(const child of node.children){
    if(!allowed.includes(child.name)) deny("NESSUS_XML_STRUCTURE_UNSUPPORTED");
  }
}
function hasNonWhitespaceText(node: XmlNode): boolean {
  return node.text.trim().length!==0;
}
/**
 * Small fail-closed structural profile for Tenable-exported Nessus v2 XML.
 * Host identifiers, vulnerability descriptions, plugin output and all source
 * strings are intentionally discarded. No import or modeled network claims.
 */
export async function previewNessusSeveritySummary(bytes: Uint8Array): Promise<NessusSeveritySummary> {
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>MAX_BYTES){
    deny("NESSUS_XML_SOURCE_SIZE_INVALID");
  }
  let root: XmlNode;
  try { root=parseSafeXml(bytes,"Nessus v2 XML"); }
  catch(error){
    // The generic parser's message can include untrusted XML. Return code only.
    const code=error instanceof EnterpriseImportError && /^IMPORT_XML_[A-Z0-9_]+$/.test(error.code)
      ?error.code:"NESSUS_XML_MALFORMED";
    deny(code);
  }
  if(root.name!=="NessusClientData_v2") deny("NESSUS_XML_ROOT_INVALID");
  allowedChildren(root,["Policy","Report"]);
  if(hasNonWhitespaceText(root)) deny("NESSUS_XML_STRUCTURE_UNSUPPORTED");
  const policy=one(root,"Policy",false);
  // Policy contains arbitrary scan settings, potentially secrets: ignored.
  void policy;
  const report=one(root,"Report",true)!;
  if(!report||!attr(report,"name")||attr(report,"name")!.length>512){
    deny("NESSUS_XML_REPORT_INVALID");
  }
  allowedChildren(report,["ReportHost"]);
  if(hasNonWhitespaceText(report)) deny("NESSUS_XML_STRUCTURE_UNSUPPORTED");
  const hosts=childElements(report,"ReportHost");
  if(hosts.length>MAX_HOSTS) deny("NESSUS_XML_HOST_BUDGET");
  const severity=[0,0,0,0,0] as [number,number,number,number,number];
  let total=0;
  for(const host of hosts){
    const hostName=attr(host,"name");
    if(!hostName||hostName.length>512) deny("NESSUS_XML_HOST_INVALID");
    allowedChildren(host,["HostProperties","ReportItem"]);
    if(hasNonWhitespaceText(host)) deny("NESSUS_XML_STRUCTURE_UNSUPPORTED");
    one(host,"HostProperties",false);
    const findings=childElements(host,"ReportItem");
    total+=findings.length;
    if(total>MAX_FINDINGS) deny("NESSUS_XML_FINDING_BUDGET");
    for(const finding of findings){
      const level=digits(attr(finding,"severity"),0,4,"NESSUS_XML_SEVERITY_INVALID");
      digits(attr(finding,"pluginID"),1,2147483647,"NESSUS_XML_PLUGIN_ID_INVALID");
      digits(attr(finding,"port"),0,65535,"NESSUS_XML_PORT_INVALID");
      const proto=attr(finding,"protocol");
      if(!proto||proto.length>32||!/^[a-z][a-z0-9_-]*$/i.test(proto)){
        deny("NESSUS_XML_PROTOCOL_INVALID");
      }
      // Ignore all finding child elements and text: may contain credentials.
      severity[level]=severity[level]!+1;
    }
  }
  const sourceSha256=await webCryptoImportHashProvider.sha256Bytes(bytes);
  return Object.freeze({
    status:"EVIDENCE_ONLY" as const,
    profileId:NESSUS_EVIDENCE_PROFILE,
    semanticTrack:"EVIDENCE_OBSERVED" as const,
    sourceSha256,
    hostCount:hosts.length,
    findingCount:total,
    severityCounts:Object.freeze(severity),
    canActivate:false as const,
    engineVerified:false as const,
    physicalTopologyVerified:false as const,
  });
}
