import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = fs.readFileSync(path.join(root, "scripts/install_offline_browser_dependencies.sh"), "utf8");
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };

const verify = 'node scripts/verify_offline_dependency_snapshot.mjs "$cache"';
const envCheck = 'YADILAB_CONSUMER_NPM_VERSION="$(npm --version)" node scripts/check_offline_snapshot_consumer_environment.mjs "$cache"';
const checksum = '(cd "$cache" && sha256sum -c SHA256SUMS.txt)';
const cacheVerify = 'npm cache verify --cache "$cache/npm-cache" >/dev/null';
const install = 'npm ci --offline --cache "$cache/npm-cache" --no-audit --no-fund';

const verifyAt = script.indexOf(verify);
const envAt = script.indexOf(envCheck);
const checksumAt = script.indexOf(checksum);
const cacheAt = script.indexOf(cacheVerify);
const installAt = script.indexOf(install);

ok(verifyAt >= 0, "snapshot integrity is verified first");
ok(envAt > verifyAt, "consumer environment check runs after snapshot verification");
ok(checksumAt > envAt, "legacy checksum check runs only after consumer identity matches");
ok(cacheAt > envAt, "npm cache is not consumed before consumer environment matches");
ok(installAt > cacheAt, "strict offline npm ci runs only after cache verification");
ok(script.includes('$(npm --version)'), "consumer npm identity comes from the executing npm binary");
ok(!script.includes("--prefer-offline"), "consumer install remains strict offline");

console.log(`PASS snapshot consumer-install contract suite: ${checks} assertions.`);
