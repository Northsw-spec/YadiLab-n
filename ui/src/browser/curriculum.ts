import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import type { BrowserDiagnostic } from "./types.js";

export const GUIDED_CURRICULUM_FORMAT_ID = "infrastructure-cyber-lab.curriculum" as const;
export const GUIDED_CURRICULUM_VERSION = "0.1.0" as const;
export const GUIDED_CURRICULUM_BOUNDARY = "LEARNER_VISIBLE_NO_SOLUTION" as const;

export type GuidedLabPlatform = "windows" | "linux";
export type GuidedLabFocus = "routing" | "dns" | "firewall" | "service";

export interface GuidedLabDifficulty {
  readonly layers: number;
  readonly dependencyDepth: number;
  readonly evidenceVisibility: number;
  readonly remediationConstraints: number;
}

export interface GuidedLabManifestEntry {
  readonly id: string;
  readonly scenarioId: string;
  readonly path: string;
  readonly title: string;
  readonly platform: GuidedLabPlatform;
  readonly focus: GuidedLabFocus;
  readonly summary: string;
  readonly sequence: number;
  readonly difficulty: GuidedLabDifficulty;
}

export interface GuidedLabManifest {
  readonly formatId: typeof GUIDED_CURRICULUM_FORMAT_ID;
  readonly schemaVersion: typeof GUIDED_CURRICULUM_VERSION;
  readonly waveId: string;
  readonly title: string;
  readonly description: string;
  readonly labs: readonly GuidedLabManifestEntry[];
}

export interface GuidedLabCatalogEntry extends GuidedLabManifestEntry {
  readonly boundary: typeof GUIDED_CURRICULUM_BOUNDARY;
  readonly source: ScenarioSource;
}

export interface GuidedLabCatalogResult {
  readonly ok: boolean;
  readonly waveId?: string;
  readonly title?: string;
  readonly description?: string;
  readonly labs: readonly GuidedLabCatalogEntry[];
  readonly diagnostics: readonly BrowserDiagnostic[];
}

function error(code: string, message: string): BrowserDiagnostic { return { severity: "error", code, message }; }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function validId(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9_]{1,63}$/.test(value); }
function validPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("curriculum/builtin/wave1/") && value.endsWith(".json") && !value.includes("..") && !value.includes("\\");
}
function validDifficulty(value: unknown): value is GuidedLabDifficulty {
  if (!isRecord(value)) return false;
  const keys = ["layers", "dependencyDepth", "evidenceVisibility", "remediationConstraints"] as const;
  if (Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) return false;
  return keys.every((key) => Number.isInteger(value[key]) && Number(value[key]) >= 0 && Number(value[key]) <= 4);
}

export function buildGuidedLabCatalog(
  manifestInput: unknown,
  sourcesByPath: Readonly<Record<string, ScenarioSource>>,
): GuidedLabCatalogResult {
  const diagnostics: BrowserDiagnostic[] = [];
  if (!isRecord(manifestInput)) return { ok: false, labs: [], diagnostics: [error("CURRICULUM_MANIFEST_INVALID", "Built-in curriculum manifest must be an object.")] };
  if (manifestInput.formatId !== GUIDED_CURRICULUM_FORMAT_ID) diagnostics.push(error("CURRICULUM_FORMAT_INVALID", `Unsupported curriculum format '${String(manifestInput.formatId)}'.`));
  if (manifestInput.schemaVersion !== GUIDED_CURRICULUM_VERSION) diagnostics.push(error("CURRICULUM_VERSION_INVALID", `Unsupported curriculum version '${String(manifestInput.schemaVersion)}'.`));
  if (!validId(manifestInput.waveId)) diagnostics.push(error("CURRICULUM_WAVE_ID_INVALID", "Curriculum waveId must be a stable lowercase ID."));
  if (typeof manifestInput.title !== "string" || !manifestInput.title.trim()) diagnostics.push(error("CURRICULUM_TITLE_INVALID", "Curriculum title must be non-empty."));
  if (typeof manifestInput.description !== "string" || !manifestInput.description.trim()) diagnostics.push(error("CURRICULUM_DESCRIPTION_INVALID", "Curriculum description must be non-empty."));
  if (!Array.isArray(manifestInput.labs) || manifestInput.labs.length < 1 || manifestInput.labs.length > 32) diagnostics.push(error("CURRICULUM_LABS_INVALID", "Curriculum must contain 1-32 guided labs."));
  if (diagnostics.length || !Array.isArray(manifestInput.labs)) return { ok: false, labs: [], diagnostics };

  const ids = new Set<string>();
  const paths = new Set<string>();
  const sequences = new Set<number>();
  const labs: GuidedLabCatalogEntry[] = [];
  for (const [index, raw] of manifestInput.labs.entries()) {
    const base = `labs[${index}]`;
    if (!isRecord(raw)) { diagnostics.push(error("CURRICULUM_LAB_INVALID", `${base} must be an object.`)); continue; }
    const allowed = new Set(["id","scenarioId","path","title","platform","focus","summary","sequence","difficulty"]);
    const extra = Object.keys(raw).filter((key) => !allowed.has(key));
    if (extra.length) diagnostics.push(error("CURRICULUM_LAB_EXTRA_FIELD", `${base} contains unsupported learner-visible field(s): ${extra.join(", ")}.`));
    if (!validId(raw.id) || !validId(raw.scenarioId) || raw.id !== raw.scenarioId) diagnostics.push(error("CURRICULUM_LAB_ID_INVALID", `${base} id/scenarioId must be identical stable IDs.`));
    if (typeof raw.id === "string" && ids.has(raw.id)) diagnostics.push(error("CURRICULUM_LAB_DUPLICATE_ID", `Duplicate guided lab '${raw.id}'.`));
    if (typeof raw.id === "string") ids.add(raw.id);
    if (!validPath(raw.path)) diagnostics.push(error("CURRICULUM_LAB_PATH_INVALID", `${base}.path must stay inside curriculum/builtin/wave1.`));
    if (typeof raw.path === "string" && paths.has(raw.path)) diagnostics.push(error("CURRICULUM_LAB_DUPLICATE_PATH", `Duplicate guided lab path '${raw.path}'.`));
    if (typeof raw.path === "string") paths.add(raw.path);
    if (raw.platform !== "windows" && raw.platform !== "linux") diagnostics.push(error("CURRICULUM_LAB_PLATFORM_INVALID", `${base}.platform must be windows or linux.`));
    if (!["routing","dns","firewall","service"].includes(String(raw.focus))) diagnostics.push(error("CURRICULUM_LAB_FOCUS_INVALID", `${base}.focus is unsupported.`));
    if (typeof raw.title !== "string" || !raw.title.trim() || typeof raw.summary !== "string" || !raw.summary.trim()) diagnostics.push(error("CURRICULUM_LAB_TEXT_INVALID", `${base} title/summary must be non-empty.`));
    if (!Number.isInteger(raw.sequence) || Number(raw.sequence) < 1) diagnostics.push(error("CURRICULUM_LAB_SEQUENCE_INVALID", `${base}.sequence must be a positive integer.`));
    if (typeof raw.sequence === "number" && sequences.has(raw.sequence)) diagnostics.push(error("CURRICULUM_LAB_DUPLICATE_SEQUENCE", `Duplicate curriculum sequence '${raw.sequence}'.`));
    if (typeof raw.sequence === "number") sequences.add(raw.sequence);
    if (!validDifficulty(raw.difficulty)) diagnostics.push(error("CURRICULUM_LAB_DIFFICULTY_INVALID", `${base}.difficulty must use the four transparent 0..4 dimensions only.`));

    const path = typeof raw.path === "string" ? raw.path : "";
    const source = sourcesByPath[path];
    if (!source) { diagnostics.push(error("CURRICULUM_LAB_SOURCE_MISSING", `No built-in source is registered for '${path}'.`)); continue; }
    if (source.scenarioId !== raw.scenarioId) diagnostics.push(error("CURRICULUM_LAB_SOURCE_ID_MISMATCH", `Manifest scenario '${String(raw.scenarioId)}' does not match source '${source.scenarioId}'.`));
    if (source.metadata.title !== raw.title) diagnostics.push(error("CURRICULUM_LAB_SOURCE_TITLE_MISMATCH", `Manifest title for '${source.scenarioId}' does not match scenario metadata title.`));
    if (!source.troubleshootingObjectives?.length) diagnostics.push(error("CURRICULUM_LAB_EVIDENCE_REQUIRED", `Guided lab '${source.scenarioId}' must define learner-visible troubleshootingObjectives.`));
    if (!source.canonicalSolution?.operations?.length) diagnostics.push(error("CURRICULUM_LAB_VERIFICATION_SOLUTION_REQUIRED", `Guided lab '${source.scenarioId}' must retain hidden canonical verification operations for deterministic authoring/acceptance.`));

    if (validId(raw.id) && validId(raw.scenarioId) && raw.id === raw.scenarioId && validPath(raw.path) && (raw.platform === "windows" || raw.platform === "linux") && ["routing","dns","firewall","service"].includes(String(raw.focus)) && typeof raw.title === "string" && typeof raw.summary === "string" && Number.isInteger(raw.sequence) && validDifficulty(raw.difficulty) && source.scenarioId === raw.scenarioId && source.metadata.title === raw.title) {
      labs.push({
        id: raw.id,
        scenarioId: raw.scenarioId,
        path: raw.path,
        title: raw.title,
        platform: raw.platform,
        focus: raw.focus as GuidedLabFocus,
        summary: raw.summary,
        sequence: raw.sequence as number,
        difficulty: clone(raw.difficulty),
        boundary: GUIDED_CURRICULUM_BOUNDARY,
        source: clone(source),
      });
    }
  }
  labs.sort((a,b)=>a.sequence-b.sequence || a.id.localeCompare(b.id,"en"));
  return {
    ok: diagnostics.length === 0,
    ...(typeof manifestInput.waveId === "string" ? { waveId: manifestInput.waveId } : {}),
    ...(typeof manifestInput.title === "string" ? { title: manifestInput.title } : {}),
    ...(typeof manifestInput.description === "string" ? { description: manifestInput.description } : {}),
    labs,
    diagnostics,
  };
}

export function cloneGuidedLabSource(entry: GuidedLabCatalogEntry): ScenarioSource { return clone(entry.source); }
