import type { ImportDiagnostic, ImportDocument } from "./types.js";

export type ReconciliationStatus = "READY" | "REVIEW" | "BLOCKED";
export interface ReconciliationGroup { readonly key: string; readonly code: string; readonly severity: ImportDiagnostic["severity"]; readonly table?: string; readonly field?: string; readonly count: number; readonly rows: readonly number[]; readonly messages: readonly string[]; }
export interface ReconciliationSummary { readonly status: ReconciliationStatus; readonly total: number; readonly errors: number; readonly warnings: number; readonly infos: number; readonly groups: readonly ReconciliationGroup[]; readonly sheets: readonly string[]; }

const keyOf = (d: ImportDiagnostic): string => [d.severity, d.code, d.table ?? "", d.field ?? ""].join("|");
export function summarizeReconciliation(document: ImportDocument, diagnostics: readonly ImportDiagnostic[]): ReconciliationSummary {
  const grouped = new Map<string, { diagnostic: ImportDiagnostic; rows: number[]; messages: string[] }>();
  for (const diagnostic of diagnostics) { const key = keyOf(diagnostic); const current = grouped.get(key) ?? { diagnostic, rows: [], messages: [] }; if (diagnostic.row !== undefined) current.rows.push(diagnostic.row); current.messages.push(diagnostic.message); grouped.set(key, current); }
  const groups = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, code: value.diagnostic.code, severity: value.diagnostic.severity, ...(value.diagnostic.table ? { table: value.diagnostic.table } : {}), ...(value.diagnostic.field ? { field: value.diagnostic.field } : {}), count: value.rows.length || value.messages.length, rows: [...new Set(value.rows)].sort((a, b) => a - b), messages: [...new Set(value.messages)] }));
  const errors = diagnostics.filter((x) => x.severity === "error").length; const warnings = diagnostics.filter((x) => x.severity === "warning").length; const infos = diagnostics.filter((x) => x.severity === "info").length;
  return { status: errors ? "BLOCKED" : warnings ? "REVIEW" : "READY", total: diagnostics.length, errors, warnings, infos, groups, sheets: document.tables.map((x) => x.tableId) };
}

export function searchReconciliation(summary: ReconciliationSummary, query: string): readonly ReconciliationGroup[] {
  const needle = query.trim().toLocaleLowerCase(); if (!needle) return summary.groups;
  return summary.groups.filter((group) => [group.key, group.code, group.table, group.field, ...group.messages].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle));
}

export function resolveReconciliationGroup(summary: ReconciliationSummary, key: string): ReconciliationSummary {
  const groups = summary.groups.filter((group) => group.key !== key); const errors = groups.filter((x) => x.severity === "error").reduce((n, x) => n + x.count, 0); const warnings = groups.filter((x) => x.severity === "warning").reduce((n, x) => n + x.count, 0); const infos = groups.filter((x) => x.severity === "info").reduce((n, x) => n + x.count, 0);
  return { ...summary, status: errors ? "BLOCKED" : warnings ? "REVIEW" : "READY", total: errors + warnings + infos, errors, warnings, infos, groups };
}
