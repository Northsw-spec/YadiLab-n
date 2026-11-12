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
  | "core-switch"
  | "distribution-switch"
  | "access-switch"
  | "l3-switch"
  | "switch"
  | "router"
  | "firewall"
  | "gateway"
  | "modem"
  | "load-balancer"
  | "wireless-ap"
  | "wlan-controller"
  | "server"
  | "web-server"
  | "database"
  | "dns"
  | "dhcp"
  | "directory"
  | "radius"
  | "ntp"
  | "mail-server"
  | "client"
  | "desktop"
  | "laptop"
  | "mobile"
  | "tablet"
  | "printer"
  | "thin-client"
  | "voip-phone"
  | "camera"
  | "iot"
  | "plc-sensor"
  | "hypervisor"
  | "virtual-machine"
  | "container"
  | "kubernetes"
  | "wireless"
  | "storage"
  | "nas"
  | "san"
  | "backup"
  | "object-storage"
  | "security-service"
  | "ids"
  | "ips"
  | "waf"
  | "proxy"
  | "siem"
  | "nac"
  | "bastion"
  | "logical-network"
  | "vlan"
  | "subnet"
  | "lan"
  | "wan"
  | "dmz"
  | "vpn"
  | "vrf"
  | "vxlan"
  | "trunk"
  | "ssid"
  | "internet"
  | "network-segment"
  | "place"
  | "building"
  | "site"
  | "rack"
  | "floor"
  | "documented-zone"
  | "presentation-group"
  | "link-attribute"
  | "ethernet"
  | "fiber"
  | "sfp"
  | "poe"
  | "lag-lacp"
  | "service"
  | "database-service"
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
  "core-switch": { key: "core-switch", className: "resource", title: "Core-switch", accessibleName: "Core network switch", viewBox: V, path: "M2 6h20v12H2zM5 9h3v3H5zm5 0h3v3h-3zm5 0h3v3h-3zM4 18v3m16-3v3" },
  "distribution-switch": { key: "distribution-switch", className: "resource", title: "Distributionsswitch", accessibleName: "Distribution switch", viewBox: V, path: "M3 5h18v14H3zM6 8h12M6 12h12M6 16h12M8 5v14M16 5v14" },
  "access-switch": { key: "access-switch", className: "resource", title: "Access-switch", accessibleName: "Access switch", viewBox: V, path: "M4 7h16v10H4zM6 10h2v2H6zm4 0h2v2h-2zm4 0h2v2h-2zm4 0h1v2h-1M8 17v3m8-3v3" },
  "l3-switch": { key: "l3-switch", className: "resource", title: "L3-switch", accessibleName: "Layer 3 switch", viewBox: V, path: "M3 4h18v16H3zM6 7h4v4H6zm8 0h4v4h-4zM6 14h4v4H6zm8 0h4v4h-4zM10 9h4M10 16h4" },
  switch: { key: "switch", className: "resource", title: "Switch", accessibleName: "Network switch", viewBox: V, path: "M3 7h18v10H3z M6 10h2v2H6zm4 0h2v2h-2zm4 0h2v2h-2zm4 0h2v2h-2z M7 17v3m10-3v3" },
  router: { key: "router", className: "resource", title: "Router", accessibleName: "Network router", viewBox: V, path: "M4 8h16v8H4z M7 12h2m2 0h2m2 0h2 M12 8V4m0 0-2 2m2-2 2 2" },
  firewall: { key: "firewall", className: "resource", title: "Brandvägg", accessibleName: "Firewall", viewBox: V, path: "M4 5h16v14H4z M4 9h16M4 14h16M9 5v4m6-4v4M7 14v5m6-5v5m4-5v5" },
  gateway: { key: "gateway", className: "resource", title: "Gateway", accessibleName: "Network gateway", viewBox: V, path: "M4 4h16v16H4zM8 8h8v8H8zM4 12H1m22 0h-3M12 4V1m0 22v-3" },
  modem: { key: "modem", className: "resource", title: "Modem", accessibleName: "Modem", viewBox: V, path: "M3 14h18v6H3zM6 14V8h12v6M8 10h2m2 0h2m2 0h2M7 20v2m10-2v2" },
  "load-balancer": { key: "load-balancer", className: "resource", title: "Lastbalanserare", accessibleName: "Load balancer", viewBox: V, path: "M3 5h7v5H3zM14 5h7v5h-7zM8 18h8v5H8zM10 10v3h4v-3M12 13v5" },
  "wireless-ap": { key: "wireless-ap", className: "resource", title: "Trådlös accesspunkt", accessibleName: "Wireless access point", viewBox: V, path: "M2 11a15 15 0 0 1 20 0M5 14a10 10 0 0 1 14 0M8 17a5 5 0 0 1 8 0M12 21h.01" },
  "wlan-controller": { key: "wlan-controller", className: "resource", title: "WLAN-controller", accessibleName: "Wireless LAN controller", viewBox: V, path: "M4 4h16v16H4zM8 8h8v8H8zM12 2v4m0 12v4M2 12h4m12 0h4" },
  server: { key: "server", className: "resource", title: "Server", accessibleName: "Server", viewBox: V, path: "M4 4h16v6H4zM4 14h16v6H4z M7 7h.01M7 17h.01M10 7h7M10 17h7" },
  "web-server": { key: "web-server", className: "resource", title: "Webbserver", accessibleName: "Web server", viewBox: V, path: "M3 4h18v16H3zM3 8h18M7 6h.01M10 6h.01M13 6h.01M7 12h10v4H7z" },
  database: { key: "database", className: "resource", title: "Databas", accessibleName: "Database", viewBox: V, path: "M4 5c0-3 16-3 16 0v14c0 3-16 3-16 0zM4 5c0 3 16 3 16 0M4 12c0 3 16 3 16 0" },
  dns: { key: "dns", className: "service", title: "DNS", accessibleName: "Domain name service", viewBox: V, path: "M12 2l3 4-3 4-3-4zM4 18l4-3 4 3-4 3zM16 18l4-3 4 3-4 3zM12 10v4M8 15h8" },
  dhcp: { key: "dhcp", className: "service", title: "DHCP", accessibleName: "Dynamic host configuration service", viewBox: V, path: "M3 6h18v12H3zM6 9h3v3H6zm5 0h3v3h-3zm5 0h3v3h-3zM6 15h12" },
  directory: { key: "directory", className: "service", title: "Katalogtjänst", accessibleName: "Directory service", viewBox: V, path: "M3 5h18v4H3zM3 11h18v4H3zM3 17h18v2H3zM6 7h.01M6 13h.01" },
  radius: { key: "radius", className: "service", title: "RADIUS", accessibleName: "RADIUS authentication service", viewBox: V, path: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2M12 1v2M12 21v2M3 12H1m22 0h-2" },
  ntp: { key: "ntp", className: "service", title: "NTP", accessibleName: "Network time service", viewBox: V, path: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l4 2M5 5l-2-2M19 5l2-2" },
  "mail-server": { key: "mail-server", className: "service", title: "E-postserver", accessibleName: "Mail server", viewBox: V, path: "M3 5h18v14H3zM3 7l9 7 9-7M7 11l-4 4m14-4 4 4" },
  client: { key: "client", className: "resource", title: "Klient", accessibleName: "Client device", viewBox: V, path: "M4 5h16v11H4z M9 20h6M12 16v4" },
  desktop: { key: "desktop", className: "resource", title: "Skrivbord", accessibleName: "Desktop computer", viewBox: V, path: "M3 4h18v12H3zM8 20h8M12 16v4M6 7h12v6H6z" },
  laptop: { key: "laptop", className: "resource", title: "Bärbar dator", accessibleName: "Laptop", viewBox: V, path: "M5 5h14v10H5zM2 18h20l-2 2H4zM8 8h8v5H8z" },
  mobile: { key: "mobile", className: "resource", title: "Mobil", accessibleName: "Mobile phone", viewBox: V, path: "M7 2h10v20H7zM10 5h4M11 19h2" },
  tablet: { key: "tablet", className: "resource", title: "Surfplatta", accessibleName: "Tablet", viewBox: V, path: "M4 3h16v18H4zM8 6h8v10H8zM11 18h2" },
  printer: { key: "printer", className: "resource", title: "Skrivare", accessibleName: "Printer", viewBox: V, path: "M6 8V3h12v5M5 17H3V9h18v8h-2M6 14h12v7H6zM8 11h2" },
  "thin-client": { key: "thin-client", className: "resource", title: "Tunn klient", accessibleName: "Thin client", viewBox: V, path: "M4 5h16v10H4zM8 18h8v3H8zM10 8h4v4h-4z" },
  "voip-phone": { key: "voip-phone", className: "resource", title: "IP-telefon", accessibleName: "Voice over IP phone", viewBox: V, path: "M5 4h4l2 5-3 2c1 3 3 5 6 6l2-3 5 2v4c-8 2-16-6-16-16z" },
  camera: { key: "camera", className: "resource", title: "Kamera", accessibleName: "Network camera", viewBox: V, path: "M3 7h5l2-3h4l2 3h5v12H3zM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" },
  iot: { key: "iot", className: "resource", title: "IoT-enhet", accessibleName: "Internet of things device", viewBox: V, path: "M9 3h6v4h4v6h-4v4H9v-4H5V7h4zM12 7v10M9 10h6" },
  "plc-sensor": { key: "plc-sensor", className: "resource", title: "PLC-sensor", accessibleName: "PLC or industrial sensor", viewBox: V, path: "M3 5h8v14H3zM13 8h8v8h-8zM6 8h2m-2 4h2m-2 4h2M15 12h4" },
  hypervisor: { key: "hypervisor", className: "resource", title: "Virtualiseringsvärd", accessibleName: "Hypervisor", viewBox: V, path: "M5 4h14v5H5zM5 11h14v5H5zM5 18h14v2H5z" },
  "virtual-machine": { key: "virtual-machine", className: "resource", title: "Virtuell maskin", accessibleName: "Virtual machine", viewBox: V, path: "M4 4h16v12H4zM8 8h8v4H8zM7 19h10M12 16v3" },
  container: { key: "container", className: "resource", title: "Container", accessibleName: "Application container", viewBox: V, path: "M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8" },
  kubernetes: { key: "kubernetes", className: "resource", title: "Kubernetes", accessibleName: "Kubernetes cluster", viewBox: V, path: "M12 2l8 5v10l-8 5-8-5V7zM12 7v10M7 10l10 4M17 10 7 14" },
  wireless: { key: "wireless", className: "resource", title: "Trådlös accesspunkt", accessibleName: "Wireless access point", viewBox: V, path: "M4 9a12 12 0 0 1 16 0M7 12a7 7 0 0 1 10 0M10 15a3 3 0 0 1 4 0M12 19h.01" },
  storage: { key: "storage", className: "resource", title: "Lagring", accessibleName: "Storage system", viewBox: V, path: "M4 5c0-2 16-2 16 0v14c0 2-16 2-16 0zM4 5c0 2 16 2 16 0M4 12c0 2 16 2 16 0" },
  nas: { key: "nas", className: "resource", title: "NAS", accessibleName: "Network attached storage", viewBox: V, path: "M4 4h16v16H4zM7 7h10v3H7zm0 5h10v3H7zm3 6h4" },
  san: { key: "san", className: "resource", title: "SAN", accessibleName: "Storage area network", viewBox: V, path: "M3 6h6v5H3zM15 6h6v5h-6zM9 17h6v5H9zM9 8h6M6 11v6h12v-6" },
  backup: { key: "backup", className: "resource", title: "Backup", accessibleName: "Backup system", viewBox: V, path: "M12 3a9 9 0 1 0 9 9M12 3v5h5M12 8v8l5 3" },
  "object-storage": { key: "object-storage", className: "resource", title: "Objektlagring", accessibleName: "Object storage", viewBox: V, path: "M5 4h14v16H5zM8 7h8v3H8zm0 5h8v3H8zm0 5h5" },
  "security-service": { key: "security-service", className: "service", title: "Säkerhetstjänst", accessibleName: "Security service", viewBox: V, path: "M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-4" },
  ids: { key: "ids", className: "service", title: "IDS", accessibleName: "Intrusion detection system", viewBox: V, path: "M3 5h18v14H3zM6 15l3-4 3 2 3-6 3 4" },
  ips: { key: "ips", className: "service", title: "IPS", accessibleName: "Intrusion prevention system", viewBox: V, path: "M12 2l8 4v6c0 5-3 8-8 10-5-2-8-5-8-10V6zM8 12h8M12 8v8" },
  waf: { key: "waf", className: "service", title: "WAF", accessibleName: "Web application firewall", viewBox: V, path: "M3 5h18v14H3zM6 8h12v8H6zM9 11h6v2H9" },
  proxy: { key: "proxy", className: "service", title: "Proxy", accessibleName: "Proxy service", viewBox: V, path: "M4 4h6v6H4zM14 14h6v6h-6zM10 7h4v10h-4M7 10v4h10" },
  siem: { key: "siem", className: "service", title: "SIEM", accessibleName: "Security information and event management", viewBox: V, path: "M3 4h18v5H3zM3 11h18v5H3zM3 18h18v2H3zM7 6h.01M7 13h.01" },
  nac: { key: "nac", className: "service", title: "NAC", accessibleName: "Network access control", viewBox: V, path: "M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6zM9 12l2 2 4-5" },
  bastion: { key: "bastion", className: "service", title: "Bastion", accessibleName: "Bastion host", viewBox: V, path: "M3 19h18M5 19V9h14v10M8 9V5h8v4M9 13h6v3H9z" },
  "logical-network": { key: "logical-network", className: "logical", title: "Logiskt nätverk", accessibleName: "Logical network", viewBox: V, path: "M5 5h4v4H5zM15 5h4v4h-4zM10 15h4v4h-4zM9 7h6M7 9v4h5m5-4v4h-3" },
  vlan: { key: "vlan", className: "logical", title: "VLAN", accessibleName: "Virtual LAN", viewBox: V, path: "M4 6h16v12H4zM8 10h8M8 14h5" },
  subnet: { key: "subnet", className: "logical", title: "Subnet", accessibleName: "IP subnet", viewBox: V, path: "M3 3h8v8H3zM13 13h8v8h-8zM11 7h2v10h-2M7 11v2h10v-2" },
  lan: { key: "lan", className: "logical", title: "LAN", accessibleName: "Local area network", viewBox: V, path: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7 12h10M12 7v10" },
  wan: { key: "wan", className: "logical", title: "WAN", accessibleName: "Wide area network", viewBox: V, path: "M3 12h18M12 3c3 3 3 15 0 18M12 3C9 6 9 18 12 21M5 7h14M5 17h14" },
  dmz: { key: "dmz", className: "logical", title: "DMZ", accessibleName: "Demilitarized zone", viewBox: V, path: "M3 4h18v16H3zM3 9h18M9 4v16M15 4v16" },
  vpn: { key: "vpn", className: "logical", title: "VPN", accessibleName: "Virtual private network", viewBox: V, path: "M4 5h16v14H4zM8 12a4 4 0 0 1 8 0v4H8zM10 12v-2a2 2 0 0 1 4 0v2" },
  vrf: { key: "vrf", className: "logical", title: "VRF", accessibleName: "Virtual routing and forwarding", viewBox: V, path: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6zM10 7h4M7 10v4M17 10v4M10 17h4" },
  vxlan: { key: "vxlan", className: "logical", title: "VXLAN", accessibleName: "Virtual extensible LAN", viewBox: V, path: "M3 7l9-5 9 5-9 5zM3 12l9 5 9-5M3 17l9 5 9-5" },
  trunk: { key: "trunk", className: "logical", title: "Trunk", accessibleName: "Network trunk", viewBox: V, path: "M3 6h18v4H3zM3 14h18v4H3zM8 10v4M16 10v4" },
  ssid: { key: "ssid", className: "logical", title: "SSID", accessibleName: "Wireless network identifier", viewBox: V, path: "M3 10a13 13 0 0 1 18 0M6 13a8 8 0 0 1 12 0M9 16a4 4 0 0 1 6 0M12 20h.01" },
  internet: { key: "internet", className: "logical", title: "Internet", accessibleName: "Internet", viewBox: V, path: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2c3 3 3 17 0 20M5 5l14 14" },
  "network-segment": { key: "network-segment", className: "logical", title: "Nätverkssegment", accessibleName: "Network segment", viewBox: V, path: "M5 5h14v14H5zM8 8h8v8H8z" },
  place: { key: "place", className: "place", title: "Dokumenterad plats", accessibleName: "Documented place", viewBox: V, path: "M12 21s7-6.2 7-11A7 7 0 0 0 5 10c0 4.8 7 11 7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" },
  building: { key: "building", className: "place", title: "Byggnad", accessibleName: "Building", viewBox: V, path: "M4 21V4h10v17M14 9h6v12M7 7h3M7 11h3M7 15h3M16 13h2M16 17h2" },
  site: { key: "site", className: "place", title: "Plats", accessibleName: "Site", viewBox: V, path: "M3 20h18M5 20V9l7-6 7 6v11M9 20v-5h6v5M12 3v6" },
  rack: { key: "rack", className: "place", title: "Rack", accessibleName: "Equipment rack", viewBox: V, path: "M5 3h14v18H5zM8 6h8v3H8zm0 5h8v3H8zm0 5h8v3H8M7 7h.01M7 12h.01M7 17h.01" },
  floor: { key: "floor", className: "place", title: "Våningsplan", accessibleName: "Floor", viewBox: V, path: "M3 8l9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5" },
  "documented-zone": { key: "documented-zone", className: "place", title: "Dokumenterad zon", accessibleName: "Documented zone", viewBox: V, path: "M3 5h18v14H3zM7 9h10v6H7zM9 5v4M15 5v4" },
  "presentation-group": { key: "presentation-group", className: "presentation", title: "Visningsgrupp", accessibleName: "Presentation group", viewBox: V, path: "M4 5h16v14H4zM8 9h3v3H8zm5 0h3v3h-3zM8 14h3v3H8zm5 0h3v3h-3z" },
  "link-attribute": { key: "link-attribute", className: "link-attribute", title: "Länkegenskap", accessibleName: "Link attribute", viewBox: V, path: "M8 12h8M10 7l2-2 2 2m-4 10 2 2 2-2M5 9h3v6H5zm11 0h3v6h-3z" },
  ethernet: { key: "ethernet", className: "link-attribute", title: "Ethernet", accessibleName: "Ethernet link", viewBox: V, path: "M3 8h6v8H3zM15 8h6v8h-6zM9 12h6M6 8V5h12v3M6 16v3h12v-3" },
  fiber: { key: "fiber", className: "link-attribute", title: "Fiber", accessibleName: "Fiber optic link", viewBox: V, path: "M3 6h6v12H3zM15 6h6v12h-6zM9 9h6M9 12h6M9 15h6" },
  sfp: { key: "sfp", className: "link-attribute", title: "SFP", accessibleName: "Small form-factor pluggable transceiver", viewBox: V, path: "M4 4h16v16H4zM7 7h4v10H7zm6 0h4v10h-4zM11 9h2M11 15h2" },
  poe: { key: "poe", className: "link-attribute", title: "PoE", accessibleName: "Power over Ethernet", viewBox: V, path: "M13 2L5 13h6l-1 9 8-11h-6z" },
  "lag-lacp": { key: "lag-lacp", className: "link-attribute", title: "LAG/LACP", accessibleName: "Link aggregation", viewBox: V, path: "M3 7h7v4H3zM14 7h7v4h-7zM3 15h7v4H3zM14 15h7v4h-7zM10 9h4M10 17h4" },
  service: { key: "service", className: "service", title: "Tjänst", accessibleName: "Service", viewBox: V, path: "M5 5h14v14H5zM8 8h8v2H8zm0 4h8v2H8z" },
  "database-service": { key: "database-service", className: "service", title: "Databastjänst", accessibleName: "Database service", viewBox: V, path: "M4 5c0-2 16-2 16 0v14c0 2-16 2-16 0zM4 5c0 2 16 2 16 0M8 10h8M8 14h8" },
  "unknown-resource": { key: "unknown-resource", className: "resource", title: "Okänd enhet", accessibleName: "Unknown device", viewBox: V, path: "M4 4h16v16H4zM8 8h8v8H8zM10 10h4v4h-4z" },
  "unknown-logical": { key: "unknown-logical", className: "logical", title: "Okänt logiskt objekt", accessibleName: "Unknown logical object", viewBox: V, path: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4v5m0 3h.01" },
};

const TYPE_ICON_RULES: readonly [RegExp, SemanticIconKey, string][] = [
  [/network\.core|core[_ -]?switch/i, "core-switch", "Core switch"],
  [/network\.distribution|distribution[_ -]?switch/i, "distribution-switch", "Distribution switch"],
  [/access[_ -]?switch/i, "access-switch", "Access switch"],
  [/l3[_ -]?switch/i, "l3-switch", "L3 switch"],
  [/firewall|ngfw/i, "firewall", "Firewall"],
  [/^ids(?:\.|$)/i, "ids", "Intrusion detection system"],
  [/^ips(?:\.|$)/i, "ips", "Intrusion prevention system"],
  [/^waf(?:\.|$)/i, "waf", "Web application firewall"],
  [/nac/i, "nac", "Network access control"],
  [/siem/i, "siem", "Security information and event management"],
  [/bastion/i, "bastion", "Bastion host"],
  [/proxy/i, "proxy", "Proxy"],
  [/network\.access|switch|bridge|hub|repeater|media[_ -]?converter/i, "switch", "Switch"],
  [/load[_ -]?balancer|adc/i, "load-balancer", "Load balancer"],
  [/router|gateway|sd[_ -]?wan/i, "router", "Router"],
  [/modem/i, "modem", "Modem"],
  [/wlan[_ -]?controller/i, "wlan-controller", "WLAN controller"],
  [/wireless|access[_ -]?point|wlan|mesh/i, "wireless-ap", "Wireless access point"],
  [/hypervisor|proxmox|vmware|esxi|hyper[-_ ]?v|kvm/i, "hypervisor", "Virtualization host"],
  [/virtual[_ -]?machine|vm\./i, "virtual-machine", "Virtual machine"],
  [/container|lxc/i, "container", "Container"],
  [/kubernetes|k8s/i, "kubernetes", "Kubernetes"],
  [/nas/i, "nas", "NAS"],
  [/san/i, "san", "SAN"],
  [/backup/i, "backup", "Backup"],
  [/object[_ -]?storage/i, "object-storage", "Object storage"],
  [/database|sql|postgres|mysql|mongo/i, "database", "Database"],
  [/web[_ -]?server/i, "web-server", "Web server"],
  [/dns/i, "dns", "DNS service"],
  [/dhcp/i, "dhcp", "DHCP service"],
  [/directory|ldap|active[_ -]?directory/i, "directory", "Directory service"],
  [/radius/i, "radius", "RADIUS service"],
  [/ntp/i, "ntp", "NTP service"],
  [/mail|smtp|imap/i, "mail-server", "Mail server"],
  [/server|collector|api|rds/i, "server", "Server / service"],
  [/desktop|workstation/i, "desktop", "Desktop computer"],
  [/laptop/i, "laptop", "Laptop"],
  [/mobile|phone/i, "mobile", "Mobile device"],
  [/tablet/i, "tablet", "Tablet"],
  [/printer/i, "printer", "Printer"],
  [/thin[_ -]?client/i, "thin-client", "Thin client"],
  [/voip/i, "voip-phone", "VoIP phone"],
  [/camera/i, "camera", "Network camera"],
  [/iot/i, "iot", "IoT device"],
  [/plc|sensor/i, "plc-sensor", "PLC / sensor"],
  [/client|endpoint|windows|linux|macos/i, "client", "Client"],
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
  // Keep the PROJECT-093 contract: a generic subnet/segment label is the
  // logical network-segment silhouette.  The dedicated `subnet` descriptor
  // remains available for source records that explicitly request it.
  if (value === "subnet" || value === "cidr" || value === "segment") return iconDescriptor("network-segment");
  if (value === "lan") return iconDescriptor("lan");
  if (value === "wan") return iconDescriptor("wan");
  if (value === "dmz") return iconDescriptor("dmz");
  if (value === "vpn") return iconDescriptor("vpn");
  if (value === "vrf") return iconDescriptor("vrf");
  if (value === "vxlan") return iconDescriptor("vxlan");
  if (value === "trunk") return iconDescriptor("trunk");
  if (value === "ssid") return iconDescriptor("ssid");
  if (value === "internet") return iconDescriptor("internet");
  return iconDescriptor("unknown-logical");
}
