import type { ErrorObject } from "ajv";
import type { CompilerDiagnostic, SchemaValidator } from "../../compiler/src/types.js";
import { validateContract, type ContractKind } from "./index.js";

function diagnosticFromAjv(error: ErrorObject): CompilerDiagnostic {
  const path = error.instancePath || "$";
  const code = `SCHEMA_${error.keyword.toUpperCase()}`;
  const extra = error.keyword === "additionalProperties" && typeof error.params.additionalProperty === "string"
    ? ` Unknown property: '${error.params.additionalProperty}'.`
    : "";
  return {
    severity: "error",
    code,
    path,
    message: `${error.message ?? "Schema validation failed."}${extra}`,
  };
}

export function createCompilerSchemaValidator(kind: Extract<ContractKind, "source" | "normalized">): SchemaValidator {
  return (data: unknown) => {
    const result = validateContract(kind, data);
    return {
      valid: result.valid,
      diagnostics: result.errors.map(diagnosticFromAjv),
    };
  };
}
