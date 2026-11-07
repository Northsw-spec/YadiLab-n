import React from "react";
const e = React.createElement;

// Only called with a validated Journey model. No protocol/timeout inference here.
export function UdpIcmpFailureXRay({ trace }) {
  if (!trace) return null;
  return e("section", {
    className: `host-stack-xray udp-icmp-failure-xray truth-${trace.truth.toLowerCase()}`,
    "data-udp-icmp-xray": "ready", "data-udp-icmp-protocol": trace.protocol,
    "data-udp-icmp-truth": trace.truth, "data-udp-icmp-disposition": trace.disposition,
    "aria-label": `UDP / ICMP Failure X-Ray for ${trace.destinationId}`,
  },
  e("div", { className: "host-stack-heading" },
    e("strong", null, "UDP / ICMP Failure X-Ray"), e("span", { className: `journey-verdict ${trace.truth.toLowerCase()}` }, trace.truth)),
  e("div", { className: "host-stack-summary" },
    e("span", { "data-udp-icmp-endpoints": "ready" }, `${trace.sourceId} → ${trace.destinationId} · ${trace.protocol.toUpperCase()}`),
    ...(trace.protocol === "udp" ? [e("span", { key: "port", "data-udp-requested-port": trace.port, "data-udp-effective-port": trace.effectiveDestinationPort }, `UDP port: ${trace.port} → effective destination ${trace.effectiveDestinationPort}`)] : []),
    ...(trace.translatedSource ? [e("span", { key: "source" }, `Translated source: ${trace.translatedSource}`)] : []),
    e("span", { "data-udp-icmp-network-truth": trace.networkTruth }, `Network/policy gate: ${trace.networkTruth}`),
    e("span", { "data-udp-icmp-policy-truth": trace.policyTruth }, `Policy: ${trace.policyTruth}`),
    e("span", { "data-udp-icmp-listener-truth": trace.listenerTruth }, `Listener: ${trace.listenerTruth}${trace.listenerModel ? ` · ${trace.listenerModel} · ${trace.listenerDisposition}` : ""}`),
    e("span", null, `Engine distinction: ${trace.disposition}`),
    e("span", { "data-udp-icmp-wire-evidence": trace.icmpEvidence }, `ICMP wire type/code / unreachable evidence: ${trace.icmpEvidence}`),
    e("span", null, `Reply: ${trace.reply} · timeout: ${trace.timeout} · retries: ${trace.retries}`)),
  e("p", { className: "host-stack-proof" }, trace.explanation.join(" ")),
  e("small", { className: "host-stack-proof" }, "ENGINE TRACE · UI performs no UDP/ICMP failure inference, listener test, reply generation or timeout simulation. UDP is connectionless; a request-path decision is not proof of an Echo Reply or application response."));
}
