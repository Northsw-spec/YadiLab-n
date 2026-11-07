import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("ui/app/main.mjs", "utf8");
const css = fs.readFileSync("ui/app/app.css", "utf8");

assert.match(main, /const terminalJourneyOutcome = journeyAtTerminal \? journeyFrame\?\.outcome/);
assert.match(main, /const visibleJourneyOutcome = terminalJourneyOutcome && journeyOutcomeMarkerExpiry > Date\.now\(\) && markerEnabled/);
assert.match(main, /terminalJourneyOutcome\?\.anchorResourceId === node\.id/);
assert.match(main, /terminalJourneyOutcome\.kind === "destination_reached"/);
assert.match(main, /terminalJourneyOutcome\.kind === "dropped"/);
assert.match(main, /terminalJourneyOutcome\.kind === "unknown"/);
assert.match(main, /outcomeAnchoredHere && visibleJourneyOutcome/);
assert.match(main, /data\.journeyOutcomeMarker/);

assert.match(css, /\.resource-node\.journey-node-arrived\s*\{[^}]*#38dfa2/);
assert.match(css, /\.resource-node\.journey-node-dropped[^}]*#ff5d6c/);
assert.match(css, /\.resource-node\.journey-node-uncertain\s*\{[^}]*#d58cff/);
assert.match(main, /data\.journeyState === "uncertain" \? "\?"/);

console.log("PASS Dev7 node outcome state contract: terminal Engine outcome state is independent of marker visibility and anchored by canonical resource identity");
