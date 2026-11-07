import type { RuntimeWorkspace } from "./types.js";

export interface RuntimeTestDetail {
  readonly id: string;
  readonly label: string;
  readonly outcome: string;
  readonly explanation: readonly string[];
}

export interface RuntimeFindingDetail {
  readonly id: string;
  readonly title: string;
  readonly severity: string;
  readonly state: string;
  readonly explanation: readonly string[];
  readonly evidenceTests: readonly string[];
}

export interface RuntimeObjectiveDetail {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly required: boolean;
  readonly state: string;
  readonly explanation: readonly string[];
}

export interface RuntimeEvidenceDetail {
  readonly sequence: number;
  readonly testId: string;
  readonly outcome: string;
  readonly summary: string;
  readonly explanation: readonly string[];
}

export interface RuntimeProgressDetail {
  readonly stateRevision: number;
  readonly completion: string;
  readonly completionExplanation: readonly string[];
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly checkpoints: readonly { readonly id: string; readonly label: string; readonly stateRevision: number }[];
}

export interface RuntimeDetailModel {
  readonly mission: {
    readonly title: string;
    readonly briefing: string;
  };
  readonly tests: readonly RuntimeTestDetail[];
  readonly findings: readonly RuntimeFindingDetail[];
  readonly evidence: readonly RuntimeEvidenceDetail[];
  readonly objectives: readonly RuntimeObjectiveDetail[];
  readonly progress: RuntimeProgressDetail;
  readonly hints: RuntimeWorkspace["scenario"]["hints"];
}

export const REQUIRED_RUNTIME_SURFACES = [
  "mission",
  "topology",
  "inspector",
  "configuration",
  "tests",
  "findings",
  "evidence",
  "progress",
  "hints",
  "learning",
] as const;

export function buildRuntimeDetailModel(workspace: RuntimeWorkspace): RuntimeDetailModel {
  return {
    mission: {
      title: workspace.scenario.metadata.title,
      briefing: workspace.scenario.metadata.briefing,
    },
    tests: workspace.evaluation.tests.map((item) => ({
      id: item.id,
      label: item.label,
      outcome: item.outcome,
      explanation: item.explanation,
    })),
    findings: workspace.evaluation.findings.map((item) => ({
      id: item.id,
      title: item.title,
      severity: item.severity,
      state: item.state,
      explanation: item.explanation,
      evidenceTests: item.evidenceTests,
    })),
    evidence: workspace.evaluation.evidence.map((item) => ({
      sequence: item.sequence,
      testId: item.testId,
      outcome: item.outcome,
      summary: item.summary,
      explanation: item.explanation,
    })),
    objectives: workspace.evaluation.objectives.map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      required: item.required,
      state: item.state,
      explanation: item.explanation,
    })),
    progress: {
      stateRevision: workspace.engineState.stateRevision,
      completion: workspace.evaluation.completion.truth,
      completionExplanation: workspace.evaluation.completion.explanation,
      undoDepth: workspace.history.past.length,
      redoDepth: workspace.history.future.length,
      checkpoints: workspace.history.checkpoints.map((item) => ({ id: item.id, label: item.label, stateRevision: item.state.stateRevision })),
    },
    hints: workspace.scenario.hints,
  };
}
