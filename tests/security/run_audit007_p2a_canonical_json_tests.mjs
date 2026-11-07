import assert from "node:assert/strict";
import { canonicalJson, webCryptoHashProvider } from "../../dist-compiler-test/compiler/src/canonical-json.js";
import { deepCloneJson, deepMergeObjects } from "../../dist-compiler-test/compiler/src/helpers.js";
import {
  canonicalEnterpriseJson, webCryptoEnterpriseHashProvider,
} from "../../dist-enterprise-test/enterprise-model/src/canonical.js";

let checks = 0;
function eq(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks++;
}
function neq(actual, expected, label) {
  assert.notDeepEqual(actual, expected, label);
  checks++;
}
function ok(value, label) {
  assert.ok(value, label);
  checks++;
}

const literalOwnProto = JSON.parse('{"__proto__":{"permission":"allow"}}');
const normalEmpty = {};
eq(Object.hasOwn(literalOwnProto, "__proto__"), true, "input has a literal own data property");
eq(Object.getPrototypeOf(literalOwnProto), Object.prototype, "original parsed JSON not poisoned");
for (const [label, stringify, sha] of [
  ["compiler", canonicalJson, webCryptoHashProvider.sha256Utf8],
  ["enterprise", canonicalEnterpriseJson, webCryptoEnterpriseHashProvider.sha256Utf8],
]) {
  const actual = stringify(literalOwnProto);
  eq(actual, '{"__proto__":{"permission":"allow"}}',
    label + " canonicalized literal own __proto__ bytes must survive");
  neq(actual, stringify(normalEmpty), label + " distinct parsed JSON cannot canonicalize to empty object");
  neq(await sha(actual), await sha(stringify(normalEmpty)),
    label + " distinct JSON content cannot yield same SHA-256");
  eq(stringify(JSON.parse('{"b":2,"a":{"z":9,"c":3}}')),
    '{"a":{"c":3,"z":9},"b":2}', label + " existing deterministic sorted-object order");
  eq(stringify(JSON.parse('{"a":1,"b":2}')),
    stringify(JSON.parse('{"b":2,"a":1}')), label + " source key insertion order invariant");
  eq(stringify({ first: undefined, second: "visible" }),
    '{"second":"visible"}', label + " retains JSON undefined omission contract");
  eq(stringify([3, { z: 2, a: 1 }, "ok"]),
    '[3,{"a":1,"z":2},"ok"]', label + " arrays and primitive values retained");
  const nested = JSON.parse('{"rows":[{"__proto__":{"rowAllow":true},"safe":1}],"nested":{"__proto__":{"nestedAllow":true},"id":2}}');
  const canonical = stringify(nested);
  eq(JSON.parse(canonical), nested, label + " nested/array own keys are present in canonical JSON");
  ok(canonical.includes('"__proto__"'), label + " malicious magic key not erased");
}
const input = JSON.parse('{"__proto__":{"privilege":"admin"},"nested":{"__proto__":{"enabled":true},"a":1},"items":[{"__proto__":{"trusted":true},"x":"yes"}]}');
const clone = deepCloneJson(input);
eq(clone, input, "deep cloned JSON exactly including own magic keys");
eq(Object.getPrototypeOf(clone), Object.prototype, "clone root has safe prototype");
eq(Object.hasOwn(clone, "__proto__"), true, "clone root own magic field preserved");
eq(clone.privilege, undefined, "no inherited privilege in cloned root");
eq(Object.getPrototypeOf(clone.nested), Object.prototype, "clone nested prototype safe");
eq(Object.hasOwn(clone.nested, "__proto__"), true, "clone nested own magic field preserved");
eq(clone.nested.enabled, undefined, "no inherited enabled property");
eq(Object.hasOwn(clone.items[0], "__proto__"), true, "clone array item magic field preserved");
eq(clone.items[0].trusted, undefined, "no inherited trusted field");
ok(clone !== input && clone.nested !== input.nested,
  "clone creates independent objects");
const base = JSON.parse('{"__proto__":{"fromBase":true},"network":{"a":1},"shared":"old"}');
const override = JSON.parse('{"__proto__":{"fromOverride":true},"network":{"b":2},"shared":"new"}');
const beforeBase = JSON.stringify(base);
const beforeOverride = JSON.stringify(override);
const merged = deepMergeObjects(base, override);
const expected = JSON.parse('{"__proto__":{"fromBase":true,"fromOverride":true},"network":{"a":1,"b":2},"shared":"new"}');
eq(merged, expected, "literal __proto__ deeply merged as data, not prototype");
eq(Object.getPrototypeOf(merged), Object.prototype, "merged root stays ordinary data object");
eq(Object.hasOwn(merged, "__proto__"), true, "merge own magic field retained");
eq(merged.fromOverride, undefined, "no inherited fake merge authority");
eq(merged.network, {a:1,b:2}, "normal nested deep merge still works");
eq(JSON.stringify(base), beforeBase, "source base unchanged");
eq(JSON.stringify(override), beforeOverride, "source override unchanged");
eq(deepMergeObjects({}, {x:{a:1}}), {x:{a:1}}, "ordinary merge unaffected");
eq(Object.getPrototypeOf({}), Object.prototype, "global Object prototype not changed");
console.log("PASS AUDIT-007 P2a: " + checks +
  " source/Enterprise canonical SHA noncollision and prototype-safe JSON clone/deep merge assertions");
