import { runAutoLayout } from "../../../layout/src/auto-layout.js";
import type { LayoutBackend } from "../../../layout/src/types.js";
import type { BrowserCommandResult, BrowserDiagnostic, BuilderWorkspace } from "./types.js";

function mapDiagnostic(d: { readonly severity: "error" | "warning"; readonly code: string; readonly message: string; readonly objectId?: string }): BrowserDiagnostic {
  return d.objectId
    ? { severity: d.severity, code: d.code, message: d.message, objectId: d.objectId }
    : { severity: d.severity, code: d.code, message: d.message };
}

export async function autoLayoutBuilder(workspace: BuilderWorkspace, backend: LayoutBackend): Promise<BrowserCommandResult<BuilderWorkspace>> {
  if (workspace.compile.status !== "valid") {
    return {
      ok: false,
      workspace,
      diagnostics: [{ severity: "error", code: "BUILDER_COMPILE_REQUIRED_FOR_LAYOUT", message: "Auto-layout requires a successful current compile." }],
    };
  }
  const result = await runAutoLayout(workspace.compile.model, backend, { manualOverrides: workspace.layoutOverrides });
  const diagnostics = result.diagnostics.map(mapDiagnostic);
  if (!result.ok || !result.document) return { ok: false, workspace, diagnostics };
  return { ok: true, workspace: { ...workspace, layout: result.document }, diagnostics };
}
