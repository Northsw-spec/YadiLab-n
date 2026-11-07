import type { LayoutDocument, NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import type { CompilerContext, CompilerDiagnostic, SchemaValidationResult } from "../../compiler/src/types.js";
import { compareSemVer, compileScenario, parseSemVer } from "../../compiler/src/index.js";
import { BUILTIN_CAPABILITY_PACK_REGISTRY, type CapabilityPackRegistry } from "../../capability-packs/src/index.js";
import { createInitialEngineState, ENGINE_VERSION, evaluateEngine, runScenarioRegression, type ScenarioRegressionReport } from "../../engine/src/index.js";
import { buildLayoutGraph, validateBackendResult, validateVisualLayout } from "../../layout/src/index.js";
import { canonicalJson, DEFAULT_PACKAGE_LIMITS, PackageIOError, type PackageAssetInput, type PackageDocumentInput, type PackageIO, type PackageReadResult } from "../../package-io/src/index.js";

export type CertificationStage = "compile" | "regression" | "layout" | "runtime" | "package-write" | "package-readback";
export interface CertificationDiagnostic { readonly severity: "error"; readonly stage: CertificationStage; readonly code: string; readonly message: string; readonly path?: string; readonly objectId?: string; }
export interface CertificationGate { readonly stage: CertificationStage; readonly passed: true; readonly summary: string; }
export interface ScenarioCertificationCertificate {
  readonly formatId: "infrastructure-cyber-lab.certification";
  readonly schemaVersion: "1.0.0";
  readonly scenarioId: string;
  readonly sourceHash: string;
  readonly distribution: "student" | "author";
  readonly gates: readonly CertificationGate[];
  readonly passed: true;
}
export interface CertificationOptions {
  readonly packageIO: PackageIO;
  readonly distribution: "student" | "author";
  readonly layout: LayoutDocument;
  readonly validateLayout?: (input: unknown) => SchemaValidationResult;
  readonly capabilityRegistry?: CapabilityPackRegistry;
  readonly assets?: readonly PackageAssetInput[];
  readonly docs?: readonly PackageDocumentInput[];
  readonly packageVersion?: string;
}
export interface SourceCertificationOptions extends CertificationOptions { readonly compilerContext: CompilerContext; }
export type ScenarioCertificationResult =
 | { readonly ok: true; readonly model: NormalizedScenario; readonly regression: ScenarioRegressionReport; readonly blob: Blob; readonly readback: PackageReadResult; readonly certificate: ScenarioCertificationCertificate; readonly diagnostics: readonly CertificationDiagnostic[] }
 | { readonly ok: false; readonly diagnostics: readonly CertificationDiagnostic[]; readonly model?: NormalizedScenario; readonly regression?: ScenarioRegressionReport };

function err(stage: CertificationStage, code: string, message: string, extra: {path?:string;objectId?:string}={}): CertificationDiagnostic {
  return { severity:"error", stage, code, message, ...extra };
}
function stripSolution(model: NormalizedScenario) { const { canonicalSolution: _solution, ...rest } = model; return rest; }
function layoutDiagnostics(model: NormalizedScenario, layout: LayoutDocument, validateLayout?: (input: unknown)=>SchemaValidationResult): CertificationDiagnostic[] {
  const out: CertificationDiagnostic[]=[];
  if (validateLayout) {
    const v=validateLayout(layout);
    if (!v.valid) out.push(...v.diagnostics.map((d)=>err("layout","CERT_LAYOUT_SCHEMA_INVALID",d.message,{path:d.path})));
  }
  if (layout.scenarioId!==model.scenarioId) out.push(err("layout","CERT_LAYOUT_SCENARIO_MISMATCH",`Layout scenario '${layout.scenarioId}' does not match '${model.scenarioId}'.`));
  const graph=buildLayoutGraph(model);
  for (const d of validateBackendResult(graph, layout.nodes)) out.push(err("layout",`CERT_${d.code}`,d.message,d.objectId !== undefined ? {objectId:d.objectId} : {}));
  for (const d of validateVisualLayout(model, layout)) out.push(err("layout",`CERT_${d.code}`,d.message,d.objectId !== undefined ? {objectId:d.objectId} : {}));
  return out;
}
function runtimeDiagnostics(model: NormalizedScenario, registry: CapabilityPackRegistry): CertificationDiagnostic[] {
  const out: CertificationDiagnostic[]=[];
  const current=parseSemVer(ENGINE_VERSION), required=parseSemVer(model.minimumEngineVersion);
  if (!current || !required) out.push(err("runtime","CERT_ENGINE_VERSION_INVALID",`Invalid Engine version metadata '${model.minimumEngineVersion}'.`));
  else if (compareSemVer(current,required)<0) out.push(err("runtime","CERT_ENGINE_TOO_OLD",`Scenario requires Engine ${model.minimumEngineVersion}; current Engine is ${ENGINE_VERSION}.`));
  const capabilities=registry.resolveLocks(model.capabilityLocks);
  if (!capabilities.ok) out.push(...capabilities.diagnostics.map((d)=>err("runtime",`CERT_${d.code}`,d.message,{objectId:d.id})));
  if (!out.length) { try { const state=createInitialEngineState(model); evaluateEngine(model,state); } catch(cause) { out.push(err("runtime","CERT_RUNTIME_INITIALIZATION_FAILED",cause instanceof Error?cause.message:String(cause))); } }
  return out;
}
function exactReadbackDiagnostics(model: NormalizedScenario, layout: LayoutDocument, read: PackageReadResult, distribution:"student"|"author"): CertificationDiagnostic[] {
  const out: CertificationDiagnostic[]=[];
  if (read.manifest.distribution!==distribution) out.push(err("package-readback","CERT_PACKAGE_DISTRIBUTION_MISMATCH",`Read-back distribution '${read.manifest.distribution}' does not match '${distribution}'.`));
  if (canonicalJson(read.scenario)!==canonicalJson(stripSolution(model))) out.push(err("package-readback","CERT_PACKAGE_SCENARIO_DRIFT","Read-back scenario.json differs from the certified normalized model."));
  if (read.layout===undefined || canonicalJson(read.layout)!==canonicalJson(layout)) out.push(err("package-readback","CERT_PACKAGE_LAYOUT_DRIFT","Read-back layout.json differs from the certified layout."));
  if (distribution==="student" && read.solution!==undefined) out.push(err("package-readback","CERT_STUDENT_SOLUTION_LEAK","Student package contains solution material."));
  if (distribution==="author") {
    if (read.solution===undefined) out.push(err("package-readback","CERT_AUTHOR_SOLUTION_MISSING","Author package lost canonical solution material."));
    else if (canonicalJson(read.solution)!==canonicalJson(model.canonicalSolution)) out.push(err("package-readback","CERT_AUTHOR_SOLUTION_DRIFT","Author solution.json differs from the certified canonical solution."));
  }
  return out;
}

export async function certifyCompiledScenario(model: NormalizedScenario, options: CertificationOptions): Promise<ScenarioCertificationResult> {
  if (!model.canonicalSolution) return { ok:false, diagnostics:[err("regression","CERT_CANONICAL_SOLUTION_REQUIRED","Scenario certification requires a canonical/reference solution.")], model };
  const regression=runScenarioRegression(model);
  if (!regression.passed) return { ok:false, diagnostics:[err("regression","CERT_REGRESSION_FAILED",`${regression.checks.filter((x)=>!x.passed).length} scenario regression check(s) failed.`)], model, regression };
  const ldiag=layoutDiagnostics(model,options.layout,options.validateLayout); if (ldiag.length) return {ok:false,diagnostics:ldiag,model,regression};
  const rdiag=runtimeDiagnostics(model,options.capabilityRegistry??BUILTIN_CAPABILITY_PACK_REGISTRY); if (rdiag.length) return {ok:false,diagnostics:rdiag,model,regression};
  let blob:Blob;
  try { blob=await options.packageIO.write(model,{distribution:options.distribution,layout:options.layout,...(options.assets?{assets:options.assets}:{}),...(options.docs?{docs:options.docs}:{}),...(options.packageVersion?{packageVersion:options.packageVersion}:{})}); }
  catch(cause){ return {ok:false,diagnostics:[cause instanceof PackageIOError?err("package-write",cause.code,cause.message,cause.path !== undefined ? {path:cause.path} : {}):err("package-write","CERT_PACKAGE_WRITE_FAILED",cause instanceof Error?cause.message:String(cause))],model,regression}; }
  let read:PackageReadResult;
  try { read=await options.packageIO.read(blob,DEFAULT_PACKAGE_LIMITS); }
  catch(cause){ return {ok:false,diagnostics:[cause instanceof PackageIOError?err("package-readback",`CERT_${cause.code}`,cause.message,cause.path !== undefined ? {path:cause.path} : {}):err("package-readback","CERT_PACKAGE_READ_FAILED",cause instanceof Error?cause.message:String(cause))],model,regression}; }
  const pdiag=exactReadbackDiagnostics(model,options.layout,read,options.distribution); if(pdiag.length)return{ok:false,diagnostics:pdiag,model,regression};
  const readRuntime=runtimeDiagnostics(read.scenario,options.capabilityRegistry??BUILTIN_CAPABILITY_PACK_REGISTRY); if(readRuntime.length)return{ok:false,diagnostics:readRuntime.map((d)=>({...d,stage:"package-readback" as const,code:`CERT_READBACK_${d.code}`})),model,regression};
  const gates:CertificationGate[]=[
    {stage:"regression",passed:true,summary:`Initial/canonical/solved regression passed (${regression.checks.length} checks).`},
    {stage:"layout",passed:true,summary:`Layout validates ${options.layout.nodes.length} semantic nodes with hierarchy/geometry intact.`},
    {stage:"runtime",passed:true,summary:`Engine ${ENGINE_VERSION} and exact capability-pack availability accepted the model.`},
    {stage:"package-write",passed:true,summary:`${options.distribution} package built through PackageIO.`},
    {stage:"package-readback",passed:true,summary:"PackageIO readback preserved scenario/layout/distribution and solution policy exactly."},
  ];
  return {ok:true,model,regression,blob,readback:read,certificate:{formatId:"infrastructure-cyber-lab.certification",schemaVersion:"1.0.0",scenarioId:model.scenarioId,sourceHash:model.sourceHash,distribution:options.distribution,gates,passed:true},diagnostics:[]};
}

export async function certifyScenarioSource(source: unknown, options: SourceCertificationOptions): Promise<ScenarioCertificationResult> {
  const compiled=await compileScenario(source,options.compilerContext);
  if(!compiled.ok) return {ok:false,diagnostics:compiled.diagnostics.map((d:CompilerDiagnostic)=>err("compile",d.code,d.message,d.path !== undefined ? {path:d.path} : {}))};
  return certifyCompiledScenario(compiled.model,options);
}
