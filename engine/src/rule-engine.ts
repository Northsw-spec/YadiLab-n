import type { Normalizedscenariorule } from "../../core-model/src/generated/contracts.js";
import { jsonEqual } from "./json.js";
import { queryAuthentication, queryMembership, queryPermission } from "./identity-engine.js";
import { queryReachability } from "./network-engine.js";
import { readPath } from "./path.js";
import { queryServiceEnabled } from "./service-engine.js";
import { truthAll, truthAny, truthNot } from "./truth.js";
import type { EngineQueryResult, RuleEvaluationContext } from "./types.js";

export function evaluateRule(rule: Normalizedscenariorule, context: RuleEvaluationContext): EngineQueryResult<undefined> {
  switch (rule.op) {
    case "all": {
      const children = rule.rules.map((child) => evaluateRule(child, context));
      return { truth: truthAll(children.map((item) => item.truth)), explanation: children.flatMap((item) => item.explanation) };
    }
    case "any": {
      const children = rule.rules.map((child) => evaluateRule(child, context));
      return { truth: truthAny(children.map((item) => item.truth)), explanation: children.flatMap((item) => item.explanation) };
    }
    case "not": {
      const child = evaluateRule(rule.rule, context);
      return { truth: truthNot(child.truth), explanation: child.explanation };
    }
    case "equals": {
      const resource = context.state.resources[rule.target];
      if (!resource) return { truth: "UNKNOWN", explanation: [`Rule target '${rule.target}' is absent from runtime state.`] };
      const read = readPath(resource, rule.path);
      if (!read.found) return { truth: "UNKNOWN", explanation: [`Path '${rule.path}' is not declared on '${rule.target}'.`] };
      const equal = jsonEqual(read.value, rule.value);
      return { truth: equal ? "TRUE" : "FALSE", explanation: [`'${rule.target}.${rule.path}' ${equal ? "equals" : "does not equal"} the declared rule value.`] };
    }
    case "reachable": {
      const result = queryReachability(context.scenario, context.state, rule.from, rule.to, rule.protocol ?? "any", rule.port);
      return { truth: result.truth, explanation: result.explanation };
    }
    case "member_of": {
      const result = queryMembership(context.state, rule.subject, rule.group);
      return { truth: result.truth, explanation: result.explanation };
    }
    case "has_permission": {
      const result = queryPermission(context.state, rule.subject, rule.resource, rule.permission);
      return { truth: result.truth, explanation: result.explanation };
    }
    case "service_enabled": {
      return queryServiceEnabled(context.state, rule.target, rule.service);
    }
    case "test_result": {
      const actual = context.testResults[rule.test];
      if (actual === undefined) return { truth: "UNKNOWN", explanation: [`Test '${rule.test}' has not been evaluated in this snapshot.`] };
      return { truth: actual === rule.expected ? "TRUE" : "FALSE", explanation: [`Test '${rule.test}' outcome is ${actual}; rule expects ${rule.expected}.`] };
    }
  }
}

// Kept as a named export for capability code that wants an explicit authentication
// query without introducing a second rule syntax before the authoritative schema evolves.
export { queryAuthentication };
