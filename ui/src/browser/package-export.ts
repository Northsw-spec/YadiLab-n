import type { PackageDocumentInput, PackageAssetInput, PackageIO } from "../../../package-io/src/index.js";
import { certifyCompiledScenario, type ScenarioCertificationCertificate, type CertificationDiagnostic } from "../../../certification/src/index.js";
import type { BuilderWorkspace, BrowserDiagnostic } from "./types.js";

export interface BuilderPackageExportOptions {
  readonly packageIO: PackageIO;
  readonly distribution: "student" | "author";
  readonly scenarioExtension: string;
  readonly packageVersion?: string;
  readonly assets?: readonly PackageAssetInput[];
  readonly docs?: readonly PackageDocumentInput[];
}

export interface ScenarioPackageDownloadDescriptor {
  readonly filename: string;
  readonly mime: "application/zip";
  readonly blob: Blob;
  readonly distribution: "student" | "author";
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly selfVerified: true;
  readonly certification: ScenarioCertificationCertificate;
}

export type BuilderPackageExportResult =
  | { readonly ok: true; readonly descriptor: ScenarioPackageDownloadDescriptor; readonly diagnostics: readonly BrowserDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly BrowserDiagnostic[] };

function error(code: string, message: string, objectId?: string): BrowserDiagnostic {
  return objectId ? { severity: "error", code, message, objectId } : { severity: "error", code, message };
}

function validateExtension(extension: string): boolean {
  return /^\.[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(extension);
}

function certificationDiagnostic(item: CertificationDiagnostic): BrowserDiagnostic {
  const location = item.path !== undefined ? ` (${item.path})` : "";
  return error(item.code, `${item.message}${location}`, item.objectId);
}

export async function buildBuilderPackageExport(workspace: BuilderWorkspace, options: BuilderPackageExportOptions): Promise<BuilderPackageExportResult> {
  if (workspace.compile.status !== "valid") {
    return { ok: false, diagnostics: [error("BROWSER_PACKAGE_COMPILE_REQUIRED", "Package export requires a successful compile of the current Builder source.")] };
  }
  if (!validateExtension(options.scenarioExtension)) {
    return { ok: false, diagnostics: [error("BROWSER_PACKAGE_EXTENSION_INVALID", `Scenario extension '${options.scenarioExtension}' is not a safe local file extension.`)] };
  }
  if (workspace.layout === undefined) {
    return { ok: false, diagnostics: [error("BROWSER_PACKAGE_CERT_LAYOUT_REQUIRED", "Verified package export requires a current layout for the compiled scenario.")] };
  }

  const certified = await certifyCompiledScenario(workspace.compile.model, {
    packageIO: options.packageIO,
    distribution: options.distribution,
    layout: workspace.layout,
    ...(options.assets !== undefined ? { assets: options.assets } : {}),
    ...(options.docs !== undefined ? { docs: options.docs } : {}),
    ...(options.packageVersion !== undefined ? { packageVersion: options.packageVersion } : {}),
  });
  if (!certified.ok) return { ok: false, diagnostics: certified.diagnostics.map(certificationDiagnostic) };

  return {
    ok: true,
    descriptor: {
      filename: `${workspace.compile.model.scenarioId}${options.scenarioExtension}`,
      mime: "application/zip",
      blob: certified.blob,
      distribution: options.distribution,
      scenarioId: workspace.compile.model.scenarioId,
      scenarioHash: workspace.compile.model.sourceHash,
      selfVerified: true,
      certification: certified.certificate,
    },
    diagnostics: [],
  };
}
