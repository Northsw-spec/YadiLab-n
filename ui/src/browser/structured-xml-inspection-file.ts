import { inspectStructuredXmlSourceReadOnly, type ReadOnlyXmlInspection } from "../../../enterprise-import/src/structured-xml-source-inspection.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export interface StructuredXmlReadableFile {
  readonly name: string;
  readonly size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Browser-only file boundary. A file chooser name/MIME never authorizes a
 * producer; P1 parses and checks original bytes. The only result is read-only
 * source metadata, never a ScenarioSource or a Builder/Engine operation.
 */
export async function inspectStructuredXmlFileReadOnly(
  file: StructuredXmlReadableFile,
): Promise<ReadOnlyXmlInspection> {
  if (!file || typeof file.name !== "string" || typeof file.arrayBuffer !== "function") {
    throw new EnterpriseImportError("IC010_XML_FILE_INVALID", "IC010_XML_FILE_INVALID");
  }
  if (file.size !== undefined &&
    (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_SOURCE_BYTES)) {
    throw new EnterpriseImportError("IC010_XML_FILE_SIZE_INVALID", "IC010_XML_FILE_SIZE_INVALID");
  }
  const raw: unknown = await file.arrayBuffer();
  if (!(raw instanceof ArrayBuffer) || raw.byteLength < 1 || raw.byteLength > MAX_SOURCE_BYTES) {
    throw new EnterpriseImportError("IC010_XML_FILE_READ_INVALID", "IC010_XML_FILE_READ_INVALID");
  }
  return inspectStructuredXmlSourceReadOnly(file.name, new Uint8Array(raw));
}
