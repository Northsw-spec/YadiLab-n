import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {previewDocxTableStructure} from "../../dist-enterprise-import-test/enterprise-import/src/docx-tables-structural-preview.js";

const root = path.resolve("tests/fixtures/atlas001-g5.0");
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
const profile = JSON.parse(await fs.readFile(path.join(root, "rendering-profile.json"), "utf8"));
const fail = (message) => { throw new Error(`G5.0 fixture: ${message}`); };
if (manifest.format !== "docx") fail("format is not DOCX");
if (manifest.rendererProfile !== profile.profileId) fail("renderer profile is not bound to the manifest");
if (profile.acceptedEnvironment?.osId !== "ubuntu" ||
    profile.acceptedEnvironment?.osVersionId !== "24.04") fail("accepted renderer profile is not Ubuntu 24.04");
const generatorSha = crypto.createHash("sha256").update(
  await fs.readFile(path.join(root, "generate_g5_fixtures.py"))).digest("hex");
if (profile.generator?.sha256 !== generatorSha) fail("generator SHA does not match checkout");
if (manifest.controls?.length !== 2) fail("exactly controls A and B are required");

for (const control of manifest.controls) {
  const bytes = new Uint8Array(await fs.readFile(path.join(root, control.file)));
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha !== control.sha256) fail(`${control.id} SHA-256 mismatch`);
  const preview = await previewDocxTableStructure(bytes);
  if (preview.status !== "REVIEW_REQUIRED" || preview.canActivate !== false ||
      preview.engineVerified !== false || preview.physicalTopologyVerified !== false) {
    fail(`${control.id} crossed the structure-only truth boundary`);
  }
  if (preview.tables.length !== control.tables) {
    fail(`${control.id} table count ${preview.tables.length} != ${control.tables}`);
  }
  if (control.id === "A" && (preview.tables.length !== 0 || preview.totalCells !== 0)) {
    fail("control A fabricated topology from a no-topology document");
  }
  if (control.id === "B" && preview.tables.length !== 2) {
    fail("control B lost its two explicit declaration tables");
  }
}
console.log("PASS ATLAS-001 G5.0 fixture structure, SHA and fail-closed checks");
