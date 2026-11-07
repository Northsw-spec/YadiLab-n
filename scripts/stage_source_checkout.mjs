import fs from "node:fs";
import path from "node:path";
import { computeSourceCheckoutIdentity, listSourceCheckoutFiles } from "./source-checkout-identity.mjs";

function blocked(message, code = 77) {
  console.error(`BLOCKED source checkout stage: ${message}`);
  process.exit(code);
}

if (process.argv.length !== 4) {
  console.error("Usage: node scripts/stage_source_checkout.mjs SOURCE_ROOT EMPTY_STAGE_ROOT");
  process.exit(2);
}
const source = path.resolve(process.argv[2]);
const stage = path.resolve(process.argv[3]);
if (stage === source || stage.startsWith(`${source}${path.sep}`)) blocked("stage must be outside source checkout");
if (fs.existsSync(stage) && fs.readdirSync(stage).length) blocked("stage directory must be empty");
fs.mkdirSync(stage, { recursive: true });

const files = listSourceCheckoutFiles(source);
for (const item of files) {
  const src = path.join(source, ...item.path.split("/"));
  const dst = path.join(stage, ...item.path.split("/"));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(dst, item.mode);
}
const sourceIdentity = computeSourceCheckoutIdentity(source);
const stageIdentity = computeSourceCheckoutIdentity(stage);
if (JSON.stringify(sourceIdentity) !== JSON.stringify(stageIdentity)) {
  fs.rmSync(stage, { recursive: true, force: true });
  blocked(`staged source identity mismatch source=${JSON.stringify(sourceIdentity)} stage=${JSON.stringify(stageIdentity)}`, 1);
}
console.log(`PASS staged source checkout: ${stageIdentity.fileCount} files / ${stageIdentity.sha256}.`);
