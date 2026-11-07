import type { TruthValue } from "./types.js";

export function truthNot(value: TruthValue): TruthValue {
  if (value === "TRUE") return "FALSE";
  if (value === "FALSE") return "TRUE";
  return "UNKNOWN";
}

export function truthAll(values: readonly TruthValue[]): TruthValue {
  if (values.some((value) => value === "FALSE")) return "FALSE";
  if (values.some((value) => value === "UNKNOWN")) return "UNKNOWN";
  return "TRUE";
}

export function truthAny(values: readonly TruthValue[]): TruthValue {
  if (values.some((value) => value === "TRUE")) return "TRUE";
  if (values.some((value) => value === "UNKNOWN")) return "UNKNOWN";
  return "FALSE";
}

export function truthEquals(actual: TruthValue, expected: TruthValue): TruthValue {
  return actual === expected ? "TRUE" : "FALSE";
}
