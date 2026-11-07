import type {
  ActiveProbeTranscript,
  ObservationDiagnostic,
  ObservationTranscript,
  TroubleshootingActiveProbeEntry,
  TroubleshootingLearnerNoteEntry,
  TroubleshootingNotebook,
  TroubleshootingNotebookEntry,
  TroubleshootingNotebookResult,
  TroubleshootingNoteKind,
  TroubleshootingObservationEntry,
} from "./types.js";
import { typedRemediationAuditMatchesOperation } from "./typed-remediation.js";

export const TROUBLESHOOTING_NOTEBOOK_VERSION = "0.3.0" as const;
export const TROUBLESHOOTING_NOTEBOOK_LEGACY_VERSIONS = ["0.1.0", "0.2.0"] as const;
export const TROUBLESHOOTING_NOTEBOOK_MAX_ENTRIES = 256 as const;

function normalizedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (value !== null && typeof value === "object") {
    const source = value as Readonly<Record<string, unknown>>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) if (source[key] !== undefined) out[key] = normalizedJson(source[key]);
    return out;
  }
  return value;
}
export function canonicalTroubleshootingJson(value: unknown): string { return JSON.stringify(normalizedJson(value)); }
async function sha256Utf8(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable in this runtime");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function diagnostic(severity: ObservationDiagnostic["severity"], code: string, message: string): ObservationDiagnostic { return { severity, code, message }; }
function entryId(sequence: number): string { return `entry-${String(sequence).padStart(4, "0")}`; }
function cleanNote(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 4000) : undefined;
}
function notebookProjection(notebook: TroubleshootingNotebook): unknown { return { ...notebook, notebookIdentity: undefined }; }
export async function computeTroubleshootingNotebookIdentity(notebook: TroubleshootingNotebook): Promise<string> {
  return sha256Utf8(canonicalTroubleshootingJson(notebookProjection(notebook)));
}
export async function computeObservationTranscriptIdentity(transcript: ObservationTranscript | ActiveProbeTranscript): Promise<string> {
  return sha256Utf8(canonicalTroubleshootingJson(transcript));
}
async function finalize(args: Omit<TroubleshootingNotebook, "notebookIdentity">): Promise<TroubleshootingNotebook> {
  const draft: TroubleshootingNotebook = { ...args, notebookIdentity: "0".repeat(64) };
  return { ...draft, notebookIdentity: await computeTroubleshootingNotebookIdentity(draft) };
}
export async function createTroubleshootingNotebook(scenarioId: string, scenarioHash: string): Promise<TroubleshootingNotebook> {
  return finalize({ formatId: "infrastructure-cyber-lab.troubleshooting-notebook", schemaVersion: TROUBLESHOOTING_NOTEBOOK_VERSION, scenarioId, scenarioHash, entries: [] });
}
function basicDiagnostics(notebook: TroubleshootingNotebook): ObservationDiagnostic[] {
  const diagnostics: ObservationDiagnostic[] = [];
  if (notebook.formatId !== "infrastructure-cyber-lab.troubleshooting-notebook") diagnostics.push(diagnostic("error", "NOTEBOOK_FORMAT_INVALID", "Troubleshooting notebook formatId is invalid."));
  if (notebook.schemaVersion !== TROUBLESHOOTING_NOTEBOOK_VERSION && !(TROUBLESHOOTING_NOTEBOOK_LEGACY_VERSIONS as readonly string[]).includes(notebook.schemaVersion)) diagnostics.push(diagnostic("error", "NOTEBOOK_VERSION_INVALID", `Troubleshooting notebook version '${notebook.schemaVersion}' is unsupported.`));
  if (!/^[0-9a-f]{64}$/.test(notebook.scenarioHash)) diagnostics.push(diagnostic("error", "NOTEBOOK_SCENARIO_HASH_INVALID", "Troubleshooting notebook scenarioHash must be a SHA-256 hex string."));
  if (notebook.entries.length > TROUBLESHOOTING_NOTEBOOK_MAX_ENTRIES) diagnostics.push(diagnostic("error", "NOTEBOOK_ENTRY_LIMIT", `Troubleshooting notebook may contain at most ${TROUBLESHOOTING_NOTEBOOK_MAX_ENTRIES} entries.`));
  notebook.entries.forEach((entry, index) => {
    const expected = index + 1;
    if (entry.sequence !== expected || entry.entryId !== entryId(expected)) diagnostics.push(diagnostic("error", "NOTEBOOK_SEQUENCE_NONCANONICAL", `Notebook entry ${index} must be canonical sequence ${expected} / '${entryId(expected)}'.`));
    if (entry.kind === "remediation_action" && entry.typedAction && !typedRemediationAuditMatchesOperation(entry.typedAction, entry.operation)) diagnostics.push(diagnostic("error", "NOTEBOOK_TYPED_REMEDIATION_MISMATCH", `Remediation entry '${entry.entryId}' typed action does not match its committed Engine operation.`));
  });
  return diagnostics;
}
export async function verifyTroubleshootingNotebook(notebook: TroubleshootingNotebook): Promise<TroubleshootingNotebookResult> {
  const diagnostics = basicDiagnostics(notebook);
  if (!diagnostics.length) {
    const identity = await computeTroubleshootingNotebookIdentity(notebook);
    if (identity !== notebook.notebookIdentity) diagnostics.push(diagnostic("error", "NOTEBOOK_IDENTITY_MISMATCH", "Troubleshooting notebook identity does not match its canonical content."));
  }
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, notebook, diagnostics: [] };
}
async function appendEntry(notebook: TroubleshootingNotebook, entry: Omit<TroubleshootingNotebookEntry, "entryId" | "sequence">): Promise<TroubleshootingNotebookResult> {
  const existing = await verifyTroubleshootingNotebook(notebook);
  if (!existing.ok) return existing;
  if (notebook.entries.length >= TROUBLESHOOTING_NOTEBOOK_MAX_ENTRIES) return { ok: false, diagnostics: [diagnostic("error", "NOTEBOOK_ENTRY_LIMIT", `Troubleshooting notebook may contain at most ${TROUBLESHOOTING_NOTEBOOK_MAX_ENTRIES} entries.`)] };
  const sequence = notebook.entries.length + 1;
  const nextEntry = { ...clone(entry), entryId: entryId(sequence), sequence } as TroubleshootingNotebookEntry;
  const next = await finalize({ ...notebook, entries: [...notebook.entries, nextEntry], notebookIdentity: undefined } as unknown as Omit<TroubleshootingNotebook, "notebookIdentity">);
  return { ok: true, notebook: next, diagnostics: [] };
}
function transcriptBindingDiagnostics(notebook: TroubleshootingNotebook, transcript: ObservationTranscript | ActiveProbeTranscript): ObservationDiagnostic[] {
  const diagnostics: ObservationDiagnostic[] = [];
  if (transcript.scenarioId !== notebook.scenarioId || transcript.scenarioHash !== notebook.scenarioHash) diagnostics.push(diagnostic("error", "NOTEBOOK_SCENARIO_MISMATCH", "Evidence transcript belongs to a different scenario identity."));
  if (!transcript.modeled || transcript.boundary !== "NO_GUEST_COMMAND_EXECUTION") diagnostics.push(diagnostic("error", "NOTEBOOK_EVIDENCE_BOUNDARY_INVALID", "Only explicitly modeled no-guest-execution transcripts may be captured."));
  return diagnostics;
}
export async function captureObservationInNotebook(notebook: TroubleshootingNotebook, transcript: ObservationTranscript, learnerNote?: string): Promise<TroubleshootingNotebookResult> {
  const diagnostics = transcriptBindingDiagnostics(notebook, transcript);
  if (diagnostics.length) return { ok: false, diagnostics };
  const note = cleanNote(learnerNote);
  const transcriptIdentity = await computeObservationTranscriptIdentity(transcript);
  if (notebook.entries.some((entry) => (entry.kind === "observation" || entry.kind === "active_probe") && entry.stateRevision === transcript.stateRevision && entry.transcriptIdentity === transcriptIdentity)) return { ok: false, diagnostics: [diagnostic("error", "NOTEBOOK_DUPLICATE_EVIDENCE", "This exact transcript is already saved for the same Runtime revision.")] };
  const entry: Omit<TroubleshootingObservationEntry, "entryId" | "sequence"> = {
    kind: "observation", stateRevision: transcript.stateRevision, engineId: transcript.engineId, engineVersion: transcript.engineVersion, boundary: transcript.boundary,
    command: transcript.command, category: transcript.category, targetId: transcript.targetId, targetLabel: transcript.targetLabel,
    transcriptIdentity, lines: clone(transcript.lines), evidence: clone(transcript.evidence), ...(note ? { learnerNote: note } : {}),
  };
  return appendEntry(notebook, entry);
}
export async function captureActiveProbeInNotebook(notebook: TroubleshootingNotebook, transcript: ActiveProbeTranscript, learnerNote?: string): Promise<TroubleshootingNotebookResult> {
  const diagnostics = transcriptBindingDiagnostics(notebook, transcript);
  if (diagnostics.length) return { ok: false, diagnostics };
  const note = cleanNote(learnerNote);
  const transcriptIdentity = await computeObservationTranscriptIdentity(transcript);
  if (notebook.entries.some((entry) => (entry.kind === "observation" || entry.kind === "active_probe") && entry.stateRevision === transcript.stateRevision && entry.transcriptIdentity === transcriptIdentity)) return { ok: false, diagnostics: [diagnostic("error", "NOTEBOOK_DUPLICATE_EVIDENCE", "This exact transcript is already saved for the same Runtime revision.")] };
  const entry: Omit<TroubleshootingActiveProbeEntry, "entryId" | "sequence"> = {
    kind: "active_probe", stateRevision: transcript.stateRevision, engineId: transcript.engineId, engineVersion: transcript.engineVersion, boundary: transcript.boundary, probeMode: transcript.probeMode,
    command: transcript.command, category: transcript.category, sourceId: transcript.sourceId, sourceLabel: transcript.sourceLabel, truth: transcript.truth,
    ...(transcript.destinationId ? { destinationId: transcript.destinationId } : {}), ...(transcript.destinationLabel ? { destinationLabel: transcript.destinationLabel } : {}),
    ...(transcript.protocol ? { protocol: transcript.protocol } : {}), ...(transcript.port !== undefined ? { port: transcript.port } : {}), ...(transcript.queryName ? { queryName: transcript.queryName } : {}),
    ...(transcript.resolvedAddress ? { resolvedAddress: transcript.resolvedAddress } : {}), ...(transcript.resolvedResourceIds ? { resolvedResourceIds: clone(transcript.resolvedResourceIds) } : {}),
    ...(transcript.path ? { path: clone(transcript.path) } : {}), ...(transcript.blockingPoint ? { blockingPoint: transcript.blockingPoint } : {}),
    transcriptIdentity, lines: clone(transcript.lines), evidence: clone(transcript.evidence), ...(note ? { learnerNote: note } : {}),
  };
  return appendEntry(notebook, entry);
}
export async function addLearnerNoteToNotebook(notebook: TroubleshootingNotebook, stateRevision: number, noteKind: TroubleshootingNoteKind, text: string): Promise<TroubleshootingNotebookResult> {
  const clean = cleanNote(text);
  if (!Number.isInteger(stateRevision) || stateRevision < 0) return { ok: false, diagnostics: [diagnostic("error", "NOTEBOOK_NOTE_REVISION_INVALID", "Learner note stateRevision must be a non-negative integer.")] };
  if (!(["hypothesis", "next_step", "conclusion"] as const).includes(noteKind)) return { ok: false, diagnostics: [diagnostic("error", "NOTEBOOK_NOTE_KIND_INVALID", `Unsupported learner note kind '${String(noteKind)}'.`)] };
  if (!clean) return { ok: false, diagnostics: [diagnostic("error", "NOTEBOOK_NOTE_EMPTY", "Learner note must contain non-whitespace text.")] };
  const entry: Omit<TroubleshootingLearnerNoteEntry, "entryId" | "sequence"> = { kind: "learner_note", stateRevision, noteKind, text: clean };
  return appendEntry(notebook, entry);
}
