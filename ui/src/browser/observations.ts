import { listActiveProbeDefinitions, listActiveProbeDestinations, listObservableTargets, listObservationCommands, runActiveProbe, runObservation } from "../../../observation-engine/src/index.js";
import type { ActiveProbeDefinition, ActiveProbeTranscript, ObservationCommandDefinition, ObservationTranscript } from "../../../observation-engine/src/index.js";
import type { BrowserDiagnostic, BrowserWorkspace, RuntimeWorkspace } from "./types.js";

export interface RuntimeObservationTarget {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly os: "windows" | "linux";
}

export interface RuntimeObservationModel {
  readonly targets: readonly RuntimeObservationTarget[];
  readonly targetId?: string;
  readonly commands: readonly ObservationCommandDefinition[];
}

export interface RuntimeObservationUiResult {
  readonly ok: boolean;
  readonly transcript?: ObservationTranscript;
  readonly diagnostics: readonly BrowserDiagnostic[];
}

function error(code: string, message: string): BrowserDiagnostic { return { severity: "error", code, message }; }

export function buildRuntimeObservationModel(workspace: BrowserWorkspace, preferredTargetId?: string): RuntimeObservationModel {
  if (workspace.mode !== "runtime") return { targets: [], commands: [] };
  const targets = listObservableTargets(workspace.engineState);
  const selected = preferredTargetId && targets.some((target) => target.id === preferredTargetId)
    ? preferredTargetId
    : workspace.selection.primary && targets.some((target) => target.id === workspace.selection.primary)
      ? workspace.selection.primary
      : targets[0]?.id;
  return {
    targets,
    ...(selected ? { targetId: selected } : {}),
    commands: selected ? listObservationCommands(workspace.engineState, selected) : [],
  };
}

export function runRuntimeObservation(workspace: BrowserWorkspace, targetId: string, commandId: string): RuntimeObservationUiResult {
  if (workspace.mode !== "runtime") return { ok: false, diagnostics: [error("OBSERVATION_UI_RUNTIME_REQUIRED", "Modeled observations are available only in Runtime.")] };
  if (workspace.engineState.scenarioId !== workspace.scenario.scenarioId || workspace.engineState.scenarioHash !== workspace.scenario.sourceHash) {
    return { ok: false, diagnostics: [error("OBSERVATION_UI_STATE_SCENARIO_MISMATCH", "Runtime Engine state belongs to a different scenario revision.")] };
  }
  const result = runObservation({ state: workspace.engineState, targetId, commandId });
  const diagnostics: BrowserDiagnostic[] = result.diagnostics.map((item) => ({ severity: item.severity, code: item.code, message: item.message }));
  return result.ok ? { ok: true, transcript: result.transcript, diagnostics } : { ok: false, diagnostics };
}

export function observationStateRevision(workspace: RuntimeWorkspace): number { return workspace.engineState.stateRevision; }


export interface RuntimeActiveProbeModel {
  readonly sources: readonly RuntimeObservationTarget[];
  readonly sourceId?: string;
  readonly probes: readonly ActiveProbeDefinition[];
  readonly destinations: readonly { readonly id: string; readonly label: string; readonly type: string }[];
  readonly destinationId?: string;
}

export interface RuntimeActiveProbeUiResult {
  readonly ok: boolean;
  readonly transcript?: ActiveProbeTranscript;
  readonly diagnostics: readonly BrowserDiagnostic[];
}

export function buildRuntimeActiveProbeModel(workspace: BrowserWorkspace, preferredSourceId?: string, preferredDestinationId?: string): RuntimeActiveProbeModel {
  if (workspace.mode !== "runtime") return { sources: [], probes: [], destinations: [] };
  const sources = listObservableTargets(workspace.engineState);
  const sourceId = preferredSourceId && sources.some((target) => target.id === preferredSourceId)
    ? preferredSourceId
    : workspace.selection.primary && sources.some((target) => target.id === workspace.selection.primary)
      ? workspace.selection.primary
      : sources[0]?.id;
  const destinations = sourceId ? listActiveProbeDestinations(workspace.engineState, sourceId) : [];
  const destinationId = preferredDestinationId && destinations.some((target) => target.id === preferredDestinationId)
    ? preferredDestinationId
    : destinations[0]?.id;
  return {
    sources,
    ...(sourceId ? { sourceId } : {}),
    probes: sourceId ? listActiveProbeDefinitions(workspace.engineState, sourceId) : [],
    destinations,
    ...(destinationId ? { destinationId } : {}),
  };
}

export function runRuntimeActiveProbe(workspace: BrowserWorkspace, args: { readonly sourceId: string; readonly probeId: string; readonly destinationId?: string; readonly port?: number; readonly queryName?: string }): RuntimeActiveProbeUiResult {
  if (workspace.mode !== "runtime") return { ok: false, diagnostics: [error("ACTIVE_PROBE_UI_RUNTIME_REQUIRED", "Modeled active probes are available only in Runtime.")] };
  if (workspace.engineState.scenarioId !== workspace.scenario.scenarioId || workspace.engineState.scenarioHash !== workspace.scenario.sourceHash) {
    return { ok: false, diagnostics: [error("ACTIVE_PROBE_UI_STATE_SCENARIO_MISMATCH", "Runtime Engine state belongs to a different scenario revision.")] };
  }
  const result = runActiveProbe({ scenario: workspace.scenario, state: workspace.engineState, sourceId: args.sourceId, probeId: args.probeId, ...(args.destinationId ? { destinationId: args.destinationId } : {}), ...(args.port !== undefined ? { port: args.port } : {}), ...(args.queryName !== undefined ? { queryName: args.queryName } : {}) });
  const diagnostics: BrowserDiagnostic[] = result.diagnostics.map((item) => ({ severity: item.severity, code: item.code, message: item.message }));
  return result.ok ? { ok: true, transcript: result.transcript, diagnostics } : { ok: false, diagnostics };
}
