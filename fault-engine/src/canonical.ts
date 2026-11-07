import type { FaultGenerationPlan, FaultOverlay, FaultPack } from "../../core-model/src/generated/contracts.js";
import type { FaultHashProvider } from "./types.js";

function normalizedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (value !== null && typeof value === "object") {
    const source = value as Readonly<Record<string, unknown>>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) if (source[key] !== undefined) out[key] = normalizedJson(source[key]);
    return out;
  }
  return value;
}
export function canonicalFaultJson(value: unknown): string { return JSON.stringify(normalizedJson(value)); }
export const webCryptoFaultHashProvider: FaultHashProvider = {
  async sha256Utf8(input: string): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable in this runtime");
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2,"0")).join("");
  },
};
function sortStrings(x: readonly string[]): string[] { return [...x].sort((a,b)=>a.localeCompare(b,"en")); }
export function faultPackIdentityProjection(pack: FaultPack): unknown {
  return {
    formatId: pack.formatId, schemaVersion: pack.schemaVersion, packId: pack.packId, version: pack.version, domain: pack.domain,
    faults: [...pack.faults].sort((a,b)=>a.faultId.localeCompare(b.faultId,"en")).map((f)=>({
      ...f,
      targetBindings:[...f.targetBindings].sort((a,b)=>a.name.localeCompare(b.name,"en")).map((b)=>({...b,resourceTypes:sortStrings(b.resourceTypes)})),
      incompatibilities:sortStrings(f.incompatibilities),
      mutations:[...f.mutations].sort((a,b)=>a.mutationId.localeCompare(b.mutationId,"en")),
      blastRadius:{...f.blastRadius,allowedBindings:sortStrings(f.blastRadius.allowedBindings)}, tags:sortStrings(f.tags), learningObjectives:[...f.learningObjectives],
    })),
  };
}
export async function computeFaultPackIdentity(pack: FaultPack, hash: FaultHashProvider=webCryptoFaultHashProvider): Promise<string> {
  return hash.sha256Utf8(canonicalFaultJson(faultPackIdentityProjection(pack)));
}
export function overlayIdentityProjection(overlay: FaultOverlay): unknown {
  return { ...overlay, overlayIdentity: undefined, packLocks:[...overlay.packLocks].sort((a,b)=>a.packId.localeCompare(b.packId,"en")||a.version.localeCompare(b.version,"en")) };
}
export async function computeFaultOverlayIdentity(overlay: FaultOverlay, hash: FaultHashProvider=webCryptoFaultHashProvider): Promise<string> {
  return hash.sha256Utf8(canonicalFaultJson(overlayIdentityProjection(overlay)));
}
export async function computeFaultApplicationHash(instance: FaultOverlay["instances"][number], hash: FaultHashProvider=webCryptoFaultHashProvider): Promise<string> {
  return hash.sha256Utf8(canonicalFaultJson({...instance, applicationHash:undefined}));
}

export function faultGenerationPlanIdentityProjection(plan: FaultGenerationPlan): unknown {
  return {
    ...plan,
    planIdentity: undefined,
    packLocks: [...plan.packLocks].sort((a,b)=>a.packId.localeCompare(b.packId,"en")||a.version.localeCompare(b.version,"en")),
    request: {
      ...plan.request,
      ...(plan.request.allowedDomains ? { allowedDomains: sortStrings(plan.request.allowedDomains) } : {}),
      ...(plan.request.allowedTargetTypes ? { allowedTargetTypes: sortStrings(plan.request.allowedTargetTypes) } : {}),
      ...(plan.request.allowedFaultIds ? { allowedFaultIds: sortStrings(plan.request.allowedFaultIds) } : {}),
      ...(plan.request.excludedFaultIds ? { excludedFaultIds: sortStrings(plan.request.excludedFaultIds) } : {}),
    },
  };
}
export async function computeFaultGenerationPlanIdentity(plan: FaultGenerationPlan, hash: FaultHashProvider=webCryptoFaultHashProvider): Promise<string> {
  return hash.sha256Utf8(canonicalFaultJson(faultGenerationPlanIdentityProjection(plan)));
}
