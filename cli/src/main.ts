import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import rawCatalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import type { CompilerCatalog, SchemaValidationResult, SchemaValidator } from "../../compiler/src/types.js";
import { SafePackageIO, ZipJsArchiveBackend } from "../../package-io/src/index.js";
import { ENGINE_VERSION } from "../../engine/src/index.js";
import { createFoundationCliServices } from "./foundation-services.js";
import { executeCli } from "./core.js";
import type { CliIO } from "./types.js";

async function loadRuntimeContext() {
  const catalogData = rawCatalog as { capabilities?: unknown; profiles?: unknown; assets?: unknown };
  const catalog: CompilerCatalog = {
    capabilities: Array.isArray(catalogData.capabilities) ? catalogData.capabilities as CompilerCatalog["capabilities"] : [],
    profiles: Array.isArray(catalogData.profiles) ? catalogData.profiles as CompilerCatalog["profiles"] : [],
    assets: Array.isArray(catalogData.assets) ? catalogData.assets as CompilerCatalog["assets"] : [],
  };

  const adapterModuleUrl = new URL("../../validator/src/compiler-adapter.js", import.meta.url).href;
  const validatorModuleUrl = new URL("../../validator/src/index.js", import.meta.url).href;
  const adapterModule = await import(adapterModuleUrl) as {
    createCompilerSchemaValidator(kind: "source" | "normalized"): SchemaValidator;
  };
  const validatorModule = await import(validatorModuleUrl) as {
    validateContract(kind: "manifest" | "layout", data: unknown): { valid: boolean; errors: readonly { instancePath?: string; message?: string }[] };
  };

  const validateNormalized = adapterModule.createCompilerSchemaValidator("normalized");
  const validateLayout = (input: unknown): SchemaValidationResult => {
    const result = validatorModule.validateContract("layout", input);
    return {
      valid: result.valid,
      diagnostics: result.errors.map((item) => ({ severity: "error" as const, code: "SCHEMA_LAYOUT", path: item.instancePath || "$", message: item.message ?? "Layout schema validation failed." })),
    };
  };
  const packageIO = new SafePackageIO(
    new ZipJsArchiveBackend(),
    (input) => {
      const result = validatorModule.validateContract("manifest", input);
      return { valid: result.valid, diagnostics: result.errors.map((item) => `${item.instancePath || "$"}: ${item.message ?? "Manifest schema validation failed."}`) };
    },
  );

  return {
    compilerContext: {
      validateSource: adapterModule.createCompilerSchemaValidator("source"),
      validateNormalized,
      catalog,
      engineBaselineVersion: ENGINE_VERSION,
    },
    packageRuntime: { packageIO, validateNormalized, validateLayout },
  } as const;
}

async function ensureParent(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent && parent !== ".") await mkdir(parent, { recursive: true });
}

const io: CliIO = {
  readText: (path) => readFile(path, "utf8"),
  writeText: async (path, content) => { await ensureParent(path); await writeFile(path, content, "utf8"); },
  readBytes: async (path) => new Uint8Array(await readFile(path)),
  writeBytes: async (path, content) => { await ensureParent(path); await writeFile(path, content); },
  stdout: (text) => globalThis.console.log(text),
  stderr: (text) => globalThis.console.error(text),
};

try {
  const options = await loadRuntimeContext();
  const result = await executeCli(process.argv.slice(2), io, createFoundationCliServices(options));
  process.exitCode = result.exitCode;
} catch (cause) {
  io.stderr(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 2;
}
