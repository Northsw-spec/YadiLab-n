/**
 * YadiLab — original project source.
 * Copyright © 2026 Daniel Ölund. All rights reserved.
 * Original author and copyright holder: Daniel Ölund.
 * No license is granted for commercial use, redistribution, or creation of
 * derivative works without prior written permission.
 * Third-party components retain their separate licenses; see THIRD_PARTY_NOTICES.md.
 */

import type { NormalizedScenario, ScenarioSource } from "../../core-model/src/generated/contracts.js";
import { canonicalJson, webCryptoHashProvider } from "./canonical-json.js";
import { deepCloneJson } from "./helpers.js";
import {
  computeMinimumEngineVersion,
  normalizeResources,
  resolveRequirements,
} from "./resolution.js";
import { foundationTestEngineMinimum, validateScenarioSemantics } from "./semantic-validation.js";
import { maxSemVer, parseSemVer } from "./semver.js";
import { checkCurrentSchemaVersion, SOURCE_FORMAT_ID } from "../../versioning/src/index.js";
import type {
  AssetDefinition,
  CapabilityDefinition,
  CompileResult,
  CompilerContext,
  CompilerDiagnostic,
  ProfileDefinition,
} from "./types.js";

export type {
  AssetDefinition,
  CapabilityClaims,
  CapabilityDefinition,
  CompileFailure,
  CompileResult,
  CompileSuccess,
  CompilerCatalog,
  CompilerContext,
  CompilerDiagnostic,
  DiagnosticSeverity,
  HashProvider,
  LayoutRequest,
  ProfileDefinition,
  ProfileResourceDefaults,
  SchemaValidationResult,
  SchemaValidator,
} from "./types.js";
export { canonicalJson, webCryptoHashProvider } from "./canonical-json.js";
export { compareSemVer, highestSatisfying, isSupportedRange, maxSemVer, parseSemVer, satisfiesSemVer } from "./semver.js";

const NORMALIZED_FORMAT_ID = "infrastructure-cyber-lab.scenario" as const;

function error(code: string, path: string, message: string, suggestion?: string): CompilerDiagnostic {
  return suggestion
    ? { severity: "error", code, path, message, suggestion }
    : { severity: "error", code, path, message };
}

function hasErrors(diagnostics: readonly CompilerDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

function validateCatalog(context: CompilerContext): readonly CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  if (!parseSemVer(context.engineBaselineVersion)) {
    diagnostics.push(error("ENGINE_BASELINE_VERSION_INVALID", "compiler.engineBaselineVersion", `Engine baseline '${context.engineBaselineVersion}' is not exact semver.`));
  }

  const check = <T extends CapabilityDefinition | ProfileDefinition>(items: readonly T[], kind: "capability" | "profile"): void => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const base = `catalog.${kind === "capability" ? "capabilities" : "profiles"}[${i}]`;
      if (!parseSemVer(item.version)) diagnostics.push(error("CATALOG_VERSION_INVALID", `${base}.version`, `${kind} '${item.id}' has invalid exact version '${item.version}'.`));
      if (!parseSemVer(item.minimumEngineVersion)) diagnostics.push(error("CATALOG_ENGINE_VERSION_INVALID", `${base}.minimumEngineVersion`, `${kind} '${item.id}@${item.version}' has invalid minimumEngineVersion '${item.minimumEngineVersion}'.`));
      const key = `${item.id}@${item.version}`;
      if (seen.has(key)) diagnostics.push(error("CATALOG_DUPLICATE_DEFINITION", base, `Duplicate ${kind} definition '${key}'.`));
      seen.add(key);
    });
  };
  check(context.catalog.capabilities, "capability");
  check(context.catalog.profiles, "profile");

  const seenAssets = new Set<string>();
  context.catalog.assets.forEach((asset, i) => {
    const base = `catalog.assets[${i}]`;
    if (!parseSemVer(asset.version)) diagnostics.push(error("CATALOG_ASSET_VERSION_INVALID", `${base}.version`, `Asset '${asset.id}' has invalid exact version '${asset.version}'.`));
    const key = `${asset.id}@${asset.version}`;
    if (seenAssets.has(key)) diagnostics.push(error("CATALOG_DUPLICATE_ASSET", base, `Duplicate asset definition '${key}'.`));
    seenAssets.add(key);
    if (!asset.trusted) diagnostics.push(error("CATALOG_ASSET_TRUST_INVALID", `${base}.trusted`, `Built-in asset '${key}' must be explicitly trusted.`));
    if (!asset.path.startsWith("assets/builtin/") || asset.path.includes("..") || asset.path.includes("\\")) {
      diagnostics.push(error("CATALOG_ASSET_PATH_INVALID", `${base}.path`, `Built-in asset '${key}' has unsafe/non-local path '${asset.path}'.`));
    }
    if (asset.mime === "image/svg+xml" && !asset.path.endsWith(".svg")) diagnostics.push(error("CATALOG_ASSET_MIME_PATH_MISMATCH", `${base}.mime`, `SVG asset '${key}' must use .svg path.`));
    if (asset.mime === "image/png" && !asset.path.endsWith(".png")) diagnostics.push(error("CATALOG_ASSET_MIME_PATH_MISMATCH", `${base}.mime`, `PNG asset '${key}' must use .png path.`));
    if (asset.appliesTo.length === 0) diagnostics.push(error("CATALOG_ASSET_APPLIES_EMPTY", `${base}.appliesTo`, `Asset '${key}' must apply to at least one resource type.`));
  });
  return diagnostics;
}

function normalizeScenario(
  source: ScenarioSource,
  sourceHash: string,
  minimumEngineVersion: string,
  capabilityDefinitions: readonly CapabilityDefinition[],
  profileDefinitions: readonly ProfileDefinition[],
  assetDefinitions: readonly AssetDefinition[],
  resources: NormalizedScenario["resources"],
): NormalizedScenario {
  return {
    formatId: NORMALIZED_FORMAT_ID,
    schemaVersion: source.schemaVersion,
    scenarioId: source.scenarioId,
    sourceHash,
    metadata: {
      title: source.metadata.title,
      description: source.metadata.description ?? "",
      language: source.metadata.language,
      authors: [...(source.metadata.authors ?? [])],
      tags: [...(source.metadata.tags ?? [])],
      briefing: source.metadata.briefing ?? "",
    },
    minimumEngineVersion,
    capabilityLocks: capabilityDefinitions
      .map((x) => ({ id: x.id, version: x.version }))
      .sort((a, b) => a.id.localeCompare(b.id, "en")),
    profileLocks: profileDefinitions
      .map((x) => ({ id: x.id, version: x.version }))
      .sort((a, b) => a.id.localeCompare(b.id, "en")),
    assetLocks: assetDefinitions
      .map((x) => ({ id: x.id, version: x.version, path: x.path, mime: x.mime, width: x.width, height: x.height, trusted: true as const }))
      .sort((a, b) => a.id.localeCompare(b.id, "en") || a.version.localeCompare(b.version, "en")),
    ...(source.enterpriseOrigin !== undefined ? { enterpriseOrigin: deepCloneJson(source.enterpriseOrigin) } : {}),
    ...(source.faultOrigin !== undefined ? { faultOrigin: deepCloneJson(source.faultOrigin) } : {}),
    zones: source.zones.map((zone) => ({
      id: zone.id,
      label: zone.label,
      kind: zone.kind ?? "custom",
      ...(zone.parent !== undefined ? { parent: zone.parent } : {}),
    })),
    resources,
    connections: source.connections.map((connection) => ({
      id: connection.id,
      kind: connection.kind,
      from: deepCloneJson(connection.from),
      to: deepCloneJson(connection.to),
      properties: deepCloneJson(connection.properties),
    })),
    tests: source.tests.map((test) => ({
      id: test.id,
      type: test.type,
      label: test.label ?? test.id,
      params: deepCloneJson(test.params),
      ...(test.expectedInitial !== undefined ? { expectedInitial: test.expectedInitial } : {}),
      ...(test.expectedSolved !== undefined ? { expectedSolved: test.expectedSolved } : {}),
    })),
    findings: source.findings.map((finding) => ({
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      when: deepCloneJson(finding.when),
      evidenceTests: [...(finding.evidenceTests ?? [])],
    })),
    objectives: source.objectives.map((objective) => ({
      id: objective.id,
      title: objective.title,
      category: objective.category,
      required: objective.required,
      condition: deepCloneJson(objective.condition),
    })),
    ...(source.troubleshootingObjectives !== undefined ? { troubleshootingObjectives: deepCloneJson(source.troubleshootingObjectives) } : {}),
    completion: deepCloneJson(source.completion),
    hints: (source.hints ?? []).map((hint) => ({ level: hint.level, text: hint.text })),
    notes: (source.notes ?? []).map((note) => ({
      id: note.id,
      ...(note.title !== undefined ? { title: note.title } : {}),
      text: note.text,
      ...(note.target !== undefined ? { target: note.target } : {}),
    })),
    ...(source.canonicalSolution !== undefined ? { canonicalSolution: deepCloneJson(source.canonicalSolution) } : {}),
  };
}

export async function compileScenario(sourceInput: unknown, context: CompilerContext): Promise<CompileResult> {
  const diagnostics: CompilerDiagnostic[] = [...validateCatalog(context)];
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };

  const sourceValidation = context.validateSource(sourceInput);
  diagnostics.push(...sourceValidation.diagnostics);
  if (!sourceValidation.valid || hasErrors(diagnostics)) return { ok: false, diagnostics };

  const schemaCompatibility = checkCurrentSchemaVersion(sourceInput, SOURCE_FORMAT_ID);
  if (schemaCompatibility) {
    diagnostics.push(error("SCHEMA_VERSION_UNSUPPORTED", "schemaVersion", schemaCompatibility.message, "Run the explicit migration toolchain before compiling this document."));
    return { ok: false, diagnostics };
  }

  // Schema validation is the authoritative type gate. The compiler intentionally
  // never rewrites invalid IDs; stable IDs are rejected by schema instead.
  const source = deepCloneJson(sourceInput) as ScenarioSource;

  const capabilityResolution = resolveRequirements(source.requires.capabilities, context.catalog.capabilities, "capability");
  const profileResolution = resolveRequirements(source.requires.profiles, context.catalog.profiles, "profile");
  diagnostics.push(...capabilityResolution.diagnostics, ...profileResolution.diagnostics);

  const resolvedCapabilityIds = new Set(capabilityResolution.resolved.map((x) => x.definition.id));
  const resolvedProfileIds = new Set(profileResolution.resolved.map((x) => x.definition.id));
  const profileIdsInCatalog = new Set(context.catalog.profiles.map((x) => x.id));

  diagnostics.push(...validateScenarioSemantics(source, {
    resolvedCapabilityIds,
    capabilityDefinitions: context.catalog.capabilities,
    resolvedProfileIds,
    profileIdsInCatalog,
  }));

  const normalizedResources = normalizeResources(source, profileResolution.resolved, context.catalog.assets);
  diagnostics.push(...normalizedResources.diagnostics);

  if (hasErrors(diagnostics)) return { ok: false, diagnostics };

  let sourceHash: string;
  try {
    sourceHash = await (context.hashProvider ?? webCryptoHashProvider).sha256Utf8(canonicalJson(source));
  } catch (cause) {
    diagnostics.push(error(
      "SOURCE_HASH_FAILED",
      "sourceHash",
      `Failed to compute SHA-256 source hash: ${cause instanceof Error ? cause.message : String(cause)}`,
    ));
    return { ok: false, diagnostics };
  }

  const semanticMinimumEngineVersion = maxSemVer(
    source.tests.map((test) => foundationTestEngineMinimum(test.type)).filter((value): value is string => value !== undefined),
  );
  const minimumEngineVersion = computeMinimumEngineVersion(
    maxSemVer([context.engineBaselineVersion, ...(semanticMinimumEngineVersion ? [semanticMinimumEngineVersion] : [])]) ?? context.engineBaselineVersion,
    capabilityResolution.resolved,
    profileResolution.resolved,
  );

  const model = normalizeScenario(
    source,
    sourceHash,
    minimumEngineVersion,
    capabilityResolution.resolved.map((x) => x.definition),
    profileResolution.resolved.map((x) => x.definition),
    normalizedResources.assetDefinitions,
    normalizedResources.resources,
  );

  const normalizedValidation = context.validateNormalized(model);
  diagnostics.push(...normalizedValidation.diagnostics.map((d) => ({
    ...d,
    code: d.code.startsWith("NORMALIZED_") ? d.code : `NORMALIZED_${d.code}`,
  })));
  if (!normalizedValidation.valid || hasErrors(diagnostics)) return { ok: false, diagnostics };

  return {
    ok: true,
    model,
    layoutRequest: {
      scenarioId: source.scenarioId,
      hints: deepCloneJson(source.layoutHints ?? []),
    },
    diagnostics,
  };
}
