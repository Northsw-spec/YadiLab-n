import type { LayoutDocument } from "../../../core-model/src/generated/contracts.js";
import { projectScenarioToCanvas } from "../canvas/projection.js";
import type { CanvasProjection } from "../canvas/types.js";
import type { BuilderWorkspace, RuntimeWorkspace } from "./types.js";

export type RuntimePanel = "mission" | "topology" | "inspector" | "configuration" | "tests" | "findings" | "evidence" | "progress" | "hints" | "learning";
export type BuilderPanel = "mission" | "topology" | "inspector" | "tests" | "findings" | "objectives" | "hints" | "solution" | "validation";

export interface BuilderViewModel {
  readonly title: string;
  readonly panels: readonly BuilderPanel[];
  readonly selectedIds: readonly string[];
  readonly sourceRevision: number;
  readonly dirty: boolean;
  readonly compileStatus: BuilderWorkspace["compile"]["status"];
  readonly canvas?: CanvasProjection;
}

export interface RuntimeViewModel {
  readonly title: string;
  readonly briefing: string;
  readonly panels: readonly RuntimePanel[];
  readonly selectedIds: readonly string[];
  readonly canvas: CanvasProjection;
  readonly tests: RuntimeWorkspace["evaluation"]["tests"];
  readonly findings: RuntimeWorkspace["evaluation"]["findings"];
  readonly objectives: RuntimeWorkspace["evaluation"]["objectives"];
  readonly evidence: RuntimeWorkspace["evaluation"]["evidence"];
  readonly completion: RuntimeWorkspace["evaluation"]["completion"];
  readonly hints: RuntimeWorkspace["scenario"]["hints"];
  readonly stateRevision: number;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly checkpointCount: number;
}

const BUILDER_PANELS: readonly BuilderPanel[] = ["mission", "topology", "inspector", "tests", "findings", "objectives", "hints", "solution", "validation"];
const RUNTIME_PANELS: readonly RuntimePanel[] = ["mission", "topology", "inspector", "configuration", "tests", "findings", "evidence", "progress", "hints", "learning"];

export function buildBuilderViewModel(workspace: BuilderWorkspace, layout?: LayoutDocument): BuilderViewModel {
  const base = {
    title: workspace.source.metadata.title,
    panels: BUILDER_PANELS,
    selectedIds: workspace.selection.ids,
    sourceRevision: workspace.sourceRevision,
    dirty: workspace.dirty,
    compileStatus: workspace.compile.status,
  } as const;
  return workspace.compile.status === "valid"
    ? { ...base, canvas: projectScenarioToCanvas(workspace.compile.model, layout ?? workspace.layout) }
    : base;
}

export function buildRuntimeViewModel(workspace: RuntimeWorkspace, layout?: LayoutDocument): RuntimeViewModel {
  return {
    title: workspace.scenario.metadata.title,
    briefing: workspace.scenario.metadata.briefing,
    panels: RUNTIME_PANELS,
    selectedIds: workspace.selection.ids,
    canvas: projectScenarioToCanvas(workspace.scenario, layout ?? workspace.layout),
    tests: workspace.evaluation.tests,
    findings: workspace.evaluation.findings,
    objectives: workspace.evaluation.objectives,
    evidence: workspace.evaluation.evidence,
    completion: workspace.evaluation.completion,
    hints: workspace.scenario.hints,
    stateRevision: workspace.engineState.stateRevision,
    undoDepth: workspace.history.past.length,
    redoDepth: workspace.history.future.length,
    checkpointCount: workspace.history.checkpoints.length,
  };
}
