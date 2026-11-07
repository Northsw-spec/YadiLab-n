import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewGraphmlFileReadOnly } from "../../dist-browser-test/ui/src/browser/graphml-import-preview.js";
import { GraphmlPreviewDetails, GraphmlReadOnlyPanel, GraphmlManualReviewControls } from "../../ui/app/graphml-preview-panel.mjs";

let assertions = 0;
const eq = (got, want, msg) => { assert.deepEqual(got, want, msg); assertions++; };
const example = fs.readFileSync("tests/fixtures/import/graphml/valid-two-nodes.graphml");
const named = (name, data = example, size = data.length) => ({
  name, size, async arrayBuffer() { return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); },
});
const expectedBlocked = async (file, code) => {
  await assert.rejects(previewGraphmlFileReadOnly(file), (e) => e.code === code, code);
  assertions++;
};

const result = await previewGraphmlFileReadOnly(named("site.graphml"));
eq(result.filename, "site.graphml");
eq(result.preview.status, "REVIEW_REQUIRED");
eq(result.preview.canActivate, false);
eq(result.preview.nodes.length, 2);
eq(result.preview.edges.length, 1);
eq(result.preview.edges[0].relationKind, "GRAPH_EDGE");
eq(Object.hasOwn(result, "source"), false, "Must not output a ScenarioSource");
eq(Object.hasOwn(result, "workspace"), false, "Must not output an active workspace");

const details = renderToStaticMarkup(React.createElement(GraphmlPreviewDetails, { result }));
for (const marker of [
  'data-graphml-preview="REVIEW_REQUIRED"',
  'data-graphml-truth-boundary="true"',
  'data-graphml-activation-status="REVIEW_REQUIRED"',
  'data-graphml-nodes="true"',
  'data-graphml-edges="true"',
  "router_1",
  "switch_1",
  "edge_1",
  "not verified cables",
]) { assert.ok(details.includes(marker), `Rendered output must show ${marker}`); assertions++; }

const panel = renderToStaticMarkup(React.createElement(GraphmlReadOnlyPanel, {
  inspectFile: previewGraphmlFileReadOnly, onClose() {},
}));
for (const marker of [
  'role="dialog"', 'aria-modal="true"', 'data-graphml-panel="PREVIEW_ONLY"',
  'data-graphml-file="true"', 'accept=".graphml"', 'data-graphml-cancel="true"',
]) { assert.ok(panel.includes(marker), `Dialog must contain ${marker}`); assertions++; }
eq(panel.includes('data-network-import-activate'), false, "GraphML preview has no activation button");

const hostile = { ...result, preview: { ...result.preview, nodes: [
  { ...result.preview.nodes[0], label: '<img src=x onerror=alert(1)>' },
] } };
const hostileHtml = renderToStaticMarkup(React.createElement(GraphmlPreviewDetails, { result: hostile }));
eq(hostileHtml.includes("<img src=x"), false, "Imported label must never create a DOM image");
eq(hostileHtml.includes("&lt;img"), true, "React escapes untrusted graph labels");
const reviewHtml = renderToStaticMarkup(React.createElement(GraphmlManualReviewControls, {
  result, manualRoleOptions:["resource.generic","network.switch","network.router"], onConfirm: async () => {},
}));
for(const marker of [
  'data-graphml-mapping="REVIEW_REQUIRED"', 'data-graphml-role="0"',
  'data-graphml-role="1"', 'data-graphml-edge-decision="0"',
  'data-graphml-edge-ack="true"', 'data-graphml-map-confirm="true"',
]) { assert.ok(reviewHtml.includes(marker), `Review UI must contain ${marker}`); assertions++; }
eq(reviewHtml.includes('resource.generic'), true, "Unknown node role defaults generic");
const wiredMain = fs.readFileSync("ui/app/main.mjs","utf8");
assert.match(wiredMain, /mapReviewedGraphmlToBuilder\(sourcePreview, decisions\)/); assertions++;
assert.match(wiredMain, /candidate\.compile\.status !== "valid"/); assertions++;
assert.match(wiredMain, /if \(!layout\.ok\)/); assertions++;
assert.match(wiredMain, /setWorkspace\(layout\.workspace\)/); assertions++;
assert.match(wiredMain, /setImportedProbeAutoOpen\(false\)/); assertions++;
const uiPanelSrc = fs.readFileSync("ui/app/graphml-preview-panel.mjs", "utf8");
// Scan executable text only. A documentation comment mentioning a forbidden
// API must not produce a false FAIL. The negative controls below still prove
// that an actual callback or unsafe HTML call would be rejected.
const executablePanelSrc = uiPanelSrc.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
const noMutationCallbacks = (src) => !/\bsetWorkspace\b|\bonActivate\b/.test(src);
eq(noMutationCallbacks(executablePanelSrc), true, "Dialog cannot mutate workspace or activate GraphML");
eq(noMutationCallbacks(executablePanelSrc + "\nsetWorkspace(null)"), false, "Mutation negative control");
eq(noMutationCallbacks(executablePanelSrc + "\nonActivate()"), false, "Activation negative control");
eq(/dangerouslySetInnerHTML/.test(executablePanelSrc), false, "No raw HTML injection");
const app = fs.readFileSync("ui/app/main.mjs", "utf8");
assert.match(app, /data-inspect-graphml": "PREVIEW_ONLY"/); assertions++;
assert.match(app, /e\(GraphmlReadOnlyPanel, \{ inspectFile: previewGraphmlFileReadOnly/); assertions++;
assert.match(app, /onConfirm: async \(sourcePreview, decisions, originalFile, isCurrentSelection\)/); assertions++;
assert.match(app, /onInspectGraphml: \(\) => setGraphmlPreviewOpen\(true\)/); assertions++;
assert.match(app, /accept: "\.json,\.xlsx,\.ods,\.csv,\.tsv"/); assertions++;

// Negative control: removing the real dialog invocation must invalidate wiring check.
const wiring = (src) => /e\(GraphmlReadOnlyPanel, \{ inspectFile: previewGraphmlFileReadOnly/.test(src);
eq(wiring(app.replace("e(GraphmlReadOnlyPanel, { inspectFile: previewGraphmlFileReadOnly", "e(GraphmlReadOnlyPanel, { inspectFile: undefined")), false);

await expectedBlocked(named("scan.xml"), "GRAPHML_FILE_EXTENSION_INVALID");
await expectedBlocked(named("scan.nessus"), "GRAPHML_FILE_EXTENSION_INVALID");
await expectedBlocked(named("folder/graph.graphml"), "GRAPHML_FILE_EXTENSION_INVALID");
await expectedBlocked(named("zero.graphml", new Uint8Array()), "GRAPHML_FILE_SIZE_INVALID");
await expectedBlocked(named("big.graphml", example, 2 * 1024 * 1024 + 1), "GRAPHML_FILE_SIZE_INVALID");
await expectedBlocked(named("fake.graphml", fs.readFileSync("tests/fixtures/import/graphml/invalid-wrong-namespace.graphml")), "GRAPHML_UNSUPPORTED_NAMESPACE");
await expectedBlocked(named("evil.graphml", fs.readFileSync("tests/fixtures/import/graphml/adversarial-xxe.graphml")), "IMPORT_XML_DTD_FORBIDDEN");

// This SSR test validates markup and source wiring, NOT real DOM events or Parrot.
console.log(`PASS GRAPHML-P2 preview-only UI: ${assertions} SSR/bridge/security/source-contract assertions; no scenario activation. Real browser and Parrot manual acceptance NOT RUN.`);
