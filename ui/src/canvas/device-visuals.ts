import type { NormalizedScenario } from "../../../core-model/src/generated/contracts.js";

export type DeviceVisualFamily =
  | "router"
  | "switch"
  | "firewall"
  | "server"
  | "client"
  | "hypervisor"
  | "actor"
  | "generic";

export interface DeviceVisualDescriptor {
  readonly family: DeviceVisualFamily;
  readonly roleLabel: string;
}

export type SemanticLinkTone = "network" | "management" | "trust" | "authentication" | "dependency" | "data-flow";

export interface SemanticLinkDescriptor {
  readonly tone: SemanticLinkTone;
  readonly kindLabel: string;
  readonly enabled: boolean;
  readonly direction: "forward" | "reverse" | "bidirectional" | "unspecified";
  readonly vlanLabel?: string;
  readonly accessibleLabel: string;
}

const EXACT_DEVICE_VISUALS: Readonly<Record<string, DeviceVisualDescriptor>> = {
  "network.router": { family: "router", roleLabel: "Router" },
  "network.gateway": { family: "router", roleLabel: "Gateway" },
  "network.vpn_gateway": { family: "router", roleLabel: "VPN gateway" },
  "network.switch": { family: "switch", roleLabel: "Switch" },
  "network.l2_switch": { family: "switch", roleLabel: "L2 switch" },
  "network.l3_switch": { family: "switch", roleLabel: "L3 switch" },
  "network.firewall": { family: "firewall", roleLabel: "Firewall" },
  "endpoint.windows": { family: "client", roleLabel: "Windows client" },
  "endpoint.linux": { family: "client", roleLabel: "Linux client" },
  "endpoint.macos": { family: "client", roleLabel: "macOS client" },
  "windows.workstation": { family: "client", roleLabel: "Windows client" },
  "linux.workstation": { family: "client", roleLabel: "Linux client" },
  "virtualization.hypervisor": { family: "hypervisor", roleLabel: "Hypervisor" },
  "virtualization.proxmox": { family: "hypervisor", roleLabel: "Virtualization host" },
  "actor.user": { family: "actor", roleLabel: "User" },
  "actor.admin": { family: "actor", roleLabel: "Administrator" },
  "actor.attacker": { family: "actor", roleLabel: "External actor" },
};

export function describeDeviceVisual(resourceType: string): DeviceVisualDescriptor {
  const normalized = resourceType.trim().toLowerCase();
  const exact = EXACT_DEVICE_VISUALS[normalized];
  if (exact) return exact;
  const segments = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
  const has = (...values: readonly string[]): boolean => values.some((value) => segments.has(value));
  if (has("firewall", "ids", "ips", "ndr")) {
    return { family: "firewall", roleLabel: "Security appliance" };
  }
  if (has("switch", "bridge", "vswitch")) {
    return { family: "switch", roleLabel: "Switch / bridge" };
  }
  if (has("router", "gateway", "proxy") || (segments.has("load") && segments.has("balancer"))) {
    return { family: "router", roleLabel: "Network gateway" };
  }
  if (has("hypervisor", "proxmox")) {
    return { family: "hypervisor", roleLabel: "Virtualization host" };
  }
  if (has("workstation", "endpoint", "client")) {
    return { family: "client", roleLabel: "Client" };
  }
  if (
    has("server", "collector", "siem", "backup", "storage", "dns", "dhcp", "vm", "container", "lxc")
    || (segments.has("domain") && segments.has("controller"))
    || (segments.has("rds") && segments.has("host"))
  ) {
    return { family: "server", roleLabel: "Server / service" };
  }
  if (normalized.startsWith("actor.")) return { family: "actor", roleLabel: "Actor" };
  return { family: "generic", roleLabel: "Resource" };
}

const LINK_PRESENTATION: Readonly<Record<NormalizedScenario["connections"][number]["kind"], { readonly tone: SemanticLinkTone; readonly label: string }>> = {
  network: { tone: "network", label: "NETWORK" },
  management: { tone: "management", label: "MGMT" },
  trust: { tone: "trust", label: "TRUST" },
  authentication: { tone: "authentication", label: "AUTH" },
  dependency: { tone: "dependency", label: "DEPENDENCY" },
  data_flow: { tone: "data-flow", label: "DATA" },
};

function explicitDirection(value: unknown): SemanticLinkDescriptor["direction"] {
  if (value === "forward" || value === "reverse" || value === "bidirectional") return value;
  return "unspecified";
}

function explicitVlanLabel(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4094) return `VLAN ${value}`;
  if (typeof value === "string" && /^(?:[0-9]{1,4}|[A-Za-z0-9_.-]{1,32})$/.test(value)) return `VLAN ${value}`;
  return undefined;
}

export function describeSemanticLink(
  kind: NormalizedScenario["connections"][number]["kind"],
  properties: Readonly<Record<string, unknown>>,
): SemanticLinkDescriptor {
  const presentation = LINK_PRESENTATION[kind];
  const enabled = properties.enabled !== false;
  const direction = explicitDirection(properties.direction);
  const vlanLabel = explicitVlanLabel(properties.vlan);
  const directionLabel = direction === "forward" ? "FORWARD" : direction === "reverse" ? "REVERSE" : direction === "bidirectional" ? "BIDIRECTIONAL" : undefined;
  const accessibleLabel = [presentation.label, vlanLabel, directionLabel, enabled ? undefined : "DISABLED"].filter(Boolean).join(" · ");
  return {
    tone: presentation.tone,
    kindLabel: presentation.label,
    enabled,
    direction,
    ...(vlanLabel ? { vlanLabel } : {}),
    accessibleLabel,
  };
}
