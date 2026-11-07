import type { FaultPack } from "../../core-model/src/generated/contracts.js";
import { readPath } from "../../engine/src/index.js";
import type { EngineState } from "../../engine/src/index.js";
import { canonicalFaultJson } from "./canonical.js";

type Condition = FaultPack["faults"][number]["preconditions"][number];
export type ConditionTruth = "TRUE"|"FALSE"|"UNKNOWN";
export interface ConditionEvaluation { readonly truth: ConditionTruth; readonly explanation: readonly string[]; }
function eq(a:unknown,b:unknown):boolean { return canonicalFaultJson(a)===canonicalFaultJson(b); }
export function evaluateFaultCondition(condition:Condition,state:EngineState,bindings:Readonly<Record<string,string>>):ConditionEvaluation {
  if (condition.op==="all") { const xs=condition.conditions.map(c=>evaluateFaultCondition(c,state,bindings)); return {truth:xs.some(x=>x.truth==="FALSE")?"FALSE":xs.some(x=>x.truth==="UNKNOWN")?"UNKNOWN":"TRUE",explanation:xs.flatMap(x=>x.explanation)}; }
  if (condition.op==="any") { const xs=condition.conditions.map(c=>evaluateFaultCondition(c,state,bindings)); return {truth:xs.some(x=>x.truth==="TRUE")?"TRUE":xs.some(x=>x.truth==="UNKNOWN")?"UNKNOWN":"FALSE",explanation:xs.flatMap(x=>x.explanation)}; }
  if (condition.op==="not") { const x=evaluateFaultCondition(condition.condition,state,bindings); return {truth:x.truth==="TRUE"?"FALSE":x.truth==="FALSE"?"TRUE":"UNKNOWN",explanation:x.explanation}; }
  const target=bindings[condition.binding];
  if (!target) return {truth:"UNKNOWN",explanation:[`Binding '${condition.binding}' is unresolved.`]};
  const resource=state.resources[target];
  if (!resource) return {truth:"UNKNOWN",explanation:[`Bound resource '${target}' is absent.`]};
  if (condition.op==="resource_type") return {truth:resource.type===condition.resourceType?"TRUE":"FALSE",explanation:[`Resource '${target}' type is '${resource.type}'.`]};
  if (condition.op==="stp_port_state_equals") {
    const rows=Array.isArray(resource.properties.stpPorts)?resource.properties.stpPorts.filter(x=>x&&typeof x==="object"&&(x as Record<string,unknown>).interface===condition.interface):[];
    if (rows.length!==1) return {truth:"UNKNOWN",explanation:[`Canonical STP interface '${condition.interface}' is missing or ambiguous on '${target}'.`]};
    const actual=(rows[0] as Record<string,unknown>).state;
    return {truth:actual===condition.state?"TRUE":"FALSE",explanation:[`Canonical STP interface '${target}.${condition.interface}' is '${String(actual)}'.`]};
  }
  const read=readPath(resource,condition.path);
  if (condition.op==="path_exists") return {truth:read.found?"TRUE":"FALSE",explanation:[`Path '${target}.${condition.path}' ${read.found?"exists":"is absent"}.`]};
  if (condition.op==="path_absent") return {truth:read.found?"FALSE":"TRUE",explanation:[`Path '${target}.${condition.path}' ${read.found?"exists":"is absent"}.`]};
  if (!read.found) return {truth:"UNKNOWN",explanation:[`Path '${target}.${condition.path}' is absent.`]};
  const same=eq(read.value,condition.value);
  if (condition.op==="path_equals") return {truth:same?"TRUE":"FALSE",explanation:[`Path '${target}.${condition.path}' ${same?"matches":"does not match"} expected value.`]};
  return {truth:same?"FALSE":"TRUE",explanation:[`Path '${target}.${condition.path}' ${same?"matches":"differs from"} forbidden value.`]};
}
