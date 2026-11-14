import assert from "node:assert/strict";
import { CancellableElkLayoutBackend } from "../../dist-layout-test/layout/src/elk-worker-backend.js";

const graph = {
  id: "__root__",
  children: [
    { id: "a", kind: "resource", width: 180, height: 80, children: [], ports: [{ id: "a::out::p1", ownerId: "a", interfaceId: "p1", direction: "output", side: "EAST", index: 0 }] },
    { id: "b", kind: "resource", width: 180, height: 80, children: [], ports: [{ id: "b::in::p1", ownerId: "b", interfaceId: "p1", direction: "input", side: "WEST", index: 0 }] },
  ],
  edges: [{ id: "e", sourceNode: "a", targetNode: "b", sourcePort: "a::out::p1", targetPort: "b::in::p1" }],
};
const identity = (requestId) => ({ requestId, sourceSha: "sha-test", sourceRevision: 2, projectGeneration: 4, builderIdentity: "builder-test", compileIdentity: "compile-test" });

const makeFakeWorkerFactory = ({ delayMs = 0, wrongResponseIdentity = false } = {}) => {
  const state = { created: 0, active: 0, maxActive: 0, terminated: 0 };
  const factory = (url) => {
    void url;
    state.created += 1;
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    let terminated = false;
    let onmessage = null;
    const worker = {
      postMessage(message) {
        const respond = () => {
          if (terminated) return;
          const envelope = wrongResponseIdentity && message.cmd === "layout"
            ? { ...message.__yadilabLayout, requestId: `${message.__yadilabLayout.requestId}-late` }
            : message.__yadilabLayout;
          if (message.cmd === "register") {
            onmessage?.({ data: { id: message.id, ["__yadilabLayout"]: envelope } });
            return;
          }
          if (message.cmd !== "layout") return;
          const children = (message.graph.children ?? []).map((node, index) => ({
            ...node,
            x: index * 260,
            y: 0,
            ports: (node.ports ?? []).map((port) => ({ ...port, x: node.id === "a" ? node.width - 8 : 0, y: 36 })),
          }));
          const output = {
            ...message.graph,
            children,
            edges: (message.graph.edges ?? []).map((edge) => ({
              ...edge,
              sections: [{ id: `${edge.id}_s0`, startPoint: { x: 180, y: 40 }, endPoint: { x: 260, y: 40 } }],
            })),
          };
          onmessage?.({ data: { id: message.id, data: output, ["__yadilabLayout"]: envelope } });
        };
        const delay = typeof delayMs === "function" ? delayMs(state.created) : delayMs;
        setTimeout(respond, delay);
      },
      terminate() {
        if (terminated) return;
        terminated = true;
        state.terminated += 1;
        state.active -= 1;
      },
      get onmessage() { return onmessage; },
      set onmessage(value) { onmessage = value; },
      set onerror(_value) {},
      set onmessageerror(_value) {},
    };
    return worker;
  };
  return { factory, state };
};

async function expectCode(promise, code) {
  try { await promise; assert.fail(`expected ${code}`); }
  catch (error) { if (!(error?.code === code || String(error?.message).includes(code))) throw error; }
}

const timeoutFake = makeFakeWorkerFactory({ delayMs: (created) => created === 1 ? 100 : 0 });
const timeoutBackend = new CancellableElkLayoutBackend({ timeoutMs: 20, workerFactory: timeoutFake.factory });
await expectCode(timeoutBackend.layout(graph, identity("timeout")), "LAYOUT_TIMEOUT_ABORTED");
assert.equal(timeoutFake.state.terminated, 1, "timeout terminates the actual worker");
assert.equal(timeoutBackend.lastMetrics?.outcome, "TIMEOUT", "timeout is diagnosed separately from layout failure");
assert.ok((timeoutBackend.lastMetrics?.graphSerializationMs ?? -1) >= 0, "graph serialization timing is recorded on timeout");
assert.ok((timeoutBackend.lastMetrics?.workerStartMs ?? -1) >= 0, "worker start timing is recorded on timeout");

const passAfterTimeout = await timeoutBackend.layout(graph, identity("after-timeout"));
assert.equal(passAfterTimeout.nodes.length, 2, "a fresh worker can run after termination");
assert.equal(passAfterTimeout.ports?.length, 2);
assert.equal(passAfterTimeout.edges?.length, 1);
assert.ok((timeoutBackend.lastMetrics?.workerRoundTripMs ?? -1) >= 0, "worker round-trip timing is recorded on success");
assert.ok((timeoutBackend.lastMetrics?.backendValidationMs ?? -1) >= 0, "backend validation timing is recorded on success");
assert.equal(timeoutFake.state.created, 2);
assert.equal(timeoutFake.state.maxActive, 1, "at most one worker is active");

const cancelFake = makeFakeWorkerFactory({ delayMs: (created) => created === 1 ? 100 : 0 });
const cancelBackend = new CancellableElkLayoutBackend({ timeoutMs: 1_000, workerFactory: cancelFake.factory });
const pending = cancelBackend.layout(graph, identity("cancel"));
setTimeout(() => cancelBackend.cancel("LAYOUT_ABORTED"), 10);
await expectCode(pending, "LAYOUT_ABORTED");
assert.equal(cancelFake.state.terminated, 1, "manual cancel terminates the actual worker");
const passAfterCancel = await cancelBackend.layout(graph, identity("after-cancel"));
assert.equal(passAfterCancel.edges?.length, 1);

const staleFake = makeFakeWorkerFactory({ wrongResponseIdentity: true });
const staleBackend = new CancellableElkLayoutBackend({ timeoutMs: 1_000, workerFactory: staleFake.factory });
await expectCode(staleBackend.layout(graph, identity("stale")), "LAYOUT_WORKER_ENVELOPE_INVALID");
assert.equal(staleFake.state.terminated, 1, "identity failure terminates the worker");

console.log("PASS cancellable ELK worker backend contract: timeout, abort, fresh worker, single concurrency and stale envelope rejection");
