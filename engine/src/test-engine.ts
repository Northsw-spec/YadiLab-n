import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { isRecord } from "./json.js";
import { queryAuthentication, queryMembership, queryPermission } from "./identity-engine.js";
import { queryReachability } from "./network-engine.js";
import { readPath } from "./path.js";
import { truthAny, truthEquals, truthNot } from "./truth.js";
import type { EngineState, ScenarioTest, TestEvaluation, TruthValue } from "./types.js";
import { jsonEqual } from "./json.js";

function paramString(params: Readonly<Record<string, unknown>>, key: string): string | undefined {
  return typeof params[key] === "string" ? params[key] as string : undefined;
}

function paramPort(params: Readonly<Record<string, unknown>>): number | undefined {
  return typeof params.port === "number" && Number.isInteger(params.port) && params.port >= 1 && params.port <= 65535 ? params.port : undefined;
}

function paramProtocol(params: Readonly<Record<string, unknown>>): "tcp" | "udp" | "icmp" | "any" | undefined {
  const value = params.protocol;
  return value === "tcp" || value === "udp" || value === "icmp" || value === "any" ? value : undefined;
}


function paramPorts(params: Readonly<Record<string, unknown>>): readonly number[] | undefined {
  const single = paramPort(params);
  if (single !== undefined) return [single];
  if (!Array.isArray(params.ports) || params.ports.length === 0) return undefined;
  const ports: number[] = [];
  for (const value of params.ports) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) return undefined;
    if (!ports.includes(value)) ports.push(value);
  }
  return ports.sort((a, b) => a - b);
}

function evaluateBooleanAudit(
  test: ScenarioTest,
  state: EngineState,
  defaultPath: string,
  label: string,
): TestEvaluation {
  const target = paramString(test.params, "target");
  const path = paramString(test.params, "path") ?? defaultPath;
  const expected = test.params.equals === undefined ? true : test.params.equals;
  if (!target) return make(test, "UNKNOWN", [`Test '${test.id}' requires params.target.`]);
  if (typeof expected !== "boolean") return make(test, "UNKNOWN", [`Test '${test.id}' params.equals must be boolean when supplied.`]);
  const resource = state.resources[target];
  if (!resource) return make(test, "UNKNOWN", [`Test target '${target}' is absent from runtime state.`]);
  const read = readPath(resource, path);
  if (!read.found) return make(test, "UNKNOWN", [`${label} evidence path '${path}' is not declared on '${target}'.`]);
  if (typeof read.value !== "boolean") return make(test, "UNKNOWN", [`${label} evidence '${target}.${path}' is not a declared boolean.`]);
  const equal = read.value === expected;
  return make(test, equal ? "TRUE" : "FALSE", [`${label} '${target}.${path}' is ${String(read.value)}; expected ${String(expected)}.`]);
}

function evaluatePortScan(scenario: NormalizedScenario, test: ScenarioTest, state: EngineState): TestEvaluation {
  const from = paramString(test.params, "from");
  const to = paramString(test.params, "to");
  const protocol = paramProtocol(test.params) ?? "tcp";
  const ports = paramPorts(test.params);
  if (!from || !to || !ports || ports.length === 0 || (protocol !== "tcp" && protocol !== "udp")) {
    return make(test, "UNKNOWN", [`Test '${test.id}' requires params.from, params.to, and params.port or non-empty params.ports; protocol must be tcp or udp when supplied.`]);
  }
  const results = ports.map((port) => ({ port, result: queryReachability(scenario, state, from, to, protocol, port) }));
  const outcome = truthAny(results.map((entry) => entry.result.truth));
  const explanation = results.flatMap((entry) => [
    `${protocol.toUpperCase()}/${entry.port}: ${entry.result.truth}`,
    ...entry.result.explanation.map((line) => `  ${line}`),
  ]);
  return make(test, outcome, explanation);
}

function evaluateManagementExposure(scenario: NormalizedScenario, test: ScenarioTest, state: EngineState): TestEvaluation {
  const from = paramString(test.params, "from");
  const to = paramString(test.params, "to");
  const protocol = paramProtocol(test.params) ?? "tcp";
  const port = paramPort(test.params);
  if (!from || !to || port === undefined || (protocol !== "tcp" && protocol !== "udp")) {
    return make(test, "UNKNOWN", [`Test '${test.id}' requires params.from, params.to, params.port, and optional protocol tcp/udp.`]);
  }
  const result = queryReachability(scenario, state, from, to, protocol, port);
  return make(test, result.truth, [`Management exposure ${from} → ${to} ${protocol.toUpperCase()}/${port}: ${result.truth}`, ...result.explanation]);
}

function make(test: ScenarioTest, outcome: TruthValue, explanation: readonly string[]): TestEvaluation {
  const expected = test.expectedInitial;
  return {
    id: test.id,
    type: test.type,
    label: test.label,
    outcome,
    explanation,
    ...(expected !== undefined ? { expectedInitial: expected, matchesExpectedInitial: truthEquals(outcome, expected) } : {}),
  };
}

function evaluatePropertyTest(test: ScenarioTest, state: EngineState): TestEvaluation {
  const target = paramString(test.params, "target");
  const path = paramString(test.params, "path");
  if (!target || !path || !("equals" in test.params)) return make(test, "UNKNOWN", [`Test '${test.id}' requires params.target, params.path, and params.equals.`]);
  const resource = state.resources[target];
  if (!resource) return make(test, "UNKNOWN", [`Test target '${target}' is absent from runtime state.`]);
  const read = readPath(resource, path);
  if (!read.found) return make(test, "UNKNOWN", [`Path '${path}' is not declared on '${target}'.`]);
  const equal = jsonEqual(read.value, test.params.equals);
  return make(test, equal ? "TRUE" : "FALSE", [`'${target}.${path}' ${equal ? "matches" : "does not match"} the expected hardening value.`]);
}

export function evaluateTest(scenario: NormalizedScenario, state: EngineState, test: ScenarioTest): TestEvaluation {
  if (!isRecord(test.params)) return make(test, "UNKNOWN", [`Test '${test.id}' params are not an object.`]);
  const params = test.params;

  if (test.type === "network.port_scan") return evaluatePortScan(scenario, test, state);

  if (test.type === "virtualization.management_exposure") return evaluateManagementExposure(scenario, test, state);

  if (test.type === "identity.password_audit") return evaluateBooleanAudit(test, state, "properties.passwordPolicy.compliant", "Password audit");
  if (test.type === "logging.visibility_test") return evaluateBooleanAudit(test, state, "properties.logging.visible", "Logging visibility");
  if (test.type === "logging.alert_test") return evaluateBooleanAudit(test, state, "properties.logging.alerting", "Logging alert");
  if (test.type === "backup.restore_test") return evaluateBooleanAudit(test, state, "properties.backup.restoreTested", "Backup restore test");

  if (test.type === "network.reachability" || test.type === "network.segmentation" || test.type === "network.route_test") {
    const from = paramString(params, "from");
    const to = paramString(params, "to");
    if (!from || !to) return make(test, "UNKNOWN", [`Test '${test.id}' requires string params.from and params.to.`]);
    const protocol = paramProtocol(params) ?? (test.type === "network.route_test" ? "any" : undefined);
    if (!protocol) return make(test, "UNKNOWN", [`Test '${test.id}' requires protocol tcp, udp, icmp, or any.`]);
    const result = queryReachability(scenario, state, from, to, protocol, paramPort(params));
    return make(test, test.type === "network.segmentation" ? truthNot(result.truth) : result.truth, result.explanation);
  }

  if (test.type === "identity.authentication_test") {
    const subject = paramString(params, "subject");
    const target = paramString(params, "target");
    if (!subject || !target) return make(test, "UNKNOWN", [`Test '${test.id}' requires params.subject and params.target.`]);
    const result = queryAuthentication(state, subject, target);
    return make(test, result.truth, result.explanation);
  }

  if (test.type === "identity.privilege_path" || test.type === "identity.permission") {
    const subject = paramString(params, "subject");
    const resource = paramString(params, "resource");
    const permission = paramString(params, "permission");
    if (!subject || !resource || !permission) return make(test, "UNKNOWN", [`Test '${test.id}' requires params.subject, params.resource, and params.permission.`]);
    const result = queryPermission(state, subject, resource, permission);
    return make(test, result.truth, result.explanation);
  }

  if (test.type === "identity.membership") {
    const subject = paramString(params, "subject");
    const group = paramString(params, "group");
    if (!subject || !group) return make(test, "UNKNOWN", [`Test '${test.id}' requires params.subject and params.group.`]);
    const result = queryMembership(state, subject, group);
    return make(test, result.truth, result.explanation);
  }

  if (test.type === "windows.hardening_check" || test.type === "linux.hardening_check") return evaluatePropertyTest(test, state);

  return make(test, "UNKNOWN", [`Test type '${test.type}' is declared by the scenario but has no Foundation Phase 3 evaluator.`]);
}
