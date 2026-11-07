import type { CompileResult } from "../../compiler/src/types.js";
import type { CliExecutionResult, CliIO, CliServices } from "./types.js";
import { NORMALIZED_FORMAT_ID, checkCurrentSchemaVersion } from "../../versioning/src/index.js";
import { inspectPackage, testPackage } from "./package-runtime.js";

const USAGE = `Usage:
  app validate --input <scenario-source.json> [--output <validation.json>]
  app compile  --input <scenario-source.json> [--output <scenario.json>]
  app test     --input <scenario-source-or-normalized.json> [--output <report.json>]
  app inspect  --input <scenario-or-manifest.json> [--output <summary.json>]
  app migrate  --input <scenario-source-or-normalized.json> [--output <migrated.json>]
  app render   --input <scenario-source-or-normalized.json> --layout <layout.json> --output <preview.svg>
  app render   --input <scenario.yadilab> [--layout <override-layout.json>] --output <preview.svg>
  app unpack   --input <scenario.yadilab> --output <directory>
  app help`;

interface ParsedArgs {
  readonly command: string;
  readonly input?: string;
  readonly output?: string;
  readonly layout?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const command = argv[0] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") return { command: "help" };
  const allowed = new Set(["validate", "compile", "test", "inspect", "migrate", "render", "unpack"]);
  if (!allowed.has(command)) throw new Error(`Unknown command '${command}'.`);

  let input: string | undefined;
  let output: string | undefined;
  let layout: string | undefined;
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token !== "--input" && token !== "--output" && token !== "--layout") throw new Error(`Unknown argument '${token}'.`);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Argument '${token}' requires a value.`);
    if (token === "--input") {
      if (input !== undefined) throw new Error("--input may only be specified once.");
      input = value;
    } else if (token === "--output") {
      if (output !== undefined) throw new Error("--output may only be specified once.");
      output = value;
    } else {
      if (layout !== undefined) throw new Error("--layout may only be specified once.");
      layout = value;
    }
    i += 1;
  }
  if (!input) throw new Error(`Command '${command}' requires --input.`);
  if (command === "render") {
    if (!output) throw new Error("Command 'render' requires --output.");
  } else if (command === "unpack") {
    if (!output) throw new Error("Command 'unpack' requires --output directory.");
  } else if (layout !== undefined) {
    throw new Error(`Argument '--layout' is only valid for command 'render'.`);
  }
  return { command, input, ...(output !== undefined ? { output } : {}), ...(layout !== undefined ? { layout } : {}) };
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(io: CliIO, path: string): Promise<unknown> {
  const text = await io.readText(path);
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error(`Invalid JSON in '${path}': ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function isPackagePath(path: string): boolean {
  return path.toLowerCase().endsWith(".yadilab");
}

async function readPackageBytes(io: CliIO, path: string): Promise<Uint8Array> {
  if (!io.readBytes) throw new Error("Binary package input is unavailable in this CLI environment.");
  return io.readBytes(path);
}

function childOutputPath(root: string, packagePath: string): string {
  const base = root.replace(/\/+$/, "");
  return `${base}/${packagePath}`;
}

async function emit(io: CliIO, output: string | undefined, value: unknown): Promise<void> {
  const text = pretty(value);
  if (output) await io.writeText(output, text);
  else io.stdout(text.trimEnd());
}

function record(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined;
}

function formatIdOf(input: unknown): string | undefined {
  const x = record(input);
  return typeof x?.formatId === "string" ? x.formatId : undefined;
}

function inspectDocument(input: unknown): unknown {
  const x = record(input);
  if (!x) throw new Error("Input must be a JSON object.");
  const formatId = typeof x.formatId === "string" ? x.formatId : "unknown";
  const arr = (key: string) => Array.isArray(x[key]) ? x[key] as unknown[] : [];
  const metadata = record(x.metadata) ?? {};

  if (formatId === "infrastructure-cyber-lab.scenario" || formatId === "infrastructure-cyber-lab.scenario-source") {
    return {
      formatId,
      kind: formatId.endsWith("scenario-source") ? "source" : "normalized",
      scenarioId: x.scenarioId ?? null,
      title: metadata.title ?? null,
      schemaVersion: x.schemaVersion ?? null,
      resourceCount: arr("resources").length,
      zoneCount: arr("zones").length,
      connectionCount: arr("connections").length,
      testCount: arr("tests").length,
      findingCount: arr("findings").length,
      objectiveCount: arr("objectives").length,
      hasCanonicalSolution: Object.hasOwn(x, "canonicalSolution"),
      capabilityCount: formatId.endsWith("scenario-source")
        ? (record(x.requires) && Array.isArray(record(x.requires)?.capabilities)
          ? (record(x.requires)?.capabilities as unknown[]).length : 0)
        : arr("capabilityLocks").length,
      profileCount: formatId.endsWith("scenario-source")
        ? (record(x.requires) && Array.isArray(record(x.requires)?.profiles)
          ? (record(x.requires)?.profiles as unknown[]).length : 0)
        : arr("profileLocks").length,
    };
  }

  if (formatId === "infrastructure-cyber-lab.package") {
    return {
      formatId,
      kind: "package-manifest",
      scenarioId: x.scenarioId ?? null,
      packageVersion: x.packageVersion ?? null,
      distribution: x.distribution ?? null,
      fileCount: arr("files").length,
      capabilityCount: arr("capabilityLocks").length,
      profileCount: arr("profileLocks").length,
    };
  }

  return { formatId, kind: "unknown" };
}

function regressionSummary(report: ReturnType<CliServices["runRegression"]>) {
  return {
    scenarioId: report.scenarioId,
    passed: report.passed,
    solutionApplied: report.solutionApplied,
    operationsApplied: report.operationsApplied,
    checks: report.checks,
    diagnostics: report.diagnostics,
  };
}

async function normalizeForTest(input: unknown, services: CliServices): Promise<CompileResult | { readonly ok: true; readonly model: unknown }> {
  const formatId = formatIdOf(input);
  if (formatId === NORMALIZED_FORMAT_ID) {
    const compatibility = checkCurrentSchemaVersion(input, NORMALIZED_FORMAT_ID);
    if (compatibility) {
      return { ok: false, diagnostics: [{ severity: "error", code: "SCHEMA_VERSION_UNSUPPORTED", path: "schemaVersion", message: compatibility.message, suggestion: "Run app migrate before testing this normalized document." }] };
    }
    return { ok: true, model: input };
  }
  if (formatId !== "infrastructure-cyber-lab.scenario-source") return { ok: true, model: input };
  return services.compileSource(input);
}

export async function executeCli(argv: readonly string[], io: CliIO, services: CliServices): Promise<CliExecutionResult> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (cause) {
    io.stderr(cause instanceof Error ? cause.message : String(cause));
    io.stderr(USAGE);
    return { exitCode: 2 };
  }

  if (args.command === "help") {
    io.stdout(USAGE);
    return { exitCode: 0, command: "help" };
  }

  try {
    const inputPath = args.input as string;
    if (isPackagePath(inputPath)) {
      if (args.command === "validate" || args.command === "compile") {
        throw new Error(`Command '${args.command}' accepts scenario JSON source, not a compiled .yadilab package.`);
      }
      if (!services.openPackage) throw new Error("Package runtime is unavailable; the ZIP adapter/dependencies are not installed in this CLI environment.");
      const packageBytes = await readPackageBytes(io, inputPath);
      const opened = await services.openPackage(new Blob([Uint8Array.from(packageBytes)]));
      if (!opened.ok) {
        await emit(io, args.command === "unpack" || args.command === "render" || args.command === "migrate" ? undefined : args.output, { ok: false, phase: "package", diagnostics: opened.diagnostics });
        return { exitCode: 1, command: args.command };
      }

      if (args.command === "inspect") {
        await emit(io, args.output, inspectPackage(opened.read));
        return { exitCode: 0, command: "inspect" };
      }

      if (args.command === "test") {
        const report = testPackage(opened.read);
        await emit(io, args.output, report);
        return { exitCode: report.passed ? 0 : 1, command: "test" };
      }

      if (args.command === "render") {
        const layout = args.layout ? await readJson(io, args.layout) : opened.read.layout;
        if (layout === undefined) throw new Error("Package render requires layout.json in the package or an explicit --layout override.");
        const rendered = services.renderScenario(opened.read.scenario, layout);
        if (!rendered.ok) {
          io.stdout(pretty({ ok: false, phase: "render", diagnostics: rendered.diagnostics }).trimEnd());
          return { exitCode: 1, command: "render" };
        }
        await io.writeText(args.output as string, rendered.svg);
        io.stdout(pretty({ ok: true, input: inputPath, output: args.output, width: rendered.width, height: rendered.height, diagnostics: rendered.diagnostics }).trimEnd());
        return { exitCode: 0, command: "render" };
      }

      if (args.command === "unpack") {
        if (!io.writeBytes) throw new Error("Binary unpack output is unavailable in this CLI environment.");
        const root = args.output as string;
        await io.writeBytes(childOutputPath(root, "manifest.json"), opened.read.manifestBytes);
        for (const [path, file] of [...opened.read.files.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))) {
          await io.writeBytes(childOutputPath(root, path), file.bytes);
        }
        io.stdout(pretty({ ok: true, input: inputPath, output: root, filesWritten: opened.read.files.size + 1 }).trimEnd());
        return { exitCode: 0, command: "unpack" };
      }

      if (args.command === "migrate") {
        if (!args.output) throw new Error("Package migration requires --output because binary package bytes are not written to stdout.");
        if (!io.writeBytes) throw new Error("Binary package output is unavailable in this CLI environment.");
        const result = services.migrateDocument(opened.read.scenario);
        if (!result.ok) {
          io.stdout(pretty({ ok: false, phase: "migrate", diagnostics: result.diagnostics }).trimEnd());
          return { exitCode: 1, command: "migrate" };
        }
        if (result.changed) {
          io.stdout(pretty({ ok: false, phase: "migrate", diagnostics: [{ severity: "error", code: "PACKAGE_MIGRATION_REPACK_REQUIRED", message: "The scenario migration changes package contents; safe package repack is not implemented in this checkpoint." }] }).trimEnd());
          return { exitCode: 1, command: "migrate" };
        }
        await io.writeBytes(args.output, packageBytes);
        io.stdout(pretty({ ok: true, changed: false, path: result.path, input: inputPath, output: args.output, byteIdentical: true }).trimEnd());
        return { exitCode: 0, command: "migrate" };
      }

      throw new Error(`Command '${args.command}' is not supported for .yadilab package input.`);
    }

    const input = await readJson(io, inputPath);

    if (args.command === "migrate") {
      const result = services.migrateDocument(input);
      if (!result.ok) {
        await emit(io, args.output, { ok: false, diagnostics: result.diagnostics });
        return { exitCode: 1, command: "migrate" };
      }
      if (args.output) {
        await io.writeText(args.output, pretty(result.document));
        io.stdout(pretty({ ok: true, changed: result.changed, path: result.path, output: args.output }).trimEnd());
      } else {
        io.stdout(pretty(result.document).trimEnd());
      }
      return { exitCode: 0, command: "migrate" };
    }

    if (args.command === "render") {
      if (!args.layout) throw new Error("JSON render requires --layout; only .yadilab packages may use embedded layout.json.");
      const normalized = await normalizeForTest(input, services);
      if (!normalized.ok) {
        io.stdout(pretty({ ok: false, phase: "compile", diagnostics: normalized.diagnostics }).trimEnd());
        return { exitCode: 1, command: "render" };
      }
      const layout = await readJson(io, args.layout as string);
      const rendered = services.renderScenario(normalized.model, layout);
      if (!rendered.ok) {
        io.stdout(pretty({ ok: false, phase: "render", diagnostics: rendered.diagnostics }).trimEnd());
        return { exitCode: 1, command: "render" };
      }
      await io.writeText(args.output as string, rendered.svg);
      io.stdout(pretty({ ok: true, output: args.output, width: rendered.width, height: rendered.height, diagnostics: rendered.diagnostics }).trimEnd());
      return { exitCode: 0, command: "render" };
    }

    if (args.command === "validate") {
      const validation = services.validateSource(input);
      await emit(io, args.output, validation);
      return { exitCode: validation.valid ? 0 : 1, command: "validate" };
    }

    if (args.command === "compile") {
      const result = await services.compileSource(input);
      if (!result.ok) {
        await emit(io, args.output, { ok: false, diagnostics: result.diagnostics });
        return { exitCode: 1, command: "compile" };
      }
      if (args.output) {
        await io.writeText(args.output, pretty(result.model));
        io.stdout(pretty({ ok: true, scenarioId: result.model.scenarioId, output: args.output, diagnostics: result.diagnostics }).trimEnd());
      } else {
        io.stdout(pretty(result.model).trimEnd());
      }
      return { exitCode: 0, command: "compile" };
    }

    if (args.command === "test") {
      const normalized = await normalizeForTest(input, services);
      if (!normalized.ok) {
        await emit(io, args.output, { passed: false, phase: "compile", diagnostics: normalized.diagnostics });
        return { exitCode: 1, command: "test" };
      }
      const report = services.runRegression(normalized.model);
      await emit(io, args.output, regressionSummary(report));
      return { exitCode: report.passed ? 0 : 1, command: "test" };
    }

    const summary = inspectDocument(input);
    await emit(io, args.output, summary);
    return { exitCode: 0, command: "inspect" };
  } catch (cause) {
    io.stderr(cause instanceof Error ? cause.message : String(cause));
    return { exitCode: 2, command: args.command };
  }
}

export { inspectDocument, parseArgs, USAGE };
