import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  liveCanvasWorkspace,
  liveBuilderCanvasMutationWorkspace,
} from "../../ui/app/topology-workspace-guard.mjs";
import {
  applyBuilderCanvasSelection,
  applyMissionInspector,
  createBuilderWorkspace,
  setLayoutOverride,
} from "../../dist-browser-test/ui/src/browser/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
let checks = 0;
function eq(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }

const rendered = createBuilderWorkspace(source);
let published = rendered;
const generation = 7;
const edited = applyMissionInspector(rendered, {
  title: "PROJECT-054 latest typed source", language: "sv",
  briefing: rendered.source.metadata.briefing ?? "",
  description: rendered.source.metadata.description ?? "",
});
eq(edited.ok, true, "Builder inspector authoring succeeds");
published = edited.workspace;
eq(published.dirty, true, "live source revision has unsaved state");

// Inspector Apply -> ReactFlow selection in one task: emulate the event
// handler created by the last rendered React tree, before React paints the
// updated source. An old handler must select on the new source, never restore
// the saved/unchanged source from the previous render.
const staleRenderSelection = () => {
  const active = liveCanvasWorkspace(rendered, published, generation, generation);
  eq(active, published, "old selection handler resolves synchronously published workspace");
  published = applyBuilderCanvasSelection(active, { nodeIds: ["rds01"], primary: "rds01" });
};
staleRenderSelection();
eq(published.source.metadata.title, "PROJECT-054 latest typed source",
  "old rendered ReactFlow selection does not revert just-applied Builder source");
eq(published.dirty, true, "canvas selection does not erase unsaved state");
eq(published.sourceRevision, rendered.sourceRevision + 1,
  "canvas selection cannot roll source revision backward");

// Pane click from a previous React tree must preserve the latest canonical
// source while resetting selection.
const paneActive = liveCanvasWorkspace(rendered, published, generation, generation);
published = applyBuilderCanvasSelection(paneActive, {});
eq(published.source.metadata.title, "PROJECT-054 latest typed source",
  "old pane click cannot restore saved canonical source");
eq(published.dirty, true, "old pane click cannot clear dirty source");
eq(published.selection.ids, [], "old pane click still clears current selection");

// Source-dependent gestures are denied when the source changed between the
// rendered projection and the callback, even in the same project generation.
eq(liveBuilderCanvasMutationWorkspace(rendered, published, generation, generation), null,
  "stale drag/connect/zone resize cannot act on new canonical source");
const moved = setLayoutOverride(rendered, { id: "rds01", x: 40, y: 90 });
eq(liveBuilderCanvasMutationWorkspace(rendered, moved, generation, generation), moved,
  "unchanged-source layout edits may use the latest non-source Builder revision");

// New/Open/import increments scenario generation. Old ReactFlow callbacks
// must never update an unrelated project, even when scenario IDs match.
const otherSource = structuredClone(source);
otherSource.metadata.title = "Separate project with reused public ID";
const otherProject = createBuilderWorkspace(otherSource);
eq(liveCanvasWorkspace(rendered, otherProject, generation, generation + 1), null,
  "old ReactFlow callback blocked across New/Open generation");
eq(liveBuilderCanvasMutationWorkspace(rendered, otherProject, generation, generation + 1), null,
  "old geometry callback blocked across New/Open generation");
eq(liveCanvasWorkspace(rendered, otherProject, -1, generation), null,
  "invalid rendered generation cannot act on a project");
eq(liveCanvasWorkspace(rendered, otherProject, generation, Number.NaN), null,
  "invalid current generation cannot authorize old callback");
eq(liveCanvasWorkspace(rendered, { mode: "runtime" }, generation, generation), null,
  "builder event cannot overwrite Runtime project");

// Positive Runtime selection remains possible on the live Runtime workspace.
const runtimeRendered = { mode: "runtime", source: source, id: "runtime-origin" };
const runtimeLive = { ...runtimeRendered, id: "latest-runtime-state" };
eq(liveCanvasWorkspace(runtimeRendered, runtimeLive, 12, 12), runtimeLive,
  "runtime canvas selection receives latest Runtime snapshot");
eq(liveBuilderCanvasMutationWorkspace(runtimeRendered, runtimeLive, 12, 12), null,
  "runtime canvas cannot perform builder-only mutations");

// Validate the UI uses both guards for each stale-sensitive callback.
const mainSource = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
for (const segment of ["onSelectionChange", "onNodeDragStop", "onConnect", "clearSelection", "focusTopologyResult", "onResizeEnd"]) {
  eq(mainSource.includes(segment), true, "required ReactFlow handler remains wired: " + segment);
}
eq(mainSource.includes("liveCanvasWorkspace(workspace, getWorkspace()"), true,
  "real UI callback consults live workspace rather than stale render");
eq(mainSource.includes("liveBuilderCanvasMutationWorkspace(workspace, getWorkspace()"), true,
  "real UI source gestures fail closed on stale graph");

console.log(`PASS PROJECT-054: ${checks} live ReactFlow workspace and source-integrity assertions`);
