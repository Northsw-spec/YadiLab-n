import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { MemoryArchiveBackend, SafePackageIO } from "../../dist-browser-test/package-io/src/index.js";
import { createRuntimePackageMedia, openRuntimePackage } from "../../dist-browser-test/ui/src/browser/index.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scenario = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-normalized.json"), "utf8"));
const layout = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/layout.json"), "utf8"));
const enc = new TextEncoder();
const pngFixture = new Uint8Array(fs.readFileSync(path.join(root,"tests/fixtures/media/safe.png")));
const safeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" fill="#334155"/></svg>';
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const urls = [];
const revoked = [];
const host = {
  createObjectURL(blob) { urls.push(blob); return `blob:https://127.0.0.1:9000/${urls.length}`; },
  revokeObjectURL(url) { revoked.push(url); },
};
const io = new SafePackageIO(new MemoryArchiveBackend(), () => ({ valid: true }));
const blob = await io.write(scenario, {
  distribution: "student", layout,
  assets: [
    { path: "assets/z-diagram.svg", mime: "image/svg+xml", bytes: enc.encode(safeSvg) },
    { path: "assets/a-photo.png", mime: "image/png", bytes: pngFixture },
  ],
  docs: [{ path: "docs/mission.txt", mime: "text/plain", bytes: enc.encode("Don't execute me") }],
});
const validateNormalized = x => ({ valid: x?.formatId === "infrastructure-cyber-lab.scenario" });
const validateLayout = x => ({ valid: x?.formatId === "infrastructure-cyber-lab.layout" });
const opened = await openRuntimePackage(blob, { packageIO: io, validateNormalized, validateLayout, imageUrlHost: host });
ok(opened.ok, "student package opens with optional image-only media");
if (!opened.ok) process.exit(1);
ok(!!opened.media, "successful package open exposes ephemeral media separately from Engine state");
eq(opened.media.images.length, 2, "only the two image assets become preview URLs");
eq(opened.media.images.map(x => x.path), ["assets/a-photo.png", "assets/z-diagram.svg"], "asset preview ordering is stable");
eq(opened.media.images[1].trust, "sanitized-untrusted", "custom SVG retains untrusted designation");
eq(opened.media.images[0].trust, "untrusted-raster", "raster retains untrusted designation");
eq(opened.media.images[1].mime, "image/svg+xml", "strict MIME is retained");
eq(opened.media.images[1].size, enc.encode(safeSvg).byteLength, "sanitizer preserves exact accepted bytes");
ok(opened.media.images.every(x => x.objectUrl.startsWith("blob:")), "no remote or inline source URLs emitted");
eq(urls.length, 2, "browser host created exactly two ephemeral Blob URLs");
eq(urls[0].type, "image/png", "Blob MIME matches validated PNG");
eq(urls[1].type, "image/svg+xml", "Blob MIME matches validated SVG");
eq(await urls[1].text(), safeSvg, "SVG remains passive and byte-identical in preview Blob");
const jpegFixture = new Uint8Array(fs.readFileSync(path.join(root,"tests/fixtures/media/safe.jpg")));
const webpFixture = new Uint8Array(fs.readFileSync(path.join(root,"tests/fixtures/media/safe.webp")));
const extraHost = {created: [],revoked: [],createObjectURL(blob) {this.created.push(blob);return `blob:local/${this.created.length}`;},revokeObjectURL(url){this.revoked.push(url);}};
const extraMedia = createRuntimePackageMedia(new Map([
  ["assets/photo.jpg", {path:"assets/photo.jpg",mime:"image/jpeg",bytes:jpegFixture}],
  ["assets/photo.webp", {path:"assets/photo.webp",mime:"image/webp",bytes:webpFixture}],
]), extraHost);
eq(extraMedia.images.map(x=>x.mime),["image/jpeg","image/webp"],"verified JPEG and WebP get native image previews");
eq(extraHost.created.length,2,"both binary raster formats receive ephemeral URLs");
extraMedia.release();eq(extraHost.revoked.length,2,"JPEG and WebP URLs are revoked");
ok(opened.packageInfo.docs.length === 1 && !opened.media.images.some(x=>x.path.startsWith("docs/")), "documents never become rendered image media");
ok(!Object.hasOwn(opened.workspace, "media"), "no ephemeral URL leaks into mutable Runtime workspace/save data");
ok(!Object.hasOwn(opened.workspace.scenario, "media"), "no ephemeral URL leaks into scenario semantics");
opened.media.release();
eq(revoked.length, 2, "both Blob URLs revoked on Runtime cleanup");
opened.media.release();
eq(revoked.length, 2, "repeated cleanup is idempotent");
const without = await openRuntimePackage(blob, { packageIO: io, validateNormalized, validateLayout });
ok(without.ok && !without.media, "headless package opening remains media-independent");
eq(urls.length, 2, "headless package opening creates no URLs");
const appSource = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
ok(appSource.includes('data-package-media'), "actual browser source includes package image panel");
ok(appSource.includes('mediaRef.current?.release()'), "browser unmount releases media URLs");
ok(appSource.includes('releaseMedia();'), "browser mode switches release media URLs");
ok(!/dangerouslySetInnerHTML|\.innerHTML\s*=/.test(appSource), "browser never injects package SVG as inline DOM");
const go = fs.readFileSync(path.join(root, "launcher/server.go"), "utf8");
ok(go.includes("img-src 'self' blob:") && go.includes("object-src 'none'"), "loopback CSP permits local/blob images but forbids embeds");
console.log(`PASS package media suite: ${checks} assertions.`);
