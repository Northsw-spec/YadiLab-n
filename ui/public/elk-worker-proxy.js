/*
 * YadiLab's checked ELK worker boundary.
 *
 * The ELK distribution owns the actual layout protocol.  This thin local
 * proxy adds a validated request envelope to every ELK message and echoes it
 * on every response.  It deliberately does not alter the graph or layout
 * algorithm; termination of the host Worker therefore terminates the same
 * ELK implementation used by the existing backend.
 */
importScripts("./elk-worker.js");

const elkDispatch = self.onmessage;
const post = self.postMessage.bind(self);
const ENVELOPE_KEY = "__yadilabLayout";

function validEnvelope(value) {
  return Boolean(value && typeof value.requestId === "string" && value.requestId.length > 0 &&
    typeof value.sourceSha === "string" && value.sourceSha.length > 0 &&
    Number.isInteger(value.sourceRevision) && value.sourceRevision >= 0 &&
    Number.isInteger(value.projectGeneration) && value.projectGeneration >= 0 &&
    typeof value.builderIdentity === "string" && value.builderIdentity.length > 0 &&
    typeof value.compileIdentity === "string" && value.compileIdentity.length > 0);
}

self.onmessage = (event) => {
  const message = event?.data;
  const envelope = message?.[ENVELOPE_KEY];
  if (!message || !validEnvelope(envelope) || typeof message.id !== "number" || typeof message.cmd !== "string") {
    post({ id: typeof message?.id === "number" ? message.id : -1,
      error: { code: "LAYOUT_WORKER_ENVELOPE_INVALID", message: "Invalid YadiLab layout request envelope." },
      [ENVELOPE_KEY]: envelope ?? null });
    return;
  }
  const previousPost = self.postMessage;
  self.postMessage = (response) => post({ ...response, [ENVELOPE_KEY]: envelope });
  try {
    // ELK ignores the additive envelope field and receives its original
    // protocol message unchanged.
    elkDispatch({ data: message });
  } finally {
    self.postMessage = previousPost;
  }
};
