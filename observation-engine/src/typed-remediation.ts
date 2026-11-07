import type { EngineState, RuntimeResourceState, ScenarioOperation } from "../../engine/src/index.js";
import type { ObservationDiagnostic, TroubleshootingTypedRemediationAction, TypedRemediationActionId } from "./types.js";

export const TYPED_REMEDIATION_ENGINE_ID = "foundation.typed_remediation" as const;
export const TYPED_REMEDIATION_ENGINE_VERSION = "0.1.0" as const;
export const TYPED_REMEDIATION_BOUNDARY = "LEARNER_ACTION_NO_SOLUTION" as const;

export interface TypedRemediationActionDefinition {
  readonly actionId: TypedRemediationActionId;
  readonly label: string;
  readonly description: string;
  readonly parameterKind: "gateway" | "dns_servers" | "firewall_action" | "interface_addresses" | "service_enabled" | "service_port" | "network_profile";
}

export interface TypedRemediationRequest {
  readonly actionId: TypedRemediationActionId;
  readonly targetId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export type TypedRemediationAudit = TroubleshootingTypedRemediationAction;

export interface TypedRemediationResolution {
  readonly ok: boolean;
  readonly operation?: ScenarioOperation;
  readonly audit?: TypedRemediationAudit;
  readonly diagnostics: readonly ObservationDiagnostic[];
}

const ACTIONS: readonly TypedRemediationActionDefinition[] = [
  { actionId: "change_default_gateway", label: "Change default gateway", description: "Set the modeled default gateway for a Windows or Linux host.", parameterKind: "gateway" },
  { actionId: "change_dns_servers", label: "Change DNS servers", description: "Replace the modeled resolver list for a Windows or Linux host.", parameterKind: "dns_servers" },
  { actionId: "set_firewall_default_action", label: "Change firewall default policy", description: "Set the modeled host ACL/firewall default action to allow or deny.", parameterKind: "firewall_action" },
  { actionId: "set_interface_addresses", label: "Set interface addresses", description: "Replace the modeled CIDR address list on one existing interface.", parameterKind: "interface_addresses" },
  { actionId: "set_service_enabled", label: "Enable or disable service", description: "Change the modeled enabled state of a supported Windows or Linux service.", parameterKind: "service_enabled" },
  { actionId: "set_service_port", label: "Change service listener port", description: "Change the modeled listener port of a supported service that already declares a port.", parameterKind: "service_port" },
  { actionId: "set_windows_network_profile", label: "Change Windows network profile", description: "Set the modeled Windows network profile to public, private or domain.", parameterKind: "network_profile" },
];

const WINDOWS_SERVICES = new Set(["rdp", "smb", "winrm"]);
const LINUX_SERVICES = new Set(["ssh", "http", "networkManager", "systemdResolved"]);

function diagnostic(code: string, message: string): ObservationDiagnostic { return { severity: "error", code, message }; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function osFor(resource: RuntimeResourceState): "windows" | "linux" | undefined {
  if (resource.type.startsWith("windows.")) return "windows";
  if (resource.type.startsWith("linux.")) return "linux";
  return undefined;
}
function isIpv4(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return parts.length === 4 && parts.every((p) => /^(0|[1-9][0-9]{0,2})$/.test(p) && Number(p) <= 255);
}
function isCidr(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [ip, prefix, ...rest] = value.split("/");
  return rest.length === 0 && isIpv4(ip) && /^(0|[1-9]|[12][0-9]|3[0-2])$/.test(prefix ?? "");
}
function stringParam(parameters: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = parameters[key];
  return typeof value === "string" ? value.trim() : undefined;
}
function intParam(parameters: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = parameters[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
function boolParam(parameters: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = parameters[key];
  return typeof value === "boolean" ? value : undefined;
}
function exactKeys(parameters: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(parameters).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function serviceAllowed(resource: RuntimeResourceState, service: string): boolean {
  const os = osFor(resource);
  return os === "windows" ? WINDOWS_SERVICES.has(service) : os === "linux" ? LINUX_SERVICES.has(service) : false;
}
function serviceObject(resource: RuntimeResourceState, service: string): Readonly<Record<string, unknown>> | undefined {
  const raw = resource.properties[service];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Readonly<Record<string, unknown>> : undefined;
}

export function listTypedRemediationActions(state: EngineState, targetId: string): readonly TypedRemediationActionDefinition[] {
  const resource = state.resources[targetId];
  if (!resource) return [];
  const os = osFor(resource);
  if (!os) return [];
  return ACTIONS.filter((action) => {
    if (action.actionId === "set_windows_network_profile") return os === "windows";
    if (action.actionId === "set_service_enabled") return Object.keys(resource.properties).some((name) => serviceAllowed(resource, name) && serviceObject(resource, name));
    if (action.actionId === "set_service_port") return Object.keys(resource.properties).some((name) => serviceAllowed(resource, name) && typeof serviceObject(resource, name)?.port === "number");
    if (action.actionId === "set_interface_addresses") return resource.interfaces.length > 0;
    return true;
  });
}

export function resolveTypedRemediationAction(state: EngineState, request: TypedRemediationRequest): TypedRemediationResolution {
  const resource = state.resources[request.targetId];
  if (!resource) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_TARGET_UNKNOWN", `Typed remediation target '${request.targetId}' does not exist.`)] };
  const os = osFor(resource);
  if (!os) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_TARGET_UNSUPPORTED", "Typed remediation actions in this phase are available only for modeled Windows and Linux hosts.")] };
  const definition = ACTIONS.find((action) => action.actionId === request.actionId);
  if (!definition) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_ACTION_UNKNOWN", `Unsupported typed remediation action '${String(request.actionId)}'.`)] };
  const params = request.parameters ?? {};
  let operation: ScenarioOperation | undefined;

  switch (request.actionId) {
    case "change_default_gateway": {
      if (!exactKeys(params, ["gateway"])) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_PARAMETERS_INVALID", "Change default gateway accepts exactly one 'gateway' parameter.")] };
      const gateway = stringParam(params, "gateway");
      if (!isIpv4(gateway)) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_GATEWAY_INVALID", "Default gateway must be a valid IPv4 address.")] };
      operation = { op: "set", target: request.targetId, path: "properties.defaultGateway", value: gateway };
      break;
    }
    case "change_dns_servers": {
      if (!exactKeys(params, ["servers"])) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_PARAMETERS_INVALID", "Change DNS servers accepts exactly one 'servers' parameter.")] };
      const raw = params.servers;
      if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4 || !raw.every(isIpv4) || new Set(raw).size !== raw.length) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_DNS_INVALID", "DNS servers must be 1-4 unique IPv4 addresses.")] };
      operation = { op: "set", target: request.targetId, path: "properties.dnsServers", value: [...raw] };
      break;
    }
    case "set_firewall_default_action": {
      if (!exactKeys(params, ["action"])) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_PARAMETERS_INVALID", "Firewall policy accepts exactly one 'action' parameter.")] };
      const action = stringParam(params, "action");
      if (action !== "allow" && action !== "deny") return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_FIREWALL_INVALID", "Firewall default action must be 'allow' or 'deny'.")] };
      operation = { op: "set", target: request.targetId, path: "properties.aclDefaultAction", value: action };
      break;
    }
    case "set_interface_addresses": {
      if (!exactKeys(params, ["interfaceIndex", "addresses"])) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_PARAMETERS_INVALID", "Set interface addresses accepts exactly 'interfaceIndex' and 'addresses'.")] };
      const index = intParam(params, "interfaceIndex");
      const addresses = params.addresses;
      if (index === undefined || index < 0 || index >= resource.interfaces.length) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_INTERFACE_INVALID", "interfaceIndex must identify an existing modeled interface.")] };
      if (!Array.isArray(addresses) || addresses.length < 1 || addresses.length > 8 || !addresses.every(isCidr) || new Set(addresses).size !== addresses.length) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_ADDRESSES_INVALID", "Interface addresses must be 1-8 unique IPv4 CIDR strings.")] };
      operation = { op: "set", target: request.targetId, path: `interfaces.${index}.addresses`, value: [...addresses] };
      break;
    }
    case "set_service_enabled": {
      if (!exactKeys(params, ["service", "enabled"])) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_PARAMETERS_INVALID", "Service state accepts exactly 'service' and 'enabled'.")] };
      const service = stringParam(params, "service");
      const enabled = boolParam(params, "enabled");
      if (!service || !serviceAllowed(resource, service) || !serviceObject(resource, service)) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_SERVICE_INVALID", "Service must be a supported service already modeled on the selected host.")] };
      if (enabled === undefined) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_SERVICE_STATE_INVALID", "Service enabled must be boolean true or false.")] };
      operation = { op: "set", target: request.targetId, path: `properties.${service}.enabled`, value: enabled };
      break;
    }
    case "set_service_port": {
      if (!exactKeys(params, ["service", "port"])) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_PARAMETERS_INVALID", "Service port accepts exactly 'service' and 'port'.")] };
      const service = stringParam(params, "service");
      const port = intParam(params, "port");
      const modeled = service ? serviceObject(resource, service) : undefined;
      if (!service || !serviceAllowed(resource, service) || typeof modeled?.port !== "number") return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_SERVICE_PORT_UNMODELED", "Listener-port remediation requires a supported service with an existing modeled port.")] };
      if (port === undefined || port < 1 || port > 65535) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_PORT_INVALID", "Service port must be an integer from 1 through 65535.")] };
      operation = { op: "set", target: request.targetId, path: `properties.${service}.port`, value: port };
      break;
    }
    case "set_windows_network_profile": {
      if (os !== "windows") return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_OS_MISMATCH", "Windows network profile remediation is available only for Windows resources.")] };
      if (!exactKeys(params, ["profile"])) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_PARAMETERS_INVALID", "Windows network profile accepts exactly one 'profile' parameter.")] };
      const profile = stringParam(params, "profile");
      if (profile !== "public" && profile !== "private" && profile !== "domain") return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_PROFILE_INVALID", "Windows network profile must be 'public', 'private' or 'domain'.")] };
      operation = { op: "set", target: request.targetId, path: "properties.networkProfile", value: profile };
      break;
    }
  }

  if (!operation) return { ok: false, diagnostics: [diagnostic("TYPED_REMEDIATION_RESOLUTION_FAILED", "Typed remediation action could not be resolved.")] };
  const audit: TypedRemediationAudit = { engineId: TYPED_REMEDIATION_ENGINE_ID, engineVersion: TYPED_REMEDIATION_ENGINE_VERSION, boundary: TYPED_REMEDIATION_BOUNDARY, actionId: request.actionId, label: definition.label, targetId: request.targetId, parameters: clone(params) };
  return { ok: true, operation, audit, diagnostics: [] };
}

export function typedRemediationAuditMatchesOperation(audit: TroubleshootingTypedRemediationAction, operation: { readonly op: "set" | "remove"; readonly target: string; readonly path: string; readonly value?: unknown }): boolean {
  if (audit.engineId !== TYPED_REMEDIATION_ENGINE_ID || audit.engineVersion !== TYPED_REMEDIATION_ENGINE_VERSION || audit.boundary !== TYPED_REMEDIATION_BOUNDARY || audit.targetId !== operation.target) return false;
  const p = audit.parameters;
  switch (audit.actionId) {
    case "change_default_gateway": return operation.op === "set" && operation.path === "properties.defaultGateway" && operation.value === p.gateway;
    case "change_dns_servers": return operation.op === "set" && operation.path === "properties.dnsServers" && JSON.stringify(operation.value) === JSON.stringify(p.servers);
    case "set_firewall_default_action": return operation.op === "set" && operation.path === "properties.aclDefaultAction" && operation.value === p.action;
    case "set_interface_addresses": return operation.op === "set" && operation.path === `interfaces.${String(p.interfaceIndex)}.addresses` && JSON.stringify(operation.value) === JSON.stringify(p.addresses);
    case "set_service_enabled": return operation.op === "set" && operation.path === `properties.${String(p.service)}.enabled` && operation.value === p.enabled;
    case "set_service_port": return operation.op === "set" && operation.path === `properties.${String(p.service)}.port` && operation.value === p.port;
    case "set_windows_network_profile": return operation.op === "set" && operation.path === "properties.networkProfile" && operation.value === p.profile;
  }
}

export function typedRemediationDefinition(actionId: TypedRemediationActionId): TypedRemediationActionDefinition | undefined {
  return ACTIONS.find((action) => action.actionId === actionId);
}
