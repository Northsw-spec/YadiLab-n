import { deepCloneJson, isRecord } from "./json.js";

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export interface PathReadResult {
  readonly found: boolean;
  readonly value?: unknown;
  readonly reason?: string;
}

export interface PathWriteSuccess {
  readonly ok: true;
  readonly value: Readonly<Record<string, unknown>>;
}

export interface PathWriteFailure {
  readonly ok: false;
  readonly reason: string;
}

export type PathWriteResult = PathWriteSuccess | PathWriteFailure;

function parsePath(path: string): readonly string[] | undefined {
  if (path.trim() !== path || path.length === 0) return undefined;
  const segments = path.split(".");
  if (segments.some((segment) => segment.length === 0 || FORBIDDEN_SEGMENTS.has(segment))) return undefined;
  return segments;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function getChild(container: unknown, segment: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  if (Array.isArray(container)) {
    if (!/^(0|[1-9][0-9]*)$/.test(segment)) return { ok: false };
    const index = Number(segment);
    if (!Number.isSafeInteger(index) || index < 0 || index >= container.length) return { ok: false };
    return { ok: true, value: container[index] };
  }
  if (isRecord(container)) {
    if (!hasOwn(container, segment)) return { ok: false };
    return { ok: true, value: container[segment] };
  }
  return { ok: false };
}

export function readPath(root: unknown, path: string): PathReadResult {
  const segments = parsePath(path);
  if (!segments) return { found: false, reason: "invalid path" };
  let current = root;
  for (const segment of segments) {
    const child = getChild(current, segment);
    if (!child.ok) return { found: false, reason: `missing segment '${segment}'` };
    current = child.value;
  }
  return { found: true, value: current };
}

function mutateAtPath(
  root: Readonly<Record<string, unknown>>,
  path: string,
  mode: "set" | "remove",
  newValue?: unknown,
): PathWriteResult {
  const segments = parsePath(path);
  if (!segments) return { ok: false, reason: "Path is empty, malformed, or contains a forbidden segment." };

  const clone = deepCloneJson(root) as Record<string, unknown>;
  let current: unknown = clone;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]!;
    const child = getChild(current, segment);
    if (!child.ok) return { ok: false, reason: `Intermediate path segment '${segment}' does not exist.` };
    current = child.value;
  }

  const finalSegment = segments[segments.length - 1]!;
  if (Array.isArray(current)) {
    if (!/^(0|[1-9][0-9]*)$/.test(finalSegment)) return { ok: false, reason: `Array path segment '${finalSegment}' is not a valid index.` };
    const index = Number(finalSegment);
    if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) return { ok: false, reason: `Array index '${finalSegment}' is outside the declared state.` };
    if (mode === "set") current[index] = deepCloneJson(newValue);
    else current.splice(index, 1);
    return { ok: true, value: clone };
  }

  if (!isRecord(current)) return { ok: false, reason: "Parent path is not an object or array." };
  const mutable = current as Record<string, unknown>;
  if (mode === "remove" && !hasOwn(mutable, finalSegment)) return { ok: false, reason: `Path '${path}' does not exist.` };
  if (mode === "set") mutable[finalSegment] = deepCloneJson(newValue);
  else delete mutable[finalSegment];
  return { ok: true, value: clone };
}

export function setPath(root: Readonly<Record<string, unknown>>, path: string, value: unknown): PathWriteResult {
  return mutateAtPath(root, path, "set", value);
}

export function removePath(root: Readonly<Record<string, unknown>>, path: string): PathWriteResult {
  return mutateAtPath(root, path, "remove");
}
