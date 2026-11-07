import assert from "node:assert/strict";
import fs from "node:fs";
import { describeDeviceVisual, describeSemanticLink, projectScenarioToCanvas } from "../../dist-canvas-test/ui/src/canvas/index.js";

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };
const ok = (value, message) => { assert.ok(value, message); checks += 1; };

eq(describeDeviceVisual("network.router").family, "router", "router uses router chassis");
eq(describeDeviceVisual("network.switch").family, "switch", "switch uses switch chassis");
eq(describeDeviceVisual("network.firewall").family, "firewall", "firewall uses security chassis");
eq(describeDeviceVisual("windows.rds_host").family, "server", "RDS host uses server chassis");
eq(describeDeviceVisual("windows.workstation").family, "client", "workstation uses client chassis");
eq(describeDeviceVisual("virtualization.proxmox").family, "hypervisor", "Proxmox uses hypervisor chassis");

const management = describeSemanticLink("management", { vlan: 300, direction: "forward" });
eq(management.tone, "management", "management link has distinct tone");
eq(management.vlanLabel, "VLAN 300", "declared VLAN is visible");
eq(management.direction, "forward", "declared direction is visible");
eq(management.accessibleLabel, "MGMT · VLAN 300 · FORWARD", "semantic link label is deterministic");

const scenario = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json", "utf8"));
const adminResource = scenario.resources.find((resource) => resource.id === "admin01");
adminResource.interfaces = [{ id: "eth0", label: "eth0", addresses: ["10.20.30.40/24"], mac: "02:00:00:00:00:40" }];
const adminLink = scenario.connections.find((connection) => connection.id === "admin_rds");
adminLink.from.port = "eth0";
const projected = projectScenarioToCanvas(scenario);
const admin = projected.nodes.find((node) => node.id === "admin01");
const link = projected.edges.find((edge) => edge.id === "admin_rds");
eq(admin.data.deviceFamily, "client", "projected node carries visual family");
eq(admin.data.deviceRoleLabel, "Windows client", "projected node carries accessible role");
eq(admin.data.interfaces.length, 1, "modeled interface projects as one visible port anchor");
eq(admin.data.interfaces[0], {
  interfaceId: "eth0",
  label: "eth0",
  addresses: ["10.20.30.40/24"],
  mac: "02:00:00:00:00:40",
  stateLabel: "DECLARED",
  sourceHandleId: "out:eth0",
  targetHandleId: "in:eth0",
}, "port anchor preserves only modeled interface facts");
eq(link.sourceHandle, "out:eth0", "semantic edge binds to the declared source interface");
eq(link.data.visual.kindLabel, "MGMT", "projected link carries semantic presentation");
eq(link.data.visual.enabled, true, "missing enabled flag is not rendered as disabled");

const main = fs.readFileSync("ui/app/main.mjs", "utf8");
const css = fs.readFileSync("ui/app/app.css", "utf8");
for (const token of ["function DeviceChassis", "data-device-family", "data-port-state", "data-link-activity", "data-connection-kind", "PORTS NOT MODELED"]) {
  ok(main.includes(token), `browser device renderer includes ${token}`);
}
for (const token of [".chassis-router", ".switch-port-bank", ".firewall-bricks", ".server-bays", ".client-monitor", ".semantic-edge.tone-management", ".zone-heading", ".link-led.active"]) {
  ok(css.includes(token), `Phase B stylesheet includes ${token}`);
}

console.log(`PASS real device visuals functional: ${checks}`);
