import assert from "node:assert/strict";
import { importSavedDiagnosticSession } from "../../dist-browser-test/ui/src/browser/diagnostic-session.js";
for (const value of ["{bad", JSON.stringify({ formatId: "wrong", schemaVersion: "0.1.0" }), "x".repeat(8 * 1024 * 1024 + 1)]) assert.equal((await importSavedDiagnosticSession(value)).ok, false);
console.log("PASS v1.5 Dev3 adversarial: malformed JSON, wrong format and oversized session fail closed");
