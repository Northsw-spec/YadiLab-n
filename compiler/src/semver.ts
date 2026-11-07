export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
  readonly raw: string;
}

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemVer(input: string): SemVer | null {
  const m = SEMVER_RE.exec(input.trim());
  if (!m) return null;
  const prerelease = m[4]
    ? m[4].split(".").map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part))
    : [];
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease,
    raw: input.trim(),
  };
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const n = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < n; i += 1) {
    const av = a.prerelease[i];
    const bv = b.prerelease[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    if (typeof av === "number" && typeof bv === "string") return -1;
    if (typeof av === "string" && typeof bv === "number") return 1;
    return av < bv ? -1 : 1;
  }
  return 0;
}

interface Comparator {
  readonly op: ">" | ">=" | "<" | "<=" | "=";
  readonly version: SemVer;
}

function partialVersion(input: string): { major: number; minor?: number; patch?: number } | null {
  const parts = input.trim().split(".");
  if (parts.length < 1 || parts.length > 3) return null;
  if (!parts.every((x) => /^\d+$/.test(x))) return null;
  const nums = parts.map(Number);
  return { major: nums[0]!, ...(nums[1] !== undefined ? { minor: nums[1] } : {}), ...(nums[2] !== undefined ? { patch: nums[2] } : {}) };
}

function completePartial(input: string): SemVer | null {
  const p = partialVersion(input);
  if (!p) return null;
  return parseSemVer(`${p.major}.${p.minor ?? 0}.${p.patch ?? 0}`);
}

function comparatorPass(version: SemVer, comparator: Comparator): boolean {
  const c = compareSemVer(version, comparator.version);
  switch (comparator.op) {
    case ">": return c > 0;
    case ">=": return c >= 0;
    case "<": return c < 0;
    case "<=": return c <= 0;
    case "=": return c === 0;
  }
}

function wildcardComparators(range: string): Comparator[] | null {
  const r = range.trim();
  if (r === "*" || /^x$/i.test(r)) return [];
  const m = /^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i.exec(r);
  if (!m) return null;
  const major = Number(m[1]);
  const minorToken = m[2];
  const patchToken = m[3];
  if (minorToken === undefined || /^x|\*$/i.test(minorToken)) {
    return [
      { op: ">=", version: parseSemVer(`${major}.0.0`)! },
      { op: "<", version: parseSemVer(`${major + 1}.0.0`)! },
    ];
  }
  const minor = Number(minorToken);
  if (patchToken === undefined || /^x|\*$/i.test(patchToken)) {
    return [
      { op: ">=", version: parseSemVer(`${major}.${minor}.0`)! },
      { op: "<", version: parseSemVer(`${major}.${minor + 1}.0`)! },
    ];
  }
  const exact = parseSemVer(`${major}.${minor}.${Number(patchToken)}`);
  return exact ? [{ op: "=", version: exact }] : null;
}

function caretComparators(raw: string): Comparator[] | null {
  const base = completePartial(raw);
  if (!base) return null;
  let upper: SemVer;
  if (base.major > 0) upper = parseSemVer(`${base.major + 1}.0.0`)!;
  else if (base.minor > 0) upper = parseSemVer(`0.${base.minor + 1}.0`)!;
  else upper = parseSemVer(`0.0.${base.patch + 1}`)!;
  return [{ op: ">=", version: base }, { op: "<", version: upper }];
}

function tildeComparators(raw: string): Comparator[] | null {
  const p = partialVersion(raw);
  if (!p) return null;
  const base = parseSemVer(`${p.major}.${p.minor ?? 0}.${p.patch ?? 0}`)!;
  const upper = p.minor === undefined
    ? parseSemVer(`${p.major + 1}.0.0`)! 
    : parseSemVer(`${p.major}.${p.minor + 1}.0`)!;
  return [{ op: ">=", version: base }, { op: "<", version: upper }];
}

function parseComparatorSet(range: string): Comparator[] | null {
  const trimmed = range.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("^")) return caretComparators(trimmed.slice(1));
  if (trimmed.startsWith("~")) return tildeComparators(trimmed.slice(1));

  const wildcard = wildcardComparators(trimmed);
  if (wildcard) return wildcard;

  const exact = parseSemVer(trimmed);
  if (exact) return [{ op: "=", version: exact }];

  const tokens = trimmed.split(/\s+/);
  const comparators: Comparator[] = [];
  for (const token of tokens) {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(token);
    if (!m) return null;
    const op = (m[1] ?? "=") as Comparator["op"];
    const v = completePartial(m[2]!);
    if (!v) return null;
    comparators.push({ op, version: v });
  }
  return comparators;
}

export function isSupportedRange(range: string): boolean {
  return parseComparatorSet(range) !== null;
}

export function satisfiesSemVer(version: string, range: string): boolean {
  const v = parseSemVer(version);
  const comparators = parseComparatorSet(range);
  if (!v || !comparators) return false;
  return comparators.every((c) => comparatorPass(v, c));
}

export function highestSatisfying(versions: readonly string[], range: string): string | null {
  const parsed = versions
    .map((raw) => ({ raw, parsed: parseSemVer(raw) }))
    .filter((x): x is { raw: string; parsed: SemVer } => x.parsed !== null)
    .filter((x) => satisfiesSemVer(x.raw, range))
    .sort((a, b) => compareSemVer(b.parsed, a.parsed));
  return parsed[0]?.raw ?? null;
}

export function maxSemVer(versions: readonly string[]): string | null {
  const parsed = versions
    .map((raw) => ({ raw, parsed: parseSemVer(raw) }))
    .filter((x): x is { raw: string; parsed: SemVer } => x.parsed !== null)
    .sort((a, b) => compareSemVer(b.parsed, a.parsed));
  return parsed[0]?.raw ?? null;
}
