import assert from "node:assert/strict";
import fs from "node:fs";
const journey=fs.readFileSync("ui/src/browser/visual-journey.ts","utf8"); const main=fs.readFileSync("ui/app/main.mjs","utf8");
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++;};
for(const kind of ["dhcp.dora","dns.resolve","tcp.state","udp.failure","icmp.failure"]) ok(journey.includes(`\"${kind}\"`),`${kind} is a typed Engine event kind`);
for(const field of ["dhcpDoraDecision","dnsChainDecision","tcpStateMachineDecision","udpIcmpFailureDecision"]) ok(journey.includes(field),`${field} remains attached to visual events`);
for(const label of ["DNS Chain X-Ray","DHCP DORA X-Ray","TCP State Machine X-Ray"]) ok(main.includes(label),`${label} is rendered in the living UI`);
ok(main.includes("NOT_MODELED"),"unmodeled host/protocol behavior remains explicit"); ok(!journey.includes("Math.random"),"host/protocol projections are deterministic");
console.log(`PASS dev30 host/protocol living visualization contract: ${checks} assertions.`);
