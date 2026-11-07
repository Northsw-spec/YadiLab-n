import type { SaveState } from "../../../core-model/src/generated/contracts.js";
import branding from "../../../app-config/branding.json" with { type: "json" };
import {
  canonicalTroubleshootingJson,
  computeTroubleshootingNotebookIdentity,
  createTroubleshootingNotebook,
  verifyTroubleshootingNotebook,
  type TroubleshootingNotebook,
  type TroubleshootingNotebookEntry,
} from "../../../observation-engine/src/index.js";
import { createRuntimeProgress, loadRuntimeProgress } from "./progress.js";
import type { SaveContractValidator } from "./progress-session.js";
import type { TroubleshootingNotebookValidator } from "./troubleshooting-session.js";
import type { BrowserDiagnostic, JsonDownloadDescriptor, RuntimeWorkspace, TextReadableFile } from "./types.js";

export const TROUBLESHOOTING_SESSION_VERSION = "0.1.0" as const;

export interface TroubleshootingSessionSnapshot {
  readonly formatId: "infrastructure-cyber-lab.troubleshooting-session";
  readonly schemaVersion: "0.1.0";
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly stateRevision: number;
  readonly notebookIdentity: string;
  readonly sessionIdentity: string;
  readonly progress: SaveState;
  readonly notebook: TroubleshootingNotebook;
}

export interface TroubleshootingSessionValidation {
  readonly valid: boolean;
  readonly diagnostics?: readonly string[];
}

export type TroubleshootingSessionValidator = (input: unknown) => TroubleshootingSessionValidation;

export interface TroubleshootingSessionValidators {
  readonly validateSession: TroubleshootingSessionValidator;
  readonly validateSave: SaveContractValidator;
  readonly validateNotebook: TroubleshootingNotebookValidator;
}

export interface TroubleshootingSessionResult {
  readonly ok: boolean;
  readonly workspace: RuntimeWorkspace;
  readonly notebook?: TroubleshootingNotebook;
  readonly snapshot?: TroubleshootingSessionSnapshot;
  readonly diagnostics: readonly BrowserDiagnostic[];
}

export interface TroubleshootingReplayFrame {
  readonly sequence: number;
  readonly entryId: string;
  readonly kind: TroubleshootingNotebookEntry["kind"];
  readonly stateRevision: number;
  readonly relationToRestoredState: "current_revision" | "different_revision";
  readonly entry: TroubleshootingNotebookEntry;
}

export interface TroubleshootingSessionStore {
  put(snapshot: TroubleshootingSessionSnapshot): Promise<void>;
  get(scenarioHash: string): Promise<TroubleshootingSessionSnapshot | undefined>;
  delete(scenarioHash: string): Promise<void>;
  list(): Promise<readonly TroubleshootingSessionSnapshot[]>;
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function error(code: string, message: string): BrowserDiagnostic { return { severity: "error", code, message }; }
function mapMessages(code: string, messages: readonly string[] | undefined, fallback: string): readonly BrowserDiagnostic[] {
  const list = messages?.length ? messages : [fallback];
  return list.map((message) => error(code, message));
}
function sessionProjection(snapshot: TroubleshootingSessionSnapshot): unknown { return { ...snapshot, sessionIdentity: undefined }; }
async function sha256Utf8(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable in this runtime");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function computeTroubleshootingSessionIdentity(snapshot: TroubleshootingSessionSnapshot): Promise<string> {
  return sha256Utf8(canonicalTroubleshootingJson(sessionProjection(snapshot)));
}

export class MemoryTroubleshootingSessionStore implements TroubleshootingSessionStore {
  private readonly sessions = new Map<string, TroubleshootingSessionSnapshot>();
  async put(snapshot: TroubleshootingSessionSnapshot): Promise<void> { this.sessions.set(snapshot.scenarioHash, clone(snapshot)); }
  async get(scenarioHash: string): Promise<TroubleshootingSessionSnapshot | undefined> { const item = this.sessions.get(scenarioHash); return item ? clone(item) : undefined; }
  async delete(scenarioHash: string): Promise<void> { this.sessions.delete(scenarioHash); }
  async list(): Promise<readonly TroubleshootingSessionSnapshot[]> { return [...this.sessions.values()].map(clone).sort((a, b) => a.scenarioHash.localeCompare(b.scenarioHash, "en")); }
}

interface StoredTroubleshootingSessionRecord { readonly scenarioHash: string; readonly snapshot: TroubleshootingSessionSnapshot; }

export class IndexedDbTroubleshootingSessionStore implements TroubleshootingSessionStore {
  private readonly indexedDb: IDBFactory;
  private readonly dbName: string;
  private readonly storeName: string;
  constructor(indexedDb: IDBFactory, dbName = "app-troubleshooting-sessions", storeName = "sessions") { this.indexedDb = indexedDb; this.dbName = dbName; this.storeName = storeName; }
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.indexedDb.open(this.dbName, 1);
      request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName, { keyPath: "scenarioHash" }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Troubleshooting session IndexedDB open failed."));
    });
  }
  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T> {
    const db = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(this.storeName, mode); const store = tx.objectStore(this.storeName); run(store, resolve, reject);
        tx.onerror = () => reject(tx.error ?? new Error("Troubleshooting session IndexedDB transaction failed."));
        tx.onabort = () => reject(tx.error ?? new Error("Troubleshooting session IndexedDB transaction aborted."));
      });
    } finally { db.close(); }
  }
  async put(snapshot: TroubleshootingSessionSnapshot): Promise<void> {
    await this.transaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.put({ scenarioHash: snapshot.scenarioHash, snapshot: clone(snapshot) } satisfies StoredTroubleshootingSessionRecord);
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error ?? new Error("Troubleshooting session IndexedDB put failed."));
    });
  }
  async get(scenarioHash: string): Promise<TroubleshootingSessionSnapshot | undefined> {
    return this.transaction<TroubleshootingSessionSnapshot | undefined>("readonly", (store, resolve, reject) => {
      const request = store.get(scenarioHash);
      request.onsuccess = () => { const record = request.result as StoredTroubleshootingSessionRecord | undefined; resolve(record ? clone(record.snapshot) : undefined); };
      request.onerror = () => reject(request.error ?? new Error("Troubleshooting session IndexedDB get failed."));
    });
  }
  async delete(scenarioHash: string): Promise<void> {
    await this.transaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.delete(scenarioHash); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error ?? new Error("Troubleshooting session IndexedDB delete failed."));
    });
  }
  async list(): Promise<readonly TroubleshootingSessionSnapshot[]> {
    return this.transaction<readonly TroubleshootingSessionSnapshot[]>("readonly", (store, resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as StoredTroubleshootingSessionRecord[]).map((item) => clone(item.snapshot)).sort((a, b) => a.scenarioHash.localeCompare(b.scenarioHash, "en")));
      request.onerror = () => reject(request.error ?? new Error("Troubleshooting session IndexedDB list failed."));
    });
  }
}

export async function createTroubleshootingSessionSnapshot(workspace: RuntimeWorkspace, notebook?: TroubleshootingNotebook): Promise<{ readonly ok: true; readonly snapshot: TroubleshootingSessionSnapshot; readonly notebook: TroubleshootingNotebook; readonly diagnostics: readonly BrowserDiagnostic[] } | { readonly ok: false; readonly diagnostics: readonly BrowserDiagnostic[] }> {
  const candidate = notebook ?? await createTroubleshootingNotebook(workspace.scenario.scenarioId, workspace.scenario.sourceHash);
  if (candidate.scenarioId !== workspace.scenario.scenarioId || candidate.scenarioHash !== workspace.scenario.sourceHash) return { ok: false, diagnostics: [error("TROUBLESHOOTING_SESSION_SCENARIO_MISMATCH", "Notebook and Runtime must belong to the exact same scenario identity before persistence.")] };
  const verified = await verifyTroubleshootingNotebook(candidate);
  if (!verified.ok) return { ok: false, diagnostics: verified.diagnostics.map((item) => error(item.code, item.message)) };
  const progress = createRuntimeProgress(workspace);
  const draft: TroubleshootingSessionSnapshot = {
    formatId: "infrastructure-cyber-lab.troubleshooting-session", schemaVersion: TROUBLESHOOTING_SESSION_VERSION,
    scenarioId: workspace.scenario.scenarioId, scenarioHash: workspace.scenario.sourceHash, stateRevision: workspace.engineState.stateRevision,
    notebookIdentity: candidate.notebookIdentity, sessionIdentity: "0".repeat(64), progress: clone(progress), notebook: clone(candidate),
  };
  const snapshot = { ...draft, sessionIdentity: await computeTroubleshootingSessionIdentity(draft) };
  return { ok: true, snapshot, notebook: candidate, diagnostics: [] };
}

export async function verifyTroubleshootingSessionSnapshot(workspace: RuntimeWorkspace, snapshot: TroubleshootingSessionSnapshot, validators: TroubleshootingSessionValidators): Promise<readonly BrowserDiagnostic[]> {
  const diagnostics: BrowserDiagnostic[] = [];
  const sessionSchema = validators.validateSession(snapshot);
  if (!sessionSchema.valid) return mapMessages("TROUBLESHOOTING_SESSION_SCHEMA_INVALID", sessionSchema.diagnostics, "Troubleshooting session failed schema validation.");
  const saveSchema = validators.validateSave(snapshot.progress);
  if (!saveSchema.valid) diagnostics.push(...mapMessages("TROUBLESHOOTING_SESSION_SAVE_INVALID", saveSchema.diagnostics, "Embedded Runtime progress failed schema validation."));
  const notebookSchema = validators.validateNotebook(snapshot.notebook);
  if (!notebookSchema.valid) diagnostics.push(...mapMessages("TROUBLESHOOTING_SESSION_NOTEBOOK_INVALID", notebookSchema.diagnostics, "Embedded notebook failed schema validation."));
  if (diagnostics.length) return diagnostics;
  if (snapshot.scenarioId !== workspace.scenario.scenarioId || snapshot.scenarioHash !== workspace.scenario.sourceHash) diagnostics.push(error("TROUBLESHOOTING_SESSION_SCENARIO_MISMATCH", "Persisted troubleshooting session belongs to a different scenario identity."));
  if (snapshot.progress.scenarioHash !== snapshot.scenarioHash) diagnostics.push(error("TROUBLESHOOTING_SESSION_PROGRESS_SCENARIO_MISMATCH", "Embedded Runtime progress scenario hash does not match the session envelope."));
  if (snapshot.progress.stateRevision !== snapshot.stateRevision) diagnostics.push(error("TROUBLESHOOTING_SESSION_REVISION_MISMATCH", "Embedded Runtime progress revision does not match the session envelope."));
  if (snapshot.notebook.scenarioId !== snapshot.scenarioId || snapshot.notebook.scenarioHash !== snapshot.scenarioHash) diagnostics.push(error("TROUBLESHOOTING_SESSION_NOTEBOOK_SCENARIO_MISMATCH", "Embedded notebook scenario identity does not match the session envelope."));
  if (snapshot.notebook.notebookIdentity !== snapshot.notebookIdentity) diagnostics.push(error("TROUBLESHOOTING_SESSION_NOTEBOOK_IDENTITY_MISMATCH", "Embedded notebook identity does not match the session envelope."));
  const notebookVerified = await verifyTroubleshootingNotebook(snapshot.notebook);
  if (!notebookVerified.ok) diagnostics.push(...notebookVerified.diagnostics.map((item) => error(item.code, item.message)));
  if (await computeTroubleshootingNotebookIdentity(snapshot.notebook) !== snapshot.notebookIdentity) diagnostics.push(error("TROUBLESHOOTING_SESSION_NOTEBOOK_IDENTITY_MISMATCH", "Notebook canonical identity verification failed."));
  if (await computeTroubleshootingSessionIdentity(snapshot) !== snapshot.sessionIdentity) diagnostics.push(error("TROUBLESHOOTING_SESSION_IDENTITY_MISMATCH", "Troubleshooting session identity does not match its canonical content."));
  return diagnostics;
}

export function buildTroubleshootingSessionReplay(snapshot: TroubleshootingSessionSnapshot): readonly TroubleshootingReplayFrame[] {
  return snapshot.notebook.entries.map((entry) => ({
    sequence: entry.sequence, entryId: entry.entryId, kind: entry.kind, stateRevision: entry.stateRevision,
    relationToRestoredState: entry.stateRevision === snapshot.stateRevision ? "current_revision" : "different_revision",
    entry: clone(entry),
  }));
}

export async function autosaveTroubleshootingSession(workspace: RuntimeWorkspace, notebook: TroubleshootingNotebook | undefined, store: TroubleshootingSessionStore): Promise<TroubleshootingSessionResult> {
  const created = await createTroubleshootingSessionSnapshot(workspace, notebook);
  if (!created.ok) return { ok: false, workspace, diagnostics: created.diagnostics };
  try {
    await store.put(created.snapshot);
    return { ok: true, workspace, notebook: created.notebook, snapshot: created.snapshot, diagnostics: [] };
  } catch (cause) {
    return { ok: false, workspace, notebook: created.notebook, diagnostics: [error("TROUBLESHOOTING_SESSION_AUTOSAVE_WRITE_FAILED", cause instanceof Error ? cause.message : String(cause))] };
  }
}

export async function restoreAutosavedTroubleshootingSession(workspace: RuntimeWorkspace, store: TroubleshootingSessionStore, validators: TroubleshootingSessionValidators): Promise<TroubleshootingSessionResult> {
  let snapshot: TroubleshootingSessionSnapshot | undefined;
  try { snapshot = await store.get(workspace.scenario.sourceHash); }
  catch (cause) { return { ok: false, workspace, diagnostics: [error("TROUBLESHOOTING_SESSION_AUTOSAVE_READ_FAILED", cause instanceof Error ? cause.message : String(cause))] }; }
  if (!snapshot) return { ok: false, workspace, diagnostics: [error("TROUBLESHOOTING_SESSION_AUTOSAVE_NOT_FOUND", "No persisted troubleshooting session exists for this exact scenario hash.")] };
  const diagnostics = await verifyTroubleshootingSessionSnapshot(workspace, snapshot, validators);
  if (diagnostics.length) return { ok: false, workspace, diagnostics };
  const restored = loadRuntimeProgress(workspace, snapshot.progress);
  if (!restored.ok) return { ok: false, workspace, diagnostics: restored.diagnostics };
  if (restored.workspace.engineState.stateRevision !== snapshot.stateRevision) return { ok: false, workspace, diagnostics: [error("TROUBLESHOOTING_SESSION_RESTORE_REVISION_MISMATCH", "Restored Runtime revision does not match the persisted session envelope.")] };
  return { ok: true, workspace: restored.workspace, notebook: clone(snapshot.notebook), snapshot: clone(snapshot), diagnostics: [] };
}

export async function clearAutosavedTroubleshootingSession(workspace: RuntimeWorkspace, store: TroubleshootingSessionStore): Promise<TroubleshootingSessionResult> {
  try { await store.delete(workspace.scenario.sourceHash); return { ok: true, workspace, diagnostics: [] }; }
  catch (cause) { return { ok: false, workspace, diagnostics: [error("TROUBLESHOOTING_SESSION_AUTOSAVE_DELETE_FAILED", cause instanceof Error ? cause.message : String(cause))] }; }
}


export const TROUBLESHOOTING_SESSION_MAX_TEXT_CHARS = 8 * 1024 * 1024;

export type TroubleshootingSessionDownloadResult =
  | { readonly ok: true; readonly descriptor: JsonDownloadDescriptor; readonly snapshot: TroubleshootingSessionSnapshot; readonly notebook: TroubleshootingNotebook; readonly diagnostics: readonly BrowserDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly BrowserDiagnostic[] };

export async function createTroubleshootingSessionDownload(
  workspace: RuntimeWorkspace,
  notebook?: TroubleshootingNotebook,
): Promise<TroubleshootingSessionDownloadResult> {
  const created = await createTroubleshootingSessionSnapshot(workspace, notebook);
  if (!created.ok) return created;
  return {
    ok: true,
    descriptor: {
      filename: `${created.snapshot.scenarioId}${branding.sessionExtension}`,
      mime: "application/json",
      text: `${JSON.stringify(created.snapshot, null, 2)}\n`,
    },
    snapshot: created.snapshot,
    notebook: created.notebook,
    diagnostics: [],
  };
}

export async function readTroubleshootingSessionFile(file: TextReadableFile): Promise<unknown> {
  if (!file.name.toLowerCase().endsWith(branding.sessionExtension.toLowerCase())) {
    throw new Error(`Portable troubleshooting session must use the '${branding.sessionExtension}' extension.`);
  }
  const text = await file.text();
  if (text.length > TROUBLESHOOTING_SESSION_MAX_TEXT_CHARS) {
    throw new Error(`Portable troubleshooting session exceeds the local ${TROUBLESHOOTING_SESSION_MAX_TEXT_CHARS}-character safety limit.`);
  }
  try { return JSON.parse(text) as unknown; }
  catch (cause) { throw new Error(`Could not parse portable troubleshooting session '${file.name}' as JSON: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

export async function loadTroubleshootingSessionFile(
  workspace: RuntimeWorkspace,
  file: TextReadableFile,
  validators: TroubleshootingSessionValidators,
): Promise<TroubleshootingSessionResult> {
  let input: unknown;
  try { input = await readTroubleshootingSessionFile(file); }
  catch (cause) { return { ok: false, workspace, diagnostics: [error("TROUBLESHOOTING_SESSION_FILE_READ_FAILED", cause instanceof Error ? cause.message : String(cause))] }; }

  const schema = validators.validateSession(input);
  if (!schema.valid) return { ok: false, workspace, diagnostics: mapMessages("TROUBLESHOOTING_SESSION_SCHEMA_INVALID", schema.diagnostics, "Portable troubleshooting session failed schema validation.") };

  const snapshot = input as TroubleshootingSessionSnapshot;
  const diagnostics = await verifyTroubleshootingSessionSnapshot(workspace, snapshot, validators);
  if (diagnostics.length) return { ok: false, workspace, diagnostics };

  const restored = loadRuntimeProgress(workspace, snapshot.progress);
  if (!restored.ok) return { ok: false, workspace, diagnostics: restored.diagnostics };
  if (restored.workspace.engineState.stateRevision !== snapshot.stateRevision) {
    return { ok: false, workspace, diagnostics: [error("TROUBLESHOOTING_SESSION_RESTORE_REVISION_MISMATCH", "Restored Runtime revision does not match the portable session envelope.")] };
  }
  return { ok: true, workspace: restored.workspace, notebook: clone(snapshot.notebook), snapshot: clone(snapshot), diagnostics: [] };
}
