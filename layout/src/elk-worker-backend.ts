import ELK from "elkjs/lib/elk-api.js";
import { normalizeElkOutput, toElkGraph, type ElkNodeLike } from "./elk-backend.js";
import type { LayoutBackend, LayoutBackendResult, LayoutGraph } from "./types.js";

/** The product deadline is independent from the 250 ms F4A experiment budget. */
export const NORMAL_LAYOUT_OPERATIONAL_TIMEOUT_MS = 15_000;
export const DEFAULT_ELK_WORKER_URL = "./assets/elk-worker-proxy.js";

export interface LayoutRequestIdentity {
  readonly requestId: string;
  readonly sourceSha: string;
  readonly sourceRevision: number;
  readonly projectGeneration: number;
  readonly builderIdentity: string;
  readonly compileIdentity: string;
}
export interface LayoutWorkerMetrics {
  readonly requestId: string;
  readonly graphBytes: number;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly elapsedMs?: number;
  readonly terminationRequestedAt?: number;
  readonly terminationElapsedMs?: number;
  readonly outcome: "RUNNING" | "PASS" | "ABORTED" | "TIMEOUT" | "ERROR";
}

export interface CancellableElkLayoutBackendOptions {
  readonly workerUrl?: string;
  readonly timeoutMs?: number;
  /** Test-only injection; production uses the browser's native Worker. */
  readonly workerFactory?: (url?: string) => Worker;
}

export type LayoutAbortReason = "LAYOUT_ABORTED" | "LAYOUT_TIMEOUT_ABORTED";

interface ActiveJob {
  readonly requestId: string;
  readonly elk: { terminateWorker(): void };
  readonly startedAt: number;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  reject: (reason: unknown) => void;
  onAbort?: (reason: LayoutAbortReason) => void;
}

let activeNormalJob: ActiveJob | null = null;
let sequence = 0;

function now(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

function abortError(code: LayoutAbortReason | "LAYOUT_WORKER_BUSY" | "LAYOUT_WORKER_UNAVAILABLE" | "LAYOUT_WORKER_ENVELOPE_INVALID", message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function identityOrDefault(identity?: Partial<LayoutRequestIdentity>): LayoutRequestIdentity {
  const requestId = identity?.requestId ?? `normal-layout-${++sequence}`;
  return {
    requestId,
    sourceSha: identity?.sourceSha ?? "unknown-source",
    sourceRevision: identity?.sourceRevision ?? 0,
    projectGeneration: identity?.projectGeneration ?? 0,
    builderIdentity: identity?.builderIdentity ?? "unknown-builder",
    compileIdentity: identity?.compileIdentity ?? "unknown-compile",
  };
}

function sameIdentity(a: LayoutRequestIdentity, b: LayoutRequestIdentity): boolean {
  return a.requestId === b.requestId && a.sourceSha === b.sourceSha &&
    a.sourceRevision === b.sourceRevision && a.projectGeneration === b.projectGeneration &&
    a.builderIdentity === b.builderIdentity && a.compileIdentity === b.compileIdentity;
}

function validatedWorkerFactory(
  factory: ((url?: string) => Worker) | undefined,
  envelope: LayoutRequestIdentity,
): ((url?: string) => Worker) {
  return (url?: string) => {
    const worker = factory ? factory(url) : (() => {
      if (typeof globalThis.Worker !== "function") throw abortError("LAYOUT_WORKER_UNAVAILABLE", "Web Worker is unavailable in this runtime.");
      return new globalThis.Worker(url ?? DEFAULT_ELK_WORKER_URL);
    })();
    let onmessage: ((event: MessageEvent) => void) | null = null;
    let onerror: ((event: ErrorEvent) => void) | null = null;
    let onmessageerror: ((event: MessageEvent) => void) | null = null;
    let lastMessageId = -1;
    const validateResponse = (response: unknown): response is Record<string, unknown> => {
      if (!response || typeof response !== "object") return false;
      const value = response as Record<string, unknown>;
      const observed = value.__yadilabLayout;
      if (!observed || typeof observed !== "object") return false;
      const candidate = observed as Partial<LayoutRequestIdentity>;
      return sameIdentity(envelope, {
        requestId: typeof candidate.requestId === "string" ? candidate.requestId : "",
        sourceSha: typeof candidate.sourceSha === "string" ? candidate.sourceSha : "",
        sourceRevision: typeof candidate.sourceRevision === "number" ? candidate.sourceRevision : -1,
        projectGeneration: typeof candidate.projectGeneration === "number" ? candidate.projectGeneration : -1,
        builderIdentity: typeof candidate.builderIdentity === "string" ? candidate.builderIdentity : "",
        compileIdentity: typeof candidate.compileIdentity === "string" ? candidate.compileIdentity : "",
      });
    };
    const proxy = {
      postMessage(message: Record<string, unknown>, transfer?: Transferable[]) {
        if (!message || typeof message.id !== "number" || typeof message.cmd !== "string") {
          throw abortError("LAYOUT_WORKER_ENVELOPE_INVALID", "Invalid ELK worker request message.");
        }
        lastMessageId = message.id;
        const payload = { ...message, __yadilabLayout: envelope };
        if (transfer) worker.postMessage(payload, transfer);
        else worker.postMessage(payload);
      },
      terminate() { worker.terminate(); },
      set onmessage(handler: ((event: MessageEvent) => void) | null) {
        onmessage = handler;
        worker.onmessage = (event) => {
          const response = event?.data;
          if (!validateResponse(response)) {
            handler?.({ data: { id: typeof response?.id === "number" ? response.id : lastMessageId, error: { code: "LAYOUT_WORKER_ENVELOPE_INVALID", message: "Worker response identity does not match the active layout request." } } } as MessageEvent);
            return;
          }
          handler?.(event);
        };
      },
      get onmessage() { return onmessage; },
      set onerror(handler: ((event: ErrorEvent) => void) | null) {
        onerror = handler;
      },
      set onmessageerror(handler: ((event: MessageEvent) => void) | null) {
        onmessageerror = handler;
      },
    };
    worker.onerror = (event) => {
      onmessage?.({ data: { id: lastMessageId, error: { code: "LAYOUT_WORKER_RUNTIME_ERROR", message: event?.message || "ELK Worker failed." } } } as MessageEvent);
      onerror?.(event);
    };
    worker.onmessageerror = (event) => {
      onmessage?.({ data: { id: lastMessageId, error: { code: "LAYOUT_WORKER_MESSAGE_ERROR", message: "ELK Worker message could not be decoded." } } } as MessageEvent);
      onmessageerror?.(event);
    };
    return proxy as unknown as Worker;
  };
}

/** Terminate the currently active NORMAL layout, if any. */
export function cancelActiveNormalLayout(reason: LayoutAbortReason = "LAYOUT_ABORTED"): boolean {
  const job = activeNormalJob;
  if (!job || job.settled) return false;
  job.settled = true;
  if (job.timer !== undefined) clearTimeout(job.timer);
  const terminationRequestedAt = now();
  try { job.elk.terminateWorker(); }
  finally {
    if (activeNormalJob === job) activeNormalJob = null;
    job.onAbort?.(reason);
    job.reject(abortError(reason, reason === "LAYOUT_TIMEOUT_ABORTED" ?
      "ELK layout exceeded the operational timeout and its Worker was terminated." :
      "ELK layout was cancelled and its Worker was terminated."));
  }
  void terminationRequestedAt;
  return true;
}

export class CancellableElkLayoutBackend implements LayoutBackend {
  readonly id = "elk.layered.worker";
  readonly #workerUrl: string;
  readonly #timeoutMs: number;
  readonly #workerFactory: ((url?: string) => Worker) | undefined;
  #lastMetrics: LayoutWorkerMetrics | null = null;

  constructor(options: CancellableElkLayoutBackendOptions = {}) {
    this.#workerUrl = options.workerUrl ?? DEFAULT_ELK_WORKER_URL;
    this.#timeoutMs = options.timeoutMs ?? NORMAL_LAYOUT_OPERATIONAL_TIMEOUT_MS;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) throw new RangeError("Layout Worker timeout must be positive.");
    this.#workerFactory = options.workerFactory;
  }

  get lastMetrics(): LayoutWorkerMetrics | null { return this.#lastMetrics; }
  get active(): boolean { return activeNormalJob !== null && !activeNormalJob.settled; }
  cancel(reason: LayoutAbortReason = "LAYOUT_ABORTED"): boolean { return cancelActiveNormalLayout(reason); }

  async layout(graph: LayoutGraph, suppliedIdentity?: Partial<LayoutRequestIdentity>): Promise<LayoutBackendResult> {
    if (activeNormalJob && !activeNormalJob.settled) throw abortError("LAYOUT_WORKER_BUSY", "A NORMAL layout Worker is already active.");
    const identity = identityOrDefault(suppliedIdentity);
    const elkGraph = toElkGraph(graph);
    const graphBytes = JSON.stringify(elkGraph).length;
    const startedAt = now();
    this.#lastMetrics = { requestId: identity.requestId, graphBytes, startedAt, outcome: "RUNNING" };
    let elk: InstanceType<typeof ELK>;
    try {
      elk = new ELK({ workerUrl: this.#workerUrl, workerFactory: validatedWorkerFactory(this.#workerFactory, identity) });
    } catch (cause) {
      this.#lastMetrics = { requestId: identity.requestId, graphBytes, startedAt, completedAt: now(), elapsedMs: now() - startedAt, outcome: "ERROR" };
      throw abortError("LAYOUT_WORKER_UNAVAILABLE", cause instanceof Error ? cause.message : String(cause));
    }
    let active: ActiveJob;
    const result = new Promise<LayoutBackendResult>((resolve, reject) => {
      active = { requestId: identity.requestId, elk, startedAt, settled: false, reject };
      activeNormalJob = active;
      active.onAbort = (reason) => {
        const completedAt = now();
        this.#lastMetrics = { requestId: identity.requestId, graphBytes, startedAt, completedAt, elapsedMs: completedAt - startedAt, terminationRequestedAt: completedAt, terminationElapsedMs: 0, outcome: reason === "LAYOUT_TIMEOUT_ABORTED" ? "TIMEOUT" : "ABORTED" };
      };
      const finish = (outcome: LayoutWorkerMetrics["outcome"], callback: () => void) => {
        if (active.settled) return;
        active.settled = true;
        if (active.timer !== undefined) clearTimeout(active.timer);
        const completedAt = now();
        this.#lastMetrics = { requestId: identity.requestId, graphBytes, startedAt, completedAt, elapsedMs: completedAt - startedAt, outcome };
        try { elk.terminateWorker(); } finally {
          if (activeNormalJob === active) activeNormalJob = null;
          callback();
        }
      };
      active.timer = setTimeout(() => {
        if (active.settled) return;
        finish("TIMEOUT", () => reject(abortError("LAYOUT_TIMEOUT_ABORTED", "ELK layout exceeded the operational timeout and its Worker was terminated.")));
      }, this.#timeoutMs);
      void elk.layout(elkGraph as never)
        .then((output) => finish("PASS", () => {
          try {
            const normalized = normalizeElkOutput(output as unknown as ElkNodeLike, graph);
            resolve(normalized);
          } catch (cause) {
            this.#lastMetrics = { requestId: identity.requestId, graphBytes, startedAt, completedAt: now(), elapsedMs: now() - startedAt, outcome: "ERROR" };
            reject(cause);
          }
        }))
        .catch((cause) => finish("ERROR", () => {
          const detail = cause instanceof Error ? cause.message : String(cause?.message ?? cause);
          const error = new Error(`TOPOLOGY_LAYOUT_ELK_WORKER_FAILED:${detail}`) as Error & { code?: string };
          if (typeof cause?.code === "string") error.code = cause.code;
          reject(error);
        }));
    });
    return result;
  }
}
