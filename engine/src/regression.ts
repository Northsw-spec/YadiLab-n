import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { evaluateEngine } from "./evaluation.js";
import { applyOperations, createInitialEngineState } from "./state.js";
import type { EngineDiagnostic, EngineEvaluation, EngineState, TruthValue } from "./types.js";

export type RegressionPhase = "initial" | "solution" | "solved";
export type RegressionCheckKind =
  | "expectations-present"
  | "test-expectation"
  | "completion"
  | "solution-application"
  | "required-objective";

export interface RegressionCheck {
  readonly id: string;
  readonly phase: RegressionPhase;
  readonly kind: RegressionCheckKind;
  readonly passed: boolean;
  readonly expected?: TruthValue | "PRESENT" | "APPLIED";
  readonly actual?: TruthValue | "MISSING" | "APPLIED" | "FAILED";
  readonly message: string;
}

export interface CanonicalReplayResult {
  readonly ok: boolean;
  readonly initialState: EngineState;
  readonly solvedState?: EngineState;
  readonly operationsApplied: number;
  readonly diagnostic?: EngineDiagnostic;
}

export interface ScenarioRegressionReport {
  readonly scenarioId: string;
  readonly passed: boolean;
  readonly initialState: EngineState;
  readonly initialEvaluation: EngineEvaluation;
  readonly solvedState?: EngineState;
  readonly solvedEvaluation?: EngineEvaluation;
  readonly solutionApplied: boolean;
  readonly operationsApplied: number;
  readonly checks: readonly RegressionCheck[];
  readonly diagnostics: readonly EngineDiagnostic[];
}

function testOutcome(evaluation: EngineEvaluation, testId: string): TruthValue | undefined {
  return evaluation.tests.find((test) => test.id === testId)?.outcome;
}

function checkExactTruth(
  id: string,
  phase: RegressionPhase,
  kind: RegressionCheckKind,
  expected: TruthValue,
  actual: TruthValue | undefined,
  label: string,
): RegressionCheck {
  const resolvedActual = actual ?? "UNKNOWN";
  return {
    id,
    phase,
    kind,
    passed: resolvedActual === expected,
    expected,
    actual: resolvedActual,
    message: `${label}: expected ${expected}, got ${resolvedActual}.`,
  };
}

export function replayCanonicalSolution(scenario: NormalizedScenario): CanonicalReplayResult {
  const initialState = createInitialEngineState(scenario);
  const solution = scenario.canonicalSolution;
  if (!solution) {
    return {
      ok: false,
      initialState,
      operationsApplied: 0,
      diagnostic: {
        code: "REGRESSION_CANONICAL_SOLUTION_MISSING",
        message: `Scenario '${scenario.scenarioId}' has no canonical solution to replay.`,
      },
    };
  }

  const applied = applyOperations(initialState, solution.operations);
  if (!applied.ok) {
    return {
      ok: false,
      initialState,
      operationsApplied: 0,
      diagnostic: {
        code: "REGRESSION_CANONICAL_SOLUTION_FAILED",
        message: `Canonical solution failed: ${applied.diagnostic.message}`,
        ...(applied.diagnostic.target !== undefined ? { target: applied.diagnostic.target } : {}),
        ...(applied.diagnostic.path !== undefined ? { path: applied.diagnostic.path } : {}),
      },
    };
  }

  return {
    ok: true,
    initialState,
    solvedState: applied.state,
    operationsApplied: solution.operations.length,
  };
}

export function runScenarioRegression(scenario: NormalizedScenario): ScenarioRegressionReport {
  const checks: RegressionCheck[] = [];
  const diagnostics: EngineDiagnostic[] = [];
  const replay = replayCanonicalSolution(scenario);
  const initialEvaluation = evaluateEngine(scenario, replay.initialState);

  const initialExpected = scenario.tests.filter((test) => test.expectedInitial !== undefined);
  checks.push({
    id: "initial.expectations_present",
    phase: "initial",
    kind: "expectations-present",
    passed: initialExpected.length > 0,
    expected: "PRESENT",
    actual: initialExpected.length > 0 ? "APPLIED" : "MISSING",
    message: initialExpected.length > 0
      ? `${initialExpected.length} initial test expectation(s) declared.`
      : "No expectedInitial values are declared; intended initial faults are not regression-asserted.",
  });

  for (const test of initialExpected) {
    checks.push(checkExactTruth(
      `initial.test.${test.id}`,
      "initial",
      "test-expectation",
      test.expectedInitial as TruthValue,
      testOutcome(initialEvaluation, test.id),
      `Initial test '${test.id}'`,
    ));
  }

  checks.push(checkExactTruth(
    "initial.completion",
    "initial",
    "completion",
    "FALSE",
    initialEvaluation.completion.truth,
    "Initial completion state",
  ));

  if (!replay.ok || !replay.solvedState) {
    if (replay.diagnostic) diagnostics.push(replay.diagnostic);
    checks.push({
      id: "solution.apply",
      phase: "solution",
      kind: "solution-application",
      passed: false,
      expected: "APPLIED",
      actual: replay.diagnostic?.code === "REGRESSION_CANONICAL_SOLUTION_MISSING" ? "MISSING" : "FAILED",
      message: replay.diagnostic?.message ?? "Canonical solution could not be replayed.",
    });
    return {
      scenarioId: scenario.scenarioId,
      passed: false,
      initialState: replay.initialState,
      initialEvaluation,
      solutionApplied: false,
      operationsApplied: 0,
      checks,
      diagnostics,
    };
  }

  checks.push({
    id: "solution.apply",
    phase: "solution",
    kind: "solution-application",
    passed: true,
    expected: "APPLIED",
    actual: "APPLIED",
    message: `Canonical solution applied atomically (${replay.operationsApplied} operation(s)).`,
  });

  const solvedEvaluation = evaluateEngine(scenario, replay.solvedState);
  const solvedExpected = scenario.tests.filter((test) => test.expectedSolved !== undefined);
  checks.push({
    id: "solved.expectations_present",
    phase: "solved",
    kind: "expectations-present",
    passed: solvedExpected.length > 0,
    expected: "PRESENT",
    actual: solvedExpected.length > 0 ? "APPLIED" : "MISSING",
    message: solvedExpected.length > 0
      ? `${solvedExpected.length} solved-state test expectation(s) declared.`
      : "No expectedSolved values are declared; solved-state behavior is not regression-asserted.",
  });

  for (const test of solvedExpected) {
    checks.push(checkExactTruth(
      `solved.test.${test.id}`,
      "solved",
      "test-expectation",
      test.expectedSolved as TruthValue,
      testOutcome(solvedEvaluation, test.id),
      `Solved test '${test.id}'`,
    ));
  }

  for (const objective of solvedEvaluation.objectives.filter((item) => item.required)) {
    checks.push(checkExactTruth(
      `solved.objective.${objective.id}`,
      "solved",
      "required-objective",
      "TRUE",
      objective.state,
      `Required objective '${objective.id}'`,
    ));
  }

  checks.push(checkExactTruth(
    "solved.completion",
    "solved",
    "completion",
    "TRUE",
    solvedEvaluation.completion.truth,
    "Solved completion state",
  ));

  const passed = checks.every((check) => check.passed);
  if (!passed) {
    diagnostics.push({
      code: "REGRESSION_EXPECTATION_FAILED",
      message: `${checks.filter((check) => !check.passed).length} regression check(s) failed for scenario '${scenario.scenarioId}'.`,
    });
  }

  return {
    scenarioId: scenario.scenarioId,
    passed,
    initialState: replay.initialState,
    initialEvaluation,
    solvedState: replay.solvedState,
    solvedEvaluation,
    solutionApplied: true,
    operationsApplied: replay.operationsApplied,
    checks,
    diagnostics,
  };
}
