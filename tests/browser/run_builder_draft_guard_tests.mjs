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
eq(registry.hasOtherPending(inspector), true, "Inspector cannot overwrite a pending JSON editor");
eq(registry.hasOtherPending(authoring), true, "JSON Apply cannot discard pending Inspector fields");
eq(registry.hasOtherPending({}), true, "separate object cannot impersonate another editor");
eq(registry.mark(inspector, false), 1, "Inspector Apply does not conceal staged JSON");
eq(registry.hasOtherPending(authoring), false, "sole edited authoring panel can Apply");
eq(registry.hasOtherPending(inspector), true, "unapplied JSON remains visible to Inspector commands");
eq(registry.hasPending(), true, "other unapplied panels keep Save blocked");
eq(registry.mark(authoring, false), 0, "last successful Apply clears staged status");
eq(registry.hasPending(), false, "verified Save can proceed after all Apply");
eq(registry.mark(inspector, true), 1, "new edit re-establishes pending state");
eq(registry.mark(inspector, false), 0, "reverted fields clear the guard");
eq(registry.mark({}, false), 0, "unmount cleanup is safe and idempotent");
eq(registry.mark(inspector, true, 0), 1, "old project registers staged Inspector");
eq(registry.beginGeneration(1), 0, "New/Open drops only old-generation drafts synchronously");
eq(registry.hasPending(), false, "new project is immediately free of old form owners");
eq(registry.mark(inspector, true, 0), 0, "delayed old-project input cannot mark the new project dirty");
eq(registry.mark(authoring, true, 1), 1, "new project can stage and Apply its own JSON");
eq(registry.mark(inspector, false, 0), 1, "late old-project cleanup cannot erase a new draft");
eq(registry.hasOtherPending(authoring), false, "old-generation drafts do not block new JSON Apply");
eq(registry.mark(authoring, false, 1), 0, "new generation Apply clears its own pending state");
assert.throws(() => registry.beginGeneration(1), /advance/i);
checks += 1;
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
  "BUILDER_OTHER_EDITOR_UNAPPLIED",
  "BUILDER_CANVAS_UNAPPLIED_DRAFT",
  "BUILDER_PREVIEW_UNAPPLIED_DRAFT",
  "BUILDER_COMPILE_UNAPPLIED_DRAFT",
  "BUILDER_EXPORT_UNAPPLIED_DRAFT",
  "BUILDER_ASSET_UNAPPLIED_DRAFT",
  "BUILDER_INSPECTOR_DRAFT_REVERTED",
  "BUILDER_AUTHORING_DRAFT_REVERTED",
  "Förkasta inspektörsutkast",
  "Förkasta utkast: ",
  "BUILDER_COMPILE_LATE_UNAPPLIED_DRAFT",
  "PACKAGE_OPEN_LATE_UNAPPLIED_DRAFT",
  "pendingBuilderDraftsRef.current.beginGeneration(transitionId)",
  "onPendingDraftChange(draftOwnerRef.current, false, projectGeneration)",
]) {
  eq(ui.includes(marker), true, "mounted application wires live staged draft guard: " + marker);
}
for (const marker of [
  "PROJECT_UNAPPLIED_DRAFT",
  "PROJECT_UNAPPLIED_DRAFT_DURING_SAVE",
  "getPendingDraftChanges()",
  "data-project-pending-drafts",
  "UNAPPLIED FORM EDITS",
]) {
  eq(controls.includes(marker), true, "native project workflow protects staged text: " + marker);
}
// An async lab may compile/layout while the original Inspector is still
// mounted. Its draft generation must advance only on a real project handoff.
const launchGuard = ui.slice(ui.indexOf("const reserveGuardedScenarioLaunch = () =>"),
  ui.indexOf("// Runtime imports/restores may await files"));
eq(launchGuard.includes("PROJECT_LAB_LATE_UNAPPLIED_DRAFT"), true,
  "late Inspector/JSON typing vetoes pending lab replacement");
eq(launchGuard.includes("scenarioLaunchRequestRef.current !== launchToken"), true,
  "a superseded lab launch cannot publish after a new request");
eq(launchGuard.includes("beginScenarioTransition();"), true,
  "a committed lab replacement advances the draft generation");
for (const [name, nextName] of [
  ["openGuidedLab", "openEnterpriseScenario"],
  ["openEnterpriseScenario", "openVerifiedDeliveryScenario"],
  ["openVerifiedDeliveryScenario", "exportPackage"],
]) {
  const code = ui.slice(ui.indexOf("const " + name + " = async"),
    ui.indexOf("const " + nextName + " = async"));
  eq(code.includes("reserveGuardedScenarioLaunch()"), true,
    name + " starts a guarded launch without clearing the current drafts");
  eq(code.includes("const isLiveLaunch = launch.isLive;") && code.includes("isLiveLaunch()"), true,
    name + " checks live draft owners after awaited work");
  eq(code.includes("launch.publish("), true,
    name + " advances generation only at the commit boundary");
  eq(code.includes("beginScenarioTransition()"), false,
    name + " never advances generation before asynchronous work");
}
const exportHandler = ui.slice(
  ui.indexOf("const exportPackage = async (distribution) =>"),
  ui.indexOf("const backToBuilder = () =>"));
for (const marker of [
  "PROJECT_PACKAGE_EXPORT_UNAPPLIED_DRAFT",
  "PROJECT_PACKAGE_EXPORT_LATE_UNAPPLIED_DRAFT",
  "scenarioTransitionRef.current !== startedTransition",
  "latestDrawioWorkspaceRef.current !== origin",
  "hasPendingBuilderDrafts()",
]) eq(exportHandler.includes(marker), true,
  "package export must guard stale canonical downloads: " + marker);
eq(exportHandler.indexOf("hasPendingBuilderDrafts()") <
  exportHandler.indexOf("await buildBuilderPackageExport("), true,
  "pending draft must be rejected before package-building I/O");
eq(exportHandler.lastIndexOf("hasPendingBuilderDrafts()") >
  exportHandler.indexOf("await buildBuilderPackageExport("), true,
  "late draft must be rejected after awaited package-building I/O");
console.log(`PASS PROJECT-065: ${checks} staged Inspector/JSON and native Save/New assertions`);
