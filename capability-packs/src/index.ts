export type CapabilityExecutionMode = "engine" | "declarative";

export interface CapabilityLock {
  readonly id: string;
  readonly version: string;
}

export interface CapabilityPackRuntimeDescriptor extends CapabilityLock {
  readonly execution: CapabilityExecutionMode;
}

export interface CapabilityPackDiagnostic {
  readonly code:
    | "CAPABILITY_LOCK_DUPLICATE"
    | "CAPABILITY_PACK_UNAVAILABLE"
    | "CAPABILITY_PACK_VERSION_UNAVAILABLE";
  readonly id: string;
  readonly version: string;
  readonly message: string;
}

export interface CapabilityPackResolution {
  readonly ok: boolean;
  readonly resolved: readonly CapabilityPackRuntimeDescriptor[];
  readonly diagnostics: readonly CapabilityPackDiagnostic[];
}

const ID_PATTERN = /^[a-z][a-z0-9_.-]{0,127}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function assertDescriptor(descriptor: CapabilityPackRuntimeDescriptor): void {
  if (!ID_PATTERN.test(descriptor.id)) throw new Error(`Invalid capability pack id '${descriptor.id}'.`);
  if (!SEMVER_PATTERN.test(descriptor.version)) throw new Error(`Invalid capability pack version '${descriptor.version}'.`);
  if (descriptor.execution !== "engine" && descriptor.execution !== "declarative") {
    throw new Error(`Invalid execution mode for '${descriptor.id}@${descriptor.version}'.`);
  }
}

export class CapabilityPackRegistry {
  readonly #byId: ReadonlyMap<string, ReadonlyMap<string, CapabilityPackRuntimeDescriptor>>;
  readonly #entries: readonly CapabilityPackRuntimeDescriptor[];

  constructor(entries: readonly CapabilityPackRuntimeDescriptor[]) {
    const byId = new Map<string, Map<string, CapabilityPackRuntimeDescriptor>>();
    for (const raw of entries) {
      const descriptor = Object.freeze({ ...raw });
      assertDescriptor(descriptor);
      const versions = byId.get(descriptor.id) ?? new Map<string, CapabilityPackRuntimeDescriptor>();
      if (versions.has(descriptor.version)) {
        throw new Error(`Duplicate capability pack runtime descriptor '${descriptor.id}@${descriptor.version}'.`);
      }
      versions.set(descriptor.version, descriptor);
      byId.set(descriptor.id, versions);
    }
    this.#byId = new Map([...byId.entries()].map(([id, versions]) => [id, new Map(versions)]));
    this.#entries = Object.freeze(
      [...entries]
        .map((entry) => Object.freeze({ ...entry }))
        .sort((a, b) => a.id.localeCompare(b.id, "en") || a.version.localeCompare(b.version, "en")),
    );
  }

  entries(): readonly CapabilityPackRuntimeDescriptor[] {
    return this.#entries;
  }

  versions(id: string): readonly string[] {
    return [...(this.#byId.get(id)?.keys() ?? [])].sort((a, b) => a.localeCompare(b, "en"));
  }

  resolveExact(id: string, version: string): CapabilityPackRuntimeDescriptor | undefined {
    return this.#byId.get(id)?.get(version);
  }

  resolveLocks(locks: readonly CapabilityLock[]): CapabilityPackResolution {
    const diagnostics: CapabilityPackDiagnostic[] = [];
    const resolved: CapabilityPackRuntimeDescriptor[] = [];
    const seen = new Set<string>();

    for (const lock of locks) {
      const key = `${lock.id}@${lock.version}`;
      if (seen.has(key)) {
        diagnostics.push({
          code: "CAPABILITY_LOCK_DUPLICATE",
          id: lock.id,
          version: lock.version,
          message: `Scenario contains duplicate capability lock '${key}'.`,
        });
        continue;
      }
      seen.add(key);

      const versions = this.#byId.get(lock.id);
      if (!versions) {
        diagnostics.push({
          code: "CAPABILITY_PACK_UNAVAILABLE",
          id: lock.id,
          version: lock.version,
          message: `Required capability pack '${lock.id}@${lock.version}' is not installed in this Runtime.`,
        });
        continue;
      }
      const descriptor = versions.get(lock.version);
      if (!descriptor) {
        diagnostics.push({
          code: "CAPABILITY_PACK_VERSION_UNAVAILABLE",
          id: lock.id,
          version: lock.version,
          message: `Required capability pack '${lock.id}@${lock.version}' is unavailable; installed versions: ${[...versions.keys()].sort().join(", ") || "none"}.`,
        });
        continue;
      }
      resolved.push(descriptor);
    }

    return {
      ok: diagnostics.length === 0,
      resolved: Object.freeze(resolved),
      diagnostics: Object.freeze(diagnostics),
    };
  }
}

export const BUILTIN_CAPABILITY_PACKS = Object.freeze([
  { id: "core.network", version: "1.0.0", execution: "engine" },
  { id: "core.identity", version: "1.0.0", execution: "engine" },
  { id: "core.windows", version: "1.0.0", execution: "declarative" },
  { id: "core.linux", version: "1.0.0", execution: "declarative" },
  { id: "core.virtualization", version: "1.0.0", execution: "declarative" },
  { id: "core.security", version: "1.0.0", execution: "declarative" },
  { id: "core.logging", version: "1.0.0", execution: "declarative" },
  { id: "core.backup", version: "1.0.0", execution: "declarative" },
] satisfies readonly CapabilityPackRuntimeDescriptor[]);

export const BUILTIN_CAPABILITY_PACK_REGISTRY = new CapabilityPackRegistry(BUILTIN_CAPABILITY_PACKS);
