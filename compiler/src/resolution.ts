import type { NormalizedScenario, ScenarioSource } from "../../core-model/src/generated/contracts.js";
import { deepCloneJson, deepMergeObjects } from "./helpers.js";
import { highestSatisfying, isSupportedRange, maxSemVer } from "./semver.js";
import type {
  AssetDefinition,
  CapabilityDefinition,
  CompilerDiagnostic,
  ProfileDefinition,
  ResolvedDefinition,
} from "./types.js";

type SourceRequirement = ScenarioSource["requires"]["capabilities"][number];
type NormalizedResource = NormalizedScenario["resources"][number];

function error(code: string, path: string, message: string, suggestion?: string): CompilerDiagnostic {
  return suggestion
    ? { severity: "error", code, path, message, suggestion }
    : { severity: "error", code, path, message };
}

export interface RequirementResolution<T extends { readonly id: string; readonly version: string; readonly minimumEngineVersion: string }> {
  readonly resolved: readonly ResolvedDefinition<T>[];
  readonly diagnostics: readonly CompilerDiagnostic[];
}

export function resolveRequirements<T extends { readonly id: string; readonly version: string; readonly minimumEngineVersion: string }>(
  requirements: readonly SourceRequirement[],
  available: readonly T[],
  kind: "capability" | "profile",
): RequirementResolution<T> {
  const diagnostics: CompilerDiagnostic[] = [];
  const resolved: ResolvedDefinition<T>[] = [];
  const seen = new Set<string>();

  requirements.forEach((requirement, index) => {
    const path = `requires.${kind === "capability" ? "capabilities" : "profiles"}[${index}]`;
    if (seen.has(requirement.id)) {
      diagnostics.push(error(
        "DUPLICATE_REQUIREMENT_ID",
        `${path}.id`,
        `Duplicate ${kind} requirement '${requirement.id}'. Each requirement ID must appear only once.`,
      ));
      return;
    }
    seen.add(requirement.id);

    if (!isSupportedRange(requirement.version)) {
      diagnostics.push(error(
        "VERSION_RANGE_INVALID",
        `${path}.version`,
        `Unsupported version range '${requirement.version}' for ${kind} '${requirement.id}'.`,
        "Use an exact semver, wildcard (1.x / 1.2.x), caret (^1.2.3), tilde (~1.2.3), or comparator set (>=1.0.0 <2.0.0).",
      ));
      return;
    }

    const candidates = available.filter((x) => x.id === requirement.id);
    if (candidates.length === 0) {
      diagnostics.push(error(
        kind === "capability" ? "CAPABILITY_UNAVAILABLE" : "PROFILE_UNAVAILABLE",
        `${path}.id`,
        `No ${kind} '${requirement.id}' exists in the active catalog.`,
      ));
      return;
    }

    const version = highestSatisfying(candidates.map((x) => x.version), requirement.version);
    if (!version) {
      diagnostics.push(error(
        kind === "capability" ? "CAPABILITY_VERSION_UNAVAILABLE" : "PROFILE_VERSION_UNAVAILABLE",
        `${path}.version`,
        `No available version of ${kind} '${requirement.id}' satisfies '${requirement.version}'. Available: ${candidates.map((x) => x.version).sort().join(", ")}.`,
      ));
      return;
    }
    const definition = candidates.find((x) => x.version === version)!;
    resolved.push({ requirementId: requirement.id, requestedRange: requirement.version, definition });
  });

  return { resolved, diagnostics };
}

function profileApplies(profile: ProfileDefinition, resourceType: string): boolean {
  return profile.appliesTo.some((pattern) => {
    if (pattern.endsWith(".*")) return resourceType.startsWith(pattern.slice(0, -1));
    return pattern === resourceType;
  });
}

function assetPatternScore(pattern: string, resourceType: string): number {
  if (pattern === "*") return 0;
  if (pattern.endsWith(".*")) return resourceType.startsWith(pattern.slice(0, -1)) ? pattern.length : -1;
  return pattern === resourceType ? 10000 + pattern.length : -1;
}

function assetScore(asset: AssetDefinition, resourceType: string): number {
  return Math.max(...asset.appliesTo.map((pattern) => assetPatternScore(pattern, resourceType)));
}

function resolveExplicitAsset(
  resource: ScenarioSource["resources"][number],
  index: number,
  available: readonly AssetDefinition[],
  diagnostics: CompilerDiagnostic[],
): AssetDefinition | undefined {
  const request = resource.asset;
  if (!request) return undefined;
  const base = `resources[${index}].asset`;
  if (!isSupportedRange(request.version)) {
    diagnostics.push(error(
      "ASSET_VERSION_RANGE_INVALID",
      `${base}.version`,
      `Unsupported asset version range '${request.version}' for '${request.id}'.`,
      "Use an exact semver, wildcard (1.x / 1.2.x), caret (^1.2.3), tilde (~1.2.3), or comparator set.",
    ));
    return undefined;
  }
  const candidates = available.filter((asset) => asset.id === request.id);
  if (candidates.length === 0) {
    diagnostics.push(error("ASSET_UNAVAILABLE", `${base}.id`, `Asset '${request.id}' is not available in the active Asset Library.`));
    return undefined;
  }
  const version = highestSatisfying(candidates.map((asset) => asset.version), request.version);
  if (!version) {
    diagnostics.push(error(
      "ASSET_VERSION_UNAVAILABLE",
      `${base}.version`,
      `No version of asset '${request.id}' satisfies '${request.version}'. Available: ${candidates.map((asset) => asset.version).sort().join(", ")}.`,
    ));
    return undefined;
  }
  const definition = candidates.find((asset) => asset.version === version)!;
  if (assetScore(definition, resource.type) < 0) {
    diagnostics.push(error(
      "ASSET_TYPE_MISMATCH",
      base,
      `Asset '${definition.id}@${definition.version}' does not apply to resource type '${resource.type}'.`,
    ));
    return undefined;
  }
  return definition;
}

function resolveAutomaticAsset(
  resource: ScenarioSource["resources"][number],
  index: number,
  available: readonly AssetDefinition[],
  diagnostics: CompilerDiagnostic[],
): AssetDefinition | undefined {
  const matches = available
    .map((asset) => ({ asset, score: assetScore(asset, resource.type) }))
    .filter((entry) => entry.score >= 0);
  if (matches.length === 0) {
    diagnostics.push(error("ASSET_UNAVAILABLE_FOR_TYPE", `resources[${index}].type`, `No built-in asset resolves resource type '${resource.type}'.`));
    return undefined;
  }
  const bestScore = Math.max(...matches.map((entry) => entry.score));
  const best = matches.filter((entry) => entry.score === bestScore);
  const ids = [...new Set(best.map((entry) => entry.asset.id))].sort((a, b) => a.localeCompare(b, "en"));
  if (ids.length !== 1) {
    diagnostics.push(error(
      "ASSET_MATCH_AMBIGUOUS",
      `resources[${index}].type`,
      `Resource type '${resource.type}' matches multiple equally-specific assets: ${ids.join(", ")}.`,
      "Specify resources[].asset explicitly or make Asset Library appliesTo patterns unambiguous.",
    ));
    return undefined;
  }
  const candidates = best.filter((entry) => entry.asset.id === ids[0]).map((entry) => entry.asset);
  const version = maxSemVer(candidates.map((asset) => asset.version));
  return candidates.find((asset) => asset.version === version);
}

function normalizeInterfaces(
  interfaces: readonly { readonly id: string; readonly label?: string; readonly addresses?: readonly string[]; readonly mac?: string; readonly mtu?: number }[] | undefined,
): NormalizedResource["interfaces"] {
  return (interfaces ?? []).map((iface) => ({
    id: iface.id,
    label: iface.label ?? iface.id,
    addresses: [...(iface.addresses ?? [])],
    ...(iface.mac !== undefined ? { mac: iface.mac } : {}),
    ...(iface.mtu !== undefined ? { mtu: iface.mtu } : {}),
  }));
}

export interface ResourceNormalizationResult {
  readonly resources: NormalizedScenario["resources"];
  readonly assetDefinitions: readonly AssetDefinition[];
  readonly diagnostics: readonly CompilerDiagnostic[];
}

export function normalizeResources(
  source: ScenarioSource,
  resolvedProfiles: readonly ResolvedDefinition<ProfileDefinition>[],
  availableAssets: readonly AssetDefinition[],
): ResourceNormalizationResult {
  const diagnostics: CompilerDiagnostic[] = [];
  const profileById = new Map(resolvedProfiles.map((x) => [x.definition.id, x.definition] as const));
  const usedAssets = new Map<string, AssetDefinition>();

  const resources = source.resources.map((resource, index): NormalizedResource => {
    const profile = resource.profile !== undefined ? profileById.get(resource.profile) : undefined;
    if (profile && !profileApplies(profile, resource.type)) {
      diagnostics.push(error(
        "PROFILE_TYPE_MISMATCH",
        `resources[${index}].profile`,
        `Profile '${profile.id}@${profile.version}' does not apply to resource type '${resource.type}'.`,
      ));
    }

    const asset = resolveExplicitAsset(resource, index, availableAssets, diagnostics)
      ?? (resource.asset === undefined ? resolveAutomaticAsset(resource, index, availableAssets, diagnostics) : undefined);
    if (asset) usedAssets.set(`${asset.id}@${asset.version}`, asset);

    const defaults = profile?.defaults;
    const sourceInterfaces = resource.interfaces;
    const defaultInterfaces = defaults?.interfaces;
    const properties = deepMergeObjects(defaults?.properties ?? {}, resource.properties);

    // Asset failures are reported above. A structurally invalid placeholder keeps the
    // in-memory object typed until the compiler returns failure before normalized validation.
    const assetRef = asset ? { id: asset.id, version: asset.version } : { id: "resource.generic", version: "0.0.0" };

    return {
      id: resource.id,
      type: resource.type,
      label: resource.label,
      ...(resource.zone !== undefined ? { zone: resource.zone } : {}),
      ...(resource.profile !== undefined ? { profile: resource.profile } : {}),
      ...((resource.vendor ?? defaults?.vendor) !== undefined ? { vendor: resource.vendor ?? defaults?.vendor! } : {}),
      ...((resource.product ?? defaults?.product) !== undefined ? { product: resource.product ?? defaults?.product! } : {}),
      interfaces: normalizeInterfaces(sourceInterfaces ?? defaultInterfaces),
      properties: deepCloneJson(properties),
      asset: assetRef,
    };
  });

  return {
    resources,
    assetDefinitions: [...usedAssets.values()].sort((a, b) => a.id.localeCompare(b.id, "en") || a.version.localeCompare(b.version, "en")),
    diagnostics,
  };
}

export function computeMinimumEngineVersion(
  baseline: string,
  capabilities: readonly ResolvedDefinition<CapabilityDefinition>[],
  profiles: readonly ResolvedDefinition<ProfileDefinition>[],
): string {
  return maxSemVer([
    baseline,
    ...capabilities.map((x) => x.definition.minimumEngineVersion),
    ...profiles.map((x) => x.definition.minimumEngineVersion),
  ]) ?? baseline;
}
