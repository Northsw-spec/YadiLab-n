import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseIpAddress, parseCidr, addressInCidr } from "../../dist-engine-test/engine/src/ip.js";
import { computeEnterpriseBaselineIdentity, verifyEnterpriseBaseline } from "../../dist-enterprise-test/enterprise-model/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/enterprise-baseline.json"), "utf8"));
let assertions = 0;
function eq(actual, expected, label) { assert.deepEqual(actual, expected, label); assertions++; }
function yes(value, label) { assert.ok(value, label); assertions++; }

async function verifyFact(factId, valueType, value) {
  const baseline = structuredClone(fixture);
  const fact = baseline.facts.find((f) => f.factId === factId);
  yes(fact !== undefined, "fixture fact " + factId);
  fact.valueType = valueType;
  fact.value = value;
  baseline.baselineIdentity = await computeEnterpriseBaselineIdentity(baseline);
  return verifyEnterpriseBaseline(baseline);
}
async function rejectFact(factId, valueType, value) {
  const result = await verifyFact(factId, valueType, value);
  eq(result.ok, false, "reject " + valueType + " " + value);
  yes(result.diagnostics.some((d) => d.code === "ENTERPRISE_VALUE_TYPE_MISMATCH"), "type mismatch " + value);
  eq(result.diagnostics.some((d) => d.code === "ENTERPRISE_BASELINE_IDENTITY_MISMATCH"), false, "hash valid and not the rejection source");
}
async function acceptFact(factId, valueType, value) {
  const result = await verifyFact(factId, valueType, value);
  eq(result.ok, true, "accept " + valueType + " " + value + ": " + JSON.stringify(result.diagnostics));
}

// Malformed interface prefixes must not silently be converted into valid host addresses.
for (const value of [
  "192.0.2.7/", "192.0.2.7/garbage", "192.0.2.7/33",
  "192.0.2.7/024", "192.0.2.7/24/1", "192.0.2.7/+24",
  "192.0.2.7/ 24", "2001:db8::7/", "2001:db8::7/129",
  "2001:db8::7/64x", "2001:db8::7/64/1", "::ffff:192.0.2.7/999",
]) {
  eq(parseIpAddress(value), undefined, "invalid interface " + value);
  const target = value.includes(":") ? "2001:db8::/32" : "192.0.2.0/24";
  eq(addressInCidr(value, target), undefined, "invalid interface cannot establish network truth " + value);
}
for (const [value, family, subnet] of [
  ["192.0.2.7", 4, "192.0.2.0/24"],
  ["192.0.2.7/24", 4, "192.0.2.0/24"],
  ["2001:db8::7", 6, "2001:db8::/64"],
  ["2001:db8::7/64", 6, "2001:db8::/64"],
  ["::ffff:192.0.2.7/128", 6, "::ffff:192.0.2.0/120"],
]) {
  eq(parseIpAddress(value)?.family, family, "valid interface family " + value);
  eq(addressInCidr(value, subnet), true, "valid interface match " + value);
}

for (const value of [
  ":", "not:ipv6", "garbage:address/999", "2001:db8:::7",
  "2001:db8::7:", "2001:db8::7%eth0", "2001:db8::7/64",
  "::ffff:192.168.001.1", "1:2:3:4:5:6:7:8:9", "1234",
]) await rejectFact("fact_ip", "ipv6", value);
for (const value of ["::", "::1", "2001:db8::7", "1:2:3:4:5:6:7:8", "::ffff:192.0.2.7"]) {
  await acceptFact("fact_ip", "ipv6", value);
}
for (const value of [
  "10.0.0.0/", "999.1.2.3/24", "192.0.2.1/33", "192.0.2.1/00",
  "2001:db8:::1/64", "garbage:address/999", "2001:db8::7/129",
  "2001:db8::7/64junk", "2001:db8::7/", "::/0x10",
  "192.0.2.7", "2001:db8::7", "192.168.001.1/24",
]) await rejectFact("fact_network", "cidr", value);
for (const value of [
  "0.0.0.0/0", "192.0.2.1/32", "10.0.0.0/8",
  "::/0", "2001:db8::/64", "::ffff:192.0.2.7/128",
]) await acceptFact("fact_network", "cidr", value);
await rejectFact("fact_ip", "ipv4", "192.0.2.7/24");
await acceptFact("fact_ip", "ipv4", "192.0.2.7");
eq(parseCidr("2001:db8::7/64")?.prefix, 64, "valid IPv6 prefix survives");

// Conflicting sourced facts are checked candidate-by-candidate.
for (const [type, bad, good] of [
  ["ipv6", "garbage:address/999", "2001:db8::7"],
  ["cidr", "999.999.999.999/24", "192.0.2.0/24"],
]) {
  const baseline = structuredClone(fixture);
  const fact = baseline.facts.find((f) => f.state === "CONFLICTING");
  fact.valueType = type;
  fact.candidates[0].value = bad;
  fact.candidates[1].value = good;
  baseline.baselineIdentity = await computeEnterpriseBaselineIdentity(baseline);
  const result = await verifyEnterpriseBaseline(baseline);
  eq(result.ok, false, "conflicting malformed candidate rejected " + type);
  yes(result.diagnostics.some((d) => d.code === "ENTERPRISE_VALUE_TYPE_MISMATCH" && d.path.includes("/candidates/0/value")), "precise candidate locator " + type);
}
console.log("PASS AUDIT-007 P3: " + assertions + " Engine interface-prefix and Enterprise IPv4/IPv6/CIDR valueType source assertions");
