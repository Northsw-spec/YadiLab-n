import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with { type: "json" };
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with { type: "json" };
import manifestSchema from "../../schema/package-manifest.schema.json" with { type: "json" };
import saveStateSchema from "../../schema/save-state.schema.json" with { type: "json" };
import layoutSchema from "../../schema/layout.schema.json" with { type: "json" };
import troubleshootingNotebookSchema from "../../schema/troubleshooting-notebook.schema.json" with { type: "json" };
import troubleshootingSessionSchema from "../../schema/troubleshooting-session.schema.json" with { type: "json" };

export type ContractKind = "source" | "editableSource" | "normalized" | "manifest" | "save" | "layout" | "troubleshootingNotebook" | "troubleshootingSession";

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ErrorObject[];
}

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  allowUnionTypes: false,
  validateSchema: true,
});

// An editable New project may be empty, but is NOT a runnable scenario.
// Preserve every canonical source constraint except the two runtime-only
// minimum counts. All other source fields and references remain verified
// by the project-document semantic integrity gate.
const editableSourceSchema = structuredClone(sourceSchema);
editableSourceSchema.$id = "urn:app:schema:editable-project-source:0.1.0";
editableSourceSchema.title = "Editable Project Source";
editableSourceSchema.properties.resources.minItems = 0;
editableSourceSchema.properties.objectives.minItems = 0;

const validators = {
  source: ajv.compile(sourceSchema),
  editableSource: ajv.compile(editableSourceSchema),
  normalized: ajv.compile(normalizedSchema),
  manifest: ajv.compile(manifestSchema),
  save: ajv.compile(saveStateSchema),
  layout: ajv.compile(layoutSchema),
  troubleshootingNotebook: ajv.compile(troubleshootingNotebookSchema),
  troubleshootingSession: ajv.compile(troubleshootingSessionSchema),
} as const;

export function validateContract(kind: ContractKind, data: unknown): ValidationResult {
  const validator = validators[kind];
  const valid = validator(data);
  return { valid: Boolean(valid), errors: validator.errors ? [...validator.errors] : [] };
}
