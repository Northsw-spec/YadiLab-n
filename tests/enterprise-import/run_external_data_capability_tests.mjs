import assert from "node:assert/strict";
import fs from "node:fs";
import { csvImportAdapter, externalDataCapabilities, mapExternalDocumentToCanonicalScenario, previewExternalMapping, webCryptoImportHashProvider } from "../../dist-enterprise-import-test/enterprise-import/src/index.js";

const profile = JSON.parse(fs.readFileSync("tests/fixtures/valid/enterprise-mapping-profile.json", "utf8"));
const bytes = new Uint8Array(fs.readFileSync("tests/fixtures/import/devices.csv"));
const parsed = csvImportAdapter.parse({ bytes, mediaType: "text/csv" }, { options: { trimStrings: true } });
const ok = (condition, message) => { assert.equal(condition, true, message); };
ok(externalDataCapabilities.find((x) => x.format === "Native JSON")?.status === "SUPPORTED", "native JSON is supported");
ok(externalDataCapabilities.find((x) => x.format === "CSV")?.status === "SUPPORTED", "CSV is supported");
ok(externalDataCapabilities.find((x) => x.format === "DOCX")?.status === "UNSUPPORTED", "unstructured DOCX is unsupported without a deterministic template");
ok(externalDataCapabilities.find((x) => x.format === "PDF")?.mapping === "manual mapping required", "PDF requires manual mapping");
ok(parsed.document.tables.length === 1, "CSV becomes a parsed table");
const preview = previewExternalMapping({ sourceName: "devices.csv", detectedFormat: "CSV", document: parsed.document, profile, diagnostics: parsed.diagnostics });
ok(preview.mode === "PREVIEW", "mapping preview is explicit and isolated");
ok(preview.mapped.nodes === 2, "preview reports mapped source records");
const sourceHash = await webCryptoImportHashProvider.sha256Bytes(bytes);
const result = await mapExternalDocumentToCanonicalScenario({
  baselineId: "external_dev1",
  source: { sourceId: `src_${sourceHash}`, mediaType: "text/csv", sha256: sourceHash, byteSize: bytes.byteLength, displayName: "devices.csv" },
  document: parsed.document,
  profile,
  adapter: { id: csvImportAdapter.id, version: csvImportAdapter.version },
  options: { trimStrings: true },
  sourceName: "devices.csv",
  detectedFormat: "CSV",
});
ok(result.ok, "structured external data maps through canonical projection");
ok(result.source?.formatId === "infrastructure-cyber-lab.scenario-source", "mapping emits canonical Scenario Source");
ok(result.source?.resources.length === 2, "canonical source contains mapped resources");
console.log("PASS dev1 external data capability and canonical mapping: 10 assertions.");
