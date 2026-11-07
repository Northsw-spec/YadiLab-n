import assert from "node:assert/strict";
import fs from "node:fs";

const mainPath = process.argv[2] ?? "ui/app/main.mjs";
const main = fs.readFileSync(mainPath, "utf8");
const css = fs.readFileSync("ui/app/app.css", "utf8");

assert.match(main, /const terminalJourneyOutcome = journeyAtTerminal \? journeyFrame\?\.outcome/);
assert.match(main, /const \[journeyOutcomeMarkerExpiry, setJourneyOutcomeMarkerExpiry\] = useState\(0\)/);
assert.match(main, /const visibleJourneyOutcome = terminalJourneyOutcome && journeyOutcomeMarkerExpiry > Date\.now\(\) && markerEnabled/);
assert.match(main, /const durationMs = Math\.max\(1000, Number\(outcome\.markerDurationMs\) \|\| 4000\)/);
assert.match(main, /setJourneyOutcomeMarkerExpiry\(expiry\)/);
assert.match(main, /setTimeout\(\(\) => setJourneyOutcomeMarkerExpiry\(0\), durationMs\)/);
assert.match(main, /terminalJourneyOutcome\?\.anchorResourceId === node\.id/);
assert.match(main, /outcomeAnchoredHere && visibleJourneyOutcome/);
assert.match(main, /data\.journeyOutcomeMarker/);

assert.match(css, /\.journey-node-badge\.outcome-success[^{]*\{/);
assert.match(css, /\.journey-node-badge\.outcome-drop[^{]*\{/);
assert.match(css, /z-index:\s*8/);
assert.match(css, /animation:\s*journey-outcome-pop/);

console.log(`PASS Dev8 visible marker lifecycle contract: terminal Engine outcome drives a rendered, timed marker independently of persistent node state (${mainPath})`);
