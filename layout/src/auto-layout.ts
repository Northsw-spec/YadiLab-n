import type { LayoutDocument, NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { buildLayoutGraph } from "./projection.js";
import type { AutoLayoutOptions, AutoLayoutResult, LayoutBackendNode } from "./types.js";
import { validateBackendResult } from "./validation.js";
import { validateVisualLayout } from "./visual-validation.js";
import type { LayoutBackend } from "./types.js";

export async function runAutoLayout(
  scenario: NormalizedScenario,
  backend: LayoutBackend,
  options: AutoLayoutOptions = {},
): Promise<AutoLayoutResult> {
  const graph = buildLayoutGraph(scenario);
  let raw;
  try {
    raw = await backend.layout(graph);
  } catch (cause) {
    return { ok: false, diagnostics: [{ severity: "error", code: "LAYOUT_BACKEND_FAILED", message: cause instanceof Error ? cause.message : String(cause) }] };
  }
  const diagnostics = [...validateBackendResult(graph, raw.nodes)];
  if (diagnostics.some((d) => d.severity === "error")) return { ok: false, diagnostics };

  const overrides = new Map((options.manualOverrides ?? []).map((x) => [x.id, x] as const));
  const known = new Set(raw.nodes.map((x) => x.id));
  for (const override of overrides.values()) {
    if (!known.has(override.id)) diagnostics.push({ severity: "warning", code: "LAYOUT_OVERRIDE_UNKNOWN", objectId: override.id, message: `Manual override '${override.id}' has no semantic/layout node and was ignored.` });
  }

  const nodes: LayoutBackendNode[] = raw.nodes.map((node) => {
    const o = overrides.get(node.id);
    return o ? {
      ...node,
      x: o.x,
      y: o.y,
      width: o.width ?? node.width,
      height: o.height ?? node.height,
    } : node;
  });

  const document: LayoutDocument = {
    formatId: "infrastructure-cyber-lab.layout",
    schemaVersion: options.schemaVersion ?? "0.1.0",
    scenarioId: scenario.scenarioId,
    engine: "elk.layered",
    nodes: nodes
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((node) => ({
        id: node.id,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        ...(node.parent ? { parent: node.parent } : {}),
        ...(overrides.has(node.id) ? { manualOverride: true } : {}),
      })),
  };
  diagnostics.push(...validateVisualLayout(scenario, document));
  if (diagnostics.some((d) => d.severity === "error")) return { ok: false, diagnostics };
  return { ok: true, document, diagnostics };
}
