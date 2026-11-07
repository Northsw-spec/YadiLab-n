import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const base = new URL("../fixtures/import/ansible-ini/", import.meta.url);
const oracle = JSON.parse(readFileSync(new URL("oracles.json", base), "utf8"));
assert.equal(oracle.stage, "PREP_ONLY_NO_PARSER_AND_NO_UI");
assert.equal(oracle.profileId, "ansible.inventory.static.ini.v1");
assert.equal(oracle.semanticTrack, "CONFIG_DOCUMENTED");
assert.equal(oracle.positives.length, 6);
assert.equal(oracle.negatives.length, 12);
const all = [...oracle.positives, ...oracle.negatives];
assert.equal(new Set(all.map(x=>x.file)).size, all.length, "fixture paths unique");
const hashes = [];
for (const c of all) {
  assert.match(c.file, /^(valid|invalid)-[a-z-]+\.ini$/);
  const bytes = readFileSync(new URL(c.file, base));
  assert.ok(bytes.length > 0 && bytes.length <= oracle.limits.bytes, "bounded fixture source");
  assert.equal(bytes.includes(0), false, "fixture no embedded NUL");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.ok(text.trim().length > 0);
  hashes.push(createHash("sha256").update(bytes).digest("hex"));
  if (c.file.startsWith("valid-")) {
    assert.ok(c.hosts.length > 0 && new Set(c.hosts).size === c.hosts.length);
    assert.equal(c.links, 0, "no topology links in any positive oracle");
    for (const h of c.hosts) {
      assert.ok(text.includes(h), "expected host literal in fixture: " + h);
      assert.ok(Object.hasOwn(c.directGroups, h));
    }
    for (const h of c.unknown) assert.ok(c.hosts.includes(h));
    for (const h of Object.keys(c.addresses)) assert.ok(c.hosts.includes(h));
    for (const x of c.forbiddenOutputSubstrings ?? []) assert.ok(text.includes(x), "redaction canary must exist in source: " + x);
  } else {
    assert.match(c.code, /^ANSIBLE_INI_[A-Z_]+$/);
  }
}
assert.equal(new Set(hashes).size, hashes.length, "fixture bytes distinguish every contract case");
console.log("PASS ANSIBLE-INI-PREP-001: 18 fixtures and independent oracle INTEGRITY only; parser/browser NOT IMPLEMENTED or TESTED.");
