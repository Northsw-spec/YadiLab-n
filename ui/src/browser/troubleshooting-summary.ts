import {
  canonicalTroubleshootingJson,
  createTroubleshootingNotebook,
  reviewRemediationLoop,
  verifyTroubleshootingNotebook,
  type RemediationReview,
  type TroubleshootingNotebook,
  type TroubleshootingNotebookEntry,
} from "../../../observation-engine/src/index.js";
import { applyOperation } from "../../../engine/src/index.js";
import type { ScenarioOperation, TruthValue } from "../../../engine/src/index.js";
import type { Normalizedscenariotroubleshootingactiveproberequirement } from "../../../core-model/src/generated/contracts.js";
import type { BrowserDiagnostic, BrowserWorkspace, RuntimeWorkspace } from "./types.js";

export type TroubleshootingSummaryStatus =
  | "INVESTIGATION_IN_PROGRESS"
  | "ACTION_RECORDED_NO_RETEST"
  | "VERIFIED_IMPROVEMENT"
  | "HISTORICAL_VERIFIED_NEEDS_RECHECK"
  | "NO_VERIFIED_IMPROVEMENT"
  | "REGRESSION_DETECTED"
  | "INSUFFICIENT_EVIDENCE";

export interface TroubleshootingSummaryEvidence {
  readonly entryId: string;
  readonly kind: "observation" | "active_probe";
  readonly revision: number;
  readonly command: string;
  readonly source: string;
  readonly destination?: string;
  readonly truth?: TruthValue;
  readonly result: string;
}

export interface TroubleshootingSummaryHypothesis {
  readonly text: string;
  readonly revision: number;
  readonly historical: boolean;
}

export interface TroubleshootingSummaryAction {
  readonly entryId: string;
  readonly label: string;
  readonly target: string;
  readonly operation: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly beforeValue: string;
  readonly afterValue: string;
  readonly note?: string;
}

export interface TroubleshootingSummaryVerification {
  readonly remediationEntryId?: string;
  readonly status: RemediationReview["status"];
  readonly historical: boolean;
  readonly pairs: readonly {
    readonly label: string;
    readonly before: string;
    readonly after: string;
    readonly pairStatus: string;
  }[];
}

export interface TroubleshootingSummaryFinalVerification {
  readonly required: readonly Normalizedscenariotroubleshootingactiveproberequirement[];
  readonly completed: readonly Normalizedscenariotroubleshootingactiveproberequirement[];
  readonly missing: readonly Normalizedscenariotroubleshootingactiveproberequirement[];
  readonly complete: boolean;
}

export interface TroubleshootingSummary {
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly title: string;
  readonly problem: string;
  readonly modeledEnvironment: string;
  readonly status: TroubleshootingSummaryStatus;
  readonly statusLabel: string;
  readonly runtimeRevision: number;
  readonly evidence: readonly TroubleshootingSummaryEvidence[];
  readonly actions: readonly TroubleshootingSummaryAction[];
  readonly verifications: readonly TroubleshootingSummaryVerification[];
  readonly finalVerification: TroubleshootingSummaryFinalVerification;
  readonly fullRecoveryVerified: boolean;
  readonly hypothesis?: TroubleshootingSummaryHypothesis;
  readonly action?: TroubleshootingSummaryAction;
  readonly verification?: TroubleshootingSummaryVerification;
  readonly completion: TruthValue;
  readonly completionLabel: string;
  readonly uncertainty: string;
  readonly markdown: string;
  readonly reportIdentity: string;
}

export interface TroubleshootingSummaryResult {
  readonly ok: boolean;
  readonly summary?: TroubleshootingSummary;
  readonly diagnostics: readonly BrowserDiagnostic[];
}

function error(code: string, message: string): BrowserDiagnostic {
  return { severity: "error", code, message };
}

function isEvidence(entry: TroubleshootingNotebookEntry): entry is Extract<TroubleshootingNotebookEntry, { readonly kind: "observation" | "active_probe" }> {
  return entry.kind === "observation" || entry.kind === "active_probe";
}

function displayValue(state: "KNOWN" | "ABSENT", value: unknown): string {
  return state === "KNOWN" ? JSON.stringify(value) : "<absent>";
}

export function troubleshootingSummaryStatusLabel(status: TroubleshootingSummaryStatus): string {
  return {
    INVESTIGATION_IN_PROGRESS: "Utredning pågår",
    ACTION_RECORDED_NO_RETEST: "Åtgärd utförd, omtest saknas",
    VERIFIED_IMPROVEMENT: "Förbättring verifierad",
    HISTORICAL_VERIFIED_NEEDS_RECHECK: "Historisk förbättring — ny verifiering behövs",
    NO_VERIFIED_IMPROVEMENT: "Ingen verifierad förbättring",
    REGRESSION_DETECTED: "Regression upptäckt",
    INSUFFICIENT_EVIDENCE: "Otillräcklig evidens",
  }[status];
}

function evidenceResult(entry: Extract<TroubleshootingNotebookEntry, { readonly kind: "observation" | "active_probe" }>): TroubleshootingSummaryEvidence {
  if (entry.kind === "active_probe") {
    const source = `${entry.sourceLabel} (${entry.sourceId})`;
    const destination = entry.destinationLabel ? `${entry.destinationLabel} (${entry.destinationId ?? "?"})` : entry.destinationId;
    return {
      entryId: entry.entryId,
      kind: entry.kind,
      revision: entry.stateRevision,
      command: entry.command,
      source,
      ...(destination ? { destination } : {}),
      truth: entry.truth,
      result: `${entry.truth}${entry.blockingPoint ? ` · ${entry.blockingPoint}` : ""}`,
    };
  }
  return {
    entryId: entry.entryId,
    kind: entry.kind,
    revision: entry.stateRevision,
    command: entry.command,
    source: `${entry.targetLabel} (${entry.targetId})`,
    result: entry.lines.slice(0, 3).join(" · ") || "Observation sparad utan textresultat",
  };
}

function evidenceLabel(entry: Extract<TroubleshootingNotebookEntry, { readonly kind: "observation" | "active_probe" }>): string {
  if (entry.kind === "active_probe") {
    return `${entry.command}: ${entry.sourceLabel} → ${entry.destinationLabel ?? entry.destinationId ?? "destination"}`;
  }
  return `${entry.command}: ${entry.targetLabel}`;
}

function entryById(notebook: TroubleshootingNotebook, entryId: string): TroubleshootingNotebookEntry | undefined {
  return notebook.entries.find((entry) => entry.entryId === entryId);
}

export function declaredFinalVerificationRequirements(runtime: RuntimeWorkspace): readonly Normalizedscenariotroubleshootingactiveproberequirement[] {
  return (runtime.scenario.troubleshootingObjectives ?? [])
    .filter((objective) => !objective.required)
    .flatMap((objective) => objective.requirements)
    .filter((requirement): requirement is Normalizedscenariotroubleshootingactiveproberequirement => requirement.kind === "active_probe" && requirement.truth === "TRUE");
}

function matchesFinalVerificationRequirement(requirement: Normalizedscenariotroubleshootingactiveproberequirement, entry: Extract<TroubleshootingNotebookEntry, { readonly kind: "active_probe" }>): boolean {
  return entry.truth === "TRUE"
    && (requirement.sourceId === undefined || requirement.sourceId === entry.sourceId)
    && (requirement.destinationId === undefined || requirement.destinationId === entry.destinationId)
    && (requirement.protocol === undefined || requirement.protocol === entry.protocol)
    && (requirement.port === undefined || requirement.port === entry.port)
    && (requirement.queryName === undefined || requirement.queryName === entry.queryName);
}

export function currentFinalVerificationRequirements(runtime: RuntimeWorkspace, notebook: TroubleshootingNotebook, latestRemediation?: Extract<TroubleshootingNotebookEntry, { readonly kind: "remediation_action" }>): TroubleshootingSummaryFinalVerification {
  const required = declaredFinalVerificationRequirements(runtime);
  const minimumSequence = latestRemediation?.sequence ?? 0;
  const current = notebook.entries.filter((entry): entry is Extract<TroubleshootingNotebookEntry, { readonly kind: "active_probe" }> => entry.kind === "active_probe" && entry.stateRevision === runtime.engineState.stateRevision && entry.sequence > minimumSequence);
  const completed = required.filter((requirement) => current.some((entry) => matchesFinalVerificationRequirement(requirement, entry)));
  const missing = required.filter((requirement) => !completed.includes(requirement));
  return { required, completed, missing, complete: missing.length === 0 };
}

function compactJson(value: unknown): string {
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function isCurrentRemediationState(runtime: RuntimeWorkspace, remediation: Extract<TroubleshootingNotebookEntry, { readonly kind: "remediation_action" }>): boolean {
  if (runtime.engineState.stateRevision !== remediation.afterStateRevision) return false;
  const predecessor = runtime.history.past.at(-1);
  if (!predecessor || predecessor.stateRevision !== remediation.beforeStateRevision) return false;
  const replayed = applyOperation(predecessor, remediation.operation as ScenarioOperation);
  if (!replayed.ok || replayed.state.stateRevision !== runtime.engineState.stateRevision) return false;
  return canonicalTroubleshootingJson(replayed.state) === canonicalTroubleshootingJson(runtime.engineState);
}

function markdownFor(summary: Omit<TroubleshootingSummary, "markdown" | "reportIdentity">): string {
  const lines = [
    `# FELSÖKNING — ${summary.title}`,
    "",
    `**Scenario:** ${summary.scenarioId}`,
    `**Status:** ${summary.statusLabel}`,
    "",
    "## Problem",
    summary.problem,
    "",
    "## Undersökning",
  ];
  if (summary.evidence.length) {
    for (const item of summary.evidence) {
      const endpoint = item.destination ? ` → ${item.destination}` : "";
      const truth = item.truth ? `: ${item.truth}` : "";
      lines.push(`- ${item.command}, ${item.source}${endpoint}${truth} (rev ${item.revision})${item.result && !item.truth ? ` — ${item.result}` : ""}`);
    }
  } else {
    lines.push("- Ingen observation eller aktiv probe är sparad ännu.");
  }
  lines.push("", "## Genomförda åtgärder");
  if (summary.actions.length) {
    for (const action of summary.actions) {
      lines.push(`- ${action.label} på ${action.target}`);
      lines.push(`  - Registrerad ändring: ${action.operation}`);
      if (action.parameters) lines.push(`  - Parametrar: ${compactJson(action.parameters)}`);
      lines.push(`  - Runtime-revision: ${action.beforeRevision} → ${action.afterRevision}`);
      lines.push(`  - Värde: ${action.beforeValue} → ${action.afterValue}`);
      if (action.note) lines.push(`  - Användaranteckning: ${action.note}`);
    }
  } else lines.push("- Ingen åtgärd är dokumenterad.");
  lines.push("", "## Verifieringar per åtgärd");
  if (summary.verifications.length) {
    for (const verification of summary.verifications) {
      lines.push(`- ${verification.remediationEntryId ?? "Åtgärd"}: ${verification.status}${verification.historical ? " (historisk)" : ""}`);
      for (const pair of verification.pairs) lines.push(`  - ${pair.label}: ${pair.before} → ${pair.after} (${pair.pairStatus})`);
    }
  } else lines.push("- Ingen matchad före-/efterevidens finns ännu.");
  lines.push("", "## Användarens hypotes");
  lines.push(summary.hypothesis ? `${summary.hypothesis.text} (rev ${summary.hypothesis.revision}${summary.hypothesis.historical ? ", historisk" : ""})` : "Ingen hypotes är dokumenterad.");
  lines.push("", "## Senaste åtgärd (kompatibilitetsprojektion)");
  if (summary.action) {
    lines.push(`- ${summary.action.label} på ${summary.action.target}`);
    lines.push(`- Registrerad ändring: ${summary.action.operation}`);
    if (summary.action.parameters) lines.push(`- Parametrar: ${compactJson(summary.action.parameters)}`);
    lines.push(`- Runtime-revision: ${summary.action.beforeRevision} → ${summary.action.afterRevision}`);
    lines.push(`- Värde: ${summary.action.beforeValue} → ${summary.action.afterValue}`);
    if (summary.action.note) lines.push(`- Användaranteckning: ${summary.action.note}`);
  } else {
    lines.push("- Ingen åtgärd är dokumenterad.");
  }
  lines.push("", "## Senaste verifiering (kompatibilitetsprojektion)");
  if (summary.verification?.pairs.length) {
    for (const pair of summary.verification.pairs) lines.push(`- ${pair.label}: ${pair.before} → ${pair.after} (${pair.pairStatus})`);
    lines.push(`- Review-status: ${summary.verification.status}${summary.verification.historical ? " (historisk)" : ""}`);
  } else {
    lines.push("- Ingen matchad före-/efterevidens finns ännu.");
  }
  lines.push("", "## Slutverifiering", `- Fullständig incidentåterställning verifierad: ${summary.fullRecoveryVerified ? "JA" : "NEJ"}`, `- Aktuella slutprober: ${summary.finalVerification.completed.length}/${summary.finalVerification.required.length}`, "", "## Kvarstående osäkerhet", summary.uncertainty, "", "## Uppgiftens separata completion-evaluering", `- ${summary.completionLabel}`, "", "## Miljö", summary.modeledEnvironment, "", `Scenario source hash: ${summary.scenarioHash}`);
  return `${lines.join("\n")}\n`;
}

async function sha256(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildTroubleshootingSummary(workspace: BrowserWorkspace, notebook?: TroubleshootingNotebook): Promise<TroubleshootingSummaryResult> {
  if (workspace.mode !== "runtime") return { ok: false, diagnostics: [error("TROUBLESHOOTING_SUMMARY_RUNTIME_REQUIRED", "Felsökningssammanfattning är tillgänglig endast i Runtime.")] };
  const runtime = workspace as RuntimeWorkspace;
  const exactNotebook = notebook ?? await createTroubleshootingNotebook(runtime.scenario.scenarioId, runtime.scenario.sourceHash);
  if (exactNotebook.scenarioId !== runtime.scenario.scenarioId || exactNotebook.scenarioHash !== runtime.scenario.sourceHash) {
    return { ok: false, diagnostics: [error("TROUBLESHOOTING_SUMMARY_SCENARIO_MISMATCH", "Notebook och Runtime hör inte till samma aktuella scenarioidentitet.")] };
  }
  const verified = await verifyTroubleshootingNotebook(exactNotebook);
  if (!verified.ok) return { ok: false, diagnostics: verified.diagnostics.map((item) => error(item.code, item.message)) };

  const allEvidence = exactNotebook.entries.filter(isEvidence);
  const remediations = exactNotebook.entries.filter((entry): entry is Extract<TroubleshootingNotebookEntry, { readonly kind: "remediation_action" }> => entry.kind === "remediation_action");
  const latestRemediation = remediations.at(-1);
  let remediationReview: RemediationReview | undefined;
  if (latestRemediation) {
    const result = await reviewRemediationLoop(exactNotebook, latestRemediation.entryId);
    if (!result.ok || !result.review) return { ok: false, diagnostics: result.diagnostics.map((item) => error(item.code, item.message)) };
    remediationReview = result.review;
  }
  const historicalAction = latestRemediation ? !isCurrentRemediationState(runtime, latestRemediation) : false;
  let status: TroubleshootingSummaryStatus;
  if (!allEvidence.length) status = "INSUFFICIENT_EVIDENCE";
  else if (!latestRemediation) status = "INVESTIGATION_IN_PROGRESS";
  else if (!remediationReview || remediationReview.status === "PENDING_AFTER_EVIDENCE") status = "ACTION_RECORDED_NO_RETEST";
  else if (remediationReview.status === "REGRESSION_DETECTED") status = "REGRESSION_DETECTED";
  else if (remediationReview.status === "VERIFIED_IMPROVEMENT") status = historicalAction ? "HISTORICAL_VERIFIED_NEEDS_RECHECK" : "VERIFIED_IMPROVEMENT";
  else status = "NO_VERIFIED_IMPROVEMENT";

  const evidence = allEvidence.map(evidenceResult);
  const hypothesisCandidates = exactNotebook.entries.filter((entry): entry is Extract<TroubleshootingNotebookEntry, { readonly kind: "learner_note" }> => entry.kind === "learner_note" && entry.noteKind === "hypothesis" && (!latestRemediation || entry.sequence < latestRemediation.sequence));
  const hypothesisEntry = hypothesisCandidates.at(-1);
  const hypothesis = hypothesisEntry ? { text: hypothesisEntry.text, revision: hypothesisEntry.stateRevision, historical: hypothesisEntry.stateRevision !== runtime.engineState.stateRevision } : undefined;
  const actionFor = (remediation: Extract<TroubleshootingNotebookEntry, { readonly kind: "remediation_action" }>): TroubleshootingSummaryAction => ({
    entryId: remediation.entryId,
    label: remediation.typedAction?.label ?? `${remediation.operation.op.toUpperCase()} ${remediation.operation.path}`,
    target: remediation.typedAction?.targetId ?? remediation.operation.target,
    operation: `${remediation.operation.op.toUpperCase()} ${remediation.operation.target}.${remediation.operation.path}`,
    ...(remediation.typedAction?.parameters ? { parameters: remediation.typedAction.parameters } : {}),
    beforeRevision: remediation.beforeStateRevision,
    afterRevision: remediation.afterStateRevision,
    beforeValue: displayValue(remediation.beforeValueState, remediation.beforeValue),
    afterValue: displayValue(remediation.afterValueState, remediation.afterValue),
    ...(remediation.learnerNote ? { note: remediation.learnerNote } : {}),
  });
  const verificationFor = (remediation: Extract<TroubleshootingNotebookEntry, { readonly kind: "remediation_action" }>, review: RemediationReview): TroubleshootingSummaryVerification => ({
    remediationEntryId: remediation.entryId,
    status: review.status,
    historical: !isCurrentRemediationState(runtime, remediation),
    pairs: review.pairs.map((pair) => {
      const before = entryById(exactNotebook, pair.beforeEntryId);
      const after = entryById(exactNotebook, pair.afterEntryId);
      const beforeEvidence = before && isEvidence(before) ? before : undefined;
      const afterEvidence = after && isEvidence(after) ? after : undefined;
      return {
        label: beforeEvidence && afterEvidence ? evidenceLabel(beforeEvidence) : `${pair.beforeEntryId} → ${pair.afterEntryId}`,
        before: beforeEvidence?.kind === "active_probe" ? beforeEvidence.truth : beforeEvidence?.kind === "observation" ? beforeEvidence.lines.slice(0, 2).join(" · ") : "UNKNOWN",
        after: afterEvidence?.kind === "active_probe" ? afterEvidence.truth : afterEvidence?.kind === "observation" ? afterEvidence.lines.slice(0, 2).join(" · ") : "UNKNOWN",
        pairStatus: pair.status,
      };
    }),
  });
  const reviewedRemediations: readonly { readonly remediation: Extract<TroubleshootingNotebookEntry, { readonly kind: "remediation_action" }>; readonly review?: RemediationReview }[] = await Promise.all(remediations.map(async (remediation) => {
    const result = await reviewRemediationLoop(exactNotebook, remediation.entryId);
    return { remediation, ...(result.ok && result.review ? { review: result.review } : {}) };
  }));
  const actions = remediations.map(actionFor);
  const verifications = reviewedRemediations.filter((item): item is { readonly remediation: Extract<TroubleshootingNotebookEntry, { readonly kind: "remediation_action" }>; readonly review: RemediationReview } => item.review !== undefined).map((item) => verificationFor(item.remediation, item.review));
  const action = latestRemediation ? actionFor(latestRemediation) : undefined;
  const verification = remediationReview ? verificationFor(latestRemediation!, remediationReview) : undefined;

  const completion = runtime.evaluation.completion.truth;
  const finalVerification = currentFinalVerificationRequirements(runtime, exactNotebook, latestRemediation);
  const fullRecoveryVerified = completion === "TRUE" && finalVerification.complete && !historicalAction && (!latestRemediation || remediationReview?.status === "VERIFIED_IMPROVEMENT");
  const completionLabel = completion === "TRUE" ? "Slutfört labb: TRUE" : completion === "FALSE" ? "Slutfört labb: FALSE" : "Slutfört labb: UNKNOWN";
  const uncertainty = status === "INSUFFICIENT_EVIDENCE"
    ? "Problemet är inte tillräckligt dokumenterat ännu. Ingen åtgärd eller verifierad förbättring finns i aktuell Notebook."
    : status === "INVESTIGATION_IN_PROGRESS"
      ? "Ingen åtgärd är dokumenterad; ingen förbättring är verifierad."
      : status === "ACTION_RECORDED_NO_RETEST"
        ? "Åtgärden är registrerad, men ett jämförbart omtest saknas."
        : status === "REGRESSION_DETECTED"
          ? "Efterevidensen visar regression; problemet ska inte beskrivas som löst."
          : status === "NO_VERIFIED_IMPROVEMENT"
            ? "Matchad före-/efterevidens styrker ingen förbättring."
            : status === "HISTORICAL_VERIFIED_NEEDS_RECHECK"
              ? `Förbättringen verifierades vid rev ${latestRemediation?.afterStateRevision}, men aktuell Runtime är rev ${runtime.engineState.stateRevision}. Ny verifiering behövs.`
      : fullRecoveryVerified
        ? "Alla deklarerade slutprober är sparade med TRUE i aktuell Runtime och completion är TRUE. Incidenten kan beskrivas som verifierat återställd."
        : "Förbättring verifierad med matchad före-/efterevidens, men fullständig incidentåterställning är ännu inte styrkt av alla aktuella slutprober.";
  const base = {
    scenarioId: runtime.scenario.scenarioId,
    scenarioHash: runtime.scenario.sourceHash,
    title: runtime.scenario.metadata.title,
    problem: runtime.scenario.metadata.briefing || runtime.scenario.metadata.description || "Scenario utan användarsynlig problembeskrivning.",
    modeledEnvironment: "Modellerad YadiLab-simulering; ingen verklig host- eller nätverksexekvering.",
    status,
    statusLabel: troubleshootingSummaryStatusLabel(status),
    runtimeRevision: runtime.engineState.stateRevision,
    evidence,
    actions,
    verifications,
    finalVerification,
    fullRecoveryVerified,
    ...(hypothesis ? { hypothesis } : {}),
    ...(action ? { action } : {}),
    ...(verification ? { verification } : {}),
    completion,
    completionLabel,
    uncertainty,
  } satisfies Omit<TroubleshootingSummary, "markdown" | "reportIdentity">;
  const markdown = markdownFor(base);
  const reportIdentity = await sha256(markdown);
  return { ok: true, summary: { ...base, markdown, reportIdentity }, diagnostics: [] };
}

export function createTroubleshootingSummaryDownload(summary: TroubleshootingSummary): { readonly filename: string; readonly mime: "text/markdown"; readonly text: string } {
  return { filename: `${summary.scenarioId}-troubleshooting-summary.md`, mime: "text/markdown", text: summary.markdown };
}
