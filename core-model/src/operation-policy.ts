/**
 * Canonical Runtime mutation path contract shared by Compiler, Engine and
 * Builder authoring. Only runtime configuration, not resource/interface
 * identity, may be changed by generic scenario operations.
 *
 * Project-document.mjs mirrors this pure check at the native Save/Open
 * boundary, which cannot import TypeScript source directly.
 */
const forbiddenSegments = new Set(["__proto__", "prototype", "constructor"]);
const immutableInterfaceFields = new Set(["id", "name", "label", "type"]);

export function isMutableRuntimeOperationPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.trim() !== path)
    return false;
  const parts = path.split(".");
  if (parts.some((part) => !part || forbiddenSegments.has(part))) return false;

  if (parts[0] === "properties") return parts.length >= 2;
  if (parts[0] !== "interfaces" || parts.length < 3) return false;

  const index = parts[1]!;
  if (!/^(0|[1-9][0-9]*)$/.test(index) || !Number.isSafeInteger(Number(index)))
    return false;
  const field = parts[2]!;
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field) ||
      immutableInterfaceFields.has(field)) return false;
  return true;
}
