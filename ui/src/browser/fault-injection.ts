import type { FaultGenerationPlan, FaultOverlay, FaultPack, NormalizedScenario, ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { createInitialEngineState, evaluateEngine } from "../../../engine/src/index.js";
import type { EngineState } from "../../../engine/src/index.js";
import {
  canonicalFaultJson,
  FAULT_SCENARIO_GENERATOR_ID,
  FAULT_SCENARIO_GENERATOR_VERSION,
  generateDeterministicFaultScenario,
  injectFault,
  materializeFaultedScenarioVariant,
  previewFaultInjection,
  rollbackLatestFault,
  verifyFaultGenerationPlan,
  verifyFaultPack,
  webCryptoFaultHashProvider,
} from "../../../fault-engine/src/index.js";
import type { FaultDiagnostic, FaultGenerationConstraints, FaultHashProvider } from "../../../fault-engine/src/index.js";
import { createBuilderWorkspace } from "./builder.js";
import type { BrowserDiagnostic, BuilderWorkspace, RuntimeWorkspace } from "./types.js";

export interface FaultTargetOption {
  readonly resourceId: string;
  readonly label: string;
  readonly resourceType: string;
}

export interface FaultBindingView {
  readonly name: string;
  readonly resourceTypes: readonly string[];
  readonly options: readonly FaultTargetOption[];
}

export interface FaultDefinitionView {
  readonly faultId: string;
  readonly title: string;
  readonly domain: string;
  readonly bindings: readonly FaultBindingView[];
  readonly symptoms: readonly string[];
  readonly hiddenTruth: string;
  readonly learningObjectives: readonly string[];
  readonly difficulty: FaultPack["faults"][number]["difficulty"];
}

export interface FaultPreviewView {
  readonly token: string;
  readonly ok: boolean;
  readonly diagnostics: readonly FaultDiagnostic[];
  readonly changedResources: readonly string[];
  readonly operations: readonly { readonly op: string; readonly target: string; readonly path: string }[];
  readonly overlay?: FaultOverlay;
}

export interface BuilderFaultDraft {
  readonly scenarioHash: string;
  readonly sourceRevision: number;
  readonly state: EngineState;
  readonly overlay?: FaultOverlay;
}

export interface FaultUiResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly diagnostics: readonly BrowserDiagnostic[];
}

function browserDiagnostics(items: readonly FaultDiagnostic[]): readonly BrowserDiagnostic[] {
  return items.map((item) => ({
    severity: item.severity === "error" ? "error" : "warning",
    code: item.code,
    message: item.message,
    ...(item.objectId ? { objectId: item.objectId } : {}),
  }));
}

function error(code: string, message: string): BrowserDiagnostic {
  return { severity: "error", code, message };
}

function faultById(pack: FaultPack, faultId: string): FaultPack["faults"][number] | undefined {
  return pack.faults.find((fault) => fault.faultId === faultId);
}

function resourceType(resource: NormalizedScenario["resources"][number]): string {
  return resource.type || "resource";
}

function accepted(type: string, acceptedTypes: readonly string[]): boolean {
  return acceptedTypes.includes("*") || acceptedTypes.includes(type);
}

export function buildFaultDefinitionViews(pack: FaultPack, scenario: NormalizedScenario): readonly FaultDefinitionView[] {
  return pack.faults.map((fault) => ({
    faultId: fault.faultId,
    title: fault.title,
    domain: fault.domain,
    bindings: fault.targetBindings.map((binding) => ({
      name: binding.name,
      resourceTypes: binding.resourceTypes,
      options: scenario.resources
        .filter((resource) => accepted(resourceType(resource), binding.resourceTypes))
        .map((resource) => ({ resourceId: resource.id, label: resource.label, resourceType: resourceType(resource) }))
        .sort((a, b) => a.resourceId.localeCompare(b.resourceId, "en")),
    })),
    symptoms: fault.observableSymptoms,
    hiddenTruth: fault.hiddenTruth,
    learningObjectives: fault.learningObjectives,
    difficulty: fault.difficulty,
  }));
}

export function createBuilderFaultDraft(workspace: BuilderWorkspace): FaultUiResult<BuilderFaultDraft> {
  if (workspace.compile.status !== "valid") return { ok: false, diagnostics: [error("FAULT_UI_COMPILE_REQUIRED", "Fault variant drafting requires a successful current compile.")] };
  return {
    ok: true,
    value: {
      scenarioHash: workspace.compile.model.sourceHash,
      sourceRevision: workspace.sourceRevision,
      state: createInitialEngineState(workspace.compile.model),
    },
    diagnostics: [],
  };
}

export async function computeFaultPreviewToken(args: {
  readonly scenario: NormalizedScenario;
  readonly state: EngineState;
  readonly pack: FaultPack;
  readonly faultId: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly seed: number;
  readonly mode: FaultOverlay["mode"];
  readonly activeOverlay?: FaultOverlay;
}, hash: FaultHashProvider = webCryptoFaultHashProvider): Promise<string> {
  const payload = {
    scenarioId: args.scenario.scenarioId,
    scenarioHash: args.scenario.sourceHash,
    stateRevision: args.state.stateRevision,
    packId: args.pack.packId,
    packVersion: args.pack.version,
    packIdentity: args.pack.packIdentity,
    faultId: args.faultId,
    bindings: Object.fromEntries(Object.entries(args.bindings).sort(([a], [b]) => a.localeCompare(b, "en"))),
    seed: args.seed,
    mode: args.mode,
    activeOverlayIdentity: args.activeOverlay?.overlayIdentity ?? null,
  };
  return hash.sha256Utf8(canonicalFaultJson(payload));
}

async function validateUiRequest(args: {
  readonly scenario: NormalizedScenario;
  readonly state: EngineState;
  readonly pack: FaultPack;
  readonly faultId: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly seed: number;
  readonly activeOverlay?: FaultOverlay;
}, hash: FaultHashProvider): Promise<readonly BrowserDiagnostic[]> {
  const diagnostics: BrowserDiagnostic[] = [];
  const verified = await verifyFaultPack(args.pack, hash);
  diagnostics.push(...browserDiagnostics(verified.diagnostics));
  const fault = faultById(args.pack, args.faultId);
  if (!fault) diagnostics.push(error("FAULT_UI_FAULT_NOT_FOUND", `Fault '${args.faultId}' does not exist in pack '${args.pack.packId}'.`));
  if (!Number.isInteger(args.seed) || args.seed < 0 || args.seed > 0xffffffff) diagnostics.push(error("FAULT_UI_SEED_INVALID", "Seed must be an unsigned 32-bit integer."));
  if (fault) {
    const declared = new Set(fault.targetBindings.map((binding) => binding.name));
    const supplied = Object.keys(args.bindings).sort();
    if (supplied.length !== declared.size || supplied.some((name) => !declared.has(name))) diagnostics.push(error("FAULT_UI_BINDING_SET_INVALID", "Bindings must exactly match the fault's declared target bindings."));
    for (const binding of fault.targetBindings) {
      const targetId = args.bindings[binding.name];
      const resource = args.scenario.resources.find((item) => item.id === targetId);
      if (!resource) diagnostics.push(error("FAULT_UI_TARGET_NOT_FOUND", `Binding '${binding.name}' target '${targetId ?? ""}' does not exist in the scenario.`));
      else if (!accepted(resourceType(resource), binding.resourceTypes)) diagnostics.push(error("FAULT_UI_TARGET_TYPE_REJECTED", `Resource '${resource.id}' type '${resourceType(resource)}' is not accepted by binding '${binding.name}'.`));
    }
  }
  if (args.state.scenarioHash !== args.scenario.sourceHash || args.state.scenarioId !== args.scenario.scenarioId) diagnostics.push(error("FAULT_UI_STATE_SCENARIO_MISMATCH", "Runtime state belongs to a different scenario revision."));
  if (args.activeOverlay && (args.activeOverlay.scenarioHash !== args.scenario.sourceHash || args.activeOverlay.scenarioId !== args.scenario.scenarioId)) diagnostics.push(error("FAULT_UI_OVERLAY_SCENARIO_MISMATCH", "Active fault overlay belongs to a different scenario revision."));
  const latest = args.activeOverlay?.instances.at(-1);
  if (latest && args.state.stateRevision !== latest.afterStateRevision) diagnostics.push(error("FAULT_UI_OVERLAY_STATE_DIVERGED", "Runtime/draft state no longer matches the active fault overlay. Clear the fault session or restore the matching state before adding another fault."));
  return diagnostics;
}

export async function previewFaultUi(args: {
  readonly scenario: NormalizedScenario;
  readonly state: EngineState;
  readonly pack: FaultPack;
  readonly faultId: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly seed: number;
  readonly mode: FaultOverlay["mode"];
  readonly activeOverlay?: FaultOverlay;
}, hash: FaultHashProvider = webCryptoFaultHashProvider): Promise<FaultPreviewView> {
  const validation = await validateUiRequest(args, hash);
  if (validation.some((item) => item.severity === "error")) return { token: "", ok: false, diagnostics: validation.map((item) => ({ severity: item.severity, code: item.code, message: item.message, ...(item.objectId ? { objectId: item.objectId } : {}) })), changedResources: [], operations: [] };
  const result = await previewFaultInjection(args, hash);
  const token = await computeFaultPreviewToken(args, hash);
  if (!result.ok) return { token, ok: false, diagnostics: result.diagnostics, changedResources: [], operations: [] };
  const instance = result.overlay.instances.at(-1);
  return {
    token,
    ok: true,
    diagnostics: result.diagnostics,
    changedResources: instance?.changedResources ?? [],
    operations: result.operations.map((operation) => ({ op: operation.op, target: operation.target, path: operation.path })),
    overlay: result.overlay,
  };
}

async function requirePreviewToken(args: {
  readonly previewToken: string;
  readonly scenario: NormalizedScenario;
  readonly state: EngineState;
  readonly pack: FaultPack;
  readonly faultId: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly seed: number;
  readonly mode: FaultOverlay["mode"];
  readonly activeOverlay?: FaultOverlay;
}, hash: FaultHashProvider): Promise<readonly BrowserDiagnostic[]> {
  const expected = await computeFaultPreviewToken(args, hash);
  return expected === args.previewToken ? [] : [error("FAULT_UI_PREVIEW_STALE", "Fault request changed after preview. Run preview again before injection.")];
}

export async function injectFaultIntoRuntime(args: {
  readonly workspace: RuntimeWorkspace;
  readonly pack: FaultPack;
  readonly faultId: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly seed: number;
  readonly previewToken: string;
  readonly activeOverlay?: FaultOverlay;
}, hash: FaultHashProvider = webCryptoFaultHashProvider): Promise<FaultUiResult<{ readonly workspace: RuntimeWorkspace; readonly overlay: FaultOverlay }>> {
  const mode: FaultOverlay["mode"] = "RUNTIME_INJECTION";
  const tokenDiagnostics = await requirePreviewToken({ ...args, scenario: args.workspace.scenario, state: args.workspace.engineState, mode }, hash);
  if (tokenDiagnostics.length) return { ok: false, diagnostics: tokenDiagnostics };
  const result = await injectFault({ scenario: args.workspace.scenario, state: args.workspace.engineState, pack: args.pack, faultId: args.faultId, bindings: args.bindings, seed: args.seed, mode, ...(args.activeOverlay ? { activeOverlay: args.activeOverlay } : {}) }, hash);
  if (!result.ok) return { ok: false, diagnostics: browserDiagnostics(result.diagnostics) };
  const history = { past: [...args.workspace.history.past, args.workspace.engineState], future: [], checkpoints: args.workspace.history.checkpoints };
  const workspace: RuntimeWorkspace = { ...args.workspace, engineState: result.state, evaluation: evaluateEngine(args.workspace.scenario, result.state), history };
  return { ok: true, value: { workspace, overlay: result.overlay }, diagnostics: browserDiagnostics(result.diagnostics) };
}

export async function rollbackRuntimeFaultUi(args: {
  readonly workspace: RuntimeWorkspace;
  readonly overlay: FaultOverlay;
}, hash: FaultHashProvider = webCryptoFaultHashProvider): Promise<FaultUiResult<{ readonly workspace: RuntimeWorkspace; readonly overlay: FaultOverlay }>> {
  const result = await rollbackLatestFault(args.workspace.scenario, args.workspace.engineState, args.overlay, hash);
  if (!result.ok) return { ok: false, diagnostics: browserDiagnostics(result.diagnostics) };
  const history = { past: [...args.workspace.history.past, args.workspace.engineState], future: [], checkpoints: args.workspace.history.checkpoints };
  const workspace: RuntimeWorkspace = { ...args.workspace, engineState: result.state, evaluation: evaluateEngine(args.workspace.scenario, result.state), history };
  return { ok: true, value: { workspace, overlay: result.overlay }, diagnostics: browserDiagnostics(result.diagnostics) };
}

export async function previewBuilderFaultDraft(args: {
  readonly workspace: BuilderWorkspace;
  readonly draft: BuilderFaultDraft;
  readonly pack: FaultPack;
  readonly faultId: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly seed: number;
}, hash: FaultHashProvider = webCryptoFaultHashProvider): Promise<FaultPreviewView> {
  if (args.workspace.compile.status !== "valid" || args.draft.scenarioHash !== args.workspace.compile.model.sourceHash || args.draft.sourceRevision !== args.workspace.sourceRevision) {
    return { token: "", ok: false, diagnostics: [{ severity: "error", code: "FAULT_UI_DRAFT_STALE", message: "Builder scenario changed after the fault draft was created." }], changedResources: [], operations: [] };
  }
  return previewFaultUi({ scenario: args.workspace.compile.model, state: args.draft.state, pack: args.pack, faultId: args.faultId, bindings: args.bindings, seed: args.seed, mode: "SCENARIO_VARIANT", ...(args.draft.overlay ? { activeOverlay: args.draft.overlay } : {}) }, hash);
}

export async function injectBuilderFaultDraft(args: {
  readonly workspace: BuilderWorkspace;
  readonly draft: BuilderFaultDraft;
  readonly pack: FaultPack;
  readonly faultId: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly seed: number;
  readonly previewToken: string;
}, hash: FaultHashProvider = webCryptoFaultHashProvider): Promise<FaultUiResult<BuilderFaultDraft>> {
  if (args.workspace.compile.status !== "valid" || args.draft.scenarioHash !== args.workspace.compile.model.sourceHash || args.draft.sourceRevision !== args.workspace.sourceRevision) return { ok: false, diagnostics: [error("FAULT_UI_DRAFT_STALE", "Builder scenario changed after the fault draft was created.")] };
  const mode: FaultOverlay["mode"] = "SCENARIO_VARIANT";
  const tokenDiagnostics = await requirePreviewToken({ previewToken: args.previewToken, scenario: args.workspace.compile.model, state: args.draft.state, pack: args.pack, faultId: args.faultId, bindings: args.bindings, seed: args.seed, mode, ...(args.draft.overlay ? { activeOverlay: args.draft.overlay } : {}) }, hash);
  if (tokenDiagnostics.length) return { ok: false, diagnostics: tokenDiagnostics };
  const result = await injectFault({ scenario: args.workspace.compile.model, state: args.draft.state, pack: args.pack, faultId: args.faultId, bindings: args.bindings, seed: args.seed, mode, ...(args.draft.overlay ? { activeOverlay: args.draft.overlay } : {}) }, hash);
  if (!result.ok) return { ok: false, diagnostics: browserDiagnostics(result.diagnostics) };
  return { ok: true, value: { ...args.draft, state: result.state, overlay: result.overlay }, diagnostics: browserDiagnostics(result.diagnostics) };
}

export function materializeBuilderFaultVariant(args: {
  readonly workspace: BuilderWorkspace;
  readonly draft: BuilderFaultDraft;
  readonly variantScenarioId: string;
}): FaultUiResult<BuilderWorkspace> {
  if (args.workspace.compile.status !== "valid" || args.draft.scenarioHash !== args.workspace.compile.model.sourceHash || args.draft.sourceRevision !== args.workspace.sourceRevision) return { ok: false, diagnostics: [error("FAULT_UI_DRAFT_STALE", "Builder scenario changed after the fault draft was created.")] };
  if (!args.draft.overlay?.instances.length) return { ok: false, diagnostics: [error("FAULT_UI_VARIANT_EMPTY", "Inject at least one fault into the variant draft before materializing it.")] };
  const result = materializeFaultedScenarioVariant(args.workspace.source as ScenarioSource, args.workspace.compile.model, args.draft.overlay, args.variantScenarioId);
  if (!result.ok) return { ok: false, diagnostics: browserDiagnostics(result.diagnostics) };
  return { ok: true, value: createBuilderWorkspace(result.source), diagnostics: browserDiagnostics(result.diagnostics) };
}


export interface GeneratedFaultVariantPreview {
  readonly token: string;
  readonly scenarioHash: string;
  readonly sourceRevision: number;
  readonly draft: BuilderFaultDraft;
  readonly plan: FaultGenerationPlan;
}

export async function computeGeneratedFaultPreviewToken(args: {
  readonly scenarioHash: string;
  readonly sourceRevision: number;
  readonly plan: FaultGenerationPlan;
}, hash: FaultHashProvider = webCryptoFaultHashProvider): Promise<string> {
  return hash.sha256Utf8(canonicalFaultJson({
    scenarioHash: args.scenarioHash,
    sourceRevision: args.sourceRevision,
    generatorId: FAULT_SCENARIO_GENERATOR_ID,
    generatorVersion: FAULT_SCENARIO_GENERATOR_VERSION,
    planIdentity: args.plan.planIdentity,
    overlayIdentity: args.plan.groundTruth.overlayIdentity,
  }));
}

export async function previewGeneratedBuilderFaultVariant(args: {
  readonly workspace: BuilderWorkspace;
  readonly packs: readonly FaultPack[];
  readonly seed: number;
  readonly faultCount: number;
  readonly constraints?: FaultGenerationConstraints;
}, hash: FaultHashProvider = webCryptoFaultHashProvider): Promise<FaultUiResult<GeneratedFaultVariantPreview>> {
  if (args.workspace.compile.status !== "valid") return { ok: false, diagnostics: [error("FAULT_GENERATOR_UI_COMPILE_REQUIRED", "Scenario generation requires a successful current compile.")] };
  const scenario=args.workspace.compile.model;
  const initial=createInitialEngineState(scenario);
  const generated=await generateDeterministicFaultScenario({scenario,state:initial,packs:args.packs,seed:args.seed,faultCount:args.faultCount,...(args.constraints?{constraints:args.constraints}:{})},hash);
  if (!generated.ok) return { ok: false, diagnostics: browserDiagnostics(generated.diagnostics) };
  const previewBase={scenarioHash:scenario.sourceHash,sourceRevision:args.workspace.sourceRevision,plan:generated.plan};
  const token=await computeGeneratedFaultPreviewToken(previewBase,hash);
  return {
    ok:true,
    value:{token,...previewBase,draft:{scenarioHash:scenario.sourceHash,sourceRevision:args.workspace.sourceRevision,state:generated.state,overlay:generated.overlay}},
    diagnostics:browserDiagnostics(generated.diagnostics),
  };
}

export async function materializeGeneratedBuilderFaultVariant(args: {
  readonly workspace: BuilderWorkspace;
  readonly preview: GeneratedFaultVariantPreview;
  readonly previewToken: string;
  readonly variantScenarioId: string;
}, hash: FaultHashProvider = webCryptoFaultHashProvider): Promise<FaultUiResult<BuilderWorkspace>> {
  if (args.workspace.compile.status !== "valid" || args.preview.scenarioHash !== args.workspace.compile.model.sourceHash || args.preview.sourceRevision !== args.workspace.sourceRevision) return { ok:false, diagnostics:[error("FAULT_GENERATOR_UI_PREVIEW_STALE","Builder scenario changed after generator preview. Run the generator preview again.")] };
  const expected=await computeGeneratedFaultPreviewToken({scenarioHash:args.preview.scenarioHash,sourceRevision:args.preview.sourceRevision,plan:args.preview.plan},hash);
  if (expected!==args.previewToken||expected!==args.preview.token) return { ok:false, diagnostics:[error("FAULT_GENERATOR_UI_PREVIEW_STALE","Generator request or preview changed after preview. Run the generator preview again.")] };
  const overlay=args.preview.draft.overlay;
  if (!overlay) return { ok:false, diagnostics:[error("FAULT_GENERATOR_UI_OVERLAY_MISSING","Generator preview does not contain a fault overlay.")] };
  const verified=await verifyFaultGenerationPlan(args.preview.plan,overlay,args.workspace.compile.model,hash);
  if (!verified.ok) return { ok:false, diagnostics:browserDiagnostics(verified.diagnostics) };
  const result=materializeFaultedScenarioVariant(args.workspace.source as ScenarioSource,args.workspace.compile.model,overlay,args.variantScenarioId,{generatorId:args.preview.plan.generatorId,generatorVersion:args.preview.plan.generatorVersion,seed:args.preview.plan.seed,planIdentity:args.preview.plan.planIdentity});
  if (!result.ok) return { ok:false, diagnostics:browserDiagnostics(result.diagnostics) };
  return { ok:true, value:createBuilderWorkspace(result.source), diagnostics:browserDiagnostics(result.diagnostics) };
}
