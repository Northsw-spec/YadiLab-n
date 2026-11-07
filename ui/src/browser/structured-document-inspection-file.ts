import { inspectStructuredXmlFileReadOnly, type StructuredXmlReadableFile } from "./structured-xml-inspection-file.js";
import {
  inspectStaticAnsibleSourceReadOnly, type AnsibleStaticInspection,
} from "../../../enterprise-import/src/structured-ansible-source-inspection.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";
import { inspectOfficeStructureSourceReadOnly, type OfficeStructureInspection } from "../../../enterprise-import/src/structured-office-source-inspection.js";
import type { ReadOnlyXmlInspection } from "../../../enterprise-import/src/structured-xml-source-inspection.js";

export type SharedDocumentInspection = ReadOnlyXmlInspection | AnsibleStaticInspection | OfficeStructureInspection;
const MAX_STATIC_BYTES = 256 * 1024;
const MAX_OFFICE_BYTES = 16 * 1024 * 1024;

/**
 * IC-010 P3c. Browser file bridge for exactly eight producer-validated profiles:
 * 4 prior XML subsets, 2 static Ansible inventories, DOCX and ODT structure. Any future
 * suffix/format has no implicit authority from a planned registry entry.
 */
export async function inspectSharedDocumentFileReadOnly(
  file: StructuredXmlReadableFile,
): Promise<SharedDocumentInspection> {
  if (!file || typeof file.name !== "string" || typeof file.arrayBuffer !== "function" ||
      file.name.length < 1 || file.name.length > 255 ||
      file.name.trim() !== file.name ||
      /[\\/\u0000-\u001f\u007f]/.test(file.name)) {
    throw new EnterpriseImportError("IC010_P3_FILE_INVALID", "IC010_P3_FILE_INVALID");
  }
  const name = file.name.toLowerCase();
  const staticInventory = name.endsWith(".yaml") || name.endsWith(".yml") || name.endsWith(".ini");
  const xml = name.endsWith(".graphml") || name.endsWith(".drawio") ||
    name.endsWith(".nessus") || name.endsWith(".xml");
  const office = name.endsWith(".docx") || name.endsWith(".odt");
  if (!xml && !staticInventory && !office) {
    throw new EnterpriseImportError("IC010_P3_EXTENSION_UNSUPPORTED", "IC010_P3_EXTENSION_UNSUPPORTED");
  }
  if (xml) {
    // Original XML contract and maximum source budget stay authoritative.
    return inspectStructuredXmlFileReadOnly(file);
  }
  if (office) {
    const minimum = name.endsWith(".docx") ? 4 : 42;
    if (file.size !== undefined &&
        (!Number.isSafeInteger(file.size) || file.size < minimum || file.size > MAX_OFFICE_BYTES)) {
      throw new EnterpriseImportError("IC010_P3C_SOURCE_SIZE_INVALID", "IC010_P3C_SOURCE_SIZE_INVALID");
    }
    const raw: unknown = await file.arrayBuffer();
    if (!(raw instanceof ArrayBuffer) || raw.byteLength < minimum || raw.byteLength > MAX_OFFICE_BYTES) {
      throw new EnterpriseImportError("IC010_P3C_SOURCE_READ_INVALID", "IC010_P3C_SOURCE_READ_INVALID");
    }
    return inspectOfficeStructureSourceReadOnly(file.name, new Uint8Array(raw));
  }
  if (file.size !== undefined &&
      (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_STATIC_BYTES)) {
    throw new EnterpriseImportError("IC010_P3_SOURCE_SIZE_INVALID", "IC010_P3_SOURCE_SIZE_INVALID");
  }
  const raw: unknown = await file.arrayBuffer();
  if (!(raw instanceof ArrayBuffer) || raw.byteLength < 1 || raw.byteLength > MAX_STATIC_BYTES) {
    throw new EnterpriseImportError("IC010_P3_SOURCE_READ_INVALID", "IC010_P3_SOURCE_READ_INVALID");
  }
  return inspectStaticAnsibleSourceReadOnly(file.name, new Uint8Array(raw));
}
