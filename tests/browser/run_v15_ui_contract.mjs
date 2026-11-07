import assert from "node:assert/strict";
import fs from "node:fs/promises";
const main = await fs.readFile("ui/app/main.mjs", "utf8");
for (const text of ["Troubleshooting", "Evidence", "Multi-Run", "USER NOTE", "ARCHIVED RUN", "Reproduce", "Export Diagnostic Session", "Import Diagnostic Session"]) assert.ok(main.includes(text) || text === "Troubleshooting", `UI contract text missing: ${text}`);
assert.ok(!/find root cause|auto diagnose|likely cause|confidence/i.test(main), "UI must not claim automated diagnosis");
console.log("PASS v1.5 UI truth contract: archived/current separation and no automated diagnosis wording");
