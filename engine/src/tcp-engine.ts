import type {
  EngineQueryResult,
  EngineState,
  TcpLifecycleState,
  TcpSocketStateTrace,
  TcpStateMachineDecisionTrace,
  TcpStateTransitionTrace,
  TruthValue,
} from "./types.js";
import { queryHostStackView, queryListenerServiceState } from "./service-engine.js";

const TCP_TRANSITIONS: readonly TcpStateTransitionTrace[] = [
  { from: "CLOSED", to: "SYN_SENT", trigger: "active open / SYN" },
  { from: "CLOSED", to: "LISTEN", trigger: "passive open" },
  { from: "LISTEN", to: "SYN_RECEIVED", trigger: "SYN received" },
  { from: "SYN_SENT", to: "ESTABLISHED", trigger: "SYN/ACK received; ACK sent" },
  { from: "SYN_RECEIVED", to: "ESTABLISHED", trigger: "ACK received" },
  { from: "ESTABLISHED", to: "FIN_WAIT_1", trigger: "active close / FIN" },
  { from: "ESTABLISHED", to: "CLOSE_WAIT", trigger: "peer FIN received" },
  { from: "FIN_WAIT_1", to: "FIN_WAIT_2", trigger: "ACK of local FIN" },
  { from: "FIN_WAIT_1", to: "CLOSING", trigger: "peer FIN before local FIN ACK" },
  { from: "FIN_WAIT_1", to: "TIME_WAIT", trigger: "peer FIN and local FIN acknowledged" },
  { from: "FIN_WAIT_2", to: "TIME_WAIT", trigger: "peer FIN received; ACK sent" },
  { from: "CLOSE_WAIT", to: "LAST_ACK", trigger: "local close / FIN" },
  { from: "CLOSING", to: "TIME_WAIT", trigger: "ACK of local FIN" },
  { from: "LAST_ACK", to: "CLOSED", trigger: "ACK of local FIN" },
  { from: "TIME_WAIT", to: "CLOSED", trigger: "TIME-WAIT timer expiry" },
];

const TCP_STATES = new Set<TcpLifecycleState>([
  "CLOSED", "LISTEN", "SYN_SENT", "SYN_RECEIVED", "ESTABLISHED",
  "FIN_WAIT_1", "FIN_WAIT_2", "CLOSE_WAIT", "CLOSING", "LAST_ACK", "TIME_WAIT", "UNKNOWN",
]);

function resourceAddresses(state: EngineState, resourceId: string): readonly string[] {
  const resource = state.resources[resourceId];
  if (!resource) return [];
  const addresses: string[] = [];
  for (const iface of resource.interfaces) {
    const values = iface.addresses;
    if (!Array.isArray(values)) continue;
    for (const value of values) if (typeof value === "string" && value) addresses.push(value.split("/")[0]!);
  }
  const one = resource.properties.address;
  if (typeof one === "string" && one) addresses.push(one.split("/")[0]!);
  const many = resource.properties.addresses;
  if (Array.isArray(many)) for (const value of many) if (typeof value === "string" && value) addresses.push(value.split("/")[0]!);
  return [...new Set(addresses)].sort((a, b) => a.localeCompare(b, "en"));
}

function allowedNextStates(state: TcpLifecycleState): readonly TcpLifecycleState[] {
  return [...new Set(TCP_TRANSITIONS.filter((row) => row.from === state).map((row) => row.to))];
}

function socketRole(state: TcpLifecycleState): TcpSocketStateTrace["role"] {
  if (state === "LISTEN") return "LISTENER";
  if (state === "CLOSED" || state === "UNKNOWN") return "CLOSED_OR_UNKNOWN";
  return "SESSION";
}

function uniqueStates(rows: readonly TcpSocketStateTrace[]): readonly TcpLifecycleState[] {
  return [...new Set(rows.map((row) => row.state))].sort((a, b) => a.localeCompare(b, "en"));
}

function result(
  truth: TruthValue,
  value: TcpStateMachineDecisionTrace,
): EngineQueryResult<TcpStateMachineDecisionTrace> {
  return { truth, value, explanation: value.explanation };
}

/**
 * Phase 96 bounded TCP state-machine microscope.
 *
 * This query is read-only. It does not synthesize ephemeral ports, sequence/ack numbers,
 * retransmissions, packets, timers or socket transitions. The current TCP socket state comes
 * only from the explicit Host Stack snapshot; the canonical transition table is static protocol
 * knowledge used to explain which modeled state changes are valid next steps.
 */
export function queryTcpStateMachine(
  state: EngineState,
  sourceId: string,
  destinationId: string,
  port: number,
): EngineQueryResult<TcpStateMachineDecisionTrace> {
  const base = {
    sourceId,
    destinationId,
    port,
    canonicalTransitions: TCP_TRANSITIONS,
    sequenceAckTimeline: "NOT_MODELED" as const,
    retransmissionMarkers: "NOT_MODELED" as const,
  };
  if (!state.resources[sourceId] || !state.resources[destinationId]) {
    const explanation = [`TCP state-machine query cannot bind source '${sourceId}' and destination '${destinationId}' to runtime resources.`];
    return result("UNKNOWN", { ...base, truth: "UNKNOWN", model: "SERVICE_DECLARATIONS", complete: false, disposition: "RESOURCE_ABSENT", listenerTruth: "UNKNOWN", socketRows: [], selectedSocketIds: [], currentStates: [], explanation });
  }

  const hostResult = queryHostStackView(state, destinationId, "tcp", port);
  const listenerResult = queryListenerServiceState(state, destinationId, "tcp", port);
  const host = hostResult.value;
  const listener = listenerResult.value;
  if (!host || !listener || host.truth === "UNKNOWN" || listener.disposition === "MALFORMED") {
    const explanation = [...hostResult.explanation, ...listenerResult.explanation, "TCP state-machine evidence is not trusted because Host Stack/listener evidence is malformed or absent."];
    return result("UNKNOWN", { ...base, truth: "UNKNOWN", model: "EXPLICIT_HOST_STACK", complete: false, disposition: "MALFORMED", listenerTruth: listenerResult.truth, socketRows: [], selectedSocketIds: [], currentStates: [], explanation });
  }

  if (host.model === "SERVICE_DECLARATIONS") {
    const explanation = [...listener.explanation, "TCP lifecycle state is not modeled because this resource has service declarations but no explicit Host Stack socket snapshot.", "Sequence/ACK progression and retransmission markers are NOT MODELED."];
    return result("UNKNOWN", { ...base, truth: "UNKNOWN", model: "SERVICE_DECLARATIONS", complete: false, disposition: "DECLARATION_ONLY", listenerTruth: listener.truth, socketRows: [], selectedSocketIds: [], currentStates: [], explanation });
  }

  const rawTcpRows = host.sockets.filter((socket) => socket.protocol === "tcp" && socket.localPort === port);
  if (rawTcpRows.some((socket) => !TCP_STATES.has(socket.state as TcpLifecycleState))) {
    const explanation = [...host.explanation, `TCP socket snapshot on '${destinationId}' contains a state outside the bounded Phase 96 TCP lifecycle.`];
    return result("UNKNOWN", { ...base, truth: "UNKNOWN", model: "EXPLICIT_HOST_STACK", complete: host.complete, disposition: "MALFORMED", listenerTruth: listener.truth, socketRows: [], selectedSocketIds: [], currentStates: [], explanation });
  }

  const sessionStateRows = rawTcpRows.filter((socket) => !["LISTEN", "CLOSED", "UNKNOWN"].includes(socket.state));
  if (sessionStateRows.some((socket) => socket.remoteAddress === undefined || socket.remotePort === undefined)) {
    const explanation = [...host.explanation, `TCP session-state rows on '${destinationId}' must declare both remoteAddress and remotePort; incomplete peer identity is not trusted.`, "Sequence/ACK progression and retransmission markers are NOT MODELED in this checkpoint."];
    return result("UNKNOWN", { ...base, truth: "UNKNOWN", model: "EXPLICIT_HOST_STACK", complete: host.complete, disposition: "MALFORMED", listenerTruth: listener.truth, socketRows: [], selectedSocketIds: [], currentStates: [], explanation });
  }

  const sourceAddresses = new Set(resourceAddresses(state, sourceId));
  const matchingSessions = rawTcpRows.filter((socket) => socket.state !== "LISTEN" && socket.remoteAddress !== undefined && sourceAddresses.has(socket.remoteAddress));
  const listeners = rawTcpRows.filter((socket) => socket.state === "LISTEN");
  const selectedIds = new Set((matchingSessions.length ? matchingSessions : listeners).map((socket) => socket.socketId));
  const socketRows: TcpSocketStateTrace[] = rawTcpRows.map((socket) => {
    const tcpState = socket.state as TcpLifecycleState;
    return {
      socketId: socket.socketId,
      localAddress: socket.localAddress,
      localPort: socket.localPort,
      state: tcpState,
      role: socketRole(tcpState),
      selected: selectedIds.has(socket.socketId),
      ...(socket.remoteAddress !== undefined ? { remoteAddress: socket.remoteAddress } : {}),
      ...(socket.remotePort !== undefined ? { remotePort: socket.remotePort } : {}),
      ...(socket.processId !== undefined ? { processId: socket.processId } : {}),
      ...(socket.service !== undefined ? { service: socket.service } : {}),
      allowedNextStates: allowedNextStates(tcpState),
    };
  });
  const selectedRows = socketRows.filter((row) => row.selected);
  const currentStates = uniqueStates(selectedRows);
  const commonTail = ["Sequence/ACK progression and retransmission markers are NOT MODELED in this checkpoint."];

  if (listener.truth === "FALSE") {
    const explanation = [...listener.explanation, "The destination host was reached but no TCP listener is proven, so the modeled connection attempt is CONNECTION_REFUSED at this abstraction. Exact RST packet fields are NOT MODELED.", ...commonTail];
    return result("FALSE", { ...base, truth: "FALSE", model: "EXPLICIT_HOST_STACK", complete: host.complete, disposition: "CONNECTION_REFUSED", listenerTruth: "FALSE", socketRows, selectedSocketIds: [...selectedIds].sort(), currentStates, explanation });
  }
  if (listener.truth === "UNKNOWN") {
    const explanation = [...listener.explanation, "TCP connection state cannot be completed because listener truth is not proven from the partial Host Stack snapshot.", ...commonTail];
    return result("UNKNOWN", { ...base, truth: "UNKNOWN", model: "EXPLICIT_HOST_STACK", complete: host.complete, disposition: "SNAPSHOT_INCOMPLETE", listenerTruth: "UNKNOWN", socketRows, selectedSocketIds: [...selectedIds].sort(), currentStates, explanation });
  }

  if (matchingSessions.length > 0) {
    const sessionStates = uniqueStates(socketRows.filter((row) => row.selected));
    if (matchingSessions.length > 1 && sessionStates.length > 1) {
      const explanation = [`Multiple TCP sessions on '${destinationId}' match modeled source address(es) for local port ${port}, but their lifecycle states disagree.`, ...commonTail];
      return result("UNKNOWN", { ...base, truth: "UNKNOWN", model: "EXPLICIT_HOST_STACK", complete: host.complete, disposition: "SESSION_AMBIGUOUS", listenerTruth: "TRUE", socketRows, selectedSocketIds: [...selectedIds].sort(), currentStates: sessionStates, explanation });
    }
    const explanation = [`Explicit Host Stack evidence contains ${matchingSessions.length} TCP session socket(s) for modeled source address(es) and destination port ${port}.`, `Current selected TCP state: ${sessionStates.join(", ")}.`, ...commonTail];
    return result("TRUE", { ...base, truth: "TRUE", model: "EXPLICIT_HOST_STACK", complete: host.complete, disposition: "SESSION_OBSERVED", listenerTruth: "TRUE", socketRows, selectedSocketIds: [...selectedIds].sort(), currentStates: sessionStates, explanation });
  }

  const explanation = [`Explicit Host Stack evidence proves a TCP LISTEN socket on '${destinationId}' port ${port}.`, "No source-bound child session is selected because no matching remoteAddress is explicitly modeled.", ...commonTail];
  return result("TRUE", { ...base, truth: "TRUE", model: "EXPLICIT_HOST_STACK", complete: host.complete, disposition: "LISTENING", listenerTruth: "TRUE", socketRows, selectedSocketIds: [...selectedIds].sort(), currentStates, explanation });
}
