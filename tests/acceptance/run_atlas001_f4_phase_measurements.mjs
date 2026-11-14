#!/usr/bin/env node
/**
 * Measure the existing import/compile/layout pipeline without changing it.
 *
 * The inline ELK backend is intentionally exercised only for the bounded
 * controls (50/49, 100/99 and 200-grid).  The dense 100/800 and 200/1600
 * cases are measured through graph construction only; invoking the current
 * non-cancellable backend on those cases would recreate the known hang.  Such
 * cells are recorded explicitly as NOT_RUN_SAFE_BOUNDARY, never estimated.
 */

import fs from "node:fs";
import os from "node:os";
import process from "node:process";
import { performance } from "node:perf_hooks";

import {
  createXlsxImportAdapter,
  mapNetworkWorkbookToScenario,
  normalizeNetworkInventoryDocument,
} from "../../dist-enterprise-import-test/enterprise-import/src/index.js";
import { nodeZipArchiveBackend } from "../enterprise-import/node_zip_backend.mjs";
import { compileScenario } from "../../dist-compiler-test/compiler/src/index.js";
import {
  buildLayoutGraph,
  ElkLayoutBackend,
  validateBackendEdges,
  validateBackendPorts,
  validateBackendResult,
  validateVisualLayout,
} from "../../dist-layout-test/layout/src/index.js";
import { projectScenarioToCanvas } from "../../dist-canvas-test/ui/src/canvas/projection.js";
import { compactNormalTopologyProjection } from "../../dist-canvas-test/ui/src/canvas/normal-topology.js";

const root = process.cwd();
const outputPath = process.argv[2] ?? "evidence/atlas001-f4/ATLAS001_F4_PHASE_MEASUREMENTS.json";
const normalManifestPath = "tests/fixtures/import/atlas001-normal-density-manifest.json";
const capacityManifestPath = "tests/fixtures/import/atlas001-capacity-manifest.json";
const normalManifest = JSON.parse(fs.readFileSync(normalManifestPath, "utf8"));
const capacityManifest = JSON.parse(fs.readFileSync(capacityManifestPath, "utf8"));
const cases = [
  ...normalManifest.cases.map(item => ({ ...item, manifest: normalManifestPath })),
  ...capacityManifest.cases.filter(item => item.key === "200-grid").map(item => ({ ...item, manifest: capacityManifestPath })),
];
const inlineLayoutCases = new Set(["50-linear", "100-linear", "200-grid"]);
const catalog = JSON.parse(fs.readFileSync("catalog/builtin-catalog.json", "utf8"));
const compilerContext = {
  validateSource: () => ({ valid: true, diagnostics: [] }),
  validateNormalized: () => ({ valid: true, diagnostics: [] }),
  catalog: {
    capabilities: catalog.capabilities,
    profiles: catalog.profiles,
    assets: catalog.assets,
  },
  engineBaselineVersion: "0.8.0",
};

function memory() {
  const usage = process.memoryUsage();
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
  };
}

async function measure(phase, fn) {
  const before = memory();
  const started = performance.now();
  try {
    const value = await fn();
    const after = memory();
    return {
      phase,
      status: "MEASURED",
      elapsedMs: Number((performance.now() - started).toFixed(3)),
      memoryBefore: before,
      memoryAfter: after,
      memoryDelta: {
        rssBytes: after.rssBytes - before.rssBytes,
        heapUsedBytes: after.heapUsedBytes - before.heapUsedBytes,
        externalBytes: after.externalBytes - before.externalBytes,
      },
      value,
    };
  } catch (error) {
    const after = memory();
    return {
      phase,
      status: "ERROR",
      elapsedMs: Number((performance.now() - started).toFixed(3)),
      memoryBefore: before,
      memoryAfter: after,
      memoryDelta: {
        rssBytes: after.rssBytes - before.rssBytes,
        heapUsedBytes: after.heapUsedBytes - before.heapUsedBytes,
        externalBytes: after.externalBytes - before.externalBytes,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function notRun(phase, reason) {
  return { phase, status: "NOT_RUN_SAFE_BOUNDARY", reason };
}

function layoutDocument(scenario, raw) {
  return {
    formatId: "infrastructure-cyber-lab.layout",
    schemaVersion: "0.1.0",
    scenarioId: scenario.scenarioId,
    engine: "elk.layered",
    nodes: raw.nodes
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(node => ({
        id: node.id,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        ...(node.parent ? { parent: node.parent } : {}),
      })),
  };
}

const results = [];
for (const item of cases) {
  const phases = [];
  const bytes = new Uint8Array(fs.readFileSync(item.path));
  const parsedMeasurement = await measure("xlsxImportParse", () => createXlsxImportAdapter(nodeZipArchiveBackend).parse({ bytes, mediaType: item.mediaType }, { options: {} }));
  phases.push({ ...parsedMeasurement, value: parsedMeasurement.value ? { tableCount: parsedMeasurement.value.document?.tables?.length ?? null, diagnosticCount: parsedMeasurement.value.diagnostics?.length ?? null } : undefined });
  if (parsedMeasurement.status !== "MEASURED") {
    results.push({ key: item.key, manifest: item.manifest, resources: item.resources, connections: item.connections, phases });
    continue;
  }
  const parsed = await createXlsxImportAdapter(nodeZipArchiveBackend).parse({ bytes, mediaType: item.mediaType }, { options: {} });
  const normalizedMeasurement = await measure("normalizeNetworkInventoryDocument", () => normalizeNetworkInventoryDocument(parsed.document));
  phases.push({ ...normalizedMeasurement, value: normalizedMeasurement.value ? { unmappedColumnCount: normalizedMeasurement.value.unmappedColumnCount ?? null, diagnosticCount: normalizedMeasurement.value.diagnostics?.length ?? null } : undefined });
  const normalized = normalizedMeasurement.value.document;
  const mappedMeasurement = await measure("mapNetworkWorkbookToScenario", () => mapNetworkWorkbookToScenario(normalized));
  phases.push({ ...mappedMeasurement, value: mappedMeasurement.value ? { ok: mappedMeasurement.value.ok, resources: mappedMeasurement.value.source?.resources.length ?? null, connections: mappedMeasurement.value.source?.connections.length ?? null, zones: mappedMeasurement.value.source?.zones.length ?? null } : undefined });
  if (mappedMeasurement.status !== "MEASURED" || !mappedMeasurement.value.ok || !mappedMeasurement.value.source) {
    results.push({ key: item.key, manifest: item.manifest, resources: item.resources, connections: item.connections, phases });
    continue;
  }
  const source = mappedMeasurement.value.source;
  const compiledMeasurement = await measure("canonicalCompile", () => compileScenario(source, compilerContext));
  phases.push({ ...compiledMeasurement, value: compiledMeasurement.value ? { ok: compiledMeasurement.value.ok, diagnosticCount: compiledMeasurement.value.diagnostics.length, resources: compiledMeasurement.value.model?.resources.length ?? null, connections: compiledMeasurement.value.model?.connections.length ?? null } : undefined });
  if (compiledMeasurement.status !== "MEASURED" || !compiledMeasurement.value.ok) {
    results.push({ key: item.key, manifest: item.manifest, resources: item.resources, connections: item.connections, phases });
    continue;
  }
  const scenario = compiledMeasurement.value.model;
  const graphMeasurement = await measure("elkGraphConstruction", () => buildLayoutGraph(scenario));
  phases.push({ ...graphMeasurement, value: graphMeasurement.value ? { childCount: graphMeasurement.value.children.length, edgeCount: graphMeasurement.value.edges.length } : undefined });
  if (graphMeasurement.status !== "MEASURED") {
    results.push({ key: item.key, manifest: item.manifest, resources: item.resources, connections: item.connections, phases });
    continue;
  }
  if (!inlineLayoutCases.has(item.key)) {
    phases.push(notRun("elkLayout", "DENSE_CASE_SAFE_BOUNDARY: current bundled ELK backend is non-cancellable; use the F4A Worker proof for timeout/abort instead."));
    phases.push(notRun("layoutValidation", "NOT_RUN because ELK layout was not invoked for this dense case."));
    phases.push(notRun("canvasProjection", "NOT_RUN because no complete layout document exists for this dense case."));
    phases.push(notRun("normalCompactionAndOrthogonalRouting", "NOT_RUN because no complete layout document exists for this dense case."));
    results.push({ key: item.key, manifest: item.manifest, resources: item.resources, connections: item.connections, phases });
    continue;
  }
  const backend = new ElkLayoutBackend();
  const elkMeasurement = await measure("elkLayout", () => backend.layout(graphMeasurement.value));
  phases.push({ ...elkMeasurement, value: elkMeasurement.value ? { nodeCount: elkMeasurement.value.nodes.length, portCount: elkMeasurement.value.ports?.length ?? null, edgeCount: elkMeasurement.value.edges?.length ?? null } : undefined });
  if (elkMeasurement.status !== "MEASURED") {
    phases.push(notRun("layoutValidation", "NOT_RUN because ELK layout failed."));
    phases.push(notRun("canvasProjection", "NOT_RUN because no complete layout document exists."));
    phases.push(notRun("normalCompactionAndOrthogonalRouting", "NOT_RUN because no complete layout document exists."));
    results.push({ key: item.key, manifest: item.manifest, resources: item.resources, connections: item.connections, phases });
    continue;
  }
  const raw = elkMeasurement.value;
  const document = layoutDocument(scenario, raw);
  const validationMeasurement = await measure("layoutValidation", () => [
    ...(raw.diagnostics ?? []),
    ...validateBackendResult(graphMeasurement.value, raw.nodes),
    ...(raw.ports ? validateBackendPorts(graphMeasurement.value, raw.ports) : []),
    ...(raw.edges ? validateBackendEdges(graphMeasurement.value, raw.edges) : []),
    ...validateVisualLayout(scenario, document),
  ]);
  phases.push({ ...validationMeasurement, value: validationMeasurement.value ? { diagnosticCount: validationMeasurement.value.length, errorCount: validationMeasurement.value.filter(diagnostic => diagnostic.severity === "error").length } : undefined });
  const projectionMeasurement = await measure("canvasProjection", () => projectScenarioToCanvas(scenario, document));
  phases.push({ ...projectionMeasurement, value: projectionMeasurement.value ? { nodeCount: projectionMeasurement.value.nodes.length, edgeCount: projectionMeasurement.value.edges.length, diagnosticCount: projectionMeasurement.value.diagnostics.length } : undefined });
  if (projectionMeasurement.status === "MEASURED") {
    const compactMeasurement = await measure("normalCompactionAndOrthogonalRouting", () => compactNormalTopologyProjection(projectionMeasurement.value));
    phases.push({ ...compactMeasurement, value: compactMeasurement.value ? {
      nodeCount: compactMeasurement.value.nodes.length,
      edgeCount: compactMeasurement.value.edges.length,
      diagnosticCount: compactMeasurement.value.diagnostics.length,
      errorCount: compactMeasurement.value.diagnostics.filter(diagnostic => diagnostic.severity === "error").length,
      warningCount: compactMeasurement.value.diagnostics.filter(diagnostic => diagnostic.severity === "warning").length,
      routeCount: compactMeasurement.value.edges.filter(edge => edge.data.routeKind === "orthogonal").length,
    } : undefined });
  } else {
    phases.push(notRun("normalCompactionAndOrthogonalRouting", "NOT_RUN because canvas projection failed."));
  }
  results.push({ key: item.key, manifest: item.manifest, resources: item.resources, connections: item.connections, phases });
}

const evidence = {
  format: "ATLAS001_F4_PHASE_MEASUREMENTS",
  commit: process.env.YADILAB_EXPECTED_COMMIT ?? "UNKNOWN_LOCAL_HEAD",
  host: { platform: process.platform, release: os.release(), node: process.version, cpuCount: os.cpus().length },
  inlineLayoutCases: [...inlineLayoutCases],
  denseLayoutBoundary: "No inline ELK timings are reported for 100/800 or 200/1600; those calls are intentionally not made because the current product backend is non-cancellable. See F3 Chromium evidence and F4A Worker POC.",
  results,
};
fs.mkdirSync(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
