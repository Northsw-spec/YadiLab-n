/**
 * YadiLab — original project source.
 * Copyright © 2026 Daniel Ölund. All rights reserved.
 * Original author and copyright holder: Daniel Ölund.
 * No license is granted for commercial use, redistribution, or creation of
 * derivative works without prior written permission.
 * Third-party components retain their separate licenses; see THIRD_PARTY_NOTICES.md.
 */

import type { LayoutDocument, NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { projectScenarioToCanvas } from "../../ui/src/canvas/projection.js";
import type { CanvasNode, CanvasProjectionDiagnostic } from "../../ui/src/canvas/types.js";

export interface RenderDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly objectId?: string;
}

export type SvgRenderResult =
  | {
      readonly ok: true;
      readonly svg: string;
      readonly width: number;
      readonly height: number;
      readonly diagnostics: readonly RenderDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly RenderDiagnostic[];
    };

interface AbsoluteNode {
  readonly node: CanvasNode;
  readonly x: number;
  readonly y: number;
}

const MARGIN = 40;
const HEADER = 48;

function esc(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function diagnosticFromCanvas(input: CanvasProjectionDiagnostic): RenderDiagnostic {
  return {
    code: input.code,
    message: input.message,
    ...(input.objectId !== undefined ? { objectId: input.objectId } : {}),
  };
}

function finiteNode(node: CanvasNode): RenderDiagnostic | undefined {
  const values = [node.position.x, node.position.y, node.width, node.height];
  if (!values.every(Number.isFinite) || node.width <= 0 || node.height <= 0) {
    return { code: "RENDER_NODE_GEOMETRY_INVALID", objectId: node.id, message: `Node '${node.id}' has invalid render geometry.` };
  }
  return undefined;
}

function absoluteNodes(nodes: readonly CanvasNode[]): { readonly ok: true; readonly nodes: readonly AbsoluteNode[] } | { readonly ok: false; readonly diagnostics: readonly RenderDiagnostic[] } {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const cache = new Map<string, { x: number; y: number }>();
  const diagnostics: RenderDiagnostic[] = [];

  const positionOf = (id: string, stack: ReadonlySet<string> = new Set()): { x: number; y: number } | undefined => {
    const cached = cache.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node) return undefined;
    if (stack.has(id)) {
      diagnostics.push({ code: "RENDER_PARENT_CYCLE", objectId: id, message: `Canvas parent chain cycles at '${id}'.` });
      return undefined;
    }
    const nextStack = new Set(stack); nextStack.add(id);
    const parent = node.parentId ? positionOf(node.parentId, nextStack) : { x: 0, y: 0 };
    if (!parent) {
      diagnostics.push({ code: "RENDER_PARENT_MISSING", objectId: id, message: `Node '${id}' has unresolved parent '${node.parentId ?? "unknown"}'.` });
      return undefined;
    }
    const point = { x: parent.x + node.position.x, y: parent.y + node.position.y };
    cache.set(id, point);
    return point;
  };

  const result: AbsoluteNode[] = [];
  for (const node of nodes) {
    const invalid = finiteNode(node);
    if (invalid) diagnostics.push(invalid);
    if (node.layoutStatus !== "resolved") diagnostics.push({ code: "RENDER_LAYOUT_REQUIRED", objectId: node.id, message: `Node '${node.id}' has no resolved layout.` });
    const point = positionOf(node.id);
    if (point) result.push({ node, ...point });
  }
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, nodes: result };
}

function center(item: AbsoluteNode): { x: number; y: number } {
  return { x: item.x + item.node.width / 2, y: item.y + item.node.height / 2 };
}

export function renderScenarioSvg(scenario: NormalizedScenario, layout: LayoutDocument): SvgRenderResult {
  const projection = projectScenarioToCanvas(scenario, layout);
  const projectionErrors = projection.diagnostics.filter((d) => d.severity === "error").map(diagnosticFromCanvas);
  if (projectionErrors.length) return { ok: false, diagnostics: projectionErrors };

  const resolved = absoluteNodes(projection.nodes);
  if (!resolved.ok) return resolved;
  const abs = resolved.nodes;
  const byId = new Map(abs.map((item) => [item.node.id, item] as const));
  const minX = Math.min(0, ...abs.map((x) => x.x));
  const minY = Math.min(0, ...abs.map((x) => x.y));
  const maxX = Math.max(640, ...abs.map((x) => x.x + x.node.width));
  const maxY = Math.max(360, ...abs.map((x) => x.y + x.node.height));
  const width = Math.ceil(maxX - minX + MARGIN * 2);
  const height = Math.ceil(maxY - minY + MARGIN * 2 + HEADER);
  const ox = MARGIN - minX;
  const oy = MARGIN + HEADER - minY;

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(scenario.metadata.title)}">`);
  lines.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  lines.push(`<text x="${MARGIN}" y="32" font-family="sans-serif" font-size="20" font-weight="600">${esc(scenario.metadata.title)}</text>`);

  for (const item of abs.filter((x) => x.node.type === "zone").sort((a, b) => a.node.id.localeCompare(b.node.id, "en"))) {
    const x = item.x + ox, y = item.y + oy;
    lines.push(`<g data-kind="zone" data-id="${esc(item.node.id)}">`);
    lines.push(`<rect x="${x}" y="${y}" width="${item.node.width}" height="${item.node.height}" rx="12" fill="#f7f7f7" stroke="#7a7a7a" stroke-width="1.5"/>`);
    lines.push(`<text x="${x + 12}" y="${y + 24}" font-family="sans-serif" font-size="14" font-weight="600">${esc(item.node.data.label)}</text>`);
    lines.push(`</g>`);
  }

  for (const edge of [...projection.edges].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    const from = byId.get(edge.source), to = byId.get(edge.target);
    if (!from || !to) return { ok: false, diagnostics: [{ code: "RENDER_EDGE_ENDPOINT_MISSING", objectId: edge.id, message: `Edge '${edge.id}' has an unresolved endpoint.` }] };
    const a = center(from), b = center(to);
    lines.push(`<g data-kind="edge" data-id="${esc(edge.id)}">`);
    lines.push(`<line x1="${a.x + ox}" y1="${a.y + oy}" x2="${b.x + ox}" y2="${b.y + oy}" stroke="#555555" stroke-width="2"/>`);
    lines.push(`<title>${esc(edge.data.connectionKind)}</title>`);
    lines.push(`</g>`);
  }

  for (const item of abs.filter((x) => x.node.type === "resource").sort((a, b) => a.node.id.localeCompare(b.node.id, "en"))) {
    const x = item.x + ox, y = item.y + oy;
    const data = item.node.data.semanticKind === "resource" ? item.node.data : undefined;
    if (!data) continue;
    lines.push(`<g data-kind="resource" data-id="${esc(item.node.id)}">`);
    lines.push(`<rect x="${x}" y="${y}" width="${item.node.width}" height="${item.node.height}" rx="8" fill="#ffffff" stroke="#222222" stroke-width="2"/>`);
    lines.push(`<text x="${x + 12}" y="${y + 28}" font-family="sans-serif" font-size="14" font-weight="600">${esc(data.label)}</text>`);
    lines.push(`<text x="${x + 12}" y="${y + 50}" font-family="monospace" font-size="11">${esc(data.resourceType)}</text>`);
    lines.push(`</g>`);
  }
  lines.push(`</svg>`);
  return { ok: true, svg: `${lines.join("\n")}\n`, width, height, diagnostics: projection.diagnostics.filter((d) => d.severity === "warning").map(diagnosticFromCanvas) };
}
