import { previewNmapXmlObservations, type NmapReadOnlyEvidence } from "../../../enterprise-import/src/nmap-xml-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

const MAX_NMAP_XML_BYTES = 2 * 1024 * 1024;

/** Browser file boundary only. No active workspace, Engine or network IO. */
export interface NmapXmlReadableFile {
  readonly name: string;
  readonly size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface NmapXmlFilePreview {
  readonly filename: string;
  readonly preview: NmapReadOnlyEvidence;
}

/**
 * An .xml extension is a HINT, not source authorization. The parser enforces
 * nmaprun/scanner=nmap and the strictly supported observation profile.
 * A non-Nmap XML file is always BLOCKED, never interpreted as a topology.
 */
export async function previewNmapXmlFileReadOnly(file: NmapXmlReadableFile): Promise<NmapXmlFilePreview> {
  if (!file || typeof file.name !== "string" ||
      !/^[^/\\\0]+\.xml$/i.test(file.name)) {
    throw new EnterpriseImportError(
      "NMAP_XML_FILE_EXTENSION_INVALID",
      "Choose a local .xml file; the document must be Nmap -oX output.",
    );
  }
  if (file.size !== undefined &&
      (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_NMAP_XML_BYTES)) {
    throw new EnterpriseImportError("NMAP_XML_FILE_SIZE_INVALID", "Nmap XML must be nonempty and at most 2 MiB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_NMAP_XML_BYTES) {
    throw new EnterpriseImportError("NMAP_XML_FILE_SIZE_INVALID", "Nmap XML must be nonempty and at most 2 MiB.");
  }
  return { filename: file.name, preview: await previewNmapXmlObservations(bytes) };
}
