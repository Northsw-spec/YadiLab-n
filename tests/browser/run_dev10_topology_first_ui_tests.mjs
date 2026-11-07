import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const main = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
const css = fs.readFileSync(path.join(root, "ui/app/app.css"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const checks = [
  [packageJson.version === "1.8.0-dev.10", "package version is Dev10"],
  [main.includes('data-yadilab-build-version": "1.8.0-dev.10"') && main.includes('"v1.8.0-dev.10"'), "Dev10 marker is visible"],
  [main.includes("function MainActions") && main.includes("Lab & Scenario") && main.includes("Builder") && main.includes("Run & Preview") && main.includes("Import / Export"), "main actions are categorized"],
  [main.includes("function ControlCenter") && main.includes('aria-label": "Control Center"') && main.includes("Search tools and actions"), "Control Center search is rendered"],
  [main.includes('title: "Verification, experiments & promotion"') && main.includes('title: "Scenario & Builder"') && main.includes('title: "Builder Inspector & Authoring"'), "control sections are categorized"],
  [main.indexOf('className: "control-center"') < main.indexOf("e(Topology"), "Control Center precedes topology"],
  [main.includes('workspace.mode === "runtime" ? e(Sidebar') && main.indexOf('workspace.mode === "runtime" ? e(Sidebar') > main.indexOf("e(Topology"), "runtime probes remain below topology"],
  [css.includes(".workspace-grid { flex: 0 0 auto;") && css.includes("display: flex; flex-direction: column;"), "workspace uses a single normal-flow column"],
  [css.includes(".right-scroll-column { min-width: 0; height: auto;") && css.includes("overflow: visible;"), "legacy right rail no longer owns a fixed scroll region"],
  [css.includes(".main-actions-menus { display: grid;") && css.includes("repeat(4, minmax(0, 1fr))"), "main action menus have a responsive grid"],
  [css.includes("@media (max-width: 680px)") && css.includes(".main-actions-menus { grid-template-columns: 1fr; }"), "narrow layouts collapse action menus"],
  [main.includes('open: query ? match : undefined') && main.includes('hidden: !match'), "Control Center search filters sections"],
  [main.includes('workspace.mode === "builder" ? e(ControlSection') && main.includes('workspace.mode === "runtime" ? e(PackagedMediaPanel'), "builder and runtime controls retain mode semantics"],
];
let failed = 0;
for (const [ok, label] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log(`PASS Dev10 topology-first UI contract ${checks.length}/${checks.length}`);
