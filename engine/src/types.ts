import type {
  NormalizedScenario,
  Normalizedscenariooperation,
  Normalizedscenarioresource,
  Normalizedscenariotest,
} from "../../core-model/src/generated/contracts.js";

export type TruthValue = "TRUE" | "FALSE" | "UNKNOWN";

export type L2PropagationEventKind = "FRAME_GENERATED" | "FLOOD_FORWARD" | "LOOP_REENTRY" | "SIMULATION_LIMIT" | "PROPAGATION_COMPLETE";
export type L2PropagationOutcome = "COMPLETE" | "SAFETY_CUTOFF" | "UNKNOWN";

export interface L2PropagationEvent {
  readonly eventId: string;
  readonly parentEventId?: string;
  readonly frameId: string;
  readonly kind: L2PropagationEventKind;
  readonly currentResourceId: string;
  readonly ingressInterface?: string;
  readonly egressInterface?: string;
  readonly connectionId?: string;
  readonly propagationDepth: number;
  readonly repetitionCount: number;
  readonly forwardingReason: string;
  readonly stpState?: "FORWARDING" | "BLOCKING" | "DISCARDING" | "UNKNOWN";
  readonly provenance: "ENGINE_L2_PROPAGATION";
}

export interface L2PropagationCounters {
  readonly generated: number;
  readonly forwarded: number;
  readonly loopReentries: number;
  readonly affectedNodes: number;
  readonly affectedLinks: number;
  readonly currentDepth: number;
  readonly safetyLimit: number;
}

export interface L2PropagationResult {
  readonly truth: TruthValue;
  readonly outcome: L2PropagationOutcome;
  readonly events: readonly L2PropagationEvent[];
  readonly counters: L2PropagationCounters;
  readonly explanation: readonly string[];
}

export type MtuComparisonOutcome = "WITHIN_MTU" | "EXCEEDS_MTU" | "UNKNOWN" | "UNMODELED";
export type MtuFragmentationDisposition = "NOT_MODELED" | "NOT_REQUIRED";
export type MtuIcmpDisposition = "NOT_MODELED";

export interface MtuEvaluationTrace {
  readonly resourceId: string;
  readonly egressInterface: string;
  readonly connectionId?: string;
  readonly packetSize?: number;
  readonly ipVersion?: "IPv4" | "IPv6";
  readonly df?: boolean;
  readonly egressMtu?: number;
  readonly pathMtu?: number;
  readonly comparison: MtuComparisonOutcome;
  readonly fragmentation: MtuFragmentationDisposition;
  readonly icmp: MtuIcmpDisposition;
  readonly truth: TruthValue;
  readonly provenance: "ENGINE_MTU_EVALUATION";
  readonly explanation: readonly string[];
}

export interface MtuEvaluationRequest {
  readonly resourceId: string;
  readonly egressInterface: string;
  readonly packetSize?: number;
  readonly ipVersion?: "IPv4" | "IPv6";
  readonly df?: boolean;
  readonly provenPath?: readonly string[];
}

export interface EngineQueryResult<T> {
  readonly truth: TruthValue;
  readonly value?: T;
  readonly explanation: readonly string[];
}

export interface RuntimeResourceState {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly zone?: string;
  readonly profile?: string;
  readonly vendor?: string;
  readonly product?: string;
  readonly interfaces: readonly Readonly<Record<string, unknown>>[];
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface EngineState {
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly stateRevision: number;
  readonly resources: Readonly<Record<string, RuntimeResourceState>>;
}

export interface EngineDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly target?: string;
  readonly path?: string;
}

export interface OperationSuccess {
  readonly ok: true;
  readonly state: EngineState;
}

export interface OperationFailure {
  readonly ok: false;
  readonly state: EngineState;
  readonly diagnostic: EngineDiagnostic;
}

export type OperationResult = OperationSuccess | OperationFailure;


export type PathSymmetry = "SYMMETRIC" | "ASYMMETRIC" | "UNRESOLVED";
export type ReturnPathEvaluationMode = "FULL" | "NETWORK_ONLY";
export type ReturnSecurityStatus = "MODELED" | "RETURN_TUPLE_NOT_MODELED";

export interface PathInterfaceComparisonTrace {
  readonly resourceId: string;
  readonly forwardOutgoingInterface?: string;
  readonly returnOutgoingInterface?: string;
  readonly differs: boolean;
}

export interface ForwardReturnPathComparisonTrace {
  readonly sourceId: string;
  readonly destinationId: string;
  readonly protocol: "tcp" | "udp" | "icmp" | "any";
  readonly servicePort?: number;
  readonly forwardTruth: TruthValue;
  readonly forwardPath?: readonly string[];
  readonly forwardBlockingPoint?: string;
  readonly returnTruth: TruthValue;
  readonly returnPath?: readonly string[];
  readonly returnBlockingPoint?: string;
  readonly symmetry: PathSymmetry;
  readonly returnEvaluationMode: ReturnPathEvaluationMode;
  readonly returnSecurityStatus: ReturnSecurityStatus;
  readonly natStateImplication: "NONE" | "MODELED" | "RETURN_TUPLE_REQUIRED";
  readonly interfaceComparisons: readonly PathInterfaceComparisonTrace[];
  readonly returnRouteDecisions?: readonly RouteDecisionTrace[];
  readonly returnNeighborDecisions?: readonly NeighborDecisionTrace[];
  readonly returnMacDecisions?: readonly MacDecisionTrace[];
  readonly returnVlanDecisions?: readonly VlanDecisionTrace[];
  readonly returnStpDecisions?: readonly StpDecisionTrace[];
  readonly returnPolicyDecisions?: readonly PolicyDecisionTrace[];
  readonly returnNatDecisions?: readonly NatDecisionTrace[];
  readonly returnConntrackDecisions?: readonly ConntrackDecisionTrace[];
  readonly explanation: readonly string[];
}

export type HostStackModel = "SERVICE_DECLARATIONS" | "EXPLICIT_HOST_STACK";
export type HostSocketBindScope = "WILDCARD" | "LOOPBACK" | "SPECIFIC";
export type TcpLifecycleState =
  | "CLOSED"
  | "LISTEN"
  | "SYN_SENT"
  | "SYN_RECEIVED"
  | "ESTABLISHED"
  | "FIN_WAIT_1"
  | "FIN_WAIT_2"
  | "CLOSE_WAIT"
  | "CLOSING"
  | "LAST_ACK"
  | "TIME_WAIT"
  | "UNKNOWN";
export type HostSocketState = TcpLifecycleState | "BOUND";
export type HostListenerConsistency = "CONSISTENT" | "MISMATCH" | "UNMODELED";

export interface HostProcessTrace {
  readonly processId: string;
  readonly name: string;
  readonly pid?: number;
  readonly service?: string;
}

export interface HostSocketTrace {
  readonly socketId: string;
  readonly protocol: "tcp" | "udp";
  readonly localAddress: string;
  readonly localPort: number;
  readonly bindScope: HostSocketBindScope;
  readonly state: HostSocketState;
  readonly remoteAddress?: string;
  readonly remotePort?: number;
  readonly processId?: string;
  readonly service?: string;
}

export interface HostServiceTrace {
  readonly index: number;
  readonly name: string;
  readonly enabled?: boolean;
  readonly port?: number;
  readonly protocol?: "tcp" | "udp" | "icmp" | "any";
  readonly owningProcessIds: readonly string[];
  readonly socketIds: readonly string[];
}

export interface HostStackDecisionTrace {
  readonly resourceId: string;
  readonly truth: TruthValue;
  readonly model: HostStackModel;
  readonly complete: boolean;
  readonly processes: readonly HostProcessTrace[];
  readonly sockets: readonly HostSocketTrace[];
  readonly services: readonly HostServiceTrace[];
  readonly selectedServiceNames: readonly string[];
  readonly selectedSocketIds: readonly string[];
  readonly listenerConsistency: HostListenerConsistency;
  readonly explanation: readonly string[];
}

export type ListenerServiceModel = "NOT_REQUIRED" | "SERVICE_DECLARATIONS" | "EXPLICIT_HOST_STACK";
export type ListenerStateRead = "NOT_REQUIRED" | "LISTENING" | "NOT_LISTENING" | "UNKNOWN";
export type ServiceStateRead = "UNDECLARED" | "ENABLED" | "DISABLED" | "MIXED" | "UNKNOWN";
export type ListenerServiceDisposition =
  | "NOT_REQUIRED"
  | "LISTENING"
  | "NO_LISTENER"
  | "SERVICE_DISABLED"
  | "SERVICE_STATE_UNKNOWN"
  | "DECLARATION_ABSENT"
  | "SNAPSHOT_INCOMPLETE"
  | "MALFORMED"
  | "RESOURCE_ABSENT";

export interface ListenerServiceDecisionTrace {
  readonly resourceId: string;
  readonly truth: TruthValue;
  readonly protocol: "tcp" | "udp" | "icmp" | "any";
  readonly port?: number;
  readonly model: ListenerServiceModel;
  readonly complete: boolean;
  readonly listenerState: ListenerStateRead;
  readonly serviceState: ServiceStateRead;
  readonly disposition: ListenerServiceDisposition;
  readonly selectedServiceNames: readonly string[];
  readonly selectedSocketIds: readonly string[];
  readonly listenerConsistency: HostListenerConsistency;
  readonly explanation: readonly string[];
}

export type UdpIcmpFailureDisposition = "DATAGRAM_DELIVERABLE" | "REQUEST_PATH_REACHABLE" | "NO_LISTENER" | "SERVICE_DISABLED" | "NETWORK_BLOCKED" | "POLICY_BLOCKED" | "SNAPSHOT_INCOMPLETE" | "UNKNOWN";

// Classification over existing Engine decisions, not a packet/timer emulator.
export interface UdpIcmpFailureDecisionTrace {
  readonly sourceId: string;
  readonly destinationId: string;
  readonly protocol: "udp" | "icmp";
  readonly port?: number;
  readonly effectiveDestinationPort?: number;
  readonly translatedSource?: string;
  readonly truth: TruthValue;
  readonly networkTruth: TruthValue;
  readonly policyTruth: TruthValue | "NOT_EVALUATED";
  readonly listenerTruth: TruthValue | "NOT_EVALUATED" | "NOT_REQUIRED";
  readonly listenerModel?: ListenerServiceModel;
  readonly listenerDisposition?: ListenerServiceDisposition;
  readonly disposition: UdpIcmpFailureDisposition;
  readonly icmpEvidence: "NOT_MODELED";
  readonly reply: "NOT_MODELED";
  readonly timeout: "NOT_MODELED";
  readonly retries: "NOT_MODELED";
  readonly explanation: readonly string[];
}

export type TcpStateMachineModel = "SERVICE_DECLARATIONS" | "EXPLICIT_HOST_STACK";
export type TcpStateMachineDisposition =
  | "DECLARATION_ONLY"
  | "LISTENING"
  | "CONNECTION_REFUSED"
  | "SESSION_OBSERVED"
  | "SESSION_AMBIGUOUS"
  | "SNAPSHOT_INCOMPLETE"
  | "MALFORMED"
  | "RESOURCE_ABSENT";
export type TcpTelemetryStatus = "NOT_MODELED";

export interface TcpStateTransitionTrace {
  readonly from: TcpLifecycleState;
  readonly to: TcpLifecycleState;
  readonly trigger: string;
}

export interface TcpSocketStateTrace {
  readonly socketId: string;
  readonly localAddress: string;
  readonly localPort: number;
  readonly state: TcpLifecycleState;
  readonly role: "LISTENER" | "SESSION" | "CLOSED_OR_UNKNOWN";
  readonly selected: boolean;
  readonly remoteAddress?: string;
  readonly remotePort?: number;
  readonly processId?: string;
  readonly service?: string;
  readonly allowedNextStates: readonly TcpLifecycleState[];
}

export interface TcpStateMachineDecisionTrace {
  readonly sourceId: string;
  readonly destinationId: string;
  readonly port: number;
  readonly truth: TruthValue;
  readonly model: TcpStateMachineModel;
  readonly complete: boolean;
  readonly disposition: TcpStateMachineDisposition;
  readonly listenerTruth: TruthValue;
  readonly socketRows: readonly TcpSocketStateTrace[];
  readonly selectedSocketIds: readonly string[];
  readonly currentStates: readonly TcpLifecycleState[];
  readonly canonicalTransitions: readonly TcpStateTransitionTrace[];
  readonly sequenceAckTimeline: TcpTelemetryStatus;
  readonly retransmissionMarkers: TcpTelemetryStatus;
  readonly explanation: readonly string[];
}

export type DnsConfiguredResolversState = "KNOWN" | "ABSENT" | "MALFORMED";
export type DnsResolverStateRead = "KNOWN" | "ABSENT" | "MALFORMED";
export type DnsResolverDisposition =
  | "UNMAPPED"
  | "AMBIGUOUS_MAPPING"
  | "NETWORK_BLOCKED"
  | "NETWORK_UNKNOWN"
  | "SERVICE_DISABLED"
  | "SERVICE_UNKNOWN"
  | "RECORDS_UNKNOWN"
  | "NO_RECORD"
  | "RECORD_AMBIGUOUS"
  | "RECORD_MALFORMED"
  | "RESOLVED";

export interface DnsResolverAttemptTrace {
  readonly index: number;
  readonly resolverAddress: string;
  readonly mappedResourceIds: readonly string[];
  readonly selectedResourceId?: string;
  readonly networkTruth?: TruthValue;
  readonly networkPath?: readonly string[];
  readonly networkBlockingPoint?: string;
  readonly networkExplanation?: readonly string[];
  readonly serviceState?: DnsResolverStateRead;
  readonly serviceEnabled?: boolean;
  readonly recordsState?: DnsResolverStateRead;
  readonly matchedRecordCount?: number;
  readonly answerAddress?: string;
  readonly answerResourceIds?: readonly string[];
  readonly disposition: DnsResolverDisposition;
}

export interface DnsChainDecisionTrace {
  readonly sourceId: string;
  readonly queryName: string;
  readonly truth: TruthValue;
  readonly configuredResolversState: DnsConfiguredResolversState;
  readonly resolverAddresses: readonly string[];
  readonly attempts: readonly DnsResolverAttemptTrace[];
  readonly selectedResolverAddress?: string;
  readonly selectedResolverResourceId?: string;
  readonly resolvedAddress?: string;
  readonly resolvedResourceIds?: readonly string[];
  readonly explanation: readonly string[];
}

export type DhcpClientStateRead = "KNOWN" | "ABSENT" | "MALFORMED";
export type DhcpServerDisposition =
  | "L2_BLOCKED"
  | "L2_UNKNOWN"
  | "SERVER_STATE_UNKNOWN"
  | "SERVER_DISABLED"
  | "POOL_EXHAUSTED"
  | "POOL_UNKNOWN"
  | "OFFERS_UNKNOWN"
  | "NO_CLIENT_OFFER"
  | "OFFER_AMBIGUOUS"
  | "OFFER_MALFORMED"
  | "OFFERED";
export type DhcpDoraStageKind = "DISCOVER" | "OFFER" | "REQUEST" | "ACK";

export interface DhcpDoraStageTrace {
  readonly stage: DhcpDoraStageKind;
  readonly truth: TruthValue;
  readonly serverResourceId?: string;
  readonly explanation: readonly string[];
}

export interface DhcpServerAttemptTrace {
  readonly index: number;
  readonly serverResourceId: string;
  readonly discoverTruth: TruthValue;
  readonly discoverPath?: readonly string[];
  readonly discoverExplanation: readonly string[];
  readonly offerReturnTruth?: TruthValue;
  readonly offerReturnPath?: readonly string[];
  readonly offerReturnExplanation?: readonly string[];
  readonly serverEnabled?: boolean;
  readonly availableLeases?: number;
  readonly matchedOfferCount?: number;
  readonly offeredAddress?: string;
  readonly gateway?: string;
  readonly dnsServers?: readonly string[];
  readonly prefixLength?: number;
  readonly disposition: DhcpServerDisposition;
}

export interface DhcpDoraDecisionTrace {
  readonly clientId: string;
  readonly truth: TruthValue;
  readonly clientState: DhcpClientStateRead;
  readonly clientEnabled?: boolean;
  readonly attempts: readonly DhcpServerAttemptTrace[];
  readonly stages: readonly DhcpDoraStageTrace[];
  readonly selectedServerResourceId?: string;
  readonly offeredAddress?: string;
  readonly gateway?: string;
  readonly dnsServers?: readonly string[];
  readonly prefixLength?: number;
  readonly explanation: readonly string[];
}

export interface ReachabilityDetails {
  readonly networkTruthBeforeListener?: TruthValue;
  readonly from: string;
  readonly to: string;
  readonly protocol: "tcp" | "udp" | "icmp" | "any";
  readonly port?: number;
  readonly path?: readonly string[];
  readonly blockingPoint?: string;
  readonly matchedPolicy?: string;
  readonly translatedPort?: number;
  readonly translatedSource?: string;
  readonly matchedSnatRule?: string;
  readonly routeDecisions?: readonly RouteDecisionTrace[];
  readonly neighborDecisions?: readonly NeighborDecisionTrace[];
  readonly macDecisions?: readonly MacDecisionTrace[];
  readonly vlanDecisions?: readonly VlanDecisionTrace[];
  readonly stpDecisions?: readonly StpDecisionTrace[];
  readonly policyDecisions?: readonly PolicyDecisionTrace[];
  readonly natDecisions?: readonly NatDecisionTrace[];
  readonly conntrackDecisions?: readonly ConntrackDecisionTrace[];
  readonly pathComparison?: ForwardReturnPathComparisonTrace;
  readonly hostStackDecision?: HostStackDecisionTrace;
  readonly listenerServiceDecision?: ListenerServiceDecisionTrace;
  readonly tcpStateMachineDecision?: TcpStateMachineDecisionTrace;
  readonly udpIcmpFailureDecision?: UdpIcmpFailureDecisionTrace;
}

export type ConntrackState = "NEW" | "ESTABLISHED" | "RELATED" | "INVALID" | "UNKNOWN";
export type ConntrackEntryDisposition = "MATCH" | "NO_MATCH" | "DISABLED" | "MALFORMED" | "INDETERMINATE";

export interface ConntrackEntryTrace {
  readonly index: number;
  readonly entryId: string;
  readonly disposition: ConntrackEntryDisposition;
  readonly selected: boolean;
  readonly source?: string;
  readonly destination?: string;
  readonly protocol?: string;
  readonly port?: number;
  readonly state?: ConntrackState;
  readonly sourceMatch?: TruthValue;
  readonly destinationMatch?: boolean;
  readonly protocolMatch?: boolean;
  readonly portMatch?: boolean;
}

export interface ConntrackDecisionTrace {
  readonly resourceId: string;
  readonly destinationId: string;
  readonly truth: TruthValue;
  readonly complete?: boolean;
  readonly entries: readonly ConntrackEntryTrace[];
  readonly selectedEntryId?: string;
  readonly connectionState?: ConntrackState;
  readonly observedSource?: string;
  readonly observedPort?: number;
  readonly explanation: readonly string[];
}

export type NatDecisionKind = "DNAT" | "SNAT";
export type NatRuleDisposition = "MATCH" | "NO_MATCH" | "DISABLED" | "MALFORMED" | "INDETERMINATE" | "NOT_EVALUATED" | "OTHER_KIND" | "DECLARED";
export type NatTransformationDisposition = "TRANSLATED" | "PASSTHROUGH" | "BLOCKED" | "UNKNOWN";

export interface NatRuleTrace {
  readonly index: number;
  readonly ruleId: string;
  readonly declaredType?: string;
  readonly disposition: NatRuleDisposition;
  readonly selected: boolean;
  readonly source?: string;
  readonly destination?: string;
  readonly protocol?: string;
  readonly port?: number;
  readonly externalPort?: number;
  readonly action?: string;
  readonly translatedDestination?: string;
  readonly translatedPort?: number;
  readonly translatedSource?: string;
  readonly sourceMatch?: TruthValue;
  readonly destinationMatch?: boolean;
  readonly protocolMatch?: boolean;
  readonly portMatch?: boolean;
}

export interface NatDecisionTrace {
  readonly resourceId: string;
  readonly destinationId: string;
  readonly kind: NatDecisionKind;
  readonly truth: TruthValue;
  readonly policyMode?: "required" | "optional";
  readonly transformation: NatTransformationDisposition;
  readonly rules: readonly NatRuleTrace[];
  readonly selectedRuleId?: string;
  readonly inputSource?: string;
  readonly outputSource?: string;
  readonly inputPort?: number;
  readonly outputPort?: number;
  readonly explanation: readonly string[];
}

export type PolicyDecisionKind = "ACL" | "FIREWALL";
export type FirewallScope = "NETWORK" | "LOCAL_HOST";
export type PolicyRuleDisposition = "MATCH" | "NO_MATCH" | "DISABLED" | "MALFORMED" | "INDETERMINATE" | "NOT_EVALUATED";

export interface PolicyRuleTrace {
  readonly index: number;
  readonly ruleId: string;
  readonly disposition: PolicyRuleDisposition;
  readonly selected: boolean;
  readonly source?: string;
  readonly destination?: string;
  readonly protocol?: string;
  readonly port?: number;
  readonly action?: string;
  readonly sourceMatch?: TruthValue;
  readonly destinationMatch?: boolean;
  readonly protocolMatch?: boolean;
  readonly portMatch?: boolean;
  readonly connectionState?: Exclude<ConntrackState, "UNKNOWN">;
  readonly connectionStateMatch?: TruthValue;
}

export interface PolicyDecisionTrace {
  readonly resourceId: string;
  readonly destinationId: string;
  readonly kind: PolicyDecisionKind;
  readonly firewallScope?: FirewallScope;
  readonly truth: TruthValue;
  readonly observedSource?: string;
  readonly rules: readonly PolicyRuleTrace[];
  readonly selectedPolicyId?: string;
  readonly defaultAction?: string;
  readonly usedDefault: boolean;
  readonly explanation: readonly string[];
}

export type RouteCandidateDisposition = "MATCH" | "NO_MATCH" | "DISABLED" | "MALFORMED";

export interface RouteCandidateTrace {
  readonly index: number;
  readonly routeId: string;
  readonly disposition: RouteCandidateDisposition;
  readonly selected: boolean;
  readonly destination?: string;
  readonly prefixLength?: number;
  readonly action?: string;
  readonly via?: string;
  readonly outgoingInterface?: string;
  readonly declaredMetric?: number;
  readonly declaredPreference?: number;
}

export interface RouteDecisionTrace {
  readonly resourceId: string;
  readonly destinationId: string;
  readonly nextHopResourceId: string;
  readonly truth: TruthValue;
  readonly candidates: readonly RouteCandidateTrace[];
  readonly selectedRouteId?: string;
  readonly declaredNextHop?: string;
  readonly outgoingInterface?: string;
  readonly explanation: readonly string[];
}

export type NeighborProtocol = "ARP" | "ND";
export type NeighborState = "REACHABLE" | "STALE" | "INCOMPLETE" | "FAILED" | "UNKNOWN";
export type NeighborCandidateDisposition = "MATCH" | "NO_MATCH" | "MALFORMED";

export interface NeighborCandidateTrace {
  readonly index: number;
  readonly entryId: string;
  readonly disposition: NeighborCandidateDisposition;
  readonly selected: boolean;
  readonly targetResourceId?: string;
  readonly protocol?: NeighborProtocol;
  readonly address?: string;
  readonly mac?: string;
  readonly interfaceId?: string;
  readonly state?: NeighborState;
}

export interface NeighborDecisionTrace {
  readonly resourceId: string;
  readonly destinationId: string;
  readonly nextHopResourceId: string;
  readonly truth: TruthValue;
  readonly candidates: readonly NeighborCandidateTrace[];
  readonly selectedEntryId?: string;
  readonly selectedProtocol?: NeighborProtocol;
  readonly selectedAddress?: string;
  readonly selectedMac?: string;
  readonly outgoingInterface?: string;
  readonly selectedState?: NeighborState;
  readonly explanation: readonly string[];
}

export type MacCandidateDisposition = "SOURCE_MATCH" | "DESTINATION_MATCH" | "BOTH_MATCH" | "NO_MATCH" | "MALFORMED";
export type MacLearningDisposition = "LEARNED" | "REFRESHED" | "MOVED" | "UNKNOWN";
export type MacForwardingDisposition = "UNICAST" | "FLOOD" | "FILTERED" | "BROADCAST" | "UNKNOWN";

export interface MacCandidateTrace {
  readonly index: number;
  readonly entryId: string;
  readonly disposition: MacCandidateDisposition;
  readonly selected: boolean;
  readonly mac?: string;
  readonly interfaceId?: string;
  readonly vlan?: number;
}

export interface MacDecisionTrace {
  readonly resourceId: string;
  readonly sourceResourceId: string;
  readonly nextHopResourceId: string;
  readonly destinationId: string;
  readonly truth: TruthValue;
  readonly sourceMac?: string;
  readonly destinationMac?: string;
  readonly ingressInterface?: string;
  readonly expectedEgressInterface?: string;
  readonly selectedEntryId?: string;
  readonly selectedEgressInterface?: string;
  readonly floodInterfaces?: readonly string[];
  readonly vlan?: number;
  readonly learning: MacLearningDisposition;
  readonly forwarding: MacForwardingDisposition;
  readonly candidates: readonly MacCandidateTrace[];
  readonly explanation: readonly string[];
}

export type VlanPortMode = "ACCESS" | "TRUNK";
export type VlanTagState = "TAGGED" | "UNTAGGED";
export type VlanRewriteDisposition = "ADD_TAG" | "REMOVE_TAG" | "PRESERVE_TAG" | "PRESERVE_UNTAGGED" | "UNKNOWN";
export type VlanPortDisposition = "INGRESS" | "EGRESS" | "ELIGIBLE" | "BLOCKED" | "MALFORMED" | "UNUSED";

export interface VlanPortTrace {
  readonly interfaceId: string;
  readonly disposition: VlanPortDisposition;
  readonly mode?: VlanPortMode;
  readonly accessVlan?: number;
  readonly allowedVlans?: readonly number[];
  readonly nativeVlan?: number;
  readonly egressTag?: VlanTagState;
}

export interface VlanDecisionTrace {
  readonly resourceId: string;
  readonly sourceResourceId: string;
  readonly nextHopResourceId: string;
  readonly destinationId: string;
  readonly truth: TruthValue;
  readonly vlan?: number;
  readonly ingressInterface?: string;
  readonly egressInterface?: string;
  readonly ingressMode?: VlanPortMode;
  readonly egressMode?: VlanPortMode;
  readonly ingressTag?: VlanTagState;
  readonly egressTag?: VlanTagState;
  readonly rewrite: VlanRewriteDisposition;
  readonly ports: readonly VlanPortTrace[];
  readonly explanation: readonly string[];
}

export type StpProtocol = "STP" | "RSTP" | "MSTP" | "UNKNOWN";
export type StpPortRole = "ROOT" | "DESIGNATED" | "ALTERNATE" | "BACKUP" | "DISABLED" | "UNKNOWN";
export type StpPortState = "FORWARDING" | "BLOCKING" | "DISCARDING" | "LEARNING" | "LISTENING" | "DISABLED" | "UNKNOWN";
export type StpBpduDisposition = "SEND" | "RECEIVE" | "NONE" | "UNKNOWN";
export type StpPathDisposition = "INGRESS" | "EGRESS" | "OTHER" | "MALFORMED";

export interface StpPortTrace {
  readonly interfaceId: string;
  readonly disposition: StpPathDisposition;
  readonly role?: StpPortRole;
  readonly state?: StpPortState;
  readonly bpdu?: StpBpduDisposition;
}

export interface StpDecisionTrace {
  readonly resourceId: string;
  readonly sourceResourceId: string;
  readonly nextHopResourceId: string;
  readonly destinationId: string;
  readonly truth: TruthValue;
  readonly modelComplete: boolean;
  readonly ingressInterface?: string;
  readonly egressInterface?: string;
  readonly protocol?: StpProtocol;
  readonly bridgeId?: string;
  readonly rootBridgeId?: string;
  readonly rootPathCost?: number;
  readonly isRootBridge?: boolean;
  readonly ports: readonly StpPortTrace[];
  readonly explanation: readonly string[];
}

export interface MembershipDetails {
  readonly subject: string;
  readonly group: string;
  readonly path?: readonly string[];
}

export interface PermissionDetails {
  readonly subject: string;
  readonly resource: string;
  readonly permission: string;
  readonly via?: string;
  readonly effect?: "allow" | "deny";
}

export interface AuthenticationDetails {
  readonly subject: string;
  readonly target: string;
  readonly via?: string;
  readonly mfaRequired?: boolean;
}

export interface TestEvaluation {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly outcome: TruthValue;
  readonly explanation: readonly string[];
  readonly expectedInitial?: TruthValue;
  readonly matchesExpectedInitial?: TruthValue;
}

export interface FindingEvaluation {
  readonly id: string;
  readonly title: string;
  readonly severity: "info" | "low" | "medium" | "high" | "critical";
  readonly state: TruthValue;
  readonly explanation: readonly string[];
  readonly evidenceTests: readonly string[];
}

export interface ObjectiveEvaluation {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly required: boolean;
  readonly state: TruthValue;
  readonly explanation: readonly string[];
}

export interface EvidenceEvent {
  readonly sequence: number;
  readonly testId: string;
  readonly outcome: TruthValue;
  readonly summary: string;
  readonly explanation: readonly string[];
}

export interface EngineEvaluation {
  readonly tests: readonly TestEvaluation[];
  readonly testResults: Readonly<Record<string, TruthValue>>;
  readonly findings: readonly FindingEvaluation[];
  readonly objectives: readonly ObjectiveEvaluation[];
  readonly completion: EngineQueryResult<undefined>;
  readonly evidence: readonly EvidenceEvent[];
}

export interface RuleEvaluationContext {
  readonly scenario: NormalizedScenario;
  readonly state: EngineState;
  readonly testResults: Readonly<Record<string, TruthValue>>;
}

export type ScenarioOperation = Normalizedscenariooperation;
export type ScenarioResource = Normalizedscenarioresource;
export type ScenarioTest = Normalizedscenariotest;
