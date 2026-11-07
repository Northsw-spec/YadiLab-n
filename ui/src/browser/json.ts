export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePath(path: string): readonly (string | number)[] | undefined {
  if (!path || path.startsWith(".") || path.endsWith(".")) return undefined;
  const parts = path.split(".");
  const result: (string | number)[] = [];
  for (const part of parts) {
    if (!part) return undefined;
    if (/^(0|[1-9][0-9]*)$/.test(part)) result.push(Number(part));
    else if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(part)) result.push(part);
    else return undefined;
  }
  return result;
}

export interface JsonWriteResult<T> {
  readonly ok: boolean;
  readonly value: T;
  readonly reason?: string;
}

export function setJsonPath<T>(input: T, path: string, value: unknown): JsonWriteResult<T> {
  const segments = parsePath(path);
  if (!segments) return { ok: false, value: input, reason: `Invalid path '${path}'.` };
  const root = cloneJson(input) as unknown;
  let cursor: unknown = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]!;
    const next = segments[i + 1]!;
    if (typeof segment === "number") {
      if (!Array.isArray(cursor) || segment >= cursor.length) return { ok: false, value: input, reason: `Path '${path}' does not exist.` };
      cursor = cursor[segment];
    } else {
      if (!isPlainObject(cursor) || !(segment in cursor)) return { ok: false, value: input, reason: `Path '${path}' does not exist.` };
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    if (cursor === undefined || cursor === null) return { ok: false, value: input, reason: `Path '${path}' does not exist.` };
    if (typeof next === "number" && !Array.isArray(cursor)) return { ok: false, value: input, reason: `Path '${path}' expects an array.` };
  }

  const last = segments[segments.length - 1]!;
  if (typeof last === "number") {
    if (!Array.isArray(cursor) || last >= cursor.length) return { ok: false, value: input, reason: `Path '${path}' does not exist.` };
    cursor[last] = cloneJson(value);
  } else {
    if (!isPlainObject(cursor)) return { ok: false, value: input, reason: `Path '${path}' does not target an object.` };
    (cursor as Record<string, unknown>)[last] = cloneJson(value);
  }
  return { ok: true, value: root as T };
}
