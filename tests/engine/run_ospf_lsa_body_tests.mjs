import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState, queryReachability,
  verifyOspfLsaBinary, parseOspfLsaBody,
  OSPF_LSA_BODY_FORMAT, OSPF_LSA_BODY_VERSION,
  OSPF_LSA_BODY_MAX_ROUTER_LINKS, OSPF_LSA_BODY_MAX_TOS_PER_LINK,
  OSPF_LSA_BODY_MAX_ATTACHED_ROUTERS,
} from "../../dist-engine-test/engine/src/index.js";

// Independently computed constant RFC 2328 Fletcher vectors. Production code
// can only VALIDATE them, never manufacture or repair their checksums.
const ROUTER_FOUR =
  "006402010a0000020a000002800000018238004c" +
  "070000040a000009c00002020101000a08000064" +
  "c0000201c000020202000005" +
  "c6336400ffffff0003000014" +
  "0a00000bc00002020400001e";
const NETWORK_TWO =
  "00640202c00002010a0000028000000178f20020" +
  "ffffff000a0000020a000009";
const ROUTER_ZERO = "006402010a0000020a0000028000000182c8001800000000";
const NETWORK_ONE = "00640202c00002010a0000028000000183fe001cffffff000a000002";
const bytes = (hex) => Array.from(Buffer.from(hex, "hex"));
const word = (value) => [(value >>> 8) & 255, value & 255];
const address = (s) => s.split(".").map(Number);
const routerBytes = bytes(ROUTER_FOUR);
const networkBytes = bytes(NETWORK_TWO);

/** Test fixture constructor only: independent RFC 2328 Fletcher arithmetic. */
function reseal(input) {
  const b = [...input];
  b[16] = 0;
  b[17] = 0;
  b[18] = (b.length >>> 8) & 255;
  b[19] = b.length & 255;
  let sum0 = 0;
  let sum1 = 0;
  for (let i = 2; i < b.length; i++) {
    sum0 = (sum0 + b[i]) % 255;
    sum1 = (sum1 + sum0) % 255;
  }
  const x = (((b.length - 2) - 15) * sum0 - sum1 + 255 * 512) % 255;
  const y = (510 - sum0 - x) % 255;
  b[16] = x;
  b[17] = y;
  let check0 = 0, check1 = 0;
  for (let i = 2; i < b.length; i++) {
    check0 = (check0 + b[i]) % 255;
    check1 = (check1 + check0) % 255;
  }
  assert.deepEqual([check0, check1], [0, 0], "independently resealed raw fixture");
  return b;
}
function mutation(original, modifications) {
  const b = [...original];
  for (const [i, value] of modifications) b[i] = value;
  return reseal(b);
}
let count = 0;
const eq = (a,b,label) => { assert.deepEqual(a,b,label); count++; };
const yes = (a,label) => { assert.ok(a,label); count++; };
function pass(raw,label) {
  const result = parseOspfLsaBody(raw);
  eq(result.ok, true, label);
  return result.lsa;
}
function rejected(raw,code) {
  const result = parseOspfLsaBody(raw);
  eq(result.ok, false, "reject " + code);
  eq(result.code, code, "specific diagnostic");
}

eq(OSPF_LSA_BODY_FORMAT, "yadilab.engine.ospfv2-lsa-body-structure", "format source contract");
eq(OSPF_LSA_BODY_VERSION, "1.0.0", "versioned independent parser");
eq(OSPF_LSA_BODY_MAX_ROUTER_LINKS, 128, "bounded link allocation");
eq(OSPF_LSA_BODY_MAX_TOS_PER_LINK, 16, "bounded legacy TOS fields");
eq(OSPF_LSA_BODY_MAX_ATTACHED_ROUTERS, 128, "bounded network router count");
eq(reseal(routerBytes),routerBytes,"fixed Router-LSA checksum oracle matches RFC");
eq(reseal(networkBytes),networkBytes,"fixed Network-LSA checksum oracle matches RFC");
const router = pass(routerBytes, "4-link Router-LSA with legacy TOS");
eq(router.kind,"ROUTER_LSA_BODY","explicit Router-LSA body type");
eq(router.header.lsaType,1,"generic Type 1 unchanged");
eq(router.header.length,76,"four independent links and one extra TOS");
eq(router.header.lsChecksum,0x8238,"fixed Router Fletcher checksum");
eq(router.header.linkStateId,"10.0.0.2","Router LSA ID");
eq(router.virtualLinkEndpoint,true,"V capability bit");
eq(router.asBoundaryRouter,true,"E capability bit");
eq(router.areaBorderRouter,true,"B capability bit");
eq(router.links.length,4,"exact #links 16-bit field");
eq(router.links.map(x=>x.type),[1,2,3,4],"four RFC link kinds");
eq(router.links.map(x=>x.metric),[10,5,20,30],"base metrics preserved in order");
eq(router.links[0].linkId,"10.0.0.9","P2P neighbor Router ID");
eq(router.links[0].linkData,"192.0.2.2","P2P link data raw 32-bit value");
eq(router.links[0].tosMetrics,[{tos:8,metric:100}],"legacy TOS parsed accurately");
eq(router.links[1].linkId,"192.0.2.1","transit link DR interface IP");
eq(router.links[1].linkData,"192.0.2.2","transit local interface IP");
eq(router.links[2].linkId,"198.51.100.0","stub network ID");
eq(router.links[2].linkData,"255.255.255.0","stub network mask");
eq(router.links[3].linkId,"10.0.0.11","virtual neighbor Router ID");
eq(router.links[3].metric,30,"virtual link base metric");
const r0 = pass(bytes(ROUTER_ZERO),"zero-link Router-LSA structural validity");
eq(r0.links,[],"zero link count is structurally unambiguous");
eq(r0.virtualLinkEndpoint,false,"zero V bit");
eq(r0.areaBorderRouter,false,"zero B bit");

const network = pass(networkBytes,"Network LSA with two attached routers");
eq(network.kind,"NETWORK_LSA_BODY","explicit network type");
eq(network.header.lsChecksum,0x78f2,"fixed network Fletcher checksum");
eq(network.header.length,32,"2 router IDs + 4-byte mask");
eq(network.header.linkStateId,"192.0.2.1","DR interface identifies network LSA");
eq(network.networkMask,"255.255.255.0","network mask parsed");
eq(network.maskPrefixLength,24,"contiguous mask prefix");
eq(network.attachedRouterIds,["10.0.0.2","10.0.0.9"],
  "actual stored order and DR self inclusion");
const one = pass(bytes(NETWORK_ONE),"single DR-listed Network-LSA structurally readable");
eq(one.attachedRouterIds,["10.0.0.2"],"structural parse does not claim Full adjacency");

rejected([], "OSPF_LSA_BYTES_INVALID");
const badChecksum = [...routerBytes];badChecksum[30] ^= 1;
rejected(badChecksum,"OSPF_LSA_FLETCHER_INVALID");
const badLength = [...routerBytes];badLength[19] = 77;
rejected(badLength,"OSPF_LSA_LENGTH_MISMATCH");
rejected(mutation(routerBytes,[[3,5]]),"OSPF_LSA_HEADER_INVALID");
rejected(mutation(routerBytes,[[20,0x87]]),"OSPF_ROUTER_LSA_FLAGS_RESERVED");
rejected(mutation(routerBytes,[[21,1]]),"OSPF_ROUTER_LSA_FLAGS_RESERVED");
rejected(mutation(routerBytes,[[22,0],[23,5]]),"OSPF_ROUTER_LSA_LINK_TRUNCATED");
rejected(mutation(routerBytes,[[22,0],[23,3]]),"OSPF_ROUTER_LSA_LENGTH_INVALID");
rejected(mutation(routerBytes,[[22,0],[23,129]]),"OSPF_ROUTER_LSA_LINK_LIMIT");
rejected(mutation(routerBytes,[[32,0]]),"OSPF_ROUTER_LSA_LINK_TYPE_INVALID");
rejected(mutation(routerBytes,[[32,5]]),"OSPF_ROUTER_LSA_LINK_TYPE_INVALID");
rejected(mutation(routerBytes,[[24,0],[25,0],[26,0],[27,0]]),
  "OSPF_ROUTER_LSA_LINK_ID_INVALID");
rejected(mutation(routerBytes,[[33,17]]),"OSPF_ROUTER_LSA_TOS_LIMIT");
rejected(mutation(routerBytes,[[73,1]]),"OSPF_ROUTER_LSA_TOS_TRUNCATED");
rejected(mutation(routerBytes,[[36,0]]),"OSPF_ROUTER_LSA_TOS_INVALID");
rejected(mutation(routerBytes,[[37,1]]),"OSPF_ROUTER_LSA_TOS_INVALID");
rejected(mutation(routerBytes,[[56,0xf7]]),"OSPF_ROUTER_LSA_STUB_MASK_INVALID");

// One extra repeated TOS entry in the first link, with all lengths and
// Fletcher recomputed. Invalid because the same TOS repeats on that link.
const doubled=[...routerBytes.slice(0,40),8,0,0,99,...routerBytes.slice(40)];
doubled[33]=2;
rejected(reseal(doubled),"OSPF_ROUTER_LSA_TOS_INVALID");

// Malformed network body re-Fletcher-sealed: independent checksum success
// must never be mistaken for complete semantic field validation.
rejected(mutation(networkBytes,[[20,0xf7]]),"OSPF_NETWORK_LSA_MASK_INVALID");
rejected(mutation(networkBytes,[[28,10],[29,0],[30,0],[31,2]]),
  "OSPF_NETWORK_LSA_ROUTER_INVALID");
rejected(mutation(networkBytes,[[28,0],[29,0],[30,0],[31,0]]),
  "OSPF_NETWORK_LSA_ROUTER_INVALID");
rejected(mutation(networkBytes,[[24,10],[25,0],[26,0],[27,10]]),
  "OSPF_NETWORK_LSA_DR_NOT_LISTED");
rejected(reseal(bytes(NETWORK_TWO).slice(0,24)),"OSPF_LSA_NETWORK_BODY_INVALID");
const malformedNetwork=[...networkBytes,1];malformedNetwork[19]=33;
rejected(malformedNetwork,"OSPF_LSA_NETWORK_BODY_INVALID");

// Validate the generic raw-byte verifier independently of body interpretation.
// A correct Fletcher and header is a necessary, insufficient precondition.
eq(verifyOspfLsaBinary(mutation(routerBytes,[[32,5]])).ok,true,
   "checksum-valid unsupported Router link kind still generic-LSA valid");
eq(verifyOspfLsaBinary(mutation(networkBytes,[[20,0xf7]])).ok,true,
   "checksum-valid noncontiguous mask passes generic header only");

// A host route (/32) as a stub network is explicitly valid in RFC 2328.
// Mutate the existing stub to /32 and a host Link ID, resealing its checksum.
const host=mutation(routerBytes,[
  [52,198],[53,51],[54,100],[55,10],
  [56,255],[57,255],[58,255],[59,255],
]);
const hostParsed=pass(host,"RFC /32 host route as stub link");
eq(hostParsed.links[2].linkData,"255.255.255.255","host network mask preserved");
const noMask=mutation(networkBytes,[[20,0],[21,0],[22,0],[23,0]]);
eq(pass(noMask,"syntactically contiguous zero mask").maskPrefixLength,0,
  "prefix zero does not claim a valid originated network");

function assembledRouter(links) {
  const head=bytes(ROUTER_ZERO).slice(0,20);
  const body=[0,0,...word(links.length)];
  for(let i=0;i<links.length;i++){
    body.push(...address("10.0.0.9"),...address("192.0.2.2"),1,0,...word(i+1));
  }
  return reseal([...head,...body]);
}
const maxRouter=pass(assembledRouter(Array.from({length:128},(_,i)=>i)),
  "128 bounded router link descriptions");
eq(maxRouter.links.length,128,"max router links processed");
rejected(assembledRouter(Array.from({length:129},(_,i)=>i)),
  "OSPF_ROUTER_LSA_LINK_LIMIT");

function assembledNetwork(n) {
  const head=bytes(NETWORK_ONE).slice(0,20);
  const body=[...address("255.255.255.0")];
  for(let i=0;i<n;i++)body.push(...address("10.0.0."+(i+2)));
  return reseal([...head,...body]);
}
const maxNetwork=pass(assembledNetwork(128),"128 bounded attached routers");
eq(maxNetwork.attachedRouterIds.length,128,"network bound exact");
rejected(assembledNetwork(129),"OSPF_NETWORK_LSA_ATTACHED_LIMIT");

// Defensive copying: parsed values never refer to the caller's mutable array.
const original=routerBytes.slice();
const parsed=pass(original,"defensive body parsing");
original[30]^=1;
eq(parsed.bytes[30],routerBytes[30],"saved bytes unaffected by later caller mutation");
eq(parsed.links[0].linkId,"10.0.0.9","saved links unaffected by caller mutation");

const baseline=JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json","utf8"));
const routerResource=id=>({id,type:"network.router",label:id,interfaces:[],properties:{},
  asset:{id:"network.router",version:"1.0.0"}});
const scenario={...baseline,scenarioId:"lsa-body-pure-test",sourceHash:"6".repeat(64),
  resources:[...baseline.resources,routerResource("lsa-body-a")]};
const engine=createInitialEngineState(scenario);
const reach=queryReachability(scenario,engine,"attacker","rds01","tcp",3389);
eq(engine.stateRevision,0,"Engine revision unchanged by raw parse");
eq(engine.resources["lsa-body-a"].properties,{},"resource properties unmodified");
eq(queryReachability(scenario,engine,"attacker","rds01","tcp",3389).truth,
  reach.truth,"parser cannot modify network reachability");
function replay() {
  return JSON.stringify([
    parseOspfLsaBody(routerBytes),
    parseOspfLsaBody(networkBytes),
    parseOspfLsaBody(host),
    parseOspfLsaBody(mutation(routerBytes,[[33,17]])),
    parseOspfLsaBody(mutation(networkBytes,[[20,0xf7]])),
  ]);
}
const baselineReplay=replay();
for(let i=0;i<1000;i++) eq(replay(),baselineReplay,
  "1000 identical raw LSA decoding and rejection replays");
console.log("PASS CONVERGENCE OSPFv2 Router/Network LSA bodies: "+count+
  " assertions; 1000 identical replays");
