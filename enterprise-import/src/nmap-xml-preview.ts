import { webCryptoImportHashProvider } from "./hash.js";
import { EnterpriseImportError } from "./types.js";
import { attr, childElements, parseSafeXml, type XmlNode } from "./xml-lite.js";

export const NMAP_EVIDENCE_PROFILE = "nmap.xml.observations.v1" as const;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_HOSTS = 1_000;
const MAX_PORTS_TOTAL = 10_000;
const MAX_HOSTNAMES_PER_HOST = 16;

export interface NmapEvidenceLocator {
  readonly kind: "nmap-host" | "nmap-port";
  readonly sourceSha256: string;
  readonly hostOrdinal: number;
  readonly portOrdinal?: number;
}
export interface NmapObservedPort {
  readonly protocol: "tcp" | "udp";
  readonly port: number;
  readonly observedState: "open" | "closed" | "filtered" | "unfiltered" | "open|filtered" | "closed|filtered";
  readonly serviceName?: string;
  readonly serviceMethod?: "table" | "probed";
  readonly serviceConfidence?: number;
  readonly locator: NmapEvidenceLocator;
}
export interface NmapObservedHost {
  readonly ipv4: string;
  readonly observedStatus: "up" | "down";
  readonly hostnames: readonly string[];
  readonly ports: readonly NmapObservedPort[];
  readonly locator: NmapEvidenceLocator;
}
export interface NmapReadOnlyEvidence {
  readonly status: "EVIDENCE_ONLY";
  readonly canActivate: false;
  readonly profileId: typeof NMAP_EVIDENCE_PROFILE;
  readonly semanticTrack: "EVIDENCE_OBSERVED";
  readonly sourceSha256: string;
  readonly scanStart?: number;
  readonly hosts: readonly NmapObservedHost[];
  readonly observationsCount: number;
}

function fail(code: string, message: string): never {
  throw new EnterpriseImportError(code, message);
}
function one(node: XmlNode, name: string, required = true): XmlNode | undefined {
  const matches = childElements(node, name);
  if (matches.length > 1 || (required && matches.length !== 1)) {
    fail("NMAP_XML_CARDINALITY_INVALID", name + " must occur exactly " + (required ? "once" : "zero or once") + ".");
  }
  return matches[0];
}
function only(node: XmlNode, allowed: readonly string[]): void {
  for (const child of node.children) {
    if (!allowed.includes(child.name)) {
      fail("NMAP_XML_UNSUPPORTED_ELEMENT", "Nmap element " + child.name + " is not part of this bounded observation profile.");
    }
  }
}
function boundInt(value: string | undefined, low: number, high: number, label: string): number {
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail("NMAP_XML_NUMBER_INVALID", label + " is missing or invalid.");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < low || number > high) {
    fail("NMAP_XML_NUMBER_INVALID", label + " is outside the allowed interval.");
  }
  return number;
}
function ipv4(value: string | undefined): string {
  if (!value || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(value) ||
      value.split(".").some((part) => Number(part) > 255)) {
    fail("NMAP_XML_IPV4_INVALID", "Host IPv4 value is missing or malformed.");
  }
  return value;
}

/**
 * Ignore ONLY the explicitly supported Nmap xml-stylesheet prolog, without
 * fetching, evaluating, executing or resolving its href. Never weaken the
 * general XML parser: DOCTYPE/ENTITY still block with IMPORT_XML_DTD_FORBIDDEN.
 */
function ignoreNmapStylesheetProlog(bytes: Uint8Array): Uint8Array {
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("IMPORT_XML_INVALID_UTF8", "Nmap XML must be valid UTF-8."); }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("IMPORT_XML_DTD_FORBIDDEN", "All DTD and entity declarations remain forbidden.");
  if (xml.includes("\0")) fail("IMPORT_XML_NUL_BYTE", "Nmap XML source contains NUL.");
  let cursor = 0;
  let stripped = xml;
  let seenStylesheet = false;
  let seenDeclaration = false;
  while (cursor < xml.length) {
    while (cursor < xml.length && /\s/.test(xml[cursor]!)) cursor++;
    if (xml.startsWith("<!--", cursor)) {
      const end = xml.indexOf("-->", cursor + 4);
      if (end < 0) fail("IMPORT_XML_MALFORMED", "Unterminated prolog comment.");
      cursor = end + 3; continue;
    }
    if (xml.startsWith("<?", cursor)) {
      const end = xml.indexOf("?>", cursor + 2);
      if (end < 0) fail("IMPORT_XML_MALFORMED", "Unterminated XML prolog processing instruction.");
      const instruction = xml.slice(cursor + 2, end);
      if (/^xml(?:\s|$)/i.test(instruction) && !seenDeclaration && !seenStylesheet) {
        seenDeclaration = true; cursor = end + 2; continue;
      }
      if (/^xml-stylesheet\s+/.test(instruction) && !seenStylesheet) {
        if (!/^xml-stylesheet\s+href=(["'])[^"'<>]{1,512}\1\s+type=(["'])text\/xsl\2\s*$/.test(instruction)) {
          fail("NMAP_XML_STYLESHEET_INVALID", "Only a bounded href + text/xsl stylesheet instruction is ignorable.");
        }
        stripped = stripped.slice(0, cursor) + " ".repeat(end + 2 - cursor) + stripped.slice(end + 2);
        seenStylesheet = true;
        cursor = end + 2; continue;
      }
      fail("IMPORT_XML_PROCESSING_INSTRUCTION_FORBIDDEN", "An unrecognized Nmap XML processing instruction was rejected.");
    }
    break;
  }
  return new TextEncoder().encode(stripped);
}

export async function previewNmapXmlObservations(bytes: Uint8Array): Promise<NmapReadOnlyEvidence> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_BYTES) {
    fail("NMAP_XML_SOURCE_SIZE_INVALID", "Nmap XML source must be nonempty and at most 2 MiB.");
  }
  const sanitized = ignoreNmapStylesheetProlog(bytes);
  const root = parseSafeXml(sanitized, "Nmap XML");
  if (root.name !== "nmaprun" || attr(root, "scanner") !== "nmap") {
    fail("NMAP_XML_ROOT_INVALID", "Only actual Nmap nmaprun scan documents are allowed.");
  }
  only(root, ["scaninfo", "host", "runstats", "verbose", "debugging"]);
  const sha = await webCryptoImportHashProvider.sha256Bytes(bytes);
  const hostElements = childElements(root, "host");
  if (hostElements.length > MAX_HOSTS) fail("NMAP_XML_HOST_BUDGET", "Host observation limit exceeded.");
  const scanStart = attr(root, "start") === undefined ? undefined
    : boundInt(attr(root, "start"), 0, 9999999999999, "scan start time");
  let portTotal = 0;
  const hosts: NmapObservedHost[] = [];
  for (const [hi, host] of hostElements.entries()) {
    only(host, ["status", "address", "hostnames", "ports", "times"]);
    const status = attr(one(host, "status")!, "state");
    if (status !== "up" && status !== "down") {
      fail("NMAP_XML_HOST_STATE_UNSUPPORTED", "Only explicit up/down scan-time observations are supported.");
    }
    const addresses = childElements(host, "address");
    if (addresses.length !== 1 || attr(addresses[0]!, "addrtype") !== "ipv4") {
      fail("NMAP_XML_ADDRESS_UNSUPPORTED", "Initial evidence profile requires exactly one explicit IPv4 address.");
    }
    const addr = ipv4(attr(addresses[0]!, "addr"));
    const namesNode = one(host, "hostnames", false);
    if (namesNode) only(namesNode, ["hostname"]);
    const nameEls = namesNode ? childElements(namesNode, "hostname") : [];
    if (nameEls.length > MAX_HOSTNAMES_PER_HOST) fail("NMAP_XML_HOSTNAME_BUDGET", "Host name limit exceeded.");
    const hostnames = nameEls.map((el) => {
      const val = attr(el, "name");
      if (!val || val.length > 253) fail("NMAP_XML_HOSTNAME_INVALID", "Host name is missing or too long.");
      only(el, []);
      return val;
    });
    const portsNode = one(host, "ports", false);
    if (portsNode) only(portsNode, ["port"]);
    const portEls = portsNode ? childElements(portsNode, "port") : [];
    portTotal += portEls.length;
    if (portTotal > MAX_PORTS_TOTAL) fail("NMAP_XML_PORT_BUDGET", "Port observation limit exceeded.");
    const seenPorts = new Set<string>();
    const ports: NmapObservedPort[] = portEls.map((el, pi) => {
      only(el, ["state", "service"]);
      const protocol = attr(el, "protocol");
      if (protocol !== "tcp" && protocol !== "udp") {
        fail("NMAP_XML_PROTOCOL_UNSUPPORTED", "Only TCP/UDP observed ports are supported.");
      }
      const port = boundInt(attr(el, "portid"), 1, 65535, "portid");
      const key = protocol + ":" + port;
      if (seenPorts.has(key)) fail("NMAP_XML_DUPLICATE_PORT", "Conflicting duplicate scan-time port observation.");
      seenPorts.add(key);
      const state = attr(one(el, "state")!, "state");
      if (!["open", "closed", "filtered", "unfiltered", "open|filtered", "closed|filtered"].includes(state ?? "")) {
        fail("NMAP_XML_PORT_STATE_UNSUPPORTED", "Nmap port state outside supported observations.");
      }
      const svc = one(el, "service", false);
      if (svc) only(svc, []);
      const method = svc ? attr(svc, "method") : undefined;
      if (method !== undefined && method !== "table" && method !== "probed") {
        fail("NMAP_XML_SERVICE_METHOD_UNSUPPORTED", "Unknown service identification method.");
      }
      const confidence = svc && attr(svc, "conf") !== undefined
        ? boundInt(attr(svc, "conf"), 0, 10, "service confidence") : undefined;
      const serviceName = svc ? attr(svc, "name") : undefined;
      if (serviceName !== undefined && (serviceName.length < 1 || serviceName.length > 128)) {
        fail("NMAP_XML_SERVICE_NAME_INVALID", "Service name exceeds allowed length.");
      }
      return {
        protocol, port, observedState: state as NmapObservedPort["observedState"],
        ...(serviceName === undefined ? {} : { serviceName }),
        ...(method === undefined ? {} : { serviceMethod: method }),
        ...(confidence === undefined ? {} : { serviceConfidence: confidence }),
        locator: { kind: "nmap-port" as const, sourceSha256: sha, hostOrdinal: hi, portOrdinal: pi },
      };
    });
    hosts.push({
      ipv4: addr, observedStatus: status, hostnames, ports,
      locator: { kind: "nmap-host", sourceSha256: sha, hostOrdinal: hi },
    });
  }
  // No connection, type, Engine state, or ScenarioSource can be produced here.
  return {
    status: "EVIDENCE_ONLY", canActivate: false, profileId: NMAP_EVIDENCE_PROFILE,
    semanticTrack: "EVIDENCE_OBSERVED", sourceSha256: sha,
    ...(scanStart === undefined ? {} : { scanStart }),
    hosts, observationsCount: portTotal,
  };
}
