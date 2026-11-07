/** Write literal JSON data keys without calling inherited magic setters. */
function setOwnData(output: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(output, key, {
    value, enumerable: true, writable: true, configurable: true,
  });
}

export function deepCloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((x) => deepCloneJson(x)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) setOwnData(out, k, deepCloneJson(v));
    }
    return out as T;
  }
  return value;
}

export function deepMergeObjects(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) setOwnData(out, k, deepCloneJson(v));
  for (const [k, v] of Object.entries(override)) {
    const current = Object.hasOwn(out, k) ? out[k] : undefined;
    if (
      current !== null && typeof current === "object" && !Array.isArray(current) &&
      v !== null && typeof v === "object" && !Array.isArray(v)
    ) {
      setOwnData(out, k, deepMergeObjects(current as Record<string, unknown>, v as Record<string, unknown>));
    } else {
      setOwnData(out, k, deepCloneJson(v));
    }
  }
  return out;
}

export function sortedUniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "en"));
}
