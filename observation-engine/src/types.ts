import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import type { UdpIcmpFailureDecisionTrace, ConntrackDecisionTrace, DhcpDoraDecisionTrace, DnsChainDecisionTrace, EngineState, ForwardReturnPathComparisonTrace, HostStackDecisionTrace, ListenerServiceDecisionTrace, TcpStateMachineDecisionTrace, MacDecisionTrace, NatDecisionTrace, NeighborDecisionTrace, PolicyDecisionTrace, RouteDecisionTrace, StpDecisionTrace, VlanDecisionTrace, RuntimeResourceState, TruthValue } from "../../engine/src/index.js";

export type ObservationOs = "windows" | "linux";
export type ObservationCategory = "interface" | "routing" | "dns" | "dhcp" | "firewall" | "service";
export type ObservationEvidenceState = "KNOWN" | "ABSENT" | "MALFORMED";
export type ObservationDiagnosticSeverity = "warning" | "error";

export interface ObservationCommandDefinition {
  readonly commandId: string;
  readonly os: ObservationOs;
  readonly command: string;
  readonly label: string;
  readonly category: ObservationCategory;
  readonly description: string;
}

export interface ObservationEvidence {
  readonly path: string;
  readonly state: ObservationEvidenceState;
  readonly value?: unknown;
}

export interface ObservationDiagnostic {
  readonly severity: ObservationDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface ObservationTranscript {
  readonly engineId: "foundation.observation";
  readonly engineVersion: string;
  readonly modeled: true;
  readonly boundary: "NO_GUEST_COMMAND_EXECUTION";
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly stateRevision: number;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly targetType: string;
  readonly commandId: string;
  readonly command: string;
  readonly category: ObservationCategory;
  readonly lines: readonly string[];
  readonly evidence: readonly ObservationEvidence[];
}

export interface ObservationSuccess {
  readonly ok: true;
  readonly transcript: ObservationTranscript;
  readonly diagnostics: readonly ObservationDiagnostic[];
}

export interface ObservationFailure {
  readonly ok: false;
  readonly diagnostics: readonly ObservationDiagnostic[];
}

export type ObservationResult = ObservationSuccess | ObservationFailure;

export interface ObservationRequest {
  readonly state: EngineState;
  readonly targetId: string;
  readonly commandId: string;
}

export interface ObservationCommandContext {
  readonly state: EngineState;
  readonly resource: RuntimeResourceState;
  readonly evidence: ObservationEvidence[];
  readonly diagnostics: ObservationDiagnostic[];
}


export type ActiveProbeCategory = "connectivity" | "dns" | "dhcp" | "path";
export type ActiveProbeArgumentKind = "destination" | "destination_port" | "dns_name" | "none";

export interface ActiveProbeDefinition {
  readonly probeId: string;
  readonly os: ObservationOs;
  readonly commandTemplate: string;
  readonly label: string;
  readonly category: ActiveProbeCategory;
  readonly description: string;
  readonly argumentKind: ActiveProbeArgumentKind;
}

export interface ActiveProbeEvidence {
  readonly kind: "engine_query" | "modeled_state" | "dns_record" | "topology_mapping";
  readonly subject: string;
  readonly state: "KNOWN" | "ABSENT" | "MALFORMED" | TruthValue;
  readonly value?: unknown;
}

export interface ActiveProbeTranscript {
  readonly engineId: "foundation.observation";
  readonly engineVersion: string;
  readonly modeled: true;
  readonly boundary: "NO_GUEST_COMMAND_EXECUTION";
  readonly probeMode: "ACTIVE_MODELED_PROBE";
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly stateRevision: number;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly sourceType: string;
  readonly probeId: string;
  readonly command: string;
  readonly category: ActiveProbeCategory;
  readonly truth: TruthValue;
  readonly destinationId?: string;
  readonly destinationLabel?: string;
  readonly protocol?: "tcp" | "udp" | "icmp" | "any";
  readonly port?: number;
  readonly queryName?: string;
  readonly resolvedAddress?: string;
  readonly resolvedResourceIds?: readonly string[];
  readonly path?: readonly string[];
  readonly blockingPoint?: string;
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
  readonly dnsChainDecision?: DnsChainDecisionTrace;
  readonly dhcpDoraDecision?: DhcpDoraDecisionTrace;
  readonly lines: readonly string[];
  readonly evidence: readonly ActiveProbeEvidence[];
}

export interface ActiveProbeSuccess {
  readonly ok: true;
  readonly transcript: ActiveProbeTranscript;
  readonly diagnostics: readonly ObservationDiagnostic[];
}

export interface ActiveProbeFailure {
  readonly ok: false;
  readonly diagnostics: readonly ObservationDiagnostic[];
}

export type ActiveProbeResult = ActiveProbeSuccess | ActiveProbeFailure;

export interface ActiveProbeRequest {
  readonly scenario: NormalizedScenario;
  readonly state: EngineState;
  readonly sourceId: string;
  readonly probeId: string;
  readonly destinationId?: string;
  readonly port?: number;
  readonly queryName?: string;
}

export type TroubleshootingNoteKind = "hypothesis" | "next_step" | "conclusion";

export interface TroubleshootingObservationEntry {
  readonly entryId: string;
  readonly sequence: number;
  readonly kind: "observation";
  readonly stateRevision: number;
  readonly engineId: ObservationTranscript["engineId"];
  readonly engineVersion: string;
  readonly boundary: ObservationTranscript["boundary"];
  readonly command: string;
  readonly category: ObservationCategory;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly transcriptIdentity: string;
  readonly lines: readonly string[];
  readonly evidence: readonly ObservationEvidence[];
  readonly learnerNote?: string;
}

export interface TroubleshootingActiveProbeEntry {
  readonly entryId: string;
  readonly sequence: number;
  readonly kind: "active_probe";
  readonly stateRevision: number;
  readonly engineId: ActiveProbeTranscript["engineId"];
  readonly engineVersion: string;
  readonly boundary: ActiveProbeTranscript["boundary"];
  readonly probeMode: ActiveProbeTranscript["probeMode"];
  readonly command: string;
  readonly category: ActiveProbeCategory;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly truth: TruthValue;
  readonly destinationId?: string;
  readonly destinationLabel?: string;
  readonly protocol?: "tcp" | "udp" | "icmp" | "any";
  readonly port?: number;
  readonly queryName?: string;
  readonly resolvedAddress?: string;
  readonly resolvedResourceIds?: readonly string[];
  readonly path?: readonly string[];
  readonly blockingPoint?: string;
  readonly transcriptIdentity: string;
  readonly lines: readonly string[];
  readonly evidence: readonly ActiveProbeEvidence[];
  readonly learnerNote?: string;
}


export type TypedRemediationActionId =
  | "change_default_gateway"
  | "change_dns_servers"
  | "set_firewall_default_action"
  | "set_interface_addresses"
  | "set_service_enabled"
  | "set_service_port"
  | "set_windows_network_profile";

export interface TroubleshootingTypedRemediationAction {
  readonly engineId: "foundation.typed_remediation";
  readonly engineVersion: string;
  readonly boundary: "LEARNER_ACTION_NO_SOLUTION";
  readonly actionId: TypedRemediationActionId;
  readonly label: string;
  readonly targetId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface TroubleshootingRemediationEntry {
  readonly entryId: string;
  readonly sequence: number;
  readonly kind: "remediation_action";
  readonly stateRevision: number;
  readonly beforeStateRevision: number;
  readonly afterStateRevision: number;
  readonly boundary: "LEARNER_OPERATION_NO_SOLUTION";
  readonly operation: { readonly op: "set" | "remove"; readonly target: string; readonly path: string; readonly value?: unknown };
  readonly operationIdentity: string;
  readonly typedAction?: TroubleshootingTypedRemediationAction;
  readonly beforeValueState: "KNOWN" | "ABSENT";
  readonly beforeValue?: unknown;
  readonly afterValueState: "KNOWN" | "ABSENT";
  readonly afterValue?: unknown;
  readonly learnerNote?: string;
}

export interface TroubleshootingLearnerNoteEntry {
  readonly entryId: string;
  readonly sequence: number;
  readonly kind: "learner_note";
  readonly stateRevision: number;
  readonly noteKind: TroubleshootingNoteKind;
  readonly text: string;
}

export type TroubleshootingNotebookEntry = TroubleshootingObservationEntry | TroubleshootingActiveProbeEntry | TroubleshootingRemediationEntry | TroubleshootingLearnerNoteEntry;

export interface TroubleshootingNotebook {
  readonly formatId: "infrastructure-cyber-lab.troubleshooting-notebook";
  readonly schemaVersion: "0.1.0" | "0.2.0" | "0.3.0";
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly notebookIdentity: string;
  readonly entries: readonly TroubleshootingNotebookEntry[];
}

export interface TroubleshootingNotebookResult {
  readonly ok: boolean;
  readonly notebook?: TroubleshootingNotebook;
  readonly diagnostics: readonly ObservationDiagnostic[];
}


export type EvidenceRequirementReviewStatus = "SATISFIED" | "PENDING" | "OUT_OF_ORDER";
export type EvidenceObjectiveReviewStatus = "SATISFIED" | "PENDING" | "OUT_OF_ORDER";
export type RequiredEvidenceReviewStatus = "NOT_CONFIGURED" | "SATISFIED" | "PENDING";

export interface EvidenceRequirementReview {
  readonly requirementId: string;
  readonly label: string;
  readonly kind: "observation" | "active_probe";
  readonly status: EvidenceRequirementReviewStatus;
  readonly matchedEntryId?: string;
  readonly matchedSequence?: number;
}

export interface EvidenceObjectiveReview {
  readonly objectiveId: string;
  readonly title: string;
  readonly description?: string;
  readonly required: boolean;
  readonly evidenceOrder: "ordered" | "unordered";
  readonly status: EvidenceObjectiveReviewStatus;
  readonly requirements: readonly EvidenceRequirementReview[];
}

export interface TroubleshootingEvidenceReview {
  readonly engineId: "foundation.evidence_review";
  readonly engineVersion: "0.1.0";
  readonly boundary: "NOTEBOOK_ONLY_NO_DIAGNOSIS";
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly notebookIdentity: string;
  readonly requiredEvidenceStatus: RequiredEvidenceReviewStatus;
  readonly objectives: readonly EvidenceObjectiveReview[];
  readonly reviewIdentity: string;
}

export interface TroubleshootingEvidenceReviewResult {
  readonly ok: boolean;
  readonly review?: TroubleshootingEvidenceReview;
  readonly diagnostics: readonly ObservationDiagnostic[];
}


export type RemediationPairStatus = "RESTORED" | "REGRESSED" | "CHANGED" | "UNCHANGED";
export type RemediationReviewStatus = "PENDING_AFTER_EVIDENCE" | "VERIFIED_IMPROVEMENT" | "REGRESSION_DETECTED" | "NO_VERIFIED_IMPROVEMENT";
export interface RemediationEvidencePair {
  readonly kind: "observation" | "active_probe";
  readonly beforeEntryId: string;
  readonly afterEntryId: string;
  readonly status: RemediationPairStatus;
  readonly beforeTruth?: TruthValue;
  readonly afterTruth?: TruthValue;
}
export interface RemediationReview {
  readonly engineId: "foundation.remediation_review";
  readonly engineVersion: "0.1.0";
  readonly boundary: "NOTEBOOK_ONLY_NO_SOLUTION";
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly notebookIdentity: string;
  readonly remediationEntryId: string;
  readonly status: RemediationReviewStatus;
  readonly pairs: readonly RemediationEvidencePair[];
  readonly reviewIdentity: string;
}
export interface RemediationReviewResult { readonly ok: boolean; readonly review?: RemediationReview; readonly diagnostics: readonly ObservationDiagnostic[]; }
