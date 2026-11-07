import assert from "node:assert/strict";
import { parseIpAddress, parseCidr, addressInCidr } from "../../dist-engine-test/engine/src/ip.js";
import { deepCloneJson } from "../../dist-engine-test/engine/src/json.js";

let checks = 0;
function eq(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  checks++;
}
function ok(actual, message) {
  assert.ok(actual, message);
  checks++;
}

// Reject malformed addresses, rather than dropping stray IPv6 colons.
for (const value of [
  "2001:db8:::1", ":1::2", "1::2:", "2001:db8::1:", ":::",
  "1:2:3:4:5:6:7:8:", "1:::2", "2001:db8::1::",
  "192.168.001.1", "01.2.3.4", "001.002.003.004",
  "256.1.2.3", "192.168.1", "192.168.1.2.3",
  "::ffff:192.168.001.1",
]) eq(parseIpAddress(value), undefined, "malformed IP address: " + value);
for (const [value, family] of [
  ["0.0.0.0", 4], ["255.255.255.255", 4], ["192.0.2.1", 4],
  ["::", 6], ["::1", 6], ["2001:db8::", 6], ["2001:db8::1", 6],
  ["0:0:0:0:0:0:0:0", 6], ["1:2:3:4:5:6:7:8", 6],
  ["::ffff:192.0.2.1", 6], ["2001:db8:0:1:2:3:192.0.2.1", 6],
]) {
  const parsed = parseIpAddress(value);
  ok(parsed !== undefined, "valid IP remains accepted: " + value);
  eq(parsed?.family, family, "valid IP family: " + value);
}
for (const value of [
  "10.0.0.0/", "10.0.0.0/ ", "10.0.0.0/ 0", "10.0.0.0/+0",
  "10.0.0.0/-0", "10.0.0.0/00", "10.0.0.0/01", "10.0.0.0/0x10",
  "10.0.0.0/1e1", "10.0.0.0/1.0", "10.0.0.0/33",
  "::/129", "::/001", "::/0x10", "2001:db8:::1/64",
]) eq(parseCidr(value), undefined, "malformed CIDR: " + value);
for (const [value, prefix, family] of [
  ["0.0.0.0/0", 0, 4], ["192.0.2.3/32", 32, 4],
  ["192.0.2.1", 32, 4], ["::/0", 0, 6],
  ["2001:db8::/64", 64, 6], ["::ffff:192.0.2.1/128", 128, 6],
  ["::ffff:192.0.2.1", 128, 6],
]) {
  const parsed = parseCidr(value);
  ok(parsed, "valid CIDR: " + value);
  eq(parsed.prefix, prefix, "valid prefix: " + value);
  eq(parsed.address.family, family, "valid address family: " + value);
}
eq(addressInCidr("203.0.113.7", "10.0.0.0/"), undefined,
  "missing mask must not manufacture all-host match");
eq(addressInCidr("203.0.113.7", "0.0.0.0/0"), true,
  "explicit default IPv4 CIDR still matches");
eq(addressInCidr("203.0.113.7", "10.0.0.0/8"), false,
  "known nonmatching CIDR still FALSE");
eq(addressInCidr("2001:db8::5", "2001:db8::/64"), true,
  "valid IPv6 subnet still matches");
eq(addressInCidr("2001:db9::5", "2001:db8::/64"), false,
  "valid IPv6 subnet mismatch still FALSE");
eq(addressInCidr("2001:db8:::1", "::/0"), undefined,
  "malformed IPv6 cannot match valid all-host IPv6 route");

// JSON.parse permits an own "__proto__" key. It is data, not an
// instruction to alter the prototype of our private deep clone.
const original = JSON.parse('{"__proto__":{"inheritedAllow":true},"safe":"ok","nested":{"__proto__":{"nestedAllow":true},"count":2},"rows":[{"__proto__":{"rowAllow":true},"valid":1}]}');
const clone = deepCloneJson(original);
eq(Object.getPrototypeOf(clone), Object.prototype,
  "root object keeps native Object prototype");
eq(Object.hasOwn(clone, "__proto__"), true, "preserve root own data key");
eq(clone.inheritedAllow, undefined, "no inherited fake policy flag");
eq(Object.getPrototypeOf(clone.nested), Object.prototype,
  "nested object prototype unchanged");
eq(Object.hasOwn(clone.nested, "__proto__"), true, "preserve nested own data key");
eq(clone.nested.nestedAllow, undefined, "nested fake policy flag not inherited");
eq(Object.getPrototypeOf(clone.rows[0]), Object.prototype,
  "array object prototype unchanged");
eq(Object.hasOwn(clone.rows[0], "__proto__"), true,
  "preserve array-row own data key");
eq(clone.rows[0].rowAllow, undefined, "array row fake policy flag not inherited");
eq(clone, original, "the clone preserves JSON data exactly");
ok(clone !== original && clone.nested !== original.nested,
  "deep clone does not alias original");
eq(Object.getPrototypeOf({}), Object.prototype,
  "global Object prototype not affected");

console.log("PASS AUDIT-007 P1: " + checks +
  " IP/CIDR, route/ACL predicate and own JSON prototype-clone security assertions");
