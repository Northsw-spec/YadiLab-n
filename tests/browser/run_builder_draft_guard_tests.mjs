import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPendingBuilderDraftRegistry } from "../../ui/app/builder-draft-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let checks = 0;
function eq(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}
const registry = createPendingBuilderDraftRegistry();
const inspector = {};
const authoring = {};
eq(registry.count(), 0, "initially no uncommitted drafts");
eq(registry.hasPending(), false, "new project has no phantom staged edits");
eq(registry.mark(inspector, true), 1, "Inspector edit is immediately registered");
eq(registry.hasPending(), true, "Save/New sees live pending Inspector state");
eq(registry.mark(inspector, true), 1, "retyping same form does not duplicate owner");
eq(registry.mark(authoring, true), 2, "JSON text adds independent staged owner");
eq(registry.mark(inspector, false), 1, "Inspector Apply does not conceal staged JSON");
eq(registry.hasPending(), true, "other unapplied panels keep Save blocked");
eq(registry.mark(authoring, false), 0, "last successful Apply clears staged status");
eq(registry.hasPending(), false, "verified Save can proceed after all Apply");
eq(registry.mark(inspector, true), 1, "new edit re-establishes pending state");
eq(registry.mark(inspector, false), 0, "reverted fields clear the guard");
eq(registry.mark({}, false), 0, "unmount cleanup is safe and idempotent");
assert.throws(() => registry.mark(null, true), /owner/i);
checks += 1;

const ui = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
const controls = fs.readFileSync(path.join(root, "ui/app/project-file-controls.mjs"), "utf8");
for (const marker of [
  "createPendingBuilderDraftRegistry()",
  "onPendingDraftChange(draftOwnerRef.current",
  "BUILDER_AUTHORING_MULTIPLE_UNAPPLIED",
  "BUILDER_INSPECTOR_UNAPPLIED_DRAFT",
  "getPendingDraftChanges: hasPendingBuilderDrafts",
]) {
  eq(ui.includes(marker), true, "mounted application wires live staged draft guard: " + marker);
}
for (const marker of [
  "PROJECT_UNAPPLIED_DRAFT",
  "getPendingDraftChanges()",
  "data-project-pending-drafts",
  "UNAPPLIED FORM EDITS",
]) {
  eq(controls.includes(marker), true, "native project workflow protects staged text: " + marker);
}
console.log(`PASS PROJECT-065: ${checks} staged Inspector/JSON and native Save/New assertions`);
