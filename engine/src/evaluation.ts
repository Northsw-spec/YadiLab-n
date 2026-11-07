import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { evaluateRule } from "./rule-engine.js";
import { evaluateTest } from "./test-engine.js";
import type { EngineEvaluation, EngineState, TruthValue } from "./types.js";

export function evaluateEngine(scenario: NormalizedScenario, state: EngineState): EngineEvaluation {
  const tests = scenario.tests.map((test) => evaluateTest(scenario, state, test));
  const testResults: Record<string, TruthValue> = {};
  tests.forEach((test) => { testResults[test.id] = test.outcome; });
  const context = { scenario, state, testResults };

  const findings = scenario.findings.map((finding) => {
    const result = evaluateRule(finding.when, context);
    return {
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      state: result.truth,
      explanation: result.explanation,
      evidenceTests: [...finding.evidenceTests],
    };
  });

  const objectives = scenario.objectives.map((objective) => {
    const result = evaluateRule(objective.condition, context);
    return {
      id: objective.id,
      title: objective.title,
      category: objective.category,
      required: objective.required,
      state: result.truth,
      explanation: result.explanation,
    };
  });

  const completion = evaluateRule(scenario.completion, context);
  const evidence = tests.map((test, index) => ({
    sequence: index + 1,
    testId: test.id,
    outcome: test.outcome,
    summary: `${test.label}: ${test.outcome}`,
    explanation: test.explanation,
  }));

  return { tests, testResults, findings, objectives, completion, evidence };
}
