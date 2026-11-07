import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const main = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
const css = fs.readFileSync(path.join(root, "ui/app/app.css"), "utf8");
const checks = [
  [css.includes("html, body, #app { margin: 0; min-height: 100%; }") && css.includes("html { overflow-y: auto;"), "document scroll remains enabled"],
  [css.includes(".app-frame { min-height: 100dvh;") && css.includes("overflow: visible"), "app frame permits document flow"],
  [css.includes(".workspace-grid { flex: 0 0 auto;") && css.includes("overflow: visible"), "workspace participates in document flow"],
  [css.includes(".right-scroll-column { min-width: 0; height: auto;") && css.includes("overflow: visible;"), "secondary panels remain in normal document flow"],
  [css.includes(".topology-panel { min-width: 0; min-height: 520px; height: clamp(") && css.includes("border: 1px solid"), "topology is explicitly bounded and framed"],
  [css.includes(".topology-column { min-width: 0;") && main.includes('className: "topology-column"'), "topology and playback share a normal-flow column"],
  [css.includes(".topology-panel > .react-flow { width: 100%; height: 100%; min-height: 0; }"), "React Flow fills topology viewport"],
  [main.includes('className: "right-scroll-column"'), "secondary control panels remain rendered"],
  [main.includes('e("summary", null, "Uppdrag")'), "Mission disclosure localized"],
  [main.includes('e("summary", null, "Test")'), "Tests disclosure localized"],
  [main.includes('e("summary", null, "Fynd")'), "Findings disclosure localized"],
  [main.includes('e("summary", null, "Evidens")'), "Evidence disclosure localized"],
  [main.includes('e("summary", null, "Framsteg")'), "Progress disclosure localized"],
  [main.includes('e("summary", null, "Ledtrådar")'), "Hints disclosure localized"],
  [main.includes('e("summary", null, "Lärande / mål")'), "Learning disclosure localized"],
  [main.includes('e("summary", null, "Felinjektion")'), "Fault Injection localized"],
  [main.includes('e("summary", null, "Guidad felsökning")'), "guided troubleshooting localized"],
  [main.includes('e("summary", null, "Diagnostik / observationsmotor")'), "observation heading localized"],
  [main.includes('e("summary", null, "Modellerade aktiva prober")'), "active probes heading localized"],
  [main.includes('`v${releaseIdentity.version}`'), "visible release-derived build marker is rendered"],
  [!main.includes("e(MiniMap)") && !main.includes("MiniMap,"), "unthemed React Flow MiniMap overlay is absent"],
  [css.includes(".react-flow__controls-button { color: #dff4ff; background: #13243a;"), "React Flow controls use the dark theme"],
  [main.includes('"Spela om"') && main.includes('"Spela"') && main.includes('"Steg ▶"'), "packet journey controls remain rendered"],
  [main.includes('data-outcome-toggle": "success"') && main.includes('data-outcome-toggle": "drop"'), "independent success/drop marker toggles are rendered"],
  [css.includes(".journey-player { position: static;") && css.includes("overflow: visible"), "playback is not an overlay"],
  [main.includes('"Mål"') && main.includes('"Sökväg"') && main.includes('"JSON-värde"') && main.includes('"Verkställ via Engine"'), "configuration action labels are Swedish"],
  [main.includes('"Exportera framsteg"') && main.includes('"Läs in framsteg"') && main.includes('"Återställ autosparning"'), "runtime toolbar labels are Swedish"],
  [main.includes('data-runtime-panel": "mission"') && main.includes('data-runtime-panel": "findings"'), "internal runtime panel IDs remain stable"],
];
let failed = 0;
for (const [ok, label] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log(`PASS UI layout/localization contract ${checks.length}/${checks.length}`);
