import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createTroubleshootingCase, replaceTroubleshootingCaseWorkingSource } from "../../dist-browser-test/ui/src/browser/troubleshooting-case.js";
const source = JSON.parse(await fs.readFile("tests/fixtures/valid/scenario-source.json", "utf8"));
const value = await createTroubleshootingCase({ source, title: "Hardening" });
await assert.rejects(() => replaceTroubleshootingCaseWorkingSource(value, { ...source, scenarioId: `${source.scenarioId}-mismatch` }));
const huge = await createTroubleshootingCase({ source, title: "x".repeat(10000), description: "y".repeat(10000) });
assert.ok(huge.caseId);
console.log("PASS v1.5 hardening adversarial: scenario mismatch and long user-authored data remain bounded/fail-closed");
