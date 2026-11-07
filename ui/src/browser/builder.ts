import type {
  ScenarioSource,
  Scenariosourceconnection,
  Scenariosourcefinding,
  Scenariosourcehint,
  Scenariosourcenote,
  Scenariosourceobjective,
  Scenariosourcetroubleshootingobjective,
  Scenariosourceresource,
  Scenariosourcerule,
  Scenariosourcesolution,
  Scenariosourcetest,
  Scenariosourcezone,
} from "../../../core-model/src/generated/contracts.js";
import { compileScenario } from "../../../compiler/src/index.js";
import type { ManualLayoutOverride } from "../../../layout/src/types.js";
import { cloneJson, setJsonPath } from "./json.js";
import type {
  BrowserCommandResult,
  BrowserDiagnostic,
  BuilderWorkspace,
  BrowserFoundationOptions,
  WorkspaceSelection,
} from "./types.js";

function diagnostic(code: string, message: string, objectId?: string): BrowserDiagnostic {
  return objectId ? { severity: "error", code, message, objectId } : { severity: "error", code, message };
}

function knownSemanticIds(source: ScenarioSource): ReadonlySet<string> {
  return new Set([
    ...source.zones.map((x) => x.id),
    ...source.resources.map((x) => x.id),
    ...source.connections.map((x) => x.id),
  ]);
}

function sortedUnique(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b, "en"));
}

function invalidate(workspace: BuilderWorkspace, source: ScenarioSource): BuilderWorkspace {
  return {
    ...workspace,
    source,
    sourceRevision: workspace.sourceRevision + 1,
    dirty: true,
    compile: { status: "idle" },
  };
}

function success(workspace: BuilderWorkspace): BrowserCommandResult<BuilderWorkspace> {
  return { ok: true, workspace, diagnostics: [] };
}

function failure(workspace: BuilderWorkspace, ...diagnostics: readonly BrowserDiagnostic[]): BrowserCommandResult<BuilderWorkspace> {
  return { ok: false, workspace, diagnostics };
}

export function createBuilderWorkspace(source: ScenarioSource): BuilderWorkspace {
  return {
    mode: "builder",
    source: cloneJson(source),
    sourceRevision: 0,
    dirty: false,
    selection: { ids: [] },
    layoutOverrides: [],
    compile: { status: "idle" },
  };
}

export function setBuilderSelection(workspace: BuilderWorkspace, ids: readonly string[], primary?: string): BuilderWorkspace {
  const known = knownSemanticIds(workspace.source);
  const filtered = sortedUnique(ids.filter((id) => known.has(id)));
  const selectedPrimary = primary && filtered.includes(primary) ? primary : filtered[0];
  if (workspace.selection.primary === selectedPrimary &&
      workspace.selection.ids.length === filtered.length &&
      workspace.selection.ids.every((id, index) => id === filtered[index])) return workspace;
  const selection: WorkspaceSelection = selectedPrimary ? { ids: filtered, primary: selectedPrimary } : { ids: filtered };
  return { ...workspace, selection };
}

function globalIdExists(source: ScenarioSource, id: string): boolean {
  return [source.zones, source.resources, source.connections, source.tests, source.findings, source.objectives, source.troubleshootingObjectives ?? [], source.notes ?? []]
    .some((items) => items.some((item) => item.id === id));
}

export function addZone(workspace: BuilderWorkspace, zone: Scenariosourcezone): BrowserCommandResult<BuilderWorkspace> {
  if (globalIdExists(workspace.source, zone.id)) return failure(workspace, diagnostic("BUILDER_DUPLICATE_ID", `ID '${zone.id}' already exists.`, zone.id));
  if (zone.parent && !workspace.source.zones.some((x) => x.id === zone.parent)) return failure(workspace, diagnostic("BUILDER_ZONE_PARENT_UNKNOWN", `Parent zone '${zone.parent}' does not exist.`, zone.id));
  const source = { ...workspace.source, zones: [...workspace.source.zones, cloneJson(zone)] };
  return success(invalidate(workspace, source));
}

export function addResource(workspace: BuilderWorkspace, resource: Scenariosourceresource): BrowserCommandResult<BuilderWorkspace> {
  if (globalIdExists(workspace.source, resource.id)) return failure(workspace, diagnostic("BUILDER_DUPLICATE_ID", `ID '${resource.id}' already exists.`, resource.id));
  if (resource.zone && !workspace.source.zones.some((x) => x.id === resource.zone)) return failure(workspace, diagnostic("BUILDER_ZONE_UNKNOWN", `Resource zone '${resource.zone}' does not exist.`, resource.id));
  const source = { ...workspace.source, resources: [...workspace.source.resources, cloneJson(resource)] };
  return success(invalidate(workspace, source));
}

export function duplicateResource(
  workspace: BuilderWorkspace,
  sourceId: string,
  newId: string,
  newLabel?: string,
): BrowserCommandResult<BuilderWorkspace> {
  const existing = workspace.source.resources.find((x) => x.id === sourceId);
  if (!existing) return failure(workspace, diagnostic("BUILDER_RESOURCE_UNKNOWN", `Resource '${sourceId}' does not exist.`, sourceId));
  if (globalIdExists(workspace.source, newId)) return failure(workspace, diagnostic("BUILDER_DUPLICATE_ID", `ID '${newId}' already exists.`, newId));
  const copy = cloneJson(existing) as Scenariosourceresource;
  const duplicate: Scenariosourceresource = { ...copy, id: newId, label: newLabel ?? `${existing.label} copy` };
  return addResource(workspace, duplicate);
}

export function deleteResource(workspace: BuilderWorkspace, resourceId: string, cascadeConnections = false): BrowserCommandResult<BuilderWorkspace> {
  if (!workspace.source.resources.some((x) => x.id === resourceId)) return failure(workspace, diagnostic("BUILDER_RESOURCE_UNKNOWN", `Resource '${resourceId}' does not exist.`, resourceId));
  const references = workspace.source.connections.filter((x) => x.from.resource === resourceId || x.to.resource === resourceId);
  if (references.length > 0 && !cascadeConnections) {
    return failure(workspace, diagnostic("BUILDER_RESOURCE_REFERENCED", `Resource '${resourceId}' is referenced by ${references.length} connection(s); explicit cascade is required.`, resourceId));
  }
  const troubleshootingReferences = (workspace.source.troubleshootingObjectives ?? []).flatMap((objective) => objective.requirements).filter((requirement) =>
    requirement.kind === "observation" ? requirement.targetId === resourceId : requirement.sourceId === resourceId || requirement.destinationId === resourceId);
  if (troubleshootingReferences.length > 0) return failure(workspace, diagnostic("BUILDER_RESOURCE_TROUBLESHOOTING_REFERENCED", `Resource '${resourceId}' is referenced by ${troubleshootingReferences.length} troubleshooting evidence requirement(s); edit those requirements before deleting the resource.`, resourceId));
  const source: ScenarioSource = {
    ...workspace.source,
    resources: workspace.source.resources.filter((x) => x.id !== resourceId),
    connections: cascadeConnections ? workspace.source.connections.filter((x) => x.from.resource !== resourceId && x.to.resource !== resourceId) : workspace.source.connections,
  };
  const layoutOverrides = workspace.layoutOverrides.filter((x) => x.id !== resourceId);
  const next = invalidate({ ...workspace, layoutOverrides }, source);
  return success(setBuilderSelection(next, next.selection.ids.filter((id) => id !== resourceId)));
}

export function upsertConnection(workspace: BuilderWorkspace, connection: Scenariosourceconnection): BrowserCommandResult<BuilderWorkspace> {
  const resourceIds = new Set(workspace.source.resources.map((x) => x.id));
  if (!resourceIds.has(connection.from.resource) || !resourceIds.has(connection.to.resource)) {
    return failure(workspace, diagnostic("BUILDER_CONNECTION_ENDPOINT_UNKNOWN", `Connection '${connection.id}' references an unknown resource.`, connection.id));
  }
  const existing = workspace.source.connections.findIndex((x) => x.id === connection.id);
  if (existing < 0 && globalIdExists(workspace.source, connection.id)) return failure(workspace, diagnostic("BUILDER_DUPLICATE_ID", `ID '${connection.id}' already exists.`, connection.id));
  const connections = workspace.source.connections.map((x) => cloneJson(x));
  if (existing >= 0) connections[existing] = cloneJson(connection);
  else connections.push(cloneJson(connection));
  return success(invalidate(workspace, { ...workspace.source, connections }));
}

export function deleteConnection(workspace: BuilderWorkspace, connectionId: string): BrowserCommandResult<BuilderWorkspace> {
  if (!workspace.source.connections.some((x) => x.id === connectionId)) return failure(workspace, diagnostic("BUILDER_CONNECTION_UNKNOWN", `Connection '${connectionId}' does not exist.`, connectionId));
  const next = invalidate(workspace, { ...workspace.source, connections: workspace.source.connections.filter((x) => x.id !== connectionId) });
  return success(setBuilderSelection(next, next.selection.ids.filter((id) => id !== connectionId)));
}

export function setResourceProperty(workspace: BuilderWorkspace, resourceId: string, path: string, value: unknown): BrowserCommandResult<BuilderWorkspace> {
  const index = workspace.source.resources.findIndex((x) => x.id === resourceId);
  if (index < 0) return failure(workspace, diagnostic("BUILDER_RESOURCE_UNKNOWN", `Resource '${resourceId}' does not exist.`, resourceId));
  const resource = workspace.source.resources[index]!;
  const write = setJsonPath(resource, path, value);
  if (!write.ok) return failure(workspace, diagnostic("BUILDER_PROPERTY_PATH_INVALID", write.reason ?? `Could not write '${path}'.`, resourceId));
  const resources = workspace.source.resources.map((x, i) => i === index ? write.value : cloneJson(x));
  return success(invalidate(workspace, { ...workspace.source, resources }));
}

function replaceById<T extends { readonly id: string }>(items: readonly T[], item: T): readonly T[] {
  const index = items.findIndex((x) => x.id === item.id);
  if (index < 0) return [...items, cloneJson(item)];
  return items.map((x, i) => i === index ? cloneJson(item) : cloneJson(x));
}

export function upsertTest(workspace: BuilderWorkspace, test: Scenariosourcetest): BrowserCommandResult<BuilderWorkspace> {
  const existsElsewhere = !workspace.source.tests.some((x) => x.id === test.id) && globalIdExists(workspace.source, test.id);
  if (existsElsewhere) return failure(workspace, diagnostic("BUILDER_DUPLICATE_ID", `ID '${test.id}' already exists.`, test.id));
  return success(invalidate(workspace, { ...workspace.source, tests: replaceById(workspace.source.tests, test) }));
}

export function upsertFinding(workspace: BuilderWorkspace, finding: Scenariosourcefinding): BrowserCommandResult<BuilderWorkspace> {
  const existsElsewhere = !workspace.source.findings.some((x) => x.id === finding.id) && globalIdExists(workspace.source, finding.id);
  if (existsElsewhere) return failure(workspace, diagnostic("BUILDER_DUPLICATE_ID", `ID '${finding.id}' already exists.`, finding.id));
  return success(invalidate(workspace, { ...workspace.source, findings: replaceById(workspace.source.findings, finding) }));
}

export function upsertObjective(workspace: BuilderWorkspace, objective: Scenariosourceobjective): BrowserCommandResult<BuilderWorkspace> {
  const existsElsewhere = !workspace.source.objectives.some((x) => x.id === objective.id) && globalIdExists(workspace.source, objective.id);
  if (existsElsewhere) return failure(workspace, diagnostic("BUILDER_DUPLICATE_ID", `ID '${objective.id}' already exists.`, objective.id));
  return success(invalidate(workspace, { ...workspace.source, objectives: replaceById(workspace.source.objectives, objective) }));
}

export function setHints(workspace: BuilderWorkspace, hints: readonly Scenariosourcehint[]): BrowserCommandResult<BuilderWorkspace> {
  const levels = new Set<number>();
  for (const hint of hints) {
    if (levels.has(hint.level)) return failure(workspace, diagnostic("BUILDER_HINT_LEVEL_DUPLICATE", `Hint level '${hint.level}' is duplicated.`));
    levels.add(hint.level);
  }
  return success(invalidate(workspace, { ...workspace.source, hints: cloneJson(hints) }));
}

function validateReplacementIds<T extends { readonly id: string }>(
  workspace: BuilderWorkspace,
  collection: "tests" | "findings" | "objectives" | "troubleshootingObjectives" | "notes",
  items: readonly T[],
): BrowserDiagnostic | undefined {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) return diagnostic("BUILDER_DUPLICATE_ID", `ID '${item.id}' is duplicated in ${collection}.`, item.id);
    seen.add(item.id);
  }
  const reserved = new Set<string>([
    ...workspace.source.zones.map((x) => x.id),
    ...workspace.source.resources.map((x) => x.id),
    ...workspace.source.connections.map((x) => x.id),
    ...(collection === "tests" ? [] : workspace.source.tests.map((x) => x.id)),
    ...(collection === "findings" ? [] : workspace.source.findings.map((x) => x.id)),
    ...(collection === "objectives" ? [] : workspace.source.objectives.map((x) => x.id)),
    ...(collection === "troubleshootingObjectives" ? [] : (workspace.source.troubleshootingObjectives ?? []).map((x) => x.id)),
    ...(collection === "notes" ? [] : (workspace.source.notes ?? []).map((x) => x.id)),
  ]);
  for (const item of items) {
    if (reserved.has(item.id)) return diagnostic("BUILDER_DUPLICATE_ID", `ID '${item.id}' collides with another scenario object.`, item.id);
  }
  return undefined;
}

export function replaceTests(workspace: BuilderWorkspace, tests: readonly Scenariosourcetest[]): BrowserCommandResult<BuilderWorkspace> {
  const problem = validateReplacementIds(workspace, "tests", tests);
  if (problem) return failure(workspace, problem);
  return success(invalidate(workspace, { ...workspace.source, tests: cloneJson(tests) }));
}

export function replaceFindings(workspace: BuilderWorkspace, findings: readonly Scenariosourcefinding[]): BrowserCommandResult<BuilderWorkspace> {
  const problem = validateReplacementIds(workspace, "findings", findings);
  if (problem) return failure(workspace, problem);
  return success(invalidate(workspace, { ...workspace.source, findings: cloneJson(findings) }));
}

export function replaceObjectives(workspace: BuilderWorkspace, objectives: readonly Scenariosourceobjective[]): BrowserCommandResult<BuilderWorkspace> {
  const problem = validateReplacementIds(workspace, "objectives", objectives);
  if (problem) return failure(workspace, problem);
  return success(invalidate(workspace, { ...workspace.source, objectives: cloneJson(objectives) }));
}

export function replaceTroubleshootingObjectives(workspace: BuilderWorkspace, objectives: readonly Scenariosourcetroubleshootingobjective[]): BrowserCommandResult<BuilderWorkspace> {
  const problem = validateReplacementIds(workspace, "troubleshootingObjectives", objectives);
  if (problem) return failure(workspace, problem);
  const resources = new Set(workspace.source.resources.map((item) => item.id));
  for (const objective of objectives) {
    const requirementIds = new Set<string>();
    for (const requirement of objective.requirements) {
      if (requirementIds.has(requirement.id)) return failure(workspace, diagnostic("BUILDER_TROUBLESHOOTING_REQUIREMENT_DUPLICATE", `Requirement ID '${requirement.id}' is duplicated in troubleshooting objective '${objective.id}'.`, objective.id));
      requirementIds.add(requirement.id);
      if (requirement.kind === "observation") {
        if (requirement.category === undefined && requirement.targetId === undefined && requirement.command === undefined) return failure(workspace, diagnostic("BUILDER_TROUBLESHOOTING_REQUIREMENT_EMPTY", `Observation requirement '${requirement.id}' must declare at least one matcher.`, objective.id));
        if (requirement.targetId !== undefined && !resources.has(requirement.targetId)) return failure(workspace, diagnostic("BUILDER_TROUBLESHOOTING_TARGET_UNKNOWN", `Observation requirement '${requirement.id}' references unknown target '${requirement.targetId}'.`, objective.id));
      } else {
        if (requirement.category === undefined && requirement.sourceId === undefined && requirement.destinationId === undefined && requirement.protocol === undefined && requirement.port === undefined && requirement.queryName === undefined && requirement.truth === undefined) return failure(workspace, diagnostic("BUILDER_TROUBLESHOOTING_REQUIREMENT_EMPTY", `Active-probe requirement '${requirement.id}' must declare at least one matcher.`, objective.id));
        if (requirement.sourceId !== undefined && !resources.has(requirement.sourceId)) return failure(workspace, diagnostic("BUILDER_TROUBLESHOOTING_SOURCE_UNKNOWN", `Active-probe requirement '${requirement.id}' references unknown source '${requirement.sourceId}'.`, objective.id));
        if (requirement.destinationId !== undefined && !resources.has(requirement.destinationId)) return failure(workspace, diagnostic("BUILDER_TROUBLESHOOTING_DESTINATION_UNKNOWN", `Active-probe requirement '${requirement.id}' references unknown destination '${requirement.destinationId}'.`, objective.id));
      }
    }
  }
  return success(invalidate(workspace, { ...workspace.source, troubleshootingObjectives: cloneJson(objectives) }));
}

export function replaceNotes(workspace: BuilderWorkspace, notes: readonly Scenariosourcenote[]): BrowserCommandResult<BuilderWorkspace> {
  const problem = validateReplacementIds(workspace, "notes", notes);
  if (problem) return failure(workspace, problem);
  const targets = new Set([
    ...workspace.source.zones.map((item) => item.id),
    ...workspace.source.resources.map((item) => item.id),
    ...workspace.source.connections.map((item) => item.id),
    ...workspace.source.tests.map((item) => item.id),
    ...workspace.source.findings.map((item) => item.id),
    ...workspace.source.objectives.map((item) => item.id),
  ]);
  for (const note of notes) {
    if (note.target !== undefined && !targets.has(note.target)) {
      return failure(workspace, diagnostic("BUILDER_NOTE_TARGET_UNKNOWN", `Note '${note.id}' references unknown target '${note.target}'.`, note.id));
    }
  }
  return success(invalidate(workspace, { ...workspace.source, notes: cloneJson(notes) }));
}

export function setCompletionRule(workspace: BuilderWorkspace, completion: Scenariosourcerule): BrowserCommandResult<BuilderWorkspace> {
  return success(invalidate(workspace, { ...workspace.source, completion: cloneJson(completion) }));
}

export function setCanonicalSolution(workspace: BuilderWorkspace, solution: Scenariosourcesolution | undefined): BrowserCommandResult<BuilderWorkspace> {
  const source = cloneJson(workspace.source) as ScenarioSource;
  if (solution === undefined) delete (source as { canonicalSolution?: Scenariosourcesolution }).canonicalSolution;
  else (source as { canonicalSolution?: Scenariosourcesolution }).canonicalSolution = cloneJson(solution);
  return success(invalidate(workspace, source));
}

export function setLayoutOverride(workspace: BuilderWorkspace, override: ManualLayoutOverride): BuilderWorkspace {
  const known = new Set([...workspace.source.zones.map((x) => x.id), ...workspace.source.resources.map((x) => x.id)]);
  if (!known.has(override.id)) return workspace;
  const others = workspace.layoutOverrides.filter((x) => x.id !== override.id);
  const layout = workspace.layout ? {
    ...workspace.layout,
    nodes: workspace.layout.nodes.map((node) => node.id === override.id ? {
      ...node,
      x: override.x,
      y: override.y,
      width: override.width ?? node.width,
      height: override.height ?? node.height,
      manualOverride: true,
    } : node),
  } : undefined;
  return {
    ...workspace,
    layoutOverrides: [...others, cloneJson(override)].sort((a, b) => a.id.localeCompare(b.id, "en")),
    ...(layout ? { layout } : {}),
    dirty: true,
  };
}

export function clearLayoutOverride(workspace: BuilderWorkspace, id: string): BuilderWorkspace {
  return { ...workspace, layoutOverrides: workspace.layoutOverrides.filter((x) => x.id !== id), dirty: true };
}

export async function compileBuilderWorkspace(
  workspace: BuilderWorkspace,
  options: BrowserFoundationOptions,
): Promise<BuilderWorkspace> {
  const result = await compileScenario(workspace.source, options.compilerContext);
  return result.ok
    ? { ...workspace, compile: { status: "valid", model: result.model, diagnostics: result.diagnostics } }
    : { ...workspace, compile: { status: "invalid", diagnostics: result.diagnostics } };
}

export function setMissionMetadata(
  workspace: BuilderWorkspace,
  patch: Partial<ScenarioSource["metadata"]>,
): BrowserCommandResult<BuilderWorkspace> {
  const metadata = { ...workspace.source.metadata, ...cloneJson(patch) };
  if (typeof metadata.title !== "string" || metadata.title.trim() === "") return failure(workspace, diagnostic("BUILDER_TITLE_REQUIRED", "Mission title must not be empty."));
  if (typeof metadata.language !== "string" || metadata.language.trim() === "") return failure(workspace, diagnostic("BUILDER_LANGUAGE_REQUIRED", "Mission language must not be empty."));
  return success(invalidate(workspace, { ...workspace.source, metadata }));
}

function zoneParentCreatesCycle(source: ScenarioSource, zoneId: string, parentId: string): boolean {
  const parents = new Map(source.zones.map((item) => [item.id, item.parent] as const));
  parents.set(zoneId, parentId);
  let current: string | undefined = parentId;
  const seen = new Set<string>([zoneId]);
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = parents.get(current);
  }
  return false;
}

export function replaceZone(workspace: BuilderWorkspace, zone: Scenariosourcezone): BrowserCommandResult<BuilderWorkspace> {
  const index = workspace.source.zones.findIndex((x) => x.id === zone.id);
  if (index < 0) return failure(workspace, diagnostic("BUILDER_ZONE_UNKNOWN", `Zone '${zone.id}' does not exist.`, zone.id));
  if (zone.parent === zone.id) return failure(workspace, diagnostic("BUILDER_ZONE_PARENT_SELF", `Zone '${zone.id}' cannot parent itself.`, zone.id));
  if (zone.parent && !workspace.source.zones.some((x) => x.id === zone.parent)) return failure(workspace, diagnostic("BUILDER_ZONE_PARENT_UNKNOWN", `Parent zone '${zone.parent}' does not exist.`, zone.id));
  if (zone.parent && zoneParentCreatesCycle(workspace.source, zone.id, zone.parent)) return failure(workspace, diagnostic("BUILDER_ZONE_PARENT_CYCLE", `Parent '${zone.parent}' would create a zone cycle for '${zone.id}'.`, zone.id));
  const zones = workspace.source.zones.map((x, i) => i === index ? cloneJson(zone) : cloneJson(x));
  return success(invalidate(workspace, { ...workspace.source, zones }));
}

export function replaceResource(workspace: BuilderWorkspace, resource: Scenariosourceresource): BrowserCommandResult<BuilderWorkspace> {
  const index = workspace.source.resources.findIndex((x) => x.id === resource.id);
  if (index < 0) return failure(workspace, diagnostic("BUILDER_RESOURCE_UNKNOWN", `Resource '${resource.id}' does not exist.`, resource.id));
  if (resource.zone && !workspace.source.zones.some((x) => x.id === resource.zone)) return failure(workspace, diagnostic("BUILDER_ZONE_UNKNOWN", `Resource zone '${resource.zone}' does not exist.`, resource.id));
  const resources = workspace.source.resources.map((x, i) => i === index ? cloneJson(resource) : cloneJson(x));
  return success(invalidate(workspace, { ...workspace.source, resources }));
}

function zoneDescendants(source: ScenarioSource, rootId: string): ReadonlySet<string> {
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const zone of source.zones) {
      if (zone.parent && result.has(zone.parent) && !result.has(zone.id)) {
        result.add(zone.id);
        changed = true;
      }
    }
  }
  return result;
}

export function deleteZone(workspace: BuilderWorkspace, zoneId: string, cascade = false): BrowserCommandResult<BuilderWorkspace> {
  if (!workspace.source.zones.some((x) => x.id === zoneId)) return failure(workspace, diagnostic("BUILDER_ZONE_UNKNOWN", `Zone '${zoneId}' does not exist.`, zoneId));
  const zonesToDelete = zoneDescendants(workspace.source, zoneId);
  const resourcesToDelete = new Set(workspace.source.resources.filter((x) => x.zone && zonesToDelete.has(x.zone)).map((x) => x.id));
  const hasChildren = zonesToDelete.size > 1;
  const hasResources = resourcesToDelete.size > 0;
  if ((hasChildren || hasResources) && !cascade) {
    return failure(workspace, diagnostic("BUILDER_ZONE_NOT_EMPTY", `Zone '${zoneId}' contains child zones/resources; explicit cascade is required.`, zoneId));
  }
  const source: ScenarioSource = {
    ...workspace.source,
    zones: workspace.source.zones.filter((x) => !zonesToDelete.has(x.id)),
    resources: workspace.source.resources.filter((x) => !resourcesToDelete.has(x.id)),
    connections: workspace.source.connections.filter((x) => !resourcesToDelete.has(x.from.resource) && !resourcesToDelete.has(x.to.resource)),
  };
  const removed = new Set([...zonesToDelete, ...resourcesToDelete]);
  const layoutOverrides = workspace.layoutOverrides.filter((x) => !removed.has(x.id));
  const layout = workspace.layout ? {
    ...workspace.layout,
    nodes: workspace.layout.nodes.filter((x) => !removed.has(x.id)),
  } : undefined;
  let next = invalidate({ ...workspace, layoutOverrides, ...(layout ? { layout } : {}) }, source);
  next = setBuilderSelection(next, next.selection.ids.filter((id) => !removed.has(id)));
  return success(next);
}
