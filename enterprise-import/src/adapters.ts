import { csvImportAdapter, tsvImportAdapter } from "./delimited.js";
import { jsonImportAdapter } from "./json.js";
import { odsImportAdapter } from "./ods.js";
import { xlsxImportAdapter } from "./xlsx.js";
import type { EnterpriseImportAdapter } from "./types.js";
import { EnterpriseImportError } from "./types.js";

export const builtinEnterpriseImportAdapters: readonly EnterpriseImportAdapter[] = [jsonImportAdapter, csvImportAdapter, tsvImportAdapter, xlsxImportAdapter, odsImportAdapter];

export function selectEnterpriseImportAdapter(mediaType: string, adapters: readonly EnterpriseImportAdapter[] = builtinEnterpriseImportAdapters): EnterpriseImportAdapter {
  const normalized = mediaType.split(";", 1)[0]!.trim().toLowerCase();
  const matches = adapters.filter((a) => a.mediaTypes.some((x) => x.toLowerCase() === normalized));
  if (matches.length === 0) throw new EnterpriseImportError("IMPORT_UNSUPPORTED_MEDIA_TYPE", `No import adapter supports media type ${mediaType}.`);
  if (matches.length > 1) throw new EnterpriseImportError("IMPORT_AMBIGUOUS_ADAPTER", `Multiple import adapters claim media type ${mediaType}.`);
  return matches[0]!;
}
