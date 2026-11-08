import type { NormalizedScenario, SaveState } from "../../core-model/src/generated/contracts.js";
import { deepCloneJson, isRecord, jsonEqual } from "./json.js";
import type { EngineEvaluation, EngineState, RuntimeResourceState } from "./types.js";
import { ENGINE_VERSION } from "./version.js";

export interface RestoreSaveSuccess {
  readonly ok: true;
  readonly state: EngineState;
}

export interface RestoreSaveFailure {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export type RestoreSaveResult = RestoreSaveSuccess | RestoreSaveFailure;

export function createSaveState(
  scenario: NormalizedScenario,
  state: EngineState,
  evaluation: EngineEvaluation,
): SaveState {
  // Canonical resource IDs can equal inherited JavaScript names. Never
  // serialize a prototype-backed namespace of runtime identities.
  const resourceState: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
  for (const [id, resource] of Object.entries(state.resources)) {
    resourceState[id] = deepCloneJson(resource) as unknown as Readonly<Record<string, unknown>>;
  }
  return {
    formatId: "infrastructure-cyber-lab.save",
    schemaVersion: scenario.schemaVersion,
    scenarioHash: scenario.sourceHash,
    engineVersion: ENGINE_VERSION,
    stateRevision: state.stateRevision,
    clock: { mode: "virtual", tick: state.stateRevision },
    resourceState,
    completedObjectives: evaluation.objectives.filter((x) => x.state === "TRUE").map((x) => x.id).sort((a, b) => a.localeCompare(b, "en")),
    evidence: evaluation.evidence.map((event) => ({
      sequence: event.sequence,
      testId: event.testId,
      outcome: event.outcome,
      summary: event.summary,
    })),
  };
}

function fail(code: string, message: string): RestoreSaveFailure {
  return { ok: false, code, message };
}

export function restoreSaveState(scenario: NormalizedScenario, input: SaveState): RestoreSaveResult {
  if (input.formatId !== "infrastructure-cyber-lab.save") return fail("SAVE_FORMAT_MISMATCH", `Unsupported save format '${String(input.formatId)}'.`);
  if (input.scenarioHash !== scenario.sourceHash) return fail("SAVE_SCENARIO_HASH_MISMATCH", "Save belongs to a different scenario/source revision.");
  if (input.schemaVersion !== scenario.schemaVersion) return fail("SAVE_SCHEMA_VERSION_MISMATCH", `Save schema '${input.schemaVersion}' does not match scenario schema '${scenario.schemaVersion}'.`);
  if (input.engineVersion !== ENGINE_VERSION) return fail("SAVE_ENGINE_VERSION_MISMATCH", `Save Engine '${input.engineVersion}' is incompatible with Engine '${ENGINE_VERSION}'.`);
  if (!Number.isInteger(input.stateRevision) || input.stateRevision < 0) return fail("SAVE_STATE_REVISION_INVALID", "Save stateRevision must be a non-negative integer.");
  if (!isRecord(input.resourceState)) return fail("SAVE_RESOURCE_STATE_INVALID", "Save resourceState must be an object.");

  const expectedIds = scenario.resources.map((x) => x.id).sort((a, b) => a.localeCompare(b, "en"));
  const actualIds = Object.keys(input.resourceState).sort((a, b) => a.localeCompare(b, "en"));
  if (expectedIds.length !== actualIds.length || expectedIds.some((id, i) => id !== actualIds[i])) {
    return fail("SAVE_RESOURCE_SET_MISMATCH", "Save resource set does not exactly match the scenario resource set.");
  }

  // The save may change modeled properties and mutable interface state,
  // but it cannot alter the static topology/identity envelope. Hash-matching
  // a scenario is not evidence that its stored runtime objects are faithful.
  const resources: Record<string, RuntimeResourceState> = Object.create(null);
  const scenarioResources = new Map(scenario.resources.map(resource => [resource.id, resource]));
  const fixedInterfaceKeys = ["id", "name", "label", "type"] as const;
  for (const id of expectedIds) {
    const raw = input.resourceState[id];
    if (!isRecord(raw)) return fail("SAVE_RESOURCE_INVALID", `Save resource '${id}' is not an object.`);
    if (raw.id !== id) return fail("SAVE_RESOURCE_ID_MISMATCH", `Save resource key '${id}' does not match embedded id '${String(raw.id)}'.`);
    const reference = scenarioResources.get(id)!;
    if (!isRecord(raw.properties) || !Array.isArray(raw.interfaces))
      return fail("SAVE_RESOURCE_SHAPE_INVALID", `Save resource '${id}' has invalid properties or interface structure.`);

    // Compare every field outside the allowed mutable subtrees, including
    // zone, type, label, asset, vendor and any future immutable metadata.
    const { properties: _savedProperties, interfaces: _savedInterfaces, ...savedEnvelope } = raw;
    const { properties: _referenceProperties, interfaces: _referenceInterfaces, ...referenceEnvelope } = reference;
    if (!jsonEqual(savedEnvelope, referenceEnvelope))
      return fail("SAVE_RESOURCE_ENVELOPE_MISMATCH", `Save resource '${id}' changes canonical resource identity or metadata.`);

    const declaredInterfaces = reference.interfaces;
    if (raw.interfaces.length !== declaredInterfaces.length)
      return fail("SAVE_INTERFACE_SET_MISMATCH", `Save resource '${id}' changes the number of declared interfaces.`);
    for (let index = 0; index < declaredInterfaces.length; index += 1) {
      const candidate = raw.interfaces[index];
      const expected = declaredInterfaces[index];
      if (!isRecord(candidate) || !isRecord(expected))
        return fail("SAVE_INTERFACE_INVALID", `Save interface '${id}[${index}]' is malformed.`);
      for (const key of fixedInterfaceKeys) {
        if (Object.prototype.hasOwnProperty.call(candidate, key) !== Object.prototype.hasOwnProperty.call(expected, key) ||
            !jsonEqual(candidate[key], expected[key]))
          return fail("SAVE_INTERFACE_IDENTITY_MISMATCH", `Save interface '${id}[${index}]' changes canonical '${key}'.`);
      }
    }
    resources[id] = deepCloneJson(raw) as unknown as RuntimeResourceState;
  }

  return {
    ok: true,
    state: {
      scenarioId: scenario.scenarioId,
      scenarioHash: scenario.sourceHash,
      stateRevision: input.stateRevision,
      resources,
    },
  };
}
