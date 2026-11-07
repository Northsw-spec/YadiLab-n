export const SOURCE_FORMAT_ID = "infrastructure-cyber-lab.scenario-source" as const;
export const NORMALIZED_FORMAT_ID = "infrastructure-cyber-lab.scenario" as const;
export const CURRENT_SCENARIO_SCHEMA_VERSION = "0.1.0" as const;

export type MigratableFormatId = typeof SOURCE_FORMAT_ID | typeof NORMALIZED_FORMAT_ID;

export interface VersionedDocument {
  readonly formatId: string;
  readonly schemaVersion: string;
  readonly [key: string]: unknown;
}

export interface MigrationDiagnostic {
  readonly code:
    | "MIGRATION_DOCUMENT_INVALID"
    | "MIGRATION_FORMAT_UNSUPPORTED"
    | "MIGRATION_SCHEMA_VERSION_INVALID"
    | "MIGRATION_TARGET_UNSUPPORTED"
    | "MIGRATION_PATH_UNAVAILABLE"
    | "MIGRATION_STEP_OUTPUT_INVALID"
    | "MIGRATION_CYCLE";
  readonly message: string;
  readonly fromVersion?: string;
  readonly toVersion?: string;
}

export interface MigrationStep {
  readonly formatId: MigratableFormatId;
  readonly fromVersion: string;
  readonly toVersion: string;
  migrate(document: Readonly<Record<string, unknown>>): Record<string, unknown>;
}

export type MigrationResult =
  | {
      readonly ok: true;
      readonly document: Record<string, unknown>;
      readonly changed: boolean;
      readonly path: readonly string[];
      readonly diagnostics: readonly MigrationDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly MigrationDiagnostic[];
    };

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function clone<T>(input: T): T {
  return structuredClone(input);
}

function asFormatId(input: unknown): MigratableFormatId | undefined {
  return input === SOURCE_FORMAT_ID || input === NORMALIZED_FORMAT_ID ? input : undefined;
}

function diag(code: MigrationDiagnostic["code"], message: string, fromVersion?: string, toVersion?: string): MigrationDiagnostic {
  return {
    code,
    message,
    ...(fromVersion !== undefined ? { fromVersion } : {}),
    ...(toVersion !== undefined ? { toVersion } : {}),
  };
}

export class MigrationRegistry {
  readonly #current: ReadonlyMap<MigratableFormatId, string>;
  readonly #steps: ReadonlyMap<string, MigrationStep>;

  constructor(current: Readonly<Record<MigratableFormatId, string>>, steps: readonly MigrationStep[]) {
    this.#current = new Map(Object.entries(current) as [MigratableFormatId, string][]);
    const map = new Map<string, MigrationStep>();
    for (const [formatId, version] of this.#current) {
      if (!SEMVER.test(version)) throw new Error(`Invalid current schema version '${version}' for '${formatId}'.`);
    }
    for (const step of steps) {
      if (!SEMVER.test(step.fromVersion) || !SEMVER.test(step.toVersion)) throw new Error(`Migration step '${step.fromVersion}' -> '${step.toVersion}' must use exact semver.`);
      if (step.fromVersion === step.toVersion) throw new Error(`Migration step for '${step.formatId}' cannot target the same version.`);
      const key = `${step.formatId}@${step.fromVersion}`;
      if (map.has(key)) throw new Error(`Duplicate migration origin '${key}'.`);
      map.set(key, step);
    }
    this.#steps = map;
  }

  currentVersion(formatId: MigratableFormatId): string {
    return this.#current.get(formatId)!;
  }

  migrate(input: unknown, targetVersion?: string): MigrationResult {
    if (!isRecord(input)) return { ok: false, diagnostics: [diag("MIGRATION_DOCUMENT_INVALID", "Migration input must be a JSON object.")] };
    const formatId = asFormatId(input.formatId);
    if (!formatId) return { ok: false, diagnostics: [diag("MIGRATION_FORMAT_UNSUPPORTED", `Unsupported migration format '${String(input.formatId ?? "missing")}'.`)] };
    const sourceVersion = typeof input.schemaVersion === "string" ? input.schemaVersion : "";
    if (!SEMVER.test(sourceVersion)) return { ok: false, diagnostics: [diag("MIGRATION_SCHEMA_VERSION_INVALID", `Document schemaVersion '${sourceVersion || "missing"}' is not exact semver.`)] };
    const target = targetVersion ?? this.currentVersion(formatId);
    if (!SEMVER.test(target) || target !== this.currentVersion(formatId)) {
      return { ok: false, diagnostics: [diag("MIGRATION_TARGET_UNSUPPORTED", `Target schema '${target}' is unsupported for '${formatId}'; current target is '${this.currentVersion(formatId)}'.`, sourceVersion, target)] };
    }
    if (sourceVersion === target) return { ok: true, document: clone(input), changed: false, path: [sourceVersion], diagnostics: [] };

    let current = clone(input);
    let version = sourceVersion;
    const path = [version];
    const seen = new Set<string>();
    for (let guard = 0; guard < 64; guard += 1) {
      if (version === target) return { ok: true, document: current, changed: true, path: Object.freeze(path), diagnostics: [] };
      const key = `${formatId}@${version}`;
      if (seen.has(key)) return { ok: false, diagnostics: [diag("MIGRATION_CYCLE", `Migration path cycles at '${key}'.`, sourceVersion, target)] };
      seen.add(key);
      const step = this.#steps.get(key);
      if (!step) return { ok: false, diagnostics: [diag("MIGRATION_PATH_UNAVAILABLE", `No explicit migration path exists for '${formatId}' from '${version}' to '${target}'.`, version, target)] };
      const next = step.migrate(Object.freeze(clone(current)));
      if (!isRecord(next) || next.formatId !== formatId || next.schemaVersion !== step.toVersion) {
        return { ok: false, diagnostics: [diag("MIGRATION_STEP_OUTPUT_INVALID", `Migration '${step.fromVersion}' -> '${step.toVersion}' produced invalid format/version metadata.`, step.fromVersion, step.toVersion)] };
      }
      current = clone(next);
      version = step.toVersion;
      path.push(version);
    }
    return { ok: false, diagnostics: [diag("MIGRATION_CYCLE", "Migration exceeded the deterministic step limit.", sourceVersion, target)] };
  }
}

export const FOUNDATION_MIGRATION_REGISTRY = new MigrationRegistry(
  {
    [SOURCE_FORMAT_ID]: CURRENT_SCENARIO_SCHEMA_VERSION,
    [NORMALIZED_FORMAT_ID]: CURRENT_SCENARIO_SCHEMA_VERSION,
  },
  [],
);

export function checkCurrentSchemaVersion(input: unknown, expectedFormat: MigratableFormatId): MigrationDiagnostic | undefined {
  if (!isRecord(input) || input.formatId !== expectedFormat) return diag("MIGRATION_FORMAT_UNSUPPORTED", `Expected '${expectedFormat}' document.`);
  const version = typeof input.schemaVersion === "string" ? input.schemaVersion : "";
  if (!SEMVER.test(version)) return diag("MIGRATION_SCHEMA_VERSION_INVALID", `Document schemaVersion '${version || "missing"}' is not exact semver.`);
  if (version !== FOUNDATION_MIGRATION_REGISTRY.currentVersion(expectedFormat)) {
    return diag("MIGRATION_PATH_UNAVAILABLE", `Schema '${version}' is not current '${CURRENT_SCENARIO_SCHEMA_VERSION}'. Run an explicit migration; no silent reinterpretation is allowed.`, version, CURRENT_SCENARIO_SCHEMA_VERSION);
  }
  return undefined;
}
