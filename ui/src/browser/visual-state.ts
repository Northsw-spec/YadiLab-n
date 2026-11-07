import type { NormalizedScenario } from "../../../core-model/src/generated/contracts.js";
import type { ObservationTranscript } from "../../../observation-engine/src/index.js";

/**
 * Topology-first Class B projection.  This is deliberately separate from a
 * packet journey: an observation can focus the Engine-owned state of a node,
 * but it must never manufacture a packet path that the Engine did not emit.
 */
export interface ModeledTopologyStateVisual {
  readonly schemaVersion: "1.0.0";
  readonly source: "ENGINE_STATE_PROJECTION";
  readonly actionClass: "B";
  readonly kind: "node.state";
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly stateRevision: number;
  readonly targetResourceId: string;
  readonly category: string;
  readonly commandId: string;
  readonly label: string;
  readonly evidenceRefs: readonly string[];
  readonly summary: string;
}

export interface ModeledTopologyStateBuildResult {
  readonly ok: boolean;
  readonly model?: ModeledTopologyStateVisual;
  readonly diagnostics: readonly { readonly severity: "warning" | "error"; readonly code: string; readonly message: string }[];
}

function diagnostic(code: string, message: string, severity: "warning" | "error" = "error") {
  return { severity, code, message } as const;
}

export function buildModeledObservationTopologyVisual(
  scenario: NormalizedScenario,
  transcript: ObservationTranscript,
): ModeledTopologyStateBuildResult {
  if (scenario.scenarioId !== transcript.scenarioId || scenario.sourceHash !== transcript.scenarioHash) {
    return { ok: false, diagnostics: [diagnostic("MODELED_STATE_SCENARIO_MISMATCH", "Observation evidence belongs to a different scenario revision.")] };
  }
  const target = scenario.resources.find((resource) => resource.id === transcript.targetId);
  if (!target) {
    return { ok: false, diagnostics: [diagnostic("MODELED_STATE_TARGET_UNKNOWN", `Observation target '${transcript.targetId}' is absent from the scenario.`)] };
  }
  const evidenceRefs = transcript.evidence.map((item, index) => `${item.path}:${item.state}:${index + 1}`);
  return {
    ok: true,
    diagnostics: [],
    model: {
      schemaVersion: "1.0.0",
      source: "ENGINE_STATE_PROJECTION",
      actionClass: "B",
      kind: "node.state",
      scenarioId: transcript.scenarioId,
      scenarioHash: transcript.scenarioHash,
      stateRevision: transcript.stateRevision,
      targetResourceId: target.id,
      category: transcript.category,
      commandId: transcript.commandId,
      label: transcript.targetLabel,
      evidenceRefs,
      summary: `Engine state observation · ${transcript.category} · ${transcript.targetLabel}`,
    },
  };
}

export function buildModeledNodeStateVisual(
  scenario: NormalizedScenario,
  targetResourceId: string,
  category: string,
  commandId: string,
  stateRevision: number,
  label = targetResourceId,
): ModeledTopologyStateVisual | undefined {
  if (!scenario.resources.some((resource) => resource.id === targetResourceId)) return undefined;
  return {
    schemaVersion: "1.0.0",
    source: "ENGINE_STATE_PROJECTION",
    actionClass: "B",
    kind: "node.state",
    scenarioId: scenario.scenarioId,
    scenarioHash: scenario.sourceHash,
    stateRevision,
    targetResourceId,
    category,
    commandId,
    label,
    evidenceRefs: [`resource:${targetResourceId}`, `state-revision:${stateRevision}`],
    summary: `Engine state changed · ${category} · ${label}`,
  };
}
