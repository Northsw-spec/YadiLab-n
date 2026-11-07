import { previewAnsibleStaticInventory, type AnsibleStaticInventoryPreview } from "../../../enterprise-import/src/ansible-yaml-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

export interface AnsibleYamlReadableFile {
  readonly name: string;
  readonly size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface AnsibleYamlFilePreview {
  readonly filename: string;
  readonly preview: AnsibleStaticInventoryPreview;
}
const MAX_BYTES = 256 * 1024;

/**
 * Browser boundary: suffix alone NEVER establishes Ansible inventory identity.
 * Actual YAML must pass the strict root/all/hosts/children profile parser.
 * No network access, Ansible execution, or active YadiLab workspace change.
 */
export async function previewAnsibleYamlFileReadOnly(file: AnsibleYamlReadableFile): Promise<AnsibleYamlFilePreview> {
  if (!file || typeof file.name !== "string" ||
      !/^[^/\\\0]+\.(?:yml|yaml)$/i.test(file.name)) {
    throw new EnterpriseImportError("ANSIBLE_YAML_FILE_EXTENSION_INVALID",
      "Choose one .yml or .yaml file containing a static Ansible inventory.");
  }
  if (file.size !== undefined &&
      (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_BYTES)) {
    throw new EnterpriseImportError("ANSIBLE_YAML_FILE_SIZE_INVALID",
      "Ansible YAML source must be nonempty and at most 256 KiB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) {
    throw new EnterpriseImportError("ANSIBLE_YAML_FILE_SIZE_INVALID",
      "Ansible YAML source must be nonempty and at most 256 KiB.");
  }
  return { filename: file.name, preview: await previewAnsibleStaticInventory(bytes) };
}
