import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UdpIcmpFailureXRay } from "../../ui/app/udp-icmp-xray.mjs";
import { createInitialEngineState, queryReachability } from "../../dist-visual-journey-test/engine/src/index.js";
import { udpIcmpScenario, server, natScenario } from "../fixtures/phase97.mjs";
let checks = 0;
const check = (v,m) => { assert.ok(v,m); checks++; };
for (const [doc, protocol, port] of [[udpIcmpScenario(), "udp", 5300], [udpIcmpScenario(), "icmp"], [natScenario(), "udp", 15300]]) {
  const result = queryReachability(doc, createInitialEngineState(doc), "client", "server", protocol, port);
  const trace = result.value.udpIcmpFailureDecision;
  const html = renderToStaticMarkup(React.createElement(UdpIcmpFailureXRay, { trace }));
  check(html.includes(`data-udp-icmp-disposition="${trace.disposition}"`), "actual React render preserves Engine distinction");
  check(html.includes(`data-udp-icmp-truth="${trace.truth}"`), "actual render truth bound");
  check(html.includes('data-udp-icmp-wire-evidence="NOT_MODELED"'), "no fake observed ICMP");
  check(html.includes('Reply: NOT_MODELED · timeout: NOT_MODELED · retries: NOT_MODELED'), "no fake reply, timeout, retries");
  check(html.includes('ENGINE TRACE'), "explicit provenance");
  check(protocol === "udp" ? html.includes(`data-udp-effective-port="${trace.effectiveDestinationPort}"`) : !html.includes('data-udp-effective-port'), "ICMP portless / UDP transformed port exact");
}
const doc = udpIcmpScenario(); server(doc).properties.hostStack.sockets = [];
const trace = queryReachability(doc, createInitialEngineState(doc), "client", "server", "udp", 5300).value.udpIcmpFailureDecision;
const html = renderToStaticMarkup(React.createElement(UdpIcmpFailureXRay, { trace }));
check(html.includes('data-udp-icmp-network-truth="TRUE"') && html.includes('data-udp-icmp-listener-truth="FALSE"'), "no listener does not look like unreachable network");
check(renderToStaticMarkup(React.createElement(UdpIcmpFailureXRay, { trace: undefined })) === "", "no Engine trace, no invented overlay");
const escaped = renderToStaticMarkup(React.createElement(UdpIcmpFailureXRay, { trace: { ...trace, sourceId: "<script>" } }));
check(escaped.includes('&lt;script&gt;') && !escaped.includes('<script>'), "untrusted identity is text, not HTML");
console.log(`PASS Phase97 X-Ray React-render contract: ${checks} assertions (not real-browser acceptance).`);
