/**
 * PROJECT-093: one small, offline icon registry for topology semantics.
 *
 * The registry deliberately separates the thing represented by an icon from
 * role, status and logical badges.  Classification accepts only verified
 * source fields (resource type and explicit properties); labels and IP
 * addresses are never used to invent a device class.
 */

export type SemanticIconClass =
  | "resource"
  | "logical"
  | "place"
  | "presentation"
  | "link-attribute"
  | "service";

export type SemanticIconKey =
  | "switch"
  | "router"
  | "firewall"
  | "server"
  | "client"
  | "hypervisor"
  | "wireless"
  | "storage"
  | "security-service"
  | "logical-network"
  | "vlan"
  | "network-segment"
  | "place"
  | "presentation-group"
  | "link-attribute"
  | "service"
  | "unknown-resource"
  | "unknown-logical";

export interface SemanticIconDescriptor {
  readonly key: SemanticIconKey;
  readonly className: SemanticIconClass;
  readonly title: string;
  readonly accessibleName: string;
  readonly path: string;
  readonly viewBox: "0 0 24 24";
}

export interface ResourceIconClassification extends SemanticIconDescriptor {
  readonly roleLabel?: string;
  readonly badges: readonly string[];
}

const V = "0 0 24 24" as const;

// All paths are static local data.  They use a shared 24×24 viewBox and are
// intentionally simple enough to stay legible at 16–24px in compact views.
const ICONS: Readonly<Record<SemanticIconKey, SemanticIconDescriptor>> = {
  switch: { key: "switch", className: "resource", title: "Switch", accessibleName: "Network switch", viewBox: V, path: "M3 7h18v10H3z M6 10h2v2H6zm4 0h2v2h-2zm4 0h2v2h-2zm4 0h2v2h-2z M7 17v3m10-3v3" },
  router: { key: "router", className: "resource", title: "Router", accessibleName: "Network router", viewBox: V, path: "M4 8h16v8H4z M7 12h2m2 0h2m2 0h2 M12 8V4m0 0-2 2m2-2 2 2" },
  firewall: { key: "firewall", className: "resource", title: "Brandvägg", accessibleName: "Firewall", viewBox: V, path: "M4 5h16v14H4z M4 9h16M4 14h16M9 5v4m6-4v4M7 14v5m6-5v5m4-5v5" },
  server: { key: "server", className: "resource", title: "Server", accessibleName: "Server", viewBox: V, path: "M4 4h16v6H4zM4 14h16v6H4z M7 7h.01M7 17h.01M10 7h7M10 17h7" },
  client: { key: "client", className: "resource", title: "Klient", accessibleName: "Client device", viewBox: V, path: "M4 5h16v11H4z M9 20h6M12 16v4" },
  hypervisor: { key: "hypervisor", className: "resource", title: "Virtualiseringsvärd", accessibleName: "Hypervisor", viewBox: V, path: "M5 4h14v5H5zM5 11h14v5H5zM5 18h14v2H5z" },
  wireless: { key: "wireless", className: "resource", title: "Trådlös accesspunkt", accessibleName: "Wireless access point", viewBox: V, path: "M4 9a12 12 0 0 1 16 0M7 12a7 7 0 0 1 10 0M10 15a3 3 0 0 1 4 0M12 19h.01" },
  storage: { key: "storage", className: "resource", title: "Lagring", accessibleName: "Storage system", viewBox: V, path: "M4 5c0-2 16-2 16 0v14c0 2-16 2-16 0zM4 5c0 2 16 2 16 0M4 12c0 2 16 2 16 0" },
  "security-service": { key: "security-service", className: "service", title: "Säkerhetstjänst", accessibleName: "Security service", viewBox: V, path: "M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-4" },
  "logical-network": { key: "logical-network", className: "logical", title: "Logiskt nätverk", accessibleName: "Logical network", viewBox: V, path: "M5 5h4v4H5zM15 5h4v4h-4zM10 15h4v4h-4zM9 7h6M7 9v4h5m5-4v4h-3" },
  vlan: { key: "vlan", className: "logical", title: "VLAN", accessibleName: "Virtual LAN", viewBox: V, path: "M4 6h16v12H4zM8 10h8M8 14h5" },
  "network-segment": { key: "network-segment", className: "logical", title: "Nätverkssegment", accessibleName: "Network segment", viewBox: V, path: "M5 5h14v14H5zM8 8h8v8H8z" },
  place: { key: "place", className: "place", title: "Dokumenterad plats", accessibleName: "Documented place", viewBox: V, path: "M12 21s7-6.2 7-11A7 7 0 0 0 5 10c0 4.8 7 11 7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" },
  "presentation-group": { key: "presentation-group", className: "presentation", title: "Visningsgrupp", accessibleName: "Presentation group", viewBox: V, path: "M4 5h16v14H4zM8 9h3v3H8zm5 0h3v3h-3zM8 14h3v3H8zm5 0h3v3h-3z" },
  "link-attribute": { key: "link-attribute", className: "link-attribute", title: "Länkegenskap", accessibleName: "Link attribute", viewBox: V, path: "M8 12h8M10 7l2-2 2 2m-4 10 2 2 2-2M5 9h3v6H5zm11 0h3v6h-3z" },
  service: { key: "service", className: "service", title: "Tjänst", accessibleName: "Service", viewBox: V, path: "M5 5h14v14H5zM8 8h8v2H8zm0 4h8v2H8z" },
  "unknown-resource": { key: "unknown-resource", className: "resource", title: "Okänd enhet", accessibleName: "Unknown device", viewBox: V, path: "M4 4h16v16H4zM8 8h8v8H8zM10 10h4v4h-4z" },
  "unknown-logical": { key: "unknown-logical", className: "logical", title: "Okänt logiskt objekt", accessibleName: "Unknown logical object", viewBox: V, path: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4v5m0 3h.01" },
};

const TYPE_ICON_RULES: readonly [RegExp, SemanticIconKey, string][] = [
  [/firewall|ngfw|waf|ids|ips|ndr|vpn[_ -]?gateway|security[_ -]?appliance/i, "firewall", "Firewall"],
  [/switch|bridge|hub|repeater|media[_ -]?converter|network\.core|network\.distribution|network\.access/i, "switch", "Switch"],
  [/router|gateway|sd[_ -]?wan|load[_ -]?balancer|adc|proxy/i, "router", "Router"],
  [/wireless|access[_ -]?point|wlan|mesh/i, "wireless", "Wireless access point"],
  [/hypervisor|proxmox|vmware|esxi|hyper[-_ ]?v|kvm/i, "hypervisor", "Virtualization host"],
  [/nas|san|storage|backup/i, "storage", "Storage"],
  [/server|collector|siem|dns|dhcp|ntp|ldap|radius|api|container|lxc|rds/i, "server", "Server / service"],
  [/client|endpoint|workstation|desktop|laptop|windows|linux|macos|printer|phone|tablet|camera|iot|sensor/i, "client", "Client"],
];

export function iconDescriptor(key: SemanticIconKey): SemanticIconDescriptor {
  return ICONS[key] ?? ICONS["unknown-resource"];
}

export function iconRegistry(): readonly SemanticIconDescriptor[] {
  return Object.values(ICONS);
}

function explicitRole(properties: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of ["role", "networkRole", "deviceRole", "layer"]) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function classifyResourceIcon(
  resourceType: string,
  properties: Readonly<Record<string, unknown>> = {},
): ResourceIconClassification {
  const type = resourceType.trim();
  const rule = TYPE_ICON_RULES.find(([pattern]) => pattern.test(type));
  const descriptor = iconDescriptor(rule?.[1] ?? "unknown-resource");
  const role = explicitRole(properties);
  const badges = role ? [role] : [];
  return { ...descriptor, ...(rule?.[2] ? { roleLabel: rule[2] } : {}), badges };
}

export function classifyLogicalIcon(kind: string): SemanticIconDescriptor {
  const value = kind.trim().toLowerCase();
  if (value === "vlan" || value === "802.1q") return iconDescriptor("vlan");
  if (value === "segment" || value === "subnet" || value === "cidr" || value === "lan" || value === "wan") return iconDescriptor("network-segment");
  return iconDescriptor("unknown-logical");
}
