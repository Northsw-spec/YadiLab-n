import { previewAnsibleIniStaticInventory, type AnsibleIniPreview } from "../../../enterprise-import/src/ansible-ini-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

export interface AnsibleIniReadableFile {
  readonly name: string;
  readonly size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface AnsibleIniFilePreview {
  readonly filename: string;
  readonly preview: AnsibleIniPreview;
}
const MAX_BYTES = 256 * 1024;

/**
 * Strict local-only INI file bridge. An .ini filename is only an input filter:
 * the complete original byte sequence must pass the independently tested parser.
 * No Ansible process, fetch, scenario activation, Builder or Engine callback.
 */
export async function previewAnsibleIniFileReadOnly(file: AnsibleIniReadableFile): Promise<AnsibleIniFilePreview> {
  if (!file || typeof file.name !== "string" ||
      !/^[^/\\\0]+\.ini$/i.test(file.name) || typeof file.arrayBuffer !== "function") {
    throw new EnterpriseImportError("ANSIBLE_INI_FILE_EXTENSION_INVALID",
      "Choose a single .ini file containing a supported static Ansible inventory.");
  }
  if (file.size !== undefined &&
      (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_BYTES)) {
    throw new EnterpriseImportError("ANSIBLE_INI_FILE_SIZE_INVALID",
      "Ansible INI inventory must be nonempty and at most 256 KiB.");
  }
  const buffer = await file.arrayBuffer();
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
    throw new EnterpriseImportError("ANSIBLE_INI_FILE_SIZE_INVALID",
      "Ansible INI inventory must be nonempty and at most 256 KiB.");
  }
  return { filename: file.name, preview: await previewAnsibleIniStaticInventory(new Uint8Array(buffer)) };
}
