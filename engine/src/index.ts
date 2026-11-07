/**
 * YadiLab — original project source.
 * Copyright © 2026 Daniel Ölund. All rights reserved.
 * Original author and copyright holder: Daniel Ölund.
 * No license is granted for commercial use, redistribution, or creation of
 * derivative works without prior written permission.
 * Third-party components retain their separate licenses; see THIRD_PARTY_NOTICES.md.
 */

export type {
  AuthenticationDetails,
  ConntrackDecisionTrace,
  ConntrackEntryDisposition,
  ConntrackEntryTrace,
  ConntrackState,
  DhcpClientStateRead,
  DhcpDoraDecisionTrace,
  DhcpDoraStageKind,
  DhcpDoraStageTrace,
  DhcpServerAttemptTrace,
  DhcpServerDisposition,
  DnsChainDecisionTrace,
  DnsConfiguredResolversState,
  DnsResolverAttemptTrace,
  DnsResolverDisposition,
  DnsResolverStateRead,
  EngineDiagnostic,
  EngineEvaluation,
  EngineQueryResult,
  EngineState,
  EvidenceEvent,
  FindingEvaluation,
  ForwardReturnPathComparisonTrace,
  HostListenerConsistency,
  HostProcessTrace,
  HostServiceTrace,
  HostSocketBindScope,
  HostSocketState,
  HostSocketTrace,
  HostStackDecisionTrace,
  HostStackModel,
  ListenerServiceDecisionTrace,
  ListenerServiceDisposition,
  ListenerServiceModel,
  ListenerStateRead,
  ServiceStateRead,
  TcpLifecycleState,
  TcpSocketStateTrace,
  TcpStateMachineDecisionTrace,
  UdpIcmpFailureDecisionTrace,
  UdpIcmpFailureDisposition,
  TcpStateMachineDisposition,
  TcpStateMachineModel,
  TcpStateTransitionTrace,
  TcpTelemetryStatus,
  MacCandidateDisposition,
  MacCandidateTrace,
  MacDecisionTrace,
  MacForwardingDisposition,
  MacLearningDisposition,
  MembershipDetails,
  NatDecisionKind,
  NatDecisionTrace,
  NatRuleDisposition,
  NatRuleTrace,
  NatTransformationDisposition,
  NeighborCandidateDisposition,
  NeighborCandidateTrace,
  NeighborDecisionTrace,
  NeighborProtocol,
  NeighborState,
  ObjectiveEvaluation,
  OperationResult,
  PermissionDetails,
  PolicyDecisionKind,
  PolicyDecisionTrace,
  PolicyRuleDisposition,
  PolicyRuleTrace,
  ReachabilityDetails,
  ReturnSecurityStatus,
  ReturnPathEvaluationMode,
  PathSymmetry,
  PathInterfaceComparisonTrace,
  RouteCandidateDisposition,
  RouteCandidateTrace,
  RouteDecisionTrace,
  RuleEvaluationContext,
  RuntimeResourceState,
  L2PropagationCounters,
  L2PropagationEvent,
  L2PropagationEventKind,
  L2PropagationOutcome,
  L2PropagationResult,
  MtuComparisonOutcome,
  MtuEvaluationRequest,
  MtuEvaluationTrace,
  MtuFragmentationDisposition,
  MtuIcmpDisposition,
  ScenarioOperation,
  ScenarioResource,
  ScenarioTest,
  TestEvaluation,
  TruthValue,
  StpBpduDisposition,
  StpDecisionTrace,
  StpPathDisposition,
  StpPortRole,
  StpPortState,
  StpPortTrace,
  StpProtocol,
  VlanDecisionTrace,
  VlanPortDisposition,
  VlanPortMode,
  VlanPortTrace,
  VlanRewriteDisposition,
  VlanTagState,
} from "./types.js";
export { simulateL2RepeatedPropagation } from "./l2-storm-engine.js";
export type { L2PropagationOptions } from "./l2-storm-engine.js";
export { derivePathMtu, evaluateMtuAtEgress } from "./mtu-engine.js";

export { truthAll, truthAny, truthEquals, truthNot } from "./truth.js";
export { readPath, removePath, setPath } from "./path.js";
export { createInitialEngineState, applyOperation, applyOperations } from "./state.js";
export { SIMULATION_EVENT_PLAN_FORMAT, SIMULATION_EVENT_PLAN_SCHEMA_VERSION, SIMULATION_EVENT_QUEUE_LIMIT, createSimulationEventPlan, inspectSimulationEventPlan, scheduleSimulationEvent, cancelSimulationEvent, advanceSimulationEventPlan } from "./simulation-clock.js";
export { SIMULATION_TRANSITION_FORMAT, SIMULATION_TRANSITION_VERSION, SIMULATION_MARKER_KIND, SIMULATION_MARKER_PROVENANCE, createSimulationTransitionState, inspectSimulationTransitionState, scheduleSimulationMarker, cancelSimulationMarker, advanceSimulationTransitions } from "./simulation-transitions.js";
export { OSPF_P2P_FORMAT, OSPF_P2P_VERSION, OSPF_P2P_MAX_EVENTS, OSPF_P2P_MAX_ADVANCE_EVENTS, createOspfP2pSession, inspectOspfP2pSession, receiveOspfP2pHello, advanceOspfP2pSession } from "./ospf-p2p-hello.js";
export type { OspfP2pNeighborState, OspfP2pTraceKind, OspfP2pConfig, OspfP2pHelloObservation, OspfP2pTrace, OspfP2pSession, OspfP2pResult } from "./ospf-p2p-hello.js";
export { OSPF_DD_FORMAT, OSPF_DD_VERSION, createOspfP2pDdSession, inspectOspfP2pDdSession, advanceOspfP2pDdSession, receiveOspfP2pDdHello, receiveOspfP2pDdDescription } from "./ospf-p2p-dd.js";
export type { OspfP2pDdConfig, OspfP2pDdObservation, OspfP2pDdReceipt, OspfP2pDdPhase, OspfP2pDdRole, OspfP2pDdTrace, OspfP2pDdSession, OspfP2pDdResult } from "./ospf-p2p-dd.js";
export { OSPF_EXCHANGE_FORMAT, OSPF_EXCHANGE_VERSION, OSPF_EXCHANGE_MAX_ACCEPTED, OSPF_EXCHANGE_MAX_RETRANSMITS, OSPF_EXCHANGE_MAX_ADVANCE_RETRANSMITS, createOspfP2pExchangeSession, inspectOspfP2pExchangeSession, advanceOspfP2pExchangeSession, receiveOspfP2pExchangeHello, receiveOspfP2pExchangeDescription } from "./ospf-p2p-exchange.js";
export type { OspfP2pExchangeConfig, OspfP2pExchangeRecord, OspfP2pExchangeSession, OspfP2pExchangeTrace, OspfP2pExchangeEvent, OspfP2pExchangeResult } from "./ospf-p2p-exchange.js";
export {
  OSPF_LSDB_SUMMARY_FORMAT, OSPF_LSDB_SUMMARY_VERSION, OSPF_LSDB_MAX_HEADERS,
  OSPF_LSDB_MAX_BATCH_HEADERS, OSPF_LSDB_MAX_BATCHES, OSPF_LSA_MAX_AGE,
  OSPF_LSA_MAX_AGE_DIFF, validOspfLsaHeader, compareOspfLsaHeaders,
  createOspfLsdbSummaryPlan, inspectOspfLsdbSummaryPlan, recordOspfLsdbSummaryBatch,
} from "./ospf-lsdb-summary.js";
export type {
  OspfLsaKind, OspfLsaHeader, OspfLsaRequestIntent, OspfLsdbSummaryAnchor,
  OspfLsdbSummaryPlan, OspfLsdbSummaryResult,
} from "./ospf-lsdb-summary.js";
export {
  OSPF_DD_SUMMARY_FORMAT, OSPF_DD_SUMMARY_VERSION,
  createOspfDdSummarySession, inspectOspfDdSummarySession,
  advanceOspfDdSummarySession, receiveOspfDdSummaryHello,
  receiveOspfDdSummaryDescription,
} from "./ospf-dd-summary-admission.js";
export type {
  OspfDdSummaryPage, OspfDdSummarySession,
  OspfDdSummaryTrace, OspfDdSummaryResult,
} from "./ospf-dd-summary-admission.js";
export {
  OSPF_LSA_BINARY_FORMAT, OSPF_LSA_BINARY_VERSION, OSPF_LSA_MAX_BYTES,
  verifyOspfLsaBinary,
} from "./ospf-lsa-binary.js";
export type { OspfLsaBinaryResult } from "./ospf-lsa-binary.js";
export {
  OSPF_LSA_BODY_FORMAT, OSPF_LSA_BODY_VERSION,
  OSPF_LSA_BODY_MAX_ROUTER_LINKS, OSPF_LSA_BODY_MAX_TOS_PER_LINK,
  OSPF_LSA_BODY_MAX_ATTACHED_ROUTERS, parseOspfLsaBody,
} from "./ospf-lsa-body.js";
export type {
  OspfRouterLinkKind, OspfRouterTosMetric, OspfRouterLinkBody,
  OspfRouterLsaBody, OspfNetworkLsaBody, OspfParsedLsaBody,
  OspfLsaBodyResult,
} from "./ospf-lsa-body.js";
export {
  OSPF_AREA_LSDB_FORMAT, OSPF_AREA_LSDB_VERSION,
  OSPF_AREA_LSDB_MAX_ENTRIES, OSPF_AREA_LSDB_MAX_BATCH,
  OSPF_AREA_MIN_LS_ARRIVAL_MS,
  createOspfAreaLsdbSession, inspectOspfAreaLsdbSession,
  readOspfAreaLsdb, advanceOspfAreaLsdb, receiveOspfAreaLsaBatch,
} from "./ospf-area-lsdb.js";
export type {
  OspfAreaLsaSource, OspfAreaLsdbAnchor, OspfAreaLsdbEntry,
  OspfAreaLsdbSession, OspfAreaLsdbObservation,
  OspfAreaLsdbEventKind, OspfAreaLsdbEvent,
  OspfAreaLsdbReadEntry, OspfAreaLsdbReadResult, OspfAreaLsdbResult,
} from "./ospf-area-lsdb.js";
export {
  OSPF_MAXAGE_FLUSH_FORMAT, OSPF_MAXAGE_FLUSH_VERSION,
  OSPF_MAXAGE_MAX_NEIGHBORS, OSPF_MAXAGE_MAX_RETRANSMISSION_IDS,
  OSPF_MAXAGE_MAX_REMOVAL_BATCH, OSPF_MAXAGE_INVENTORY_SOURCE,
  inspectOspfMaxAgeInventory, evaluateOspfMaxAgeFlush,
  removeOspfAreaMaxAgeModel,
} from "./ospf-maxage-flush-model.js";
export type {
  OspfMaxAgeNeighborPhase, OspfMaxAgeLsaIdentity,
  OspfMaxAgeNeighborDeclaration, OspfMaxAgeInventoryDeclaration,
  OspfMaxAgeFlushBlocker, OspfMaxAgeFlushCandidate,
  OspfMaxAgeFlushEvaluation, OspfMaxAgeFlushEvent, OspfMaxAgeFlushResult,
} from "./ospf-maxage-flush-model.js";
export {
  OSPF_LSR_FORMAT, OSPF_LSR_VERSION, OSPF_LSR_MAX_PACKET_REQUESTS,
  OSPF_LSR_MAX_UPDATE_LSAS, OSPF_LSR_MAX_RETRIES,
  OSPF_LSR_MAX_ADVANCE_RETRIES, inspectOspfLsRequestSession,
  createOspfLsRequestSession, issueOspfLsRequest,
  advanceOspfLsRequestSession, receiveOspfLsRequestHello,
  receiveOspfLsRequestUpdate,
} from "./ospf-lsr-lifecycle.js";
export type {
  OspfLsRequestCompletion, OspfLsRequestOutstanding,
  OspfLsRequestSession, OspfLsRequestTrace, OspfLsRequestResult,
  OspfLsUpdateObservation,
} from "./ospf-lsr-lifecycle.js";
export {
  OSPF_DD_FINISH_FORMAT, OSPF_DD_FINISH_VERSION,
  OSPF_DD_FINISH_MAX_LOCAL_PAGES,
  createOspfDdFinishSession, inspectOspfDdFinishSession,
  receiveOspfDdFinishDescription, receiveOspfDdFinishHello,
  advanceOspfDdFinishSession,
} from "./ospf-dd-exchange-done.js";
export type {
  OspfDdLocalSummaryIntent, OspfDdFinishSession,
  OspfDdFinishTrace, OspfDdFinishResult, OspfDdFinishEvent,
} from "./ospf-dd-exchange-done.js";
export {
  OSPF_LOADING_FORMAT, OSPF_LOADING_VERSION,
  createOspfLoadingSession, inspectOspfLoadingSession,
  receiveOspfLoadingDescription, advanceOspfLoadingSession,
  receiveOspfLoadingHello, issueOspfLoadingRequest,
  receiveOspfLoadingUpdate,
} from "./ospf-loading-coordinator.js";
export type {
  OspfLoadingPhase, OspfLoadingSession, OspfLoadingTrace,
  OspfLoadingEvent, OspfLoadingResult,
} from "./ospf-loading-coordinator.js";
export type { SimulationMarkerReceipt, SimulationMarkerCancellation, SimulationTransitionState, SimulationMarkerRequest, SimulationTransitionResult } from "./simulation-transitions.js";
export type { ScheduledSimulationEvent, SimulationEventPlan, SimulationEventPlanResult, NewSimulationEvent } from "./simulation-clock.js";
export { queryServiceEnabled, queryListeningPort, queryListenerServiceState, queryHostStackView } from "./service-engine.js";
export { queryTcpStateMachine } from "./tcp-engine.js";
export { sourceDefaultGatewayVerdict, queryReachabilityWithSourceGateway } from "./source-gateway-engine.js";
export { withUdpIcmpFailureDiagnostic, validateUdpIcmpFailureDecision } from "./udp-icmp-engine.js";
export { normalizeDnsQueryName, queryDnsChain } from "./dns-engine.js";
export { queryDhcpDora } from "./dhcp-engine.js";
export { queryLayer2BroadcastReachability, queryReachability } from "./network-engine.js";
export { queryAuthentication, queryMembership, queryPermission } from "./identity-engine.js";
export { evaluateRule } from "./rule-engine.js";
export { evaluateTest } from "./test-engine.js";
export { evaluateEngine } from "./evaluation.js";
export { replayCanonicalSolution, runScenarioRegression } from "./regression.js";
export { createSaveState, restoreSaveState } from "./save-state.js";
export type { RestoreSaveFailure, RestoreSaveResult, RestoreSaveSuccess } from "./save-state.js";
export type { CanonicalReplayResult, RegressionCheck, RegressionCheckKind, RegressionPhase, ScenarioRegressionReport } from "./regression.js";

export { ENGINE_VERSION } from "./version.js";
