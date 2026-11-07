export function deepCloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepCloneJson(item)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // An own JSON "__proto__" key is data, not a request to change
      // this clone's prototype. Define an own property (no setter call).
      if (item !== undefined) Object.defineProperty(out, key, {
        value: deepCloneJson(item), enumerable: true, writable: true, configurable: true,
      });
    }
    return out as T;
  }
  return value;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value;
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    return aKeys.length === bKeys.length && aKeys.every((key, index) => key === bKeys[index] && jsonEqual(a[key], b[key]));
  }
  return false;
}
