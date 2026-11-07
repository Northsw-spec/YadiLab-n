import { queryHostStackView, readPath } from "../../engine/src/index.js";
import type { RuntimeResourceState } from "../../engine/src/index.js";
import type {
  ObservationCategory,
  ObservationCommandContext,
  ObservationCommandDefinition,
  ObservationDiagnostic,
  ObservationEvidence,
  ObservationOs,
  ObservationRequest,
  ObservationResult,
} from "./types.js";

export type * from "./types.js";

export const OBSERVATION_ENGINE_ID = "foundation.observation" as const;
export const OBSERVATION_ENGINE_VERSION = "0.2.0" as const;
export const OBSERVATION_EXECUTION_BOUNDARY = "NO_GUEST_COMMAND_EXECUTION" as const;

interface InternalCommand extends ObservationCommandDefinition {
  readonly render: (context: ObservationCommandContext) => readonly string[];
}

const WINDOWS_TYPES = ["windows.domain_controller", "windows.rd_gateway", "windows.rds_host", "windows.server", "windows.workstation"] as const;
const LINUX_TYPES = ["linux.host", "linux.server", "linux.workstation"] as const;

function osForType(type: string): ObservationOs | undefined {
  if (type === "endpoint.windows" || (WINDOWS_TYPES as readonly string[]).includes(type) || type.startsWith("windows.")) return "windows";
  if (type === "endpoint.linux" || (LINUX_TYPES as readonly string[]).includes(type) || type.startsWith("linux.")) return "linux";
  return undefined;
}

function diagnostic(severity: ObservationDiagnostic["severity"], code: string, message: string, path?: string): ObservationDiagnostic {
  return path ? { severity, code, message, path } : { severity, code, message };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(", ")}]`;
  if (value && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record).sort().map((key) => `${key}: ${stableJson(record[key])}`).join(", ")}}`;
  }
  return JSON.stringify(value);
}

function readEvidence(context: ObservationCommandContext, path: string): ObservationEvidence {
  const result = readPath(context.resource, path);
  if (!result.found) {
    const evidence: ObservationEvidence = { path, state: "ABSENT" };
    context.evidence.push(evidence);
    return evidence;
  }
  const evidence: ObservationEvidence = { path, state: "KNOWN", value: result.value };
  context.evidence.push(evidence);
  return evidence;
}

function malformed(context: ObservationCommandContext, evidence: ObservationEvidence, expected: string): ObservationEvidence {
  const replacement: ObservationEvidence = { path: evidence.path, state: "MALFORMED", ...(evidence.value !== undefined ? { value: evidence.value } : {}) };
  context.evidence[context.evidence.length - 1] = replacement;
  context.diagnostics.push(diagnostic("warning", "OBSERVATION_VALUE_MALFORMED", `Modeled value at '${evidence.path}' is not ${expected}; observation remains fail-safe and reports it as malformed.`, evidence.path));
  return replacement;
}

function valueText(evidence: ObservationEvidence, validator: (value: unknown) => boolean, context: ObservationCommandContext, expected: string): string {
  if (evidence.state === "ABSENT") return "<not modeled>";
  if (!validator(evidence.value)) {
    malformed(context, evidence, expected);
    return "<malformed modeled value>";
  }
  return stableJson(evidence.value);
}

function stringValue(context: ObservationCommandContext, path: string): string {
  const evidence = readEvidence(context, path);
  if (evidence.state === "ABSENT") return "<not modeled>";
  if (typeof evidence.value !== "string") {
    malformed(context, evidence, "a string");
    return "<malformed modeled value>";
  }
  return evidence.value;
}

function booleanValue(context: ObservationCommandContext, path: string, yes = "true", no = "false"): string {
  const evidence = readEvidence(context, path);
  if (evidence.state === "ABSENT") return "<not modeled>";
  if (typeof evidence.value !== "boolean") {
    malformed(context, evidence, "a boolean");
    return "<malformed modeled value>";
  }
  return evidence.value ? yes : no;
}

function numberValue(context: ObservationCommandContext, path: string): string {
  const evidence = readEvidence(context, path);
  if (evidence.state === "ABSENT") return "<not modeled>";
  if (typeof evidence.value !== "number" || !Number.isFinite(evidence.value)) {
    malformed(context, evidence, "a finite number");
    return "<malformed modeled value>";
  }
  return String(evidence.value);
}

function stringArray(context: ObservationCommandContext, path: string): string {
  const evidence = readEvidence(context, path);
  if (evidence.state === "ABSENT") return "<not modeled>";
  if (!Array.isArray(evidence.value) || !evidence.value.every((value) => typeof value === "string")) {
    malformed(context, evidence, "an array of strings");
    return "<malformed modeled value>";
  }
  return evidence.value.length ? evidence.value.join(", ") : "<none>";
}

function interfaceLines(context: ObservationCommandContext): readonly string[] {
  const evidence = readEvidence(context, "interfaces");
  if (evidence.state === "ABSENT") return ["Interfaces: <not modeled>"];
  if (!Array.isArray(evidence.value)) {
    malformed(context, evidence, "an interface array");
    return ["Interfaces: <malformed modeled value>"];
  }
  if (evidence.value.length === 0) return ["Interfaces: <none declared>"];
  return evidence.value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `Interface[${index}]: <malformed modeled value>`;
    const iface = raw as Readonly<Record<string, unknown>>;
    const id = typeof iface.id === "string" ? iface.id : `interface-${index}`;
    const label = typeof iface.label === "string" ? iface.label : id;
    const addresses = Array.isArray(iface.addresses) && iface.addresses.every((value) => typeof value === "string") ? iface.addresses as readonly string[] : undefined;
    if (iface.addresses !== undefined && !addresses) context.diagnostics.push(diagnostic("warning", "OBSERVATION_INTERFACE_ADDRESSES_MALFORMED", `Interface '${id}' has malformed modeled addresses.`, `interfaces.${index}.addresses`));
    return `${label} (${id}) addresses: ${addresses ? (addresses.length ? addresses.join(", ") : "<none>") : "<not modeled>"}`;
  });
}

interface ServiceView { readonly name: string; readonly enabled?: boolean; readonly port?: number; readonly protocol?: string; }
function declaredServices(resource: RuntimeResourceState): readonly ServiceView[] {
  const out: ServiceView[] = [];
  const explicit = resource.properties.services;
  if (Array.isArray(explicit)) explicit.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const value = item as Readonly<Record<string, unknown>>;
    out.push({
      name: typeof value.name === "string" ? value.name : typeof value.id === "string" ? value.id : `services[${index}]`,
      ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
      ...(typeof value.port === "number" && Number.isFinite(value.port) ? { port: value.port } : {}),
      ...(typeof value.protocol === "string" ? { protocol: value.protocol.toLowerCase() } : {}),
    });
  });
  for (const [name, raw] of Object.entries(resource.properties)) {
    if (name === "services" || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const value = raw as Readonly<Record<string, unknown>>;
    if (typeof value.enabled !== "boolean" && typeof value.port !== "number") continue;
    out.push({
      name,
      ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
      ...(typeof value.port === "number" && Number.isFinite(value.port) ? { port: value.port } : {}),
      ...(typeof value.protocol === "string" ? { protocol: value.protocol.toLowerCase() } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en") || (a.port ?? -1) - (b.port ?? -1));
}

function listenerLines(context: ObservationCommandContext, platform: ObservationOs): readonly string[] {
  context.evidence.push({ path: "properties.hostStack", state: context.resource.properties.hostStack === undefined ? "ABSENT" : "KNOWN", ...(context.resource.properties.hostStack !== undefined ? { value: context.resource.properties.hostStack } : {}) });
  const stack = queryHostStackView(context.state, context.resource.id);
  if (!stack.value || stack.truth === "UNKNOWN") return ["Listener state: <malformed or untrusted modeled Host Stack evidence>"];

  if (stack.value.model === "EXPLICIT_HOST_STACK") {
    const listeners = stack.value.sockets.filter((socket) => (socket.protocol === "tcp" && socket.state === "LISTEN") || (socket.protocol === "udp" && socket.state === "BOUND"));
    if (!listeners.length) return [stack.value.complete ? "No modeled listening/bound sockets in complete Host Stack snapshot." : "No known listening/bound sockets in partial Host Stack snapshot; absence is not proven."];
    return listeners.map((socket) => `${socket.protocol.toUpperCase()} ${socket.protocol === "tcp" ? "LISTEN" : "BOUND"} ${socket.localAddress}:${socket.localPort} service=${socket.service ?? "<not modeled>"} process=${socket.processId ?? "<not modeled>"}`);
  }

  const services = declaredServices(context.resource);
  const listeners = services.filter((service) => service.enabled === true && service.port !== undefined);
  if (!listeners.length) return ["No declaration-only modeled enabled TCP/UDP listeners."];
  return listeners.map((service) => {
    const protocol = (service.protocol ?? "tcp").toUpperCase();
    return `${protocol} LISTEN ${service.port} service=${service.name} [SERVICE_DECLARATION_ONLY]`;
  });
}

const WINDOWS_SERVICE_NAMES: Readonly<Record<string, string>> = { rdp: "TermService", smb: "LanmanServer", winrm: "WinRM" };
function windowsServiceLines(context: ObservationCommandContext): readonly string[] {
  const services = declaredServices(context.resource).filter((service) => WINDOWS_SERVICE_NAMES[service.name] !== undefined);
  context.evidence.push({ path: "properties", state: "KNOWN", value: context.resource.properties });
  if (!services.length) return ["No modeled Windows service states for RDP/SMB/WinRM."];
  return services.map((service) => `${WINDOWS_SERVICE_NAMES[service.name]} (${service.name}) Status=${service.enabled === true ? "Running" : service.enabled === false ? "Stopped" : "<not modeled>"}${service.port !== undefined ? ` Port=${service.port}` : ""}`);
}

const LINUX_SERVICE_NAMES: Readonly<Record<string, string>> = { ssh: "sshd", http: "http", networkManager: "NetworkManager", systemdResolved: "systemd-resolved" };
function linuxServiceLines(context: ObservationCommandContext): readonly string[] {
  const services = declaredServices(context.resource).filter((service) => LINUX_SERVICE_NAMES[service.name] !== undefined);
  context.evidence.push({ path: "properties", state: "KNOWN", value: context.resource.properties });
  if (!services.length) return ["No modeled Linux service states for ssh/http/NetworkManager/systemd-resolved."];
  return services.map((service) => `${LINUX_SERVICE_NAMES[service.name]}: ${service.enabled === true ? "active" : service.enabled === false ? "inactive" : "unknown"}${service.port !== undefined ? ` port=${service.port}` : ""}`);
}

function routeLines(context: ObservationCommandContext): readonly string[] {
  const gateway = stringValue(context, "properties.defaultGateway");
  const routesEvidence = readEvidence(context, "properties.routes");
  const lines: string[] = [`Modeled default gateway: ${gateway}`];
  if (routesEvidence.state === "ABSENT") return [...lines, "Routes: <not modeled>"];
  if (!Array.isArray(routesEvidence.value)) {
    malformed(context, routesEvidence, "an array of route objects");
    return [...lines, "Routes: <malformed modeled value>"];
  }
  if (!routesEvidence.value.length) return [...lines, "Routes: <none>"];
  routesEvidence.value.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { lines.push(`Route[${index}]: <malformed modeled value>`); return; }
    const route = raw as Readonly<Record<string, unknown>>;
    lines.push(`Route[${index}] destination=${String(route.destination ?? "<not modeled>")} via=${String(route.via ?? "<direct/not modeled>")} action=${String(route.action ?? "forward")} enabled=${String(route.enabled ?? true)}`);
  });
  return lines;
}

function firewallLines(context: ObservationCommandContext, platform: ObservationOs): readonly string[] {
  const action = stringValue(context, "properties.aclDefaultAction");
  if (platform === "windows") {
    const profile = stringValue(context, "properties.networkProfile");
    return [`Network profile: ${profile}`, `Modeled host ACL default action: ${action}`];
  }
  return [`Modeled host firewall/ACL default action: ${action}`];
}

const COMMANDS: readonly InternalCommand[] = [
  {
    commandId: "windows.ipconfig_all", os: "windows", command: "ipconfig /all", label: "IP configuration", category: "interface",
    description: "Modeled interface addressing plus DHCP, gateway and DNS configuration.",
    render: (c) => [
      "[MODELED OBSERVATION — no Windows guest command executed]",
      ...interfaceLines(c),
      `DHCP Enabled: ${booleanValue(c, "properties.dhcp.enabled", "Yes", "No")}`,
      `Default Gateway: ${stringValue(c, "properties.defaultGateway")}`,
      `DNS Servers: ${stringArray(c, "properties.dnsServers")}`,
      `DHCP Gateway: ${stringValue(c, "properties.dhcp.gateway")}`,
      `DHCP DNS Servers: ${stringArray(c, "properties.dhcp.dnsServers")}`,
      `DHCP Prefix Length: ${numberValue(c, "properties.dhcp.prefixLength")}`,
    ],
  },
  {
    commandId: "windows.route_print", os: "windows", command: "route print", label: "Routing table", category: "routing",
    description: "Modeled default gateway and authoritative route declarations.",
    render: (c) => ["[MODELED OBSERVATION — no Windows guest command executed]", ...routeLines(c)],
  },
  {
    commandId: "windows.get_netipconfiguration", os: "windows", command: "Get-NetIPConfiguration", label: "PowerShell IP configuration", category: "dhcp",
    description: "Modeled adapter, DHCP, gateway and DNS state through a PowerShell-shaped observation.",
    render: (c) => [
      "[MODELED OBSERVATION — no PowerShell executed]",
      ...interfaceLines(c),
      `NetProfile: ${stringValue(c, "properties.networkProfile")}`,
      `DhcpEnabled: ${booleanValue(c, "properties.dhcp.enabled")}`,
      `IPv4DefaultGateway: ${stringValue(c, "properties.defaultGateway")}`,
      `DNSServer: ${stringArray(c, "properties.dnsServers")}`,
    ],
  },
  {
    commandId: "windows.get_netfirewallprofile", os: "windows", command: "Get-NetFirewallProfile", label: "Windows Firewall profile", category: "firewall",
    description: "Modeled network-profile and host ACL default-action evidence.",
    render: (c) => ["[MODELED OBSERVATION — no PowerShell executed]", ...firewallLines(c, "windows")],
  },
  {
    commandId: "windows.get_netconnectionprofile", os: "windows", command: "Get-NetConnectionProfile", label: "Windows network profile", category: "interface",
    description: "Modeled Windows network-profile classification.",
    render: (c) => ["[MODELED OBSERVATION — no PowerShell executed]", `NetworkCategory: ${stringValue(c, "properties.networkProfile")}`],
  },
  {
    commandId: "windows.get_nettcpconnection_listen", os: "windows", command: "Get-NetTCPConnection -State Listen", label: "Listening TCP endpoints", category: "service",
    description: "Modeled enabled services that declare listening ports.",
    render: (c) => ["[MODELED OBSERVATION — no PowerShell executed]", ...listenerLines(c, "windows")],
  },
  {
    commandId: "windows.get_service", os: "windows", command: "Get-Service TermService,LanmanServer,WinRM", label: "Core service states", category: "service",
    description: "Modeled RDP, SMB and WinRM service enabled state.",
    render: (c) => ["[MODELED OBSERVATION — no PowerShell executed]", ...windowsServiceLines(c)],
  },
  {
    commandId: "linux.ip_addr", os: "linux", command: "ip addr show", label: "Interface addresses", category: "interface",
    description: "Modeled Linux interface and address state.",
    render: (c) => ["[MODELED OBSERVATION — no Linux guest command executed]", ...interfaceLines(c)],
  },
  {
    commandId: "linux.ip_route", os: "linux", command: "ip route show", label: "Routing table", category: "routing",
    description: "Modeled default gateway and authoritative route declarations.",
    render: (c) => ["[MODELED OBSERVATION — no Linux guest command executed]", ...routeLines(c)],
  },
  {
    commandId: "linux.resolvectl_status", os: "linux", command: "resolvectl status", label: "Resolver state", category: "dns",
    description: "Modeled systemd-resolved state, DNS servers and search domains.",
    render: (c) => [
      "[MODELED OBSERVATION — no Linux guest command executed]",
      `systemd-resolved: ${booleanValue(c, "properties.systemdResolved.enabled", "active", "inactive")}`,
      `DNS Servers: ${stringArray(c, "properties.dnsServers")}`,
      `DNS Search Domains: ${stringArray(c, "properties.dnsSearchDomains")}`,
    ],
  },
  {
    commandId: "linux.nmcli_device_show", os: "linux", command: "nmcli device show", label: "NetworkManager device state", category: "dhcp",
    description: "Modeled NetworkManager, DHCP, gateway, DNS and address state.",
    render: (c) => [
      "[MODELED OBSERVATION — no Linux guest command executed]",
      `NetworkManager: ${booleanValue(c, "properties.networkManager.enabled", "active", "inactive")}`,
      ...interfaceLines(c),
      `DHCP Enabled: ${booleanValue(c, "properties.dhcp.enabled", "yes", "no")}`,
      `Default Gateway: ${stringValue(c, "properties.defaultGateway")}`,
      `DNS Servers: ${stringArray(c, "properties.dnsServers")}`,
      `DHCP Gateway: ${stringValue(c, "properties.dhcp.gateway")}`,
      `DHCP DNS Servers: ${stringArray(c, "properties.dhcp.dnsServers")}`,
      `DHCP Prefix Length: ${numberValue(c, "properties.dhcp.prefixLength")}`,
    ],
  },
  {
    commandId: "linux.nft_list_ruleset", os: "linux", command: "nft list ruleset", label: "Host firewall policy", category: "firewall",
    description: "Modeled host ACL/firewall default action; no kernel nftables state is executed.",
    render: (c) => ["[MODELED OBSERVATION — no Linux guest command executed]", ...firewallLines(c, "linux")],
  },
  {
    commandId: "linux.ss_listen", os: "linux", command: "ss -lntup", label: "Listening sockets", category: "service",
    description: "Modeled enabled services that declare listening ports.",
    render: (c) => ["[MODELED OBSERVATION — no Linux guest command executed]", ...listenerLines(c, "linux")],
  },
  {
    commandId: "linux.systemctl_status", os: "linux", command: "systemctl is-active sshd NetworkManager systemd-resolved", label: "Core service states", category: "service",
    description: "Modeled SSH, HTTP, NetworkManager and systemd-resolved enabled state.",
    render: (c) => ["[MODELED OBSERVATION — no systemctl executed]", ...linuxServiceLines(c)],
  },
] as const;

const COMMAND_BY_ID = new Map(COMMANDS.map((command) => [command.commandId, command]));

export function listObservationCommands(state: ObservationRequest["state"], targetId: string): readonly ObservationCommandDefinition[] {
  const resource = state.resources[targetId];
  if (!resource) return [];
  const os = osForType(resource.type);
  if (!os) return [];
  return COMMANDS.filter((command) => command.os === os).map(({ render: _render, ...definition }) => definition);
}

export function listObservableTargets(state: ObservationRequest["state"]): readonly { readonly id: string; readonly label: string; readonly type: string; readonly os: ObservationOs }[] {
  return Object.values(state.resources)
    .map((resource) => ({ resource, os: osForType(resource.type) }))
    .filter((entry): entry is { resource: RuntimeResourceState; os: ObservationOs } => entry.os !== undefined)
    .map(({ resource, os }) => ({ id: resource.id, label: resource.label, type: resource.type, os }))
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
}

export function runObservation(request: ObservationRequest): ObservationResult {
  const resource = request.state.resources[request.targetId];
  if (!resource) return { ok: false, diagnostics: [diagnostic("error", "OBSERVATION_TARGET_NOT_FOUND", `Observation target '${request.targetId}' does not exist in Engine state.`)] };
  const os = osForType(resource.type);
  if (!os) return { ok: false, diagnostics: [diagnostic("error", "OBSERVATION_TARGET_UNSUPPORTED", `Resource '${request.targetId}' type '${resource.type}' is not a supported Windows/Linux observation target.`)] };
  const command = COMMAND_BY_ID.get(request.commandId);
  if (!command) return { ok: false, diagnostics: [diagnostic("error", "OBSERVATION_COMMAND_UNKNOWN", `Observation command '${request.commandId}' is not registered.`)] };
  if (command.os !== os) return { ok: false, diagnostics: [diagnostic("error", "OBSERVATION_COMMAND_OS_MISMATCH", `Command '${request.commandId}' is for ${command.os}, but target '${request.targetId}' is ${os}.`)] };

  const evidence: ObservationEvidence[] = [];
  const diagnostics: ObservationDiagnostic[] = [];
  const context: ObservationCommandContext = { state: request.state, resource, evidence, diagnostics };
  const lines = command.render(context);
  return {
    ok: true,
    transcript: {
      engineId: OBSERVATION_ENGINE_ID,
      engineVersion: OBSERVATION_ENGINE_VERSION,
      modeled: true,
      boundary: OBSERVATION_EXECUTION_BOUNDARY,
      scenarioId: request.state.scenarioId,
      scenarioHash: request.state.scenarioHash,
      stateRevision: request.state.stateRevision,
      targetId: resource.id,
      targetLabel: resource.label,
      targetType: resource.type,
      commandId: command.commandId,
      command: command.command,
      category: command.category as ObservationCategory,
      lines,
      evidence,
    },
    diagnostics,
  };
}

export { listActiveProbeDefinitions, listActiveProbeDestinations, runActiveProbe } from "./active-probes.js";
export { TROUBLESHOOTING_NOTEBOOK_VERSION, TROUBLESHOOTING_NOTEBOOK_MAX_ENTRIES, canonicalTroubleshootingJson, computeTroubleshootingNotebookIdentity, computeObservationTranscriptIdentity, createTroubleshootingNotebook, verifyTroubleshootingNotebook, captureObservationInNotebook, captureActiveProbeInNotebook, addLearnerNoteToNotebook } from "./notebook.js";

export { EVIDENCE_REVIEW_ENGINE_ID, EVIDENCE_REVIEW_ENGINE_VERSION, EVIDENCE_REVIEW_BOUNDARY, reviewTroubleshootingEvidence } from "./review.js";

export * from "./remediation.js";

export * from "./typed-remediation.js";
