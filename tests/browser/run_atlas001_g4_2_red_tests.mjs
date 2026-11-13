import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reproduction contract for the pre-G4.2 hole: at f31706a the import path had
// no decision between the bounded/large branches and autoLayoutBuilder.
const historical = readFileSync("ui/app/main.mjs", "utf8");
assert.match(historical, /NETWORK_IMPORT_LAYOUT_CAPACITY_BLOCKED/);
assert.match(historical, /classifyNetworkImportActivation/);
assert.match(historical, /recordNetworkImportGlobalLayoutInvocation/);
assert.match(historical, /activationDecision\.kind !== ATLAS_ACTIVATION_KINDS\.NORMAL/);
assert.doesNotMatch(historical, /if \(boundedAtlas\.eligible\) \{[\s\S]{0,1200}const layout = await autoLayoutBuilder\(next, new ElkLayoutBackend\(\)\);/);

console.log("ATLAS-001 G4.2 former-gap regression: PASS (global import layout is guarded by an explicit activation decision)");
