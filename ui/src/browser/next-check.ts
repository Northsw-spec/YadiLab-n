import {
  createTroubleshootingNotebook,
  reviewRemediationLoop,
  reviewTroubleshootingEvidence,
  type RemediationReview,
  type TroubleshootingActiveProbeEntry,
  type TroubleshootingEvidenceReview,
  type TroubleshootingNotebook,
  type TroubleshootingNotebookEntry,
} from "../../../observation-engine/src/index.js";
import type { Normalizedscenariotroubleshootingevidencerequirement } from "../../../core-model/src/generated/contracts.js";
import { buildRuntimeActiveProbeModel, buildRuntimeObservationModel } from "./observations.js";
import { isCurrentRemediationState } from "./troubleshooting-summary.js";
import type { BrowserDiagnostic, BrowserWorkspace, RuntimeWorkspace } from "./types.js";

export type NextCheckTool = "observations" | "probes" | "notebook" | "remediation" | "summary";
export type NextCheckKind = "observation" | "active_probe" | "repeat_active_probe" | "process" | "general";

export interface NextCheckPreparation {
  readonly tool: NextCheckTool;
  readonly targetId?: string;
  readonly commandId?: string;
  readonly sourceId?: string;
  readonly probeId?: string;
  readonly destinationId?: string;
  readonly port?: number;
  readonly queryName?: string;
  readonly options?: readonly { readonly id: string; readonly label: string }[];
}

export interface NextCheckProgress {
  readonly completed: number;
  readonly total: number;
}

export interface NextCheck {
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly kind: NextCheckKind;
  readonly title: string;
  readonly reason: string;
  readonly actionLabel: string;
  readonly tool: NextCheckTool;
  readonly preparation?: NextCheckPreparation;
  readonly requirementId?: string;
  readonly requirementLabel?: string;
  readonly requirementStatus?: "PENDING" | "OUT_OF_ORDER";
  readonly progress: NextCheckProgress;
  readonly remediationReviewStatus?: RemediationReview["status"];
  readonly workflowIdentity: string;
}

export interface NextCheckResult {
  readonly ok: boolean;
  readonly nextCheck?: NextCheck;
  readonly review?: TroubleshootingEvidenceReview;
  readonly diagnostics: readonly BrowserDiagnostic[];
}

type Requirement = Normalizedscenariotroubleshootingevidencerequirement;
type RemediationEntry = Extract<TroubleshootingNotebookEntry, { readonly kind: "remediation_action" }>;

function error(code: string, message: string): BrowserDiagnostic { return { severity: "error", code, message }; }
function categoryTitle(category: string | undefined): string {
  return category === "routing" ? "Kontrollera routing"
    : category === "dns" ? "Kontrollera DNS"
      : category === "service" ? "Undersök tjänst"
        : category === "interface" ? "Kontrollera nätverkskonfiguration"
          : category === "firewall" ? "Kontrollera brandväggsevidens"
            : "Samla nästa evidens";
}

function sourceLabel(workspace: RuntimeWorkspace, id?: string): string { return workspace.scenario.resources.find((resource) => resource.id === id)?.label ?? id ?? "värden"; }

function observationPreparation(workspace: RuntimeWorkspace, requirement: Extract<Requirement, { readonly kind: "observation" }>): NextCheckPreparation | undefined {
  if (!requirement.targetId) return undefined;
  const model = buildRuntimeObservationModel(workspace, requirement.targetId);
  const candidates = model.commands.filter((command) =>
    (requirement.category === undefined || command.category === requirement.category) &&
    (requirement.command === undefined || command.command === requirement.command || command.commandId === requirement.command));
  if (!candidates.length) return undefined;
  return {
    tool: "observations",
    targetId: requirement.targetId,
    ...(candidates.length === 1 ? { commandId: candidates[0]!.commandId } : {}),
    ...(candidates.length > 1 ? { options: candidates.map((command) => ({ id: command.commandId, label: `${command.command} · ${command.label}` })) } : {}),
  };
}

function probePreparation(workspace: RuntimeWorkspace, requirement: Extract<Requirement, { readonly kind: "active_probe" }>): NextCheckPreparation | undefined {
  if (!requirement.sourceId) return undefined;
  const model = buildRuntimeActiveProbeModel(workspace, requirement.sourceId, requirement.destinationId);
  const candidates = model.probes.filter((probe) => {
    if (requirement.category === "dns") return probe.category === "dns" && probe.argumentKind === "dns_name";
    if (requirement.protocol === "icmp") return probe.category === "connectivity" && probe.probeId.endsWith("ping");
    if (requirement.protocol === "tcp") return probe.category === "connectivity" && probe.argumentKind === "destination_port" && (probe.probeId.endsWith("nc_tcp") || probe.commandTemplate.includes("nc -vz"));
    if (requirement.protocol === "udp") return probe.category === "connectivity" && probe.argumentKind === "destination_port" && (probe.probeId.endsWith("udp_delivery") || probe.commandTemplate.includes("ss -lunp"));
    return requirement.category === undefined || probe.category === requirement.category;
  });
  if (!candidates.length) return undefined;
  const selected = candidates.length === 1 ? candidates[0] : undefined;
  return {
    tool: "probes",
    sourceId: requirement.sourceId,
    ...(selected ? { probeId: selected.probeId } : {}),
    ...(requirement.destinationId ? { destinationId: requirement.destinationId } : {}),
    ...(requirement.port !== undefined ? { port: requirement.port } : {}),
    ...(requirement.queryName !== undefined ? { queryName: requirement.queryName } : {}),
    ...(candidates.length > 1 ? { options: candidates.map((probe) => ({ id: probe.probeId, label: `${probe.commandTemplate} · ${probe.label}` })) } : {}),
  };
}

function repeatProbePreparation(workspace: RuntimeWorkspace, entry: TroubleshootingActiveProbeEntry): NextCheckPreparation | undefined {
  const model = buildRuntimeActiveProbeModel(workspace, entry.sourceId, entry.destinationId);
  const probe = model.probes.find((candidate) => entry.protocol === "icmp"
    ? candidate.probeId.endsWith("ping")
    : entry.protocol === "tcp"
      ? candidate.argumentKind === "destination_port" && (candidate.probeId.endsWith("nc_tcp") || candidate.commandTemplate.includes("nc -vz"))
      : entry.category === "dns" ? candidate.category === "dns" : candidate.category === entry.category);
  if (!probe || (entry.destinationId && !model.destinations.some((destination) => destination.id === entry.destinationId))) return undefined;
  return {
    tool: "probes",
    sourceId: entry.sourceId,
    probeId: probe.probeId,
    ...(entry.destinationId ? { destinationId: entry.destinationId } : {}),
    ...(entry.port !== undefined ? { port: entry.port } : {}),
    ...(entry.queryName !== undefined ? { queryName: entry.queryName } : {}),
  };
}

function repeatActionLabel(entry: TroubleshootingActiveProbeEntry): string {
  if (entry.category === "dns") return "Förbered samma DNS-fråga igen";
  if (entry.protocol === "tcp") return "Förbered samma TCP-test igen";
  if (entry.protocol === "icmp") return "Förbered samma ping igen";
  return "Förbered samma probe igen";
}

function matchesProbeRequirement(requirement: Extract<Requirement, { readonly kind: "active_probe" }>, entry: TroubleshootingActiveProbeEntry): boolean {
  return (requirement.category === undefined || requirement.category === entry.category)
    && (requirement.sourceId === undefined || requirement.sourceId === entry.sourceId)
    && (requirement.destinationId === undefined || requirement.destinationId === entry.destinationId)
    && (requirement.protocol === undefined || requirement.protocol === entry.protocol)
    && (requirement.port === undefined || requirement.port === entry.port)
    && (requirement.queryName === undefined || requirement.queryName === entry.queryName)
    && (requirement.truth === undefined || requirement.truth === entry.truth);
}

function chooseBaselineProbe(workspace: RuntimeWorkspace, entries: readonly TroubleshootingNotebookEntry[], remediation: RemediationEntry): TroubleshootingActiveProbeEntry | undefined {
  const candidates = entries.filter((entry): entry is TroubleshootingActiveProbeEntry =>
    entry.kind === "active_probe" && entry.sequence < remediation.sequence && repeatProbePreparation(workspace, entry) !== undefined);
  if (!candidates.length) return undefined;
  const requiredProbeRequirements = (workspace.scenario.troubleshootingObjectives ?? [])
    .filter((objective) => objective.required)
    .flatMap((objective) => objective.requirements)
    .filter((requirement): requirement is Extract<Requirement, { readonly kind: "active_probe" }> => requirement.kind === "active_probe");
  const relevant = candidates.filter((entry) => requiredProbeRequirements.some((requirement) => matchesProbeRequirement(requirement, entry)));
  return (relevant.length ? relevant : candidates).at(-1);
}

function success(nextCheck: NextCheck, review: TroubleshootingEvidenceReview): NextCheckResult {
  return { ok: true, nextCheck, review, diagnostics: [] };
}

function findPendingRequirement(workspace: RuntimeWorkspace, review: TroubleshootingEvidenceReview): { requirement: Requirement; status: "PENDING" | "OUT_OF_ORDER"; label: string } | undefined {
  const objectives = workspace.scenario.troubleshootingObjectives ?? [];
  let firstPending: { requirement: Requirement; label: string } | undefined;
  let orderViolation = false;
  for (const objective of objectives) {
    if (!objective.required) continue;
    const reviewed = review.objectives.find((item) => item.objectiveId === objective.id);
    for (const requirement of objective.requirements) {
      const requirementReview = reviewed?.requirements.find((item) => item.requirementId === requirement.id);
      if (requirementReview?.status === "OUT_OF_ORDER") orderViolation = true;
      if (requirementReview?.status !== "SATISFIED" && !firstPending) firstPending = { requirement, label: requirement.label };
    }
  }
  return firstPending ? { ...firstPending, status: orderViolation ? "OUT_OF_ORDER" : "PENDING" } : undefined;
}

export async function buildNextBestCheck(workspace: BrowserWorkspace, notebook?: TroubleshootingNotebook): Promise<NextCheckResult> {
  if (workspace.mode !== "runtime") return { ok: false, diagnostics: [error("NEXT_CHECK_RUNTIME_REQUIRED", "Nästa kontroll är tillgänglig endast i Runtime.")] };
  const runtime = workspace as RuntimeWorkspace;
  const exactNotebook = notebook;
  if (exactNotebook && (exactNotebook.scenarioId !== runtime.scenario.scenarioId || exactNotebook.scenarioHash !== runtime.scenario.sourceHash)) {
    return { ok: false, diagnostics: [error("NEXT_CHECK_SCENARIO_MISMATCH", "Nästa kontroll kan inte använda evidens från ett annat scenario.")] };
  }
  const reviewNotebook = exactNotebook ?? await createTroubleshootingNotebook(runtime.scenario.scenarioId, runtime.scenario.sourceHash);
  const reviewResult = await reviewTroubleshootingEvidence(runtime.scenario, reviewNotebook);
  if (!reviewResult.ok || !reviewResult.review) return { ok: false, diagnostics: reviewResult.diagnostics.map((item) => error(item.code, item.message)) };
  const review = reviewResult.review;
  const objectives = workspace.scenario.troubleshootingObjectives ?? [];
  const total = objectives.filter((objective) => objective.required).reduce((count, objective) => count + objective.requirements.length, 0);
  const completed = review.objectives.filter((objective) => objective.required).reduce((count, objective) => count + objective.requirements.filter((requirement) => requirement.status === "SATISFIED").length, 0);
  const progress = { completed, total };
  const entries = exactNotebook?.entries ?? [];
  const remediations = entries.filter((entry): entry is RemediationEntry => entry.kind === "remediation_action");
  const latestRemediation = remediations.at(-1);
  if (latestRemediation) {
    const remediationReviewResult = await reviewRemediationLoop(exactNotebook!, latestRemediation.entryId);
    if (!remediationReviewResult.ok || !remediationReviewResult.review) return { ok: false, diagnostics: remediationReviewResult.diagnostics.map((item) => error(item.code, item.message)) };
    const remediationReview = remediationReviewResult.review;
    const historical = !isCurrentRemediationState(runtime, latestRemediation);
    if (!historical && remediationReview.status === "PENDING_AFTER_EVIDENCE") {
      const baseline = chooseBaselineProbe(runtime, entries, latestRemediation);
      if (baseline) {
        const preparation = repeatProbePreparation(runtime, baseline);
        if (preparation) return success({
          scenarioId: runtime.scenario.scenarioId, scenarioHash: runtime.scenario.sourceHash, kind: "repeat_active_probe",
          title: "Verifiera ändringen", reason: "Du testade tidigare " + sourceLabel(runtime, baseline.sourceId) + (baseline.destinationId ? " mot " + sourceLabel(runtime, baseline.destinationId) : "") + ". Kör samma " + (baseline.category === "dns" ? "DNS-fråga" : baseline.protocol === "tcp" ? "TCP-test" : baseline.protocol === "icmp" ? "ping" : "probe") + " igen för att se om resultatet förändrats.", actionLabel: repeatActionLabel(baseline), tool: "probes", preparation, progress,
          remediationReviewStatus: remediationReview.status, workflowIdentity: runtime.scenario.sourceHash + ":" + latestRemediation.entryId + ":" + runtime.engineState.stateRevision + ":repeat:" + baseline.entryId,
        }, review);
      }
    }
    if (!historical && remediationReview.status === "PENDING_AFTER_EVIDENCE") return success({
      scenarioId: runtime.scenario.scenarioId, scenarioHash: runtime.scenario.sourceHash, kind: "repeat_active_probe",
      title: "Jämförbart omtest saknas", reason: "Den tidigare evidenskedjan innehåller ingen giltig, jämförbar sparad probe som kan förberedas i aktuell Runtime. Välj själv en stödd probe och dokumentera ett nytt test.", actionLabel: "Öppna aktiva prober", tool: "probes", progress,
      remediationReviewStatus: remediationReview.status, workflowIdentity: runtime.scenario.sourceHash + ":" + latestRemediation.entryId + ":" + runtime.engineState.stateRevision + ":repeat-unavailable",
    }, review);
    if (!historical && remediationReview.status === "VERIFIED_IMPROVEMENT") return success({
      scenarioId: runtime.scenario.scenarioId, scenarioHash: runtime.scenario.sourceHash, kind: "process",
      title: "Granska verifieringsresultatet", reason: "En förbättring har verifierats med jämförbar före-/efterevidens. Granska resultatet och dokumentera din slutsats.", actionLabel: "Visa felsökningssammanfattning", tool: "summary", progress,
      remediationReviewStatus: remediationReview.status, workflowIdentity: runtime.scenario.sourceHash + ":" + latestRemediation.entryId + ":" + runtime.engineState.stateRevision + ":verified",
    }, review);
    if (historical) return success({
      scenarioId: runtime.scenario.scenarioId, scenarioHash: runtime.scenario.sourceHash, kind: "repeat_active_probe",
      title: "Ny verifiering behövs", reason: "Runtime-tillståndet har ändrats sedan den tidigare förbättringen verifierades. Samla ny, jämförbar evidens i aktuell revision.", actionLabel: "Öppna aktiva prober", tool: "probes", progress,
      remediationReviewStatus: remediationReview.status, workflowIdentity: `${runtime.scenario.sourceHash}:${latestRemediation.entryId}:${runtime.engineState.stateRevision}:historical`,
    }, review);
  }
  const pending = findPendingRequirement(runtime, review);
  if (pending) {
    const preparation = pending.requirement.kind === "observation" ? observationPreparation(runtime, pending.requirement) : probePreparation(runtime, pending.requirement);
    const title = pending.requirement.kind === "observation" ? categoryTitle(pending.requirement.category) : pending.requirement.category === "dns" ? "Undersök namnuppslag" : `Undersök anslutningen mellan ${sourceLabel(runtime, pending.requirement.sourceId)} och ${sourceLabel(runtime, pending.requirement.destinationId)}`;
    const reason = pending.requirement.kind === "observation"
      ? preparation ? "Den här observationen visar vilken konfiguration eller vilket tillstånd som är relevant innan du drar en slutsats." : "Det synliga kravet saknar ett kompatibelt modellerat observationskommando i den här Runtime-modellen. Kravet förblir öppet; välj inte ett annat kommando som om det vore samma evidens."
      : pending.requirement.category === "dns"
        ? preparation ? "En namnuppslagning ger separat evidens om DNS utan att bevisa att IP-vägen eller orsaken är fel." : "Det synliga kravet saknar en kompatibel modellerad probe i den här Runtime-modellen. Kravet förblir öppet."
        : preparation ? "En aktiv probe ger modellerad anslutningsevidens att jämföra med konfigurationen." : "Det synliga kravet saknar en kompatibel modellerad probe i den här Runtime-modellen. Kravet förblir öppet.";
    return success({
      scenarioId: runtime.scenario.scenarioId, scenarioHash: runtime.scenario.sourceHash, kind: pending.requirement.kind,
      title, reason, actionLabel: pending.requirement.kind === "observation" ? "Öppna observation för " + sourceLabel(runtime, pending.requirement.targetId) : "Förbered anslutningstest", tool: pending.requirement.kind === "observation" ? "observations" : "probes", ...(preparation ? { preparation } : {}), requirementId: pending.requirement.id, requirementLabel: pending.label, requirementStatus: pending.status, progress,
      workflowIdentity: `${runtime.scenario.sourceHash}:${pending.requirement.id}:${completed}:${pending.status}`,
    }, review);
  }
  const hasHypothesis = entries.some((entry) => entry.kind === "learner_note" && entry.noteKind === "hypothesis" && entry.stateRevision === runtime.engineState.stateRevision);
  if (!hasHypothesis && progress.total > 0 && completed === progress.total) return success({
    scenarioId: runtime.scenario.scenarioId, scenarioHash: runtime.scenario.sourceHash, kind: "process", title: "Formulera egen hypotes", reason: "Den synliga evidenskedjan är samlad. Skriv vad evidensen stödjer innan du väljer en åtgärd.", actionLabel: "Öppna hypotesanteckningar", tool: "notebook", progress, workflowIdentity: `${runtime.scenario.sourceHash}:hypothesis:${runtime.engineState.stateRevision}`,
  }, review);
  if (hasHypothesis && progress.total > 0 && completed === progress.total) return success({
    scenarioId: runtime.scenario.scenarioId, scenarioHash: runtime.scenario.sourceHash, kind: "process", title: "Granska hypotes och eventuell åtgärd", reason: "Du har dokumenterat evidens och en hypotes. Granska om hypotesen motiverar en ändring. Du väljer själv mål, åtgärd och värde.", actionLabel: "Öppna Typed Remediation", tool: "remediation", progress, workflowIdentity: runtime.scenario.sourceHash + ":remediation:" + runtime.engineState.stateRevision + ":" + (exactNotebook?.notebookIdentity ?? "empty"),
  }, review);
  return success({
    scenarioId: runtime.scenario.scenarioId, scenarioHash: runtime.scenario.sourceHash, kind: "general", title: "Välj nästa kontroll", reason: "Scenariot saknar tillräckliga synliga evidenskrav för en specifik rekommendation. Välj själv en stödd observation eller probe.", actionLabel: "Öppna observationer", tool: "observations", progress, workflowIdentity: `${runtime.scenario.sourceHash}:general:${runtime.engineState.stateRevision}`,
  }, review);
}
