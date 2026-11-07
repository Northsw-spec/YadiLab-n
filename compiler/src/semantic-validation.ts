import type {
  ScenarioSource,
  Scenariosourcerule,
} from "../../core-model/src/generated/contracts.js";
import type {
  CapabilityDefinition,
  CompilerDiagnostic,
} from "./types.js";

function error(code: string, path: string, message: string, suggestion?: string): CompilerDiagnostic {
  return suggestion
    ? { severity: "error", code, path, message, suggestion }
    : { severity: "error", code, path, message };
}

function warning(code: string, path: string, message: string, suggestion?: string): CompilerDiagnostic {
  return suggestion
    ? { severity: "warning", code, path, message, suggestion }
    : { severity: "warning", code, path, message };
}

export interface SemanticValidationContext {
  readonly resolvedCapabilityIds: ReadonlySet<string>;
  readonly capabilityDefinitions: readonly CapabilityDefinition[];
  readonly resolvedProfileIds: ReadonlySet<string>;
  readonly profileIdsInCatalog: ReadonlySet<string>;
}


const FOUNDATION_TEST_ENGINE_MINIMUM = Object.freeze({
  "network.reachability": "0.8.0",
  "network.segmentation": "0.8.0",
  "network.route_test": "0.8.0",
  "identity.authentication_test": "0.4.0",
  "identity.privilege_path": "0.4.0",
  "identity.permission": "0.4.0",
  "identity.membership": "0.4.0",
  "windows.hardening_check": "0.4.0",
  "linux.hardening_check": "0.4.0",
  "network.port_scan": "0.8.0",
  "identity.password_audit": "0.5.0",
  "virtualization.management_exposure": "0.8.0",
  "logging.visibility_test": "0.5.0",
  "logging.alert_test": "0.5.0",
  "backup.restore_test": "0.5.0",
} as const);

export function foundationTestEngineMinimum(testType: string): string | undefined {
  return FOUNDATION_TEST_ENGINE_MINIMUM[testType as keyof typeof FOUNDATION_TEST_ENGINE_MINIMUM];
}

function matchingCapabilityIds(
  definitions: readonly CapabilityDefinition[],
  claimKind: "resource" | "test" | "connection" | "rule",
  value: string,
): readonly string[] {
  const ids = new Set<string>();
  for (const def of definitions) {
    const claims = def.claims;
    if (!claims) continue;
    let matched = false;
    if (claimKind === "resource") matched = (claims.resourceTypePrefixes ?? []).some((p) => value.startsWith(p));
    if (claimKind === "test") matched = (claims.testTypePrefixes ?? []).some((p) => value.startsWith(p));
    if (claimKind === "connection") matched = (claims.connectionKinds ?? []).includes(value);
    if (claimKind === "rule") matched = (claims.ruleOps ?? []).includes(value);
    if (matched) ids.add(def.id);
  }
  return [...ids].sort();
}

function requireClaimedCapability(
  ctx: SemanticValidationContext,
  diagnostics: CompilerDiagnostic[],
  claimKind: "resource" | "test" | "connection" | "rule",
  value: string,
  path: string,
): void {
  if (claimKind === "resource" && value.startsWith("actor.")) return;
  const ids = matchingCapabilityIds(ctx.capabilityDefinitions, claimKind, value);
  if (ids.length === 0) {
    // Resource types are extensible and may be purely presentational in early packs.
    if (claimKind === "resource") {
      diagnostics.push(warning(
        "RESOURCE_TYPE_UNCLAIMED",
        path,
        `Resource type '${value}' is not claimed by any available capability; compiler preserves it but no Engine semantics are guaranteed.`,
      ));
      return;
    }
    diagnostics.push(error(
      "SEMANTIC_TYPE_UNSUPPORTED",
      path,
      `${claimKind} semantic '${value}' is not claimed by any available capability.`,
    ));
    return;
  }
  if (ids.length > 1) {
    diagnostics.push(error(
      "CAPABILITY_CLAIM_AMBIGUOUS",
      path,
      `${claimKind} semantic '${value}' is claimed by multiple capabilities: ${ids.join(", ")}.`,
    ));
    return;
  }
  const id = ids[0]!;
  if (!ctx.resolvedCapabilityIds.has(id)) {
    diagnostics.push(error(
      "CAPABILITY_NOT_DECLARED",
      path,
      `${claimKind} semantic '${value}' requires capability '${id}', but the scenario did not declare a compatible requirement.`,
      `Add '${id}' to requires.capabilities with a supported version range.`,
    ));
  }
}


function validPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function validLiteralIpv4(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && String(Number(part)) === part);
}

// This Foundation phase supports one explicit IPv4 source rewrite; no PAT/NAT66/port-pool simulation.
function validateSourceNat(
  properties: Readonly<Record<string, unknown>>,
  resourceId: string,
  path: string,
  resources: ReadonlySet<string>,
  zones: ReadonlySet<string>,
  diagnostics: CompilerDiagnostic[],
): void {
  const snatPolicy = properties.snatPolicy;
  if (snatPolicy !== undefined && snatPolicy !== "required" && snatPolicy !== "optional") {
    diagnostics.push(error("SNAT_POLICY_INVALID", `${path}.properties.snatPolicy`, `Resource '${resourceId}' has unsupported snatPolicy.`));
  }
  const rules = properties.natRules;
  if (snatPolicy !== undefined && rules !== undefined && !Array.isArray(rules)) {
    diagnostics.push(error("SNAT_RULES_INVALID", `${path}.properties.natRules`, `Resource '${resourceId}' natRules must be an array when SNAT policy is configured.`));
    return;
  }
  if (snatPolicy === "required" && rules === undefined) {
    diagnostics.push(error("SNAT_RULES_REQUIRED", `${path}.properties.natRules`, `Resource '${resourceId}' requires explicit SNAT rules.`));
    return;
  }
  if (!Array.isArray(rules)) return;
  rules.forEach((rule: unknown, index: number) => {
    if (typeof rule !== "object" || rule === null || Array.isArray(rule)) return;
    const raw = rule as Readonly<Record<string, unknown>>;
    if (raw.type !== "snat") return;
    const base = `${path}.properties.natRules[${index}]`;
    if (!validLiteralIpv4(raw.translatedSource)) {
      diagnostics.push(error("SNAT_TRANSLATED_SOURCE_INVALID", `${base}.translatedSource`, `SNAT on '${resourceId}' requires a literal translatedSource IPv4 address.`));
    }
    if (raw.translatedPort !== undefined) {
      diagnostics.push(error("SNAT_PORT_TRANSLATION_UNSUPPORTED", `${base}.translatedPort`, "Foundation SNAT does not support port-address translation."));
    }
    if (raw.port !== undefined && !validPort(raw.port)) diagnostics.push(error("SNAT_PORT_INVALID", `${base}.port`, "SNAT port must be an integer 1..65535."));
    if (raw.protocol !== undefined && !["tcp", "udp", "icmp", "any"].includes(String(raw.protocol))) {
      diagnostics.push(error("SNAT_PROTOCOL_INVALID", `${base}.protocol`, "Unsupported SNAT protocol."));
    }
    if (raw.action !== undefined && !["allow", "translate", "deny", "block"].includes(String(raw.action))) {
      diagnostics.push(error("SNAT_ACTION_INVALID", `${base}.action`, "Unsupported SNAT action."));
    }
    for (const field of ["source", "destination"] as const) {
      const selector = raw[field];
      if (selector === undefined || selector === "any" || selector === "*" || (typeof selector === "string" && (resources.has(selector) || zones.has(selector)))) continue;
      if (typeof selector === "string" && selector.includes("/")) {
        const [ip, prefix] = selector.split("/");
        if (ip !== undefined && validLiteralIpv4(ip) && prefix !== undefined && /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32) continue;
      }
      diagnostics.push(error("SNAT_SELECTOR_INVALID", `${base}.${field}`, `SNAT ${field} must be a declared resource/zone, any, or valid IPv4 CIDR.`));
    }
  });
}


function validDnsRecordName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/\s/.test(value);
}

// Phase 93 authoring contract: DNS configuration stays explicit and literal.
// Runtime ambiguity (for example duplicate modeled records) remains an Engine-owned UNKNOWN decision,
// so the compiler validates shape/addresses without collapsing legitimate adversarial state.
function validateDnsModel(
  properties: Readonly<Record<string, unknown>>,
  resourceId: string,
  path: string,
  diagnostics: CompilerDiagnostic[],
): void {
  const resolvers = properties.dnsServers;
  if (resolvers !== undefined) {
    const resolverPath = `${path}.properties.dnsServers`;
    if (!Array.isArray(resolvers)) {
      diagnostics.push(error("DNS_SERVERS_INVALID", resolverPath, `Resource '${resourceId}' dnsServers must be an array.`));
    } else {
      const seen = new Set<string>();
      resolvers.forEach((resolver: unknown, index: number) => {
        const itemPath = `${resolverPath}[${index}]`;
        if (!validLiteralIpv4(resolver)) {
          diagnostics.push(error("DNS_SERVER_ADDRESS_INVALID", itemPath, "DNS server must be a literal IPv4 address."));
          return;
        }
        if (seen.has(resolver)) diagnostics.push(error("DNS_SERVERS_DUPLICATE", itemPath, `Duplicate DNS server '${resolver}'.`));
        seen.add(resolver);
      });
    }
  }

  const rawDns = properties.dns;
  if (rawDns === undefined) return;
  const dnsPath = `${path}.properties.dns`;
  if (typeof rawDns !== "object" || rawDns === null || Array.isArray(rawDns)) {
    diagnostics.push(error("DNS_SERVICE_INVALID", dnsPath, `Resource '${resourceId}' dns must be an object when supplied.`));
    return;
  }
  const dns = rawDns as Readonly<Record<string, unknown>>;
  if (dns.enabled !== undefined && typeof dns.enabled !== "boolean") {
    diagnostics.push(error("DNS_SERVICE_ENABLED_INVALID", `${dnsPath}.enabled`, "DNS enabled must be boolean when supplied."));
  }
  if (dns.records === undefined) return;
  if (!Array.isArray(dns.records)) {
    diagnostics.push(error("DNS_RECORDS_INVALID", `${dnsPath}.records`, "DNS records must be an array when supplied."));
    return;
  }
  dns.records.forEach((record: unknown, index: number) => {
    const recordPath = `${dnsPath}.records[${index}]`;
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      diagnostics.push(error("DNS_RECORD_INVALID", recordPath, "DNS record must be an object."));
      return;
    }
    const row = record as Readonly<Record<string, unknown>>;
    const name = row.name ?? row.hostname ?? row.fqdn;
    if (!validDnsRecordName(name)) diagnostics.push(error("DNS_RECORD_NAME_INVALID", `${recordPath}.name`, "DNS record requires a non-empty name/hostname/fqdn without whitespace."));
    if (!validLiteralIpv4(row.address)) diagnostics.push(error("DNS_RECORD_ADDRESS_INVALID", `${recordPath}.address`, "Phase 93 A-like DNS record address must be a literal IPv4 address."));
  });
}


function validateFirewallScope(
  resourceType: string,
  properties: Readonly<Record<string, unknown>>,
  resourceId: string,
  path: string,
  diagnostics: CompilerDiagnostic[],
): void {
  const marker = properties.isFirewall;
  if (marker !== undefined && typeof marker !== "boolean") {
    diagnostics.push(error("FIREWALL_MARKER_INVALID", `${path}.properties.isFirewall`, "isFirewall must be boolean when supplied."));
    return;
  }
  if (resourceType === "network.firewall") {
    if (marker === false) diagnostics.push(error("NETWORK_FIREWALL_MARKER_CONTRADICTION", `${path}.properties.isFirewall`, `Network firewall '${resourceId}' cannot declare isFirewall=false.`));
    return;
  }
  const declaresFirewallPolicy = properties.rules !== undefined || properties.defaultAction !== undefined;
  if (declaresFirewallPolicy && marker !== true) {
    diagnostics.push(error("LOCAL_FIREWALL_MARKER_REQUIRED", `${path}.properties.isFirewall`, `Resource '${resourceId}' declares firewall policy but is not a network.firewall; set isFirewall=true to classify it as a local host firewall.`));
  }
}


function declaredServiceNames(properties: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const names = new Set<string>();
  const explicit = properties.services;
  if (Array.isArray(explicit)) {
    explicit.forEach((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return;
      const row = item as Readonly<Record<string, unknown>>;
      if (typeof row.name === "string" && row.name.length > 0) names.add(row.name);
      else if (typeof row.id === "string" && row.id.length > 0) names.add(row.id);
    });
  }
  for (const [name, value] of Object.entries(properties)) {
    if (name === "services" || name === "hostStack" || typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const row = value as Readonly<Record<string, unknown>>;
    if (typeof row.enabled === "boolean" || typeof row.port === "number") names.add(name);
  }
  return names;
}


function validateDhcpModel(
  properties: Readonly<Record<string, unknown>>,
  resourceId: string,
  resourceType: string,
  path: string,
  resources: ReadonlySet<string>,
  diagnostics: CompilerDiagnostic[],
): void {
  const raw = properties.dhcp;
  if (raw === undefined) return;
  const base = `${path}.properties.dhcp`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    diagnostics.push(error("DHCP_STATE_INVALID", base, `Resource '${resourceId}' dhcp must be an object.`));
    return;
  }
  const dhcp = raw as Readonly<Record<string, unknown>>;
  if (dhcp.enabled !== undefined && typeof dhcp.enabled !== "boolean") diagnostics.push(error("DHCP_ENABLED_INVALID", `${base}.enabled`, "dhcp.enabled must be boolean when supplied."));
  if (dhcp.gateway !== undefined && !validLiteralIpv4(dhcp.gateway)) diagnostics.push(error("DHCP_GATEWAY_INVALID", `${base}.gateway`, "DHCP gateway option must be a literal IPv4 address."));
  if (dhcp.prefixLength !== undefined && (!Number.isInteger(dhcp.prefixLength) || (dhcp.prefixLength as number) < 0 || (dhcp.prefixLength as number) > 32)) diagnostics.push(error("DHCP_PREFIX_INVALID", `${base}.prefixLength`, "DHCP prefixLength must be an integer 0..32."));
  if (dhcp.dnsServers !== undefined) {
    if (!Array.isArray(dhcp.dnsServers)) diagnostics.push(error("DHCP_DNS_SERVERS_INVALID", `${base}.dnsServers`, "DHCP dnsServers must be an array."));
    else {
      const seen = new Set<string>();
      dhcp.dnsServers.forEach((value: unknown,index:number) => {
        if (!validLiteralIpv4(value)) diagnostics.push(error("DHCP_DNS_SERVER_INVALID", `${base}.dnsServers[${index}]`, "DHCP DNS server must be a literal IPv4 address."));
        else if (seen.has(value)) diagnostics.push(error("DHCP_DNS_SERVER_DUPLICATE", `${base}.dnsServers[${index}]`, `Duplicate DHCP DNS server '${value}'.`));
        else seen.add(value);
      });
    }
  }
  if (dhcp.availableLeases !== undefined && (!Number.isInteger(dhcp.availableLeases) || (dhcp.availableLeases as number) < 0)) diagnostics.push(error("DHCP_AVAILABLE_LEASES_INVALID", `${base}.availableLeases`, "DHCP availableLeases must be a non-negative integer."));
  if (dhcp.offers !== undefined) {
    if (resourceType !== "network.dhcp_server") diagnostics.push(error("DHCP_OFFERS_SERVER_ONLY", `${base}.offers`, "DHCP offers are modeled only on network.dhcp_server resources."));
    if (!Array.isArray(dhcp.offers)) diagnostics.push(error("DHCP_OFFERS_INVALID", `${base}.offers`, "DHCP offers must be an array when supplied."));
    else dhcp.offers.forEach((offer: unknown,index:number) => {
      const offerPath=`${base}.offers[${index}]`;
      if (typeof offer !== "object" || offer === null || Array.isArray(offer)) { diagnostics.push(error("DHCP_OFFER_INVALID", offerPath, "DHCP offer must be an object.")); return; }
      const row=offer as Readonly<Record<string, unknown>>;
      if (typeof row.client !== "string" || !resources.has(row.client)) diagnostics.push(error("DHCP_OFFER_CLIENT_INVALID", `${offerPath}.client`, "DHCP offer client must reference a declared resource."));
      if (!validLiteralIpv4(row.address)) diagnostics.push(error("DHCP_OFFER_ADDRESS_INVALID", `${offerPath}.address`, "DHCP offer address must be a literal IPv4 address."));
    });
  }
}

function validateHostStack(
  properties: Readonly<Record<string, unknown>>,
  resourceId: string,
  path: string,
  diagnostics: CompilerDiagnostic[],
): void {
  const raw = properties.hostStack;
  if (raw === undefined) return;
  const base = `${path}.properties.hostStack`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    diagnostics.push(error("HOST_STACK_INVALID", base, `Resource '${resourceId}' hostStack must be an object.`));
    return;
  }
  const stack = raw as Readonly<Record<string, unknown>>;
  if (typeof stack.complete !== "boolean") diagnostics.push(error("HOST_STACK_COMPLETE_INVALID", `${base}.complete`, "hostStack.complete must be boolean."));
  if (!Array.isArray(stack.processes)) diagnostics.push(error("HOST_STACK_PROCESSES_INVALID", `${base}.processes`, "hostStack.processes must be an array."));
  if (!Array.isArray(stack.sockets)) diagnostics.push(error("HOST_STACK_SOCKETS_INVALID", `${base}.sockets`, "hostStack.sockets must be an array."));
  const services = declaredServiceNames(properties);
  const processIds = new Set<string>();
  const processServices = new Map<string, string>();
  if (Array.isArray(stack.processes)) {
    stack.processes.forEach((item: unknown, index: number) => {
      const rowPath = `${base}.processes[${index}]`;
      if (typeof item !== "object" || item === null || Array.isArray(item)) return;
      const row = item as Readonly<Record<string, unknown>>;
      if (typeof row.id === "string") {
        if (processIds.has(row.id)) diagnostics.push(error("HOST_STACK_PROCESS_ID_DUPLICATE", `${rowPath}.id`, `Duplicate host-stack process id '${row.id}'.`));
        processIds.add(row.id);
      }
      if (typeof row.service === "string") {
        if (!services.has(row.service)) diagnostics.push(error("HOST_STACK_PROCESS_SERVICE_UNKNOWN", `${rowPath}.service`, `Process service '${row.service}' is not declared on '${resourceId}'.`));
        if (typeof row.id === "string") processServices.set(row.id, row.service);
      }
    });
  }
  const socketIds = new Set<string>();
  if (Array.isArray(stack.sockets)) {
    stack.sockets.forEach((item: unknown, index: number) => {
      const rowPath = `${base}.sockets[${index}]`;
      if (typeof item !== "object" || item === null || Array.isArray(item)) return;
      const row = item as Readonly<Record<string, unknown>>;
      if (typeof row.id === "string") {
        if (socketIds.has(row.id)) diagnostics.push(error("HOST_STACK_SOCKET_ID_DUPLICATE", `${rowPath}.id`, `Duplicate host-stack socket id '${row.id}'.`));
        socketIds.add(row.id);
      }
      if (typeof row.processId === "string" && !processIds.has(row.processId)) diagnostics.push(error("HOST_STACK_SOCKET_PROCESS_UNKNOWN", `${rowPath}.processId`, `Socket process '${row.processId}' is not declared in hostStack.processes.`));
      if (typeof row.service === "string" && !services.has(row.service)) diagnostics.push(error("HOST_STACK_SOCKET_SERVICE_UNKNOWN", `${rowPath}.service`, `Socket service '${row.service}' is not declared on '${resourceId}'.`));
      if (typeof row.processId === "string" && typeof row.service === "string") {
        const processService = processServices.get(row.processId);
        if (processService !== undefined && processService !== row.service) diagnostics.push(error("HOST_STACK_SERVICE_BINDING_MISMATCH", `${rowPath}.service`, `Socket service '${row.service}' disagrees with owning process service '${processService}'.`));
      }
      const tcpStates = new Set(["LISTEN", "SYN_SENT", "SYN_RECEIVED", "ESTABLISHED", "FIN_WAIT_1", "FIN_WAIT_2", "CLOSE_WAIT", "CLOSING", "LAST_ACK", "TIME_WAIT", "CLOSED", "UNKNOWN"]);
      const udpStates = new Set(["BOUND", "ESTABLISHED", "CLOSED", "UNKNOWN"]);
      if (row.protocol === "udp" && row.state === "LISTEN") diagnostics.push(error("HOST_STACK_UDP_LISTEN_INVALID", `${rowPath}.state`, "UDP listener sockets use BOUND rather than TCP LISTEN in this bounded host-stack model."));
      else if (row.protocol === "udp" && typeof row.state === "string" && !udpStates.has(row.state)) diagnostics.push(error("HOST_STACK_UDP_STATE_INVALID", `${rowPath}.state`, `UDP socket state '${row.state}' is not valid in the bounded UDP host-stack model.`));
      if (row.protocol === "tcp" && row.state === "BOUND") diagnostics.push(error("HOST_STACK_TCP_BOUND_INVALID", `${rowPath}.state`, "TCP listening sockets use LISTEN rather than UDP BOUND in this bounded host-stack model."));
      else if (row.protocol === "tcp" && typeof row.state === "string" && !tcpStates.has(row.state)) diagnostics.push(error("HOST_STACK_TCP_STATE_INVALID", `${rowPath}.state`, `TCP socket state '${row.state}' is not valid in the bounded TCP state machine.`));
      else if (row.protocol === "tcp" && typeof row.state === "string" && !["LISTEN", "CLOSED", "UNKNOWN"].includes(row.state)
          && (typeof row.remoteAddress !== "string" || !row.remoteAddress || !Number.isInteger(row.remotePort))) {
        diagnostics.push(error("HOST_STACK_TCP_PEER_REQUIRED", rowPath, `TCP session state '${row.state}' requires explicit remoteAddress and remotePort so the modeled session can be bound to a peer.`));
      }
    });
  }
}

function validateSourceConntrack(
  properties: Readonly<Record<string, unknown>>,
  resourceId: string,
  path: string,
  resources: ReadonlySet<string>,
  diagnostics: CompilerDiagnostic[],
): void {
  const raw = properties.conntrack;
  if (raw !== undefined) {
    const base = `${path}.properties.conntrack`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      diagnostics.push(error("CONNTRACK_TABLE_INVALID", base, `Resource '${resourceId}' conntrack must be an object.`));
    } else {
      const table = raw as Readonly<Record<string, unknown>>;
      if (typeof table.complete !== "boolean") diagnostics.push(error("CONNTRACK_COMPLETE_INVALID", `${base}.complete`, "conntrack.complete must be boolean."));
      if (!Array.isArray(table.entries)) {
        diagnostics.push(error("CONNTRACK_ENTRIES_INVALID", `${base}.entries`, "conntrack.entries must be an array."));
      } else {
        const seen = new Set<string>();
        table.entries.forEach((entry: unknown, index: number) => {
          const entryPath = `${base}.entries[${index}]`;
          if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
            diagnostics.push(error("CONNTRACK_ENTRY_INVALID", entryPath, "Conntrack entry must be an object."));
            return;
          }
          const row = entry as Readonly<Record<string, unknown>>;
          if (typeof row.id !== "string" || row.id.length === 0) diagnostics.push(error("CONNTRACK_ENTRY_ID_INVALID", `${entryPath}.id`, "Conntrack entry requires a non-empty id."));
          else if (seen.has(row.id)) diagnostics.push(error("CONNTRACK_ENTRY_ID_DUPLICATE", `${entryPath}.id`, `Duplicate conntrack entry id '${row.id}'.`));
          else seen.add(row.id);
          if (row.enabled !== undefined && typeof row.enabled !== "boolean") diagnostics.push(error("CONNTRACK_ENTRY_ENABLED_INVALID", `${entryPath}.enabled`, "Conntrack enabled must be boolean when supplied."));
          if (!validLiteralIpv4(row.source)) diagnostics.push(error("CONNTRACK_SOURCE_INVALID", `${entryPath}.source`, "Conntrack source must be a literal IPv4 address."));
          if (typeof row.destination !== "string" || !resources.has(row.destination)) diagnostics.push(error("CONNTRACK_DESTINATION_INVALID", `${entryPath}.destination`, "Conntrack destination must reference a declared resource."));
          if (row.protocol !== "tcp" && row.protocol !== "udp" && row.protocol !== "icmp") diagnostics.push(error("CONNTRACK_PROTOCOL_INVALID", `${entryPath}.protocol`, "Conntrack protocol must be tcp, udp or icmp."));
          if (row.protocol === "icmp") {
            if (row.port !== undefined) diagnostics.push(error("CONNTRACK_PORT_INVALID", `${entryPath}.port`, "ICMP conntrack entries do not declare a transport port in this phase."));
          } else if (!validPort(row.port)) diagnostics.push(error("CONNTRACK_PORT_INVALID", `${entryPath}.port`, "TCP/UDP conntrack entries require an integer destination port 1..65535."));
          if (!["NEW", "ESTABLISHED", "RELATED", "INVALID", "UNKNOWN"].includes(String(row.state))) diagnostics.push(error("CONNTRACK_STATE_INVALID", `${entryPath}.state`, "Conntrack state must be NEW, ESTABLISHED, RELATED, INVALID or UNKNOWN."));
        });
      }
    }
  }

  const rules = properties.rules;
  if (!Array.isArray(rules)) return;
  rules.forEach((rule: unknown, index: number) => {
    if (typeof rule !== "object" || rule === null || Array.isArray(rule)) return;
    const row = rule as Readonly<Record<string, unknown>>;
    if (row.connectionState === undefined) return;
    const statePath = `${path}.properties.rules[${index}].connectionState`;
    if (!["NEW", "ESTABLISHED", "RELATED", "INVALID"].includes(String(row.connectionState))) {
      diagnostics.push(error("FIREWALL_CONNECTION_STATE_INVALID", statePath, "Firewall connectionState must be NEW, ESTABLISHED, RELATED or INVALID."));
      return;
    }
    if (raw === undefined) diagnostics.push(error("FIREWALL_CONNTRACK_REQUIRED", statePath, `Stateful firewall rule on '${resourceId}' requires an explicit conntrack table on the same resource.`));
  });
}


function validateFoundationTestParams(
  test: ScenarioSource["tests"][number],
  path: string,
  resources: ReadonlySet<string>,
  diagnostics: CompilerDiagnostic[],
): void {
  const params = test.params;
  const requireStringResource = (key: string): string | undefined => {
    const value = params[key];
    if (typeof value !== "string" || value.length === 0) {
      diagnostics.push(error("TEST_PARAM_REQUIRED", `${path}.params.${key}`, `Test '${test.type}' requires non-empty string params.${key}.`));
      return undefined;
    }
    if (!resources.has(value)) diagnostics.push(error("UNKNOWN_RESOURCE_REFERENCE", `${path}.params.${key}`, `Unknown resource '${value}'.`));
    return value;
  };

  if (test.type === "network.port_scan") {
    requireStringResource("from");
    requireStringResource("to");
    const protocol = params.protocol;
    if (protocol !== undefined && protocol !== "tcp" && protocol !== "udp") {
      diagnostics.push(error("TEST_PARAM_INVALID", `${path}.params.protocol`, "network.port_scan protocol must be tcp or udp when supplied."));
    }
    const singleValid = validPort(params.port);
    const ports = params.ports;
    const listValid = Array.isArray(ports) && ports.length > 0 && ports.every(validPort);
    if (!singleValid && !listValid) {
      diagnostics.push(error("TEST_PARAM_REQUIRED", `${path}.params`, "network.port_scan requires params.port or a non-empty params.ports array of integers 1..65535."));
    }
    return;
  }

  if (test.type === "virtualization.management_exposure") {
    requireStringResource("from");
    requireStringResource("to");
    if (!validPort(params.port)) diagnostics.push(error("TEST_PARAM_REQUIRED", `${path}.params.port`, "virtualization.management_exposure requires integer params.port in range 1..65535."));
    const protocol = params.protocol;
    if (protocol !== undefined && protocol !== "tcp" && protocol !== "udp") {
      diagnostics.push(error("TEST_PARAM_INVALID", `${path}.params.protocol`, "virtualization.management_exposure protocol must be tcp or udp when supplied."));
    }
    return;
  }

  if (
    test.type === "identity.password_audit"
    || test.type === "logging.visibility_test"
    || test.type === "logging.alert_test"
    || test.type === "backup.restore_test"
  ) {
    requireStringResource("target");
    if (params.path !== undefined && (typeof params.path !== "string" || params.path.length === 0)) {
      diagnostics.push(error("TEST_PARAM_INVALID", `${path}.params.path`, `${test.type} params.path must be a non-empty string when supplied.`));
    }
    if (params.equals !== undefined && typeof params.equals !== "boolean") {
      diagnostics.push(error("TEST_PARAM_INVALID", `${path}.params.equals`, `${test.type} params.equals must be boolean when supplied.`));
    }
  }
}

function validateRule(
  rule: Scenariosourcerule,
  path: string,
  resources: ReadonlySet<string>,
  tests: ReadonlySet<string>,
  ctx: SemanticValidationContext,
  diagnostics: CompilerDiagnostic[],
): void {
  if (rule.op === "reachable" || rule.op === "member_of" || rule.op === "has_permission") {
    requireClaimedCapability(ctx, diagnostics, "rule", rule.op, `${path}.op`);
  }
  switch (rule.op) {
    case "all":
    case "any":
      rule.rules.forEach((r, i) => validateRule(r, `${path}.rules[${i}]`, resources, tests, ctx, diagnostics));
      return;
    case "not":
      validateRule(rule.rule, `${path}.rule`, resources, tests, ctx, diagnostics);
      return;
    case "equals":
    case "service_enabled":
      if (!resources.has(rule.target)) diagnostics.push(error("UNKNOWN_RESOURCE_REFERENCE", `${path}.target`, `Unknown resource '${rule.target}'.`));
      return;
    case "reachable":
      if (!resources.has(rule.from)) diagnostics.push(error("UNKNOWN_RESOURCE_REFERENCE", `${path}.from`, `Unknown resource '${rule.from}'.`));
      if (!resources.has(rule.to)) diagnostics.push(error("UNKNOWN_RESOURCE_REFERENCE", `${path}.to`, `Unknown resource '${rule.to}'.`));
      return;
    case "member_of":
      if (!resources.has(rule.subject)) diagnostics.push(error("UNKNOWN_RESOURCE_REFERENCE", `${path}.subject`, `Unknown resource '${rule.subject}'.`));
      if (!resources.has(rule.group)) diagnostics.push(error("UNKNOWN_RESOURCE_REFERENCE", `${path}.group`, `Unknown resource '${rule.group}'.`));
      return;
    case "has_permission":
      if (!resources.has(rule.subject)) diagnostics.push(error("UNKNOWN_RESOURCE_REFERENCE", `${path}.subject`, `Unknown resource '${rule.subject}'.`));
      if (!resources.has(rule.resource)) diagnostics.push(error("UNKNOWN_RESOURCE_REFERENCE", `${path}.resource`, `Unknown resource '${rule.resource}'.`));
      return;
    case "test_result":
      if (!tests.has(rule.test)) diagnostics.push(error("UNKNOWN_TEST_REFERENCE", `${path}.test`, `Unknown test '${rule.test}'.`));
      return;
  }
}

export function validateScenarioSemantics(
  source: ScenarioSource,
  ctx: SemanticValidationContext,
): readonly CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const idOwner = new Map<string, string>();
  const register = (id: string, path: string): void => {
    const previous = idOwner.get(id);
    if (previous) diagnostics.push(error("DUPLICATE_GLOBAL_ID", path, `ID '${id}' is already used at ${previous}.`));
    else idOwner.set(id, path);
  };

  source.zones.forEach((z, i) => register(z.id, `zones[${i}].id`));
  source.resources.forEach((r, i) => register(r.id, `resources[${i}].id`));
  source.connections.forEach((c, i) => register(c.id, `connections[${i}].id`));
  source.tests.forEach((t, i) => register(t.id, `tests[${i}].id`));
  source.findings.forEach((f, i) => register(f.id, `findings[${i}].id`));
  source.objectives.forEach((o, i) => register(o.id, `objectives[${i}].id`));
  (source.troubleshootingObjectives ?? []).forEach((o, i) => register(o.id, `troubleshootingObjectives[${i}].id`));
  (source.notes ?? []).forEach((n, i) => register(n.id, `notes[${i}].id`));

  const zones = new Set(source.zones.map((x) => x.id));
  const resources = new Set(source.resources.map((x) => x.id));
  const tests = new Set(source.tests.map((x) => x.id));

  const zoneParent = new Map<string, string>();
  source.zones.forEach((zone, i) => {
    if (zone.parent !== undefined) {
      if (!zones.has(zone.parent)) diagnostics.push(error("UNKNOWN_ZONE_REFERENCE", `zones[${i}].parent`, `Unknown parent zone '${zone.parent}'.`));
      else zoneParent.set(zone.id, zone.parent);
    }
  });
  for (const zone of source.zones) {
    const seen = new Set<string>();
    let current: string | undefined = zone.id;
    while (current !== undefined) {
      if (seen.has(current)) {
        diagnostics.push(error("ZONE_PARENT_CYCLE", `zones`, `Zone parent cycle detected involving '${current}'.`));
        break;
      }
      seen.add(current);
      current = zoneParent.get(current);
    }
  }

  source.resources.forEach((resource, i) => {
    if (resource.zone !== undefined && !zones.has(resource.zone)) {
      diagnostics.push(error("UNKNOWN_ZONE_REFERENCE", `resources[${i}].zone`, `Unknown zone '${resource.zone}'.`));
    }
    const interfaceIds = new Set<string>();
    (resource.interfaces ?? []).forEach((iface, j) => {
      if (interfaceIds.has(iface.id)) diagnostics.push(error("DUPLICATE_INTERFACE_ID", `resources[${i}].interfaces[${j}].id`, `Duplicate interface ID '${iface.id}' on resource '${resource.id}'.`));
      interfaceIds.add(iface.id);
    });
    if (resource.profile !== undefined) {
      if (!ctx.profileIdsInCatalog.has(resource.profile)) {
        diagnostics.push(error("PROFILE_UNAVAILABLE", `resources[${i}].profile`, `Profile '${resource.profile}' is not available in the catalog.`));
      } else if (!ctx.resolvedProfileIds.has(resource.profile)) {
        diagnostics.push(error(
          "PROFILE_NOT_DECLARED",
          `resources[${i}].profile`,
          `Resource '${resource.id}' uses profile '${resource.profile}' but the scenario does not declare a compatible profile requirement.`,
          `Add '${resource.profile}' to requires.profiles.`,
        ));
      }
    }
    requireClaimedCapability(ctx, diagnostics, "resource", resource.type, `resources[${i}].type`);
    validateFirewallScope(resource.type, resource.properties, resource.id, `resources[${i}]`, diagnostics);
    validateDnsModel(resource.properties, resource.id, `resources[${i}]`, diagnostics);
    validateDhcpModel(resource.properties, resource.id, resource.type, `resources[${i}]`, resources, diagnostics);
    validateSourceNat(resource.properties, resource.id, `resources[${i}]`, resources, zones, diagnostics);
    validateSourceConntrack(resource.properties, resource.id, `resources[${i}]`, resources, diagnostics);
    validateHostStack(resource.properties, resource.id, `resources[${i}]`, diagnostics);
  });

  const resourceById = new Map(source.resources.map((r) => [r.id, r] as const));
  source.connections.forEach((connection, i) => {
    requireClaimedCapability(ctx, diagnostics, "connection", connection.kind, `connections[${i}].kind`);
    for (const side of ["from", "to"] as const) {
      const endpoint = connection[side];
      const resource = resourceById.get(endpoint.resource);
      if (!resource) {
        diagnostics.push(error("UNKNOWN_RESOURCE_REFERENCE", `connections[${i}].${side}.resource`, `Unknown resource '${endpoint.resource}'.`));
        continue;
      }
      if (endpoint.port !== undefined && !(resource.interfaces ?? []).some((x) => x.id === endpoint.port)) {
        diagnostics.push(error("UNKNOWN_INTERFACE_REFERENCE", `connections[${i}].${side}.port`, `Resource '${resource.id}' has no interface '${endpoint.port}'.`));
      }
    }
  });

  source.tests.forEach((test, i) => {
    requireClaimedCapability(ctx, diagnostics, "test", test.type, `tests[${i}].type`);
    if (!foundationTestEngineMinimum(test.type)) {
      diagnostics.push(error(
        "TEST_TYPE_UNIMPLEMENTED",
        `tests[${i}].type`,
        `Test type '${test.type}' is claimed by a capability but has no trusted Foundation Engine evaluator in this build.`,
      ));
    }
    validateFoundationTestParams(test, `tests[${i}]`, resources, diagnostics);
  });

  source.findings.forEach((finding, i) => {
    (finding.evidenceTests ?? []).forEach((testId, j) => {
      if (!tests.has(testId)) diagnostics.push(error("UNKNOWN_TEST_REFERENCE", `findings[${i}].evidenceTests[${j}]`, `Unknown test '${testId}'.`));
    });
    validateRule(finding.when, `findings[${i}].when`, resources, tests, ctx, diagnostics);
  });

  source.objectives.forEach((objective, i) => {
    validateRule(objective.condition, `objectives[${i}].condition`, resources, tests, ctx, diagnostics);
  });

  (source.troubleshootingObjectives ?? []).forEach((objective, i) => {
    const requirementIds = new Set<string>();
    objective.requirements.forEach((requirement, j) => {
      const path = `troubleshootingObjectives[${i}].requirements[${j}]`;
      if (requirementIds.has(requirement.id)) diagnostics.push(error("DUPLICATE_TROUBLESHOOTING_REQUIREMENT_ID", `${path}.id`, `Requirement ID '${requirement.id}' is duplicated within troubleshooting objective '${objective.id}'.`));
      requirementIds.add(requirement.id);
      if (requirement.kind === "observation") {
        const hasSelector = requirement.category !== undefined || requirement.targetId !== undefined || requirement.command !== undefined;
        if (!hasSelector) diagnostics.push(error("TROUBLESHOOTING_REQUIREMENT_EMPTY", path, `Observation requirement '${requirement.id}' must declare at least one explicit matcher.`));
        if (requirement.targetId !== undefined && !resources.has(requirement.targetId)) diagnostics.push(error("UNKNOWN_TROUBLESHOOTING_TARGET", `${path}.targetId`, `Unknown troubleshooting observation target '${requirement.targetId}'.`));
      } else {
        const hasSelector = requirement.category !== undefined || requirement.sourceId !== undefined || requirement.destinationId !== undefined || requirement.protocol !== undefined || requirement.port !== undefined || requirement.queryName !== undefined || requirement.truth !== undefined;
        if (!hasSelector) diagnostics.push(error("TROUBLESHOOTING_REQUIREMENT_EMPTY", path, `Active-probe requirement '${requirement.id}' must declare at least one explicit matcher.`));
        if (requirement.sourceId !== undefined && !resources.has(requirement.sourceId)) diagnostics.push(error("UNKNOWN_TROUBLESHOOTING_SOURCE", `${path}.sourceId`, `Unknown troubleshooting probe source '${requirement.sourceId}'.`));
        if (requirement.destinationId !== undefined && !resources.has(requirement.destinationId)) diagnostics.push(error("UNKNOWN_TROUBLESHOOTING_DESTINATION", `${path}.destinationId`, `Unknown troubleshooting probe destination '${requirement.destinationId}'.`));
      }
    });
  });

  validateRule(source.completion, "completion", resources, tests, ctx, diagnostics);

  const noteTargets = new Set([
    ...source.zones.map((item) => item.id),
    ...source.resources.map((item) => item.id),
    ...source.connections.map((item) => item.id),
    ...source.tests.map((item) => item.id),
    ...source.findings.map((item) => item.id),
    ...source.objectives.map((item) => item.id),
    ...(source.troubleshootingObjectives ?? []).map((item) => item.id),
  ]);
  (source.notes ?? []).forEach((note, i) => {
    if (note.target !== undefined && !noteTargets.has(note.target)) {
      diagnostics.push(error("UNKNOWN_NOTE_TARGET", `notes[${i}].target`, `Unknown note target '${note.target}'.`));
    }
  });

  source.canonicalSolution?.operations.forEach((operation, i) => {
    if (!resources.has(operation.target)) diagnostics.push(error("UNKNOWN_SOLUTION_TARGET", `canonicalSolution.operations[${i}].target`, `Unknown resource '${operation.target}'.`));
  });

  const layoutTargets = new Set([...zones, ...resources]);
  source.layoutHints?.forEach((hint, i) => {
    if (!layoutTargets.has(hint.target)) diagnostics.push(error("UNKNOWN_LAYOUT_TARGET", `layoutHints[${i}].target`, `Unknown layout target '${hint.target}'.`));
    if (hint.parent !== undefined && !zones.has(hint.parent)) diagnostics.push(error("UNKNOWN_ZONE_REFERENCE", `layoutHints[${i}].parent`, `Unknown layout parent zone '${hint.parent}'.`));
  });

  return diagnostics;
}
