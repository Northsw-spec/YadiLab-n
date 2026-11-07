import { isRecord } from "./json.js";
import type {
  EngineQueryResult,
  EngineState,
  HostProcessTrace,
  HostServiceTrace,
  HostSocketBindScope,
  ListenerServiceDecisionTrace,
  ServiceStateRead,
  HostSocketState,
  HostSocketTrace,
  HostStackDecisionTrace,
  TruthValue,
} from "./types.js";

function transportProtocol(value: unknown): "tcp" | "udp" | "icmp" | "any" | undefined {
  if (value === "tcp" || value === "udp" || value === "icmp" || value === "any") return value;
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase();
  if (["http", "https", "ssh", "rdp", "smb", "ldap", "ldaps", "winrm"].includes(lower)) return "tcp";
  return undefined;
}

function protocolMatches(declared: unknown, requested: "tcp" | "udp" | "icmp" | "any"): boolean {
  if (requested === "any") return true;
  const normalized = transportProtocol(declared);
  return normalized === undefined || normalized === "any" || normalized === requested;
}

interface ServiceCandidate {
  readonly name: string;
  readonly enabled?: boolean;
  readonly port?: number;
  readonly protocol?: unknown;
}

function collectServices(properties: Readonly<Record<string, unknown>>): readonly ServiceCandidate[] {
  const out: ServiceCandidate[] = [];
  const explicit = properties.services;
  if (Array.isArray(explicit)) {
    explicit.forEach((item, index) => {
      if (!isRecord(item)) return;
      out.push({
        name: typeof item.name === "string" ? item.name : typeof item.id === "string" ? item.id : `services[${index}]`,
        ...(typeof item.enabled === "boolean" ? { enabled: item.enabled } : {}),
        ...(typeof item.port === "number" ? { port: item.port } : {}),
        ...(item.protocol !== undefined ? { protocol: item.protocol } : {}),
      });
    });
  }

  for (const [name, value] of Object.entries(properties)) {
    if (name === "services" || name === "hostStack" || !isRecord(value)) continue;
    if (typeof value.port !== "number" && typeof value.enabled !== "boolean") continue;
    out.push({
      name,
      ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
      ...(typeof value.port === "number" ? { port: value.port } : {}),
      ...(value.protocol !== undefined ? { protocol: value.protocol } : {}),
    });
  }
  return out;
}

function validPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function bindScope(address: string): HostSocketBindScope {
  const lower = address.toLowerCase();
  if (lower === "*" || lower === "0.0.0.0" || lower === "::") return "WILDCARD";
  if (lower === "::1" || /^127(?:\.\d{1,3}){3}$/.test(lower)) return "LOOPBACK";
  return "SPECIFIC";
}

function baseServices(properties: Readonly<Record<string, unknown>>): readonly HostServiceTrace[] {
  return collectServices(properties).map((service, index) => ({
    index,
    name: service.name,
    ...(service.enabled !== undefined ? { enabled: service.enabled } : {}),
    ...(service.port !== undefined ? { port: service.port } : {}),
    ...(transportProtocol(service.protocol) !== undefined ? { protocol: transportProtocol(service.protocol)! } : {}),
    owningProcessIds: [],
    socketIds: [],
  }));
}

function selectedServiceNames(
  services: readonly HostServiceTrace[],
  protocol: "tcp" | "udp" | "icmp" | "any",
  port: number | undefined,
): readonly string[] {
  if (port === undefined || protocol === "icmp") return [];
  return [...new Set(services.filter((service) => service.port === port && protocolMatches(service.protocol, protocol)).map((service) => service.name))].sort();
}

function malformedHostStack(
  resourceId: string,
  services: readonly HostServiceTrace[],
  explanation: string,
): EngineQueryResult<HostStackDecisionTrace> {
  return {
    truth: "UNKNOWN",
    value: {
      resourceId,
      truth: "UNKNOWN",
      model: "EXPLICIT_HOST_STACK",
      complete: false,
      processes: [],
      sockets: [],
      services,
      selectedServiceNames: [],
      selectedSocketIds: [],
      listenerConsistency: "UNMODELED",
      explanation: [explanation],
    },
    explanation: [explanation],
  };
}

export function queryHostStackView(
  state: EngineState,
  target: string,
  protocol: "tcp" | "udp" | "icmp" | "any" = "any",
  port?: number,
): EngineQueryResult<HostStackDecisionTrace> {
  const resource = state.resources[target];
  if (!resource) return { truth: "UNKNOWN", explanation: [`Resource '${target}' is absent from runtime state.`] };
  const services = baseServices(resource.properties);
  const selectedServices = selectedServiceNames(services, protocol, port);
  const raw = resource.properties.hostStack;
  if (raw === undefined) {
    const explanation = [`Host stack on '${target}' is modeled only at service-declaration level; process/socket ownership is not declared.`];
    return {
      truth: "TRUE",
      value: {
        resourceId: target,
        truth: "TRUE",
        model: "SERVICE_DECLARATIONS",
        complete: false,
        processes: [],
        sockets: [],
        services,
        selectedServiceNames: selectedServices,
        selectedSocketIds: [],
        listenerConsistency: "UNMODELED",
        explanation,
      },
      explanation,
    };
  }
  if (!isRecord(raw) || typeof raw.complete !== "boolean" || !Array.isArray(raw.processes) || !Array.isArray(raw.sockets)) {
    return malformedHostStack(target, services, `Host stack on '${target}' is malformed: expected { complete, processes[], sockets[] }.`);
  }

  const processes: HostProcessTrace[] = [];
  const processIds = new Set<string>();
  for (let index = 0; index < raw.processes.length; index += 1) {
    const item = raw.processes[index];
    if (!isRecord(item) || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name) {
      return malformedHostStack(target, services, `Host stack process row ${index} on '${target}' is malformed.`);
    }
    if (processIds.has(item.id)) return malformedHostStack(target, services, `Host stack process id '${item.id}' is duplicated on '${target}'.`);
    if (item.pid !== undefined && (!Number.isInteger(item.pid) || Number(item.pid) < 1)) return malformedHostStack(target, services, `Host stack process '${item.id}' has an invalid PID.`);
    if (item.service !== undefined && (typeof item.service !== "string" || !services.some((service) => service.name === item.service))) {
      return malformedHostStack(target, services, `Host stack process '${item.id}' references an undeclared service.`);
    }
    processIds.add(item.id);
    processes.push({
      processId: item.id,
      name: item.name,
      ...(typeof item.pid === "number" ? { pid: item.pid } : {}),
      ...(typeof item.service === "string" ? { service: item.service } : {}),
    });
  }

  const sockets: HostSocketTrace[] = [];
  const socketIds = new Set<string>();
  for (let index = 0; index < raw.sockets.length; index += 1) {
    const item = raw.sockets[index];
    const stateValue = isRecord(item) ? item.state : undefined;
    const tcpStates = new Set(["LISTEN", "SYN_SENT", "SYN_RECEIVED", "ESTABLISHED", "FIN_WAIT_1", "FIN_WAIT_2", "CLOSE_WAIT", "CLOSING", "LAST_ACK", "TIME_WAIT", "CLOSED", "UNKNOWN"]);
    const udpStates = new Set(["BOUND", "ESTABLISHED", "CLOSED", "UNKNOWN"]);
    if (!isRecord(item)
      || typeof item.id !== "string" || !item.id
      || (item.protocol !== "tcp" && item.protocol !== "udp")
      || typeof item.localAddress !== "string" || !item.localAddress
      || !validPort(item.localPort)
      || typeof stateValue !== "string"
      || (item.protocol === "tcp" ? !tcpStates.has(stateValue) : !udpStates.has(stateValue))) {
      return malformedHostStack(target, services, `Host stack socket row ${index} on '${target}' is malformed.`);
    }
    if (socketIds.has(item.id)) return malformedHostStack(target, services, `Host stack socket id '${item.id}' is duplicated on '${target}'.`);
    if (item.remoteAddress !== undefined && (typeof item.remoteAddress !== "string" || !item.remoteAddress)) return malformedHostStack(target, services, `Host stack socket '${item.id}' has an invalid remoteAddress.`);
    if (item.remotePort !== undefined && !validPort(item.remotePort)) return malformedHostStack(target, services, `Host stack socket '${item.id}' has an invalid remotePort.`);
    if (item.processId !== undefined && (typeof item.processId !== "string" || !processIds.has(item.processId))) return malformedHostStack(target, services, `Host stack socket '${item.id}' references an unknown process.`);
    if (item.service !== undefined && (typeof item.service !== "string" || !services.some((service) => service.name === item.service))) return malformedHostStack(target, services, `Host stack socket '${item.id}' references an undeclared service.`);
    const process = typeof item.processId === "string" ? processes.find((row) => row.processId === item.processId) : undefined;
    if (process?.service !== undefined && item.service !== undefined && process.service !== item.service) return malformedHostStack(target, services, `Host stack socket '${item.id}' service disagrees with owning process service binding.`);
    socketIds.add(item.id);
    sockets.push({
      socketId: item.id,
      protocol: item.protocol,
      localAddress: item.localAddress,
      localPort: item.localPort,
      bindScope: bindScope(item.localAddress),
      state: item.state as HostSocketState,
      ...(typeof item.remoteAddress === "string" ? { remoteAddress: item.remoteAddress } : {}),
      ...(typeof item.remotePort === "number" ? { remotePort: item.remotePort } : {}),
      ...(typeof item.processId === "string" ? { processId: item.processId } : {}),
      ...(typeof item.service === "string" ? { service: item.service } : {}),
    });
  }

  const enrichedServices = services.map((service) => ({
    ...service,
    owningProcessIds: processes.filter((process) => process.service === service.name).map((process) => process.processId).sort(),
    socketIds: sockets.filter((socket) => socket.service === service.name).map((socket) => socket.socketId).sort(),
  }));
  const matchingSockets = port === undefined || protocol === "icmp"
    ? []
    : sockets.filter((socket) => socket.localPort === port && protocolMatches(socket.protocol, protocol) && ((socket.protocol === "tcp" && socket.state === "LISTEN") || (socket.protocol === "udp" && socket.state === "BOUND")));
  const selectedSocketIds = matchingSockets.map((socket) => socket.socketId).sort();
  const selected = selectedServiceNames(enrichedServices, protocol, port);

  let listenerConsistency: "CONSISTENT" | "MISMATCH" | "UNMODELED" = "UNMODELED";
  if (port !== undefined && protocol !== "icmp") {
    const matchingServices = enrichedServices.filter((service) => selected.includes(service.name));
    const declaredTrue = matchingServices.some((service) => service.enabled === true);
    const declaredFalse = matchingServices.length === 0 || matchingServices.every((service) => service.enabled === false);
    if (declaredTrue) listenerConsistency = selectedSocketIds.length > 0 ? "CONSISTENT" : raw.complete ? "MISMATCH" : "UNMODELED";
    else if (declaredFalse) listenerConsistency = selectedSocketIds.length === 0 ? "CONSISTENT" : "MISMATCH";
  }

  const explanation = [
    `Host stack on '${target}' supplies an explicit ${raw.complete ? "complete" : "partial"} process/socket snapshot.`,
    ...(listenerConsistency === "MISMATCH" ? [`Host stack listener rows disagree with declared service state for ${protocol.toUpperCase()}/${String(port)}.`] : []),
  ];
  const trace: HostStackDecisionTrace = {
    resourceId: target,
    truth: "TRUE",
    model: "EXPLICIT_HOST_STACK",
    complete: raw.complete,
    processes,
    sockets,
    services: enrichedServices,
    selectedServiceNames: selected,
    selectedSocketIds,
    listenerConsistency,
    explanation,
  };
  return { truth: "TRUE", value: trace, explanation };
}

export function queryServiceEnabled(state: EngineState, target: string, service: string): EngineQueryResult<undefined> {
  const resource = state.resources[target];
  if (!resource) return { truth: "UNKNOWN", explanation: [`Resource '${target}' is absent from runtime state.`] };
  const candidates = collectServices(resource.properties).filter((item) => item.name === service);
  if (candidates.length === 0) return { truth: "UNKNOWN", explanation: [`Service '${service}' is not declared on '${target}'.`] };
  const enabledValues = candidates.map((item) => item.enabled);
  if (enabledValues.some((value) => value === true)) return { truth: "TRUE", explanation: [`Service '${service}' is explicitly enabled on '${target}'.`] };
  if (enabledValues.every((value) => value === false)) return { truth: "FALSE", explanation: [`Service '${service}' is explicitly disabled on '${target}'.`] };
  return { truth: "UNKNOWN", explanation: [`Service '${service}' exists on '${target}', but enabled state is incomplete.`] };
}

function listenerServiceState(services: readonly HostServiceTrace[], selectedNames: readonly string[]): ServiceStateRead {
  const matching = services.filter((service) => selectedNames.includes(service.name));
  if (matching.length === 0) return "UNDECLARED";
  const enabled = matching.map((service) => service.enabled);
  if (enabled.every((value) => value === true)) return "ENABLED";
  if (enabled.every((value) => value === false)) return "DISABLED";
  if (enabled.some((value) => value === true) && enabled.some((value) => value === false)) return "MIXED";
  return "UNKNOWN";
}

export function queryListenerServiceState(
  state: EngineState,
  target: string,
  protocol: "tcp" | "udp" | "icmp" | "any",
  port: number | undefined,
): EngineQueryResult<ListenerServiceDecisionTrace> {
  if (port === undefined || protocol === "icmp") {
    const explanation = ["No destination listening-port check is required for this reachability query."];
    return {
      truth: "TRUE",
      value: {
        resourceId: target,
        truth: "TRUE",
        protocol,
        ...(port !== undefined ? { port } : {}),
        model: "NOT_REQUIRED",
        complete: true,
        listenerState: "NOT_REQUIRED",
        serviceState: "UNDECLARED",
        disposition: "NOT_REQUIRED",
        selectedServiceNames: [],
        selectedSocketIds: [],
        listenerConsistency: "UNMODELED",
        explanation,
      },
      explanation,
    };
  }

  const resource = state.resources[target];
  if (!resource) {
    const explanation = [`Resource '${target}' is absent from runtime state.`];
    return {
      truth: "UNKNOWN",
      value: {
        resourceId: target,
        truth: "UNKNOWN",
        protocol,
        port,
        model: "SERVICE_DECLARATIONS",
        complete: false,
        listenerState: "UNKNOWN",
        serviceState: "UNKNOWN",
        disposition: "RESOURCE_ABSENT",
        selectedServiceNames: [],
        selectedSocketIds: [],
        listenerConsistency: "UNMODELED",
        explanation,
      },
      explanation,
    };
  }

  const hostStackResult = queryHostStackView(state, target, protocol, port);
  const hostStack = hostStackResult.value;
  if (!hostStack) {
    const explanation = [...hostStackResult.explanation];
    return {
      truth: "UNKNOWN",
      value: {
        resourceId: target,
        truth: "UNKNOWN",
        protocol,
        port,
        model: "EXPLICIT_HOST_STACK",
        complete: false,
        listenerState: "UNKNOWN",
        serviceState: "UNKNOWN",
        disposition: "MALFORMED",
        selectedServiceNames: [],
        selectedSocketIds: [],
        listenerConsistency: "UNMODELED",
        explanation,
      },
      explanation,
    };
  }

  const serviceState = listenerServiceState(hostStack.services, hostStack.selectedServiceNames);
  const base = {
    resourceId: target,
    protocol,
    port,
    model: hostStack.model,
    complete: hostStack.complete,
    serviceState,
    selectedServiceNames: hostStack.selectedServiceNames,
    selectedSocketIds: hostStack.selectedSocketIds,
    listenerConsistency: hostStack.listenerConsistency,
  } as const;

  if (hostStack.truth === "UNKNOWN") {
    const explanation = [...hostStack.explanation, `Listener/service state for ${protocol.toUpperCase()}/${port} is not trusted because Host Stack evidence is malformed.`];
    return { truth: "UNKNOWN", value: { ...base, truth: "UNKNOWN", listenerState: "UNKNOWN", disposition: "MALFORMED", explanation }, explanation };
  }

  if (hostStack.model === "SERVICE_DECLARATIONS") {
    const services = collectServices(resource.properties);
    if (services.length === 0) {
      const explanation = [`No service/listener declaration exists on '${target}' for ${protocol.toUpperCase()}/${port}.`];
      return { truth: "UNKNOWN", value: { ...base, truth: "UNKNOWN", listenerState: "UNKNOWN", disposition: "DECLARATION_ABSENT", explanation }, explanation };
    }
    const matching = services.filter((item) => item.port === port && protocolMatches(item.protocol, protocol));
    if (matching.length === 0) {
      const explanation = [`Declared services on '${target}' do not listen on ${protocol.toUpperCase()}/${port}; process/socket state is not modeled.`];
      return { truth: "FALSE", value: { ...base, truth: "FALSE", listenerState: "NOT_LISTENING", disposition: "NO_LISTENER", explanation }, explanation };
    }
    if (matching.some((item) => item.enabled === true)) {
      const explanation = [`A declared enabled service on '${target}' listens on ${protocol.toUpperCase()}/${port} by declaration; process/socket listener ownership is not modeled.`];
      return { truth: "TRUE", value: { ...base, truth: "TRUE", listenerState: "LISTENING", disposition: "LISTENING", explanation }, explanation };
    }
    if (matching.every((item) => item.enabled === false)) {
      const explanation = [`Matching service(s) on '${target}' are explicitly disabled.`];
      return { truth: "FALSE", value: { ...base, truth: "FALSE", listenerState: "NOT_LISTENING", disposition: "SERVICE_DISABLED", explanation }, explanation };
    }
    const explanation = [`A matching service exists on '${target}', but its enabled state is not fully declared.`];
    return { truth: "UNKNOWN", value: { ...base, truth: "UNKNOWN", listenerState: "UNKNOWN", disposition: "SERVICE_STATE_UNKNOWN", explanation }, explanation };
  }

  if (hostStack.selectedSocketIds.length > 0) {
    const explanation = [
      `Explicit Host Stack evidence proves ${hostStack.selectedSocketIds.length} listening socket(s) on '${target}' for ${protocol.toUpperCase()}/${port}.`,
      ...(hostStack.listenerConsistency === "MISMATCH" ? ["Service declaration and live listener evidence disagree; listener truth follows the explicit socket snapshot while service state remains separately visible."] : []),
    ];
    return { truth: "TRUE", value: { ...base, truth: "TRUE", listenerState: "LISTENING", disposition: "LISTENING", explanation }, explanation };
  }

  if (hostStack.complete) {
    const explanation = [
      `Complete Host Stack evidence proves no listening socket on '${target}' for ${protocol.toUpperCase()}/${port}.`,
      ...(hostStack.listenerConsistency === "MISMATCH" ? ["A service declaration may report enabled while the complete socket snapshot proves that no listener is bound."] : []),
    ];
    return { truth: "FALSE", value: { ...base, truth: "FALSE", listenerState: "NOT_LISTENING", disposition: serviceState === "DISABLED" ? "SERVICE_DISABLED" : "NO_LISTENER", explanation }, explanation };
  }

  const explanation = [`Partial Host Stack evidence contains no matching listener for ${protocol.toUpperCase()}/${port}; absence is not proven.`];
  return { truth: "UNKNOWN", value: { ...base, truth: "UNKNOWN", listenerState: "UNKNOWN", disposition: "SNAPSHOT_INCOMPLETE", explanation }, explanation };
}

export function queryListeningPort(
  state: EngineState,
  target: string,
  protocol: "tcp" | "udp" | "icmp" | "any",
  port: number | undefined,
): EngineQueryResult<ListenerServiceDecisionTrace> {
  return queryListenerServiceState(state, target, protocol, port);
}

export function truthFromBoolean(value: boolean): TruthValue {
  return value ? "TRUE" : "FALSE";
}
