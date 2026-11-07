// Engine and Enterprise use the same pure address grammar. Keep this
// compatibility module so existing Engine imports remain unchanged.
export { parseIpAddress, parseCidr, addressInCidr } from "../../core-model/src/network-address.js";
export type { ParsedIpAddress, ParsedCidr } from "../../core-model/src/network-address.js";
