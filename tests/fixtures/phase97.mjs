import fs from "node:fs";
export function udpIcmpScenario(os = "linux") {
  const doc = JSON.parse(fs.readFileSync(new URL("./valid/scenario-normalized.json", import.meta.url)));
  doc.resources = [
    { id: "client", type: `${os}.workstation`, label: "Client", asset: { id: "linux.client", version: "1.0.0" }, interfaces: [{ id: "c0", addresses: ["10.97.0.10/24"], mac: "02:00:00:00:97:10" }], properties: {} },
    { id: "server", type: "linux.server", label: "Server", asset: { id: "linux.server", version: "1.0.0" }, interfaces: [{ id: "s0", addresses: ["10.97.0.20/24"], mac: "02:00:00:00:97:20" }], properties: {
      services: [{ name: "datagram", enabled: true, protocol: "udp", port: 5300 }],
      hostStack: { complete: true, processes: [{ id: "proc", name: "datagramd", service: "datagram" }], sockets: [{ id: "socket", protocol: "udp", localAddress: "0.0.0.0", localPort: 5300, state: "BOUND", processId: "proc", service: "datagram" }] },
    } },
  ];
  doc.connections = [{ id: "cs", kind: "network", from: { resource: "client", port: "c0" }, to: { resource: "server", port: "s0" }, properties: {} }];
  return doc;
}
export const server = (doc) => doc.resources.find(row => row.id === "server");
export function switchedScenario() {
  const doc = udpIcmpScenario();
  doc.resources.push({ id: "switch", type: "network.switch", label: "Switch", asset: { id: "network.switch", version: "1.0.0" }, interfaces: [{ id: "p1", addresses: [] }, { id: "p2", addresses: [] }], properties: {
    stp: { protocol: "RSTP", bridgeId: "32768.020000009701", rootBridgeId: "32768.020000009701", rootPathCost: 0 },
    stpPorts: [{ interface: "p1", role: "DESIGNATED", state: "FORWARDING", bpdu: "SEND" }, { interface: "p2", role: "ALTERNATE", state: "BLOCKING", bpdu: "RECEIVE" }],
  } });
  doc.connections = [
    { id: "cw", kind: "network", from: { resource: "client", port: "c0" }, to: { resource: "switch", port: "p1" }, properties: {} },
    { id: "ws", kind: "network", from: { resource: "switch", port: "p2" }, to: { resource: "server", port: "s0" }, properties: {} },
  ];
  return doc;
}
export function natScenario() {
  const doc = switchedScenario();
  const box = doc.resources.find(row => row.id === "switch");
  box.type = "network.firewall";
  box.properties = { rules: [], defaultAction: "allow", natPolicy: "required", natRules: [{ id: "udp-dnat", type: "dnat", source: "client", destination: "server", protocol: "udp", externalPort: 15300, translatedPort: 5300 }] };
  return doc;
}
