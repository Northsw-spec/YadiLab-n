import { ownResource } from "./resource-lookup.js";
import type { Normalizedscenariorule } from "../../core-model/src/generated/contracts.js";
import { isRecord, jsonEqual } from "./json.js";
import { queryAuthentication, queryMembership, queryPermission } from "./identity-engine.js";
import { queryReachability } from "./network-engine.js";
import { readPath } from "./path.js";
import { queryServiceEnabled } from "./service-engine.js";
import { truthAll, truthAny, truthNot } from "./truth.js";
import type { EngineQueryResult, RuleEvaluationContext } from "./types.js";

const MAX_RULE_DEPTH = 256;
const MAX_RULE_NODES = 10_000;

function hasOwn(value: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function invalidRuleTree(rule: unknown): string | undefined {
  const pending: Array<{ readonly rule: unknown; readonly depth: number }> = [{ rule, depth: 1 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (++nodes > MAX_RULE_NODES) return `Rule tree exceeds the ${MAX_RULE_NODES}-node safety limit.`;
    if (current.depth > MAX_RULE_DEPTH) return `Rule tree exceeds the ${MAX_RULE_DEPTH}-level safety limit.`;
    if (!isRecord(current.rule) || !hasOwn(current.rule, "op") || typeof current.rule.op !== "string") return "Rule is missing a valid operation.";
    switch (current.rule.op) {
      case "all":
      case "any": {
        if (!hasOwn(current.rule, "rules") || !Array.isArray(current.rule.rules) || current.rule.rules.length === 0)
          return `${current.rule.op.toUpperCase()} rule has no child rules; empty logic is not valid scenario evidence.`;
        for (const child of current.rule.rules) pending.push({ rule: child, depth: current.depth + 1 });
        break;
      }
      case "not":
        if (!hasOwn(current.rule, "rule") || !isRecord(current.rule.rule)) return "NOT rule has no child rule.";
        pending.push({ rule: current.rule.rule, depth: current.depth + 1 });
        break;
      case "equals":
        if (typeof current.rule.target !== "string" || typeof current.rule.path !== "string" || !hasOwn(current.rule, "value")) return "Equals rule has invalid target, path, or value.";
        break;
      case "reachable":
        if (typeof current.rule.from !== "string" || typeof current.rule.to !== "string" ||
            (current.rule.protocol !== undefined && !["tcp", "udp", "icmp", "any"].includes(String(current.rule.protocol))) ||
            (current.rule.port !== undefined && (!Number.isInteger(current.rule.port) || (current.rule.port as number) < 1 || (current.rule.port as number) > 65535))) return "Reachable rule has invalid endpoint, protocol, or port.";
        break;
      case "member_of":
        if (typeof current.rule.subject !== "string" || typeof current.rule.group !== "string") return "Membership rule has invalid subject or group.";
        break;
      case "has_permission":
        if (typeof current.rule.subject !== "string" || typeof current.rule.resource !== "string" || typeof current.rule.permission !== "string") return "Permission rule has invalid operands.";
        break;
      case "service_enabled":
        if (typeof current.rule.target !== "string" || typeof current.rule.service !== "string") return "Service rule has invalid target or service.";
        break;
      case "test_result":
        if (typeof current.rule.test !== "string" || !["TRUE", "FALSE", "UNKNOWN"].includes(String(current.rule.expected))) return "Test-result rule has invalid test or expected truth.";
        break;
      default:
        return "Rule has an unsupported operation.";
    }
  }
  return undefined;
}

export function evaluateRule(rule: Normalizedscenariorule, context: RuleEvaluationContext): EngineQueryResult<undefined> {
  const invalid = invalidRuleTree(rule);
  if (invalid) return { truth: "UNKNOWN", explanation: [invalid] };
  return evaluateValidatedRule(rule, context);
}

function evaluateValidatedRule(rule: Normalizedscenariorule, context: RuleEvaluationContext): EngineQueryResult<undefined> {
  switch (rule.op) {
    case "all": {
      const children = rule.rules.map((child) => evaluateValidatedRule(child, context));
      return { truth: truthAll(children.map((item) => item.truth)), explanation: children.flatMap((item) => item.explanation) };
    }
    case "any": {
      const children = rule.rules.map((child) => evaluateValidatedRule(child, context));
      return { truth: truthAny(children.map((item) => item.truth)), explanation: children.flatMap((item) => item.explanation) };
    }
    case "not": {
      const child = evaluateValidatedRule(rule.rule, context);
      return { truth: truthNot(child.truth), explanation: child.explanation };
    }
    case "equals": {
      const resource = ownResource(context.state, rule.target);
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
      const actual = Object.prototype.hasOwnProperty.call(context.testResults, rule.test)
        ? context.testResults[rule.test] : undefined;
      if (actual === undefined) return { truth: "UNKNOWN", explanation: [`Test '${rule.test}' has not been evaluated in this snapshot.`] };
      return { truth: actual === rule.expected ? "TRUE" : "FALSE", explanation: [`Test '${rule.test}' outcome is ${actual}; rule expects ${rule.expected}.`] };
    }
    default:
      return { truth: "UNKNOWN", explanation: ["Rule has an unsupported operation."] };
  }
}

// Kept as a named export for capability code that wants an explicit authentication
// query without introducing a second rule syntax before the authoritative schema evolves.
export { queryAuthentication };
