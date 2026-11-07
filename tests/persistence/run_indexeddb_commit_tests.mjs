import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { IndexedDbProgressStore } from "../../dist-persistence-test/ui/src/browser/persistence.js";

// Deterministic IndexedDB harness: request success is deliberately separate
// from transaction commit. A subsequent abort must reject the public operation.
function controlledIndexedDb() {
  const transactions = [];
  let closes = 0;
  const database = {
    objectStoreNames: { contains: () => true },
    close: () => { closes++; },
    transaction(storeName, mode) {
      assert.equal(storeName, "progress");
      assert.ok(mode === "readonly" || mode === "readwrite");
      const requests = [];
      const tx = {
        requests, mode, error: null,
        oncomplete: null, onerror: null, onabort: null,
        abort() {
          this.error = new Error("simulated rollback");
          this.onabort?.();
        },
        objectStore() {
          const request = (operation, arg) => {
            const entry = { operation, arg, result: undefined, onsuccess: null, onerror: null, error: null };
            requests.push(entry);
            return entry;
          };
          return {
            put: value => request("put", value),
            get: key => request("get", key),
            delete: key => request("delete", key),
            getAll: () => request("getAll"),
          };
        },
      };
      transactions.push(tx);
      return tx;
    },
  };
  const indexedDb = {
    open(name, version) {
      assert.equal(name, "app-progress");
      assert.equal(version, 1);
      const req = { result: database, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
  return { indexedDb, transactions, get closes() { return closes; } };
}

const sample = { scenarioHash: "scenario-a", stateRevision: 1, nested: { value: 7 } };
function succeeded(tx, result) {
  assert.equal(tx.requests.length, 1, "exactly one IndexedDB request expected");
  tx.requests[0].result = result;
  tx.requests[0].onsuccess?.();
}
async function remainsPending(promise, reason) {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  await nextTurn();
  assert.equal(settled, false, reason);
}

{
  const db = controlledIndexedDb();
  const store = new IndexedDbProgressStore(db.indexedDb);
  const put = store.put(sample);
  await nextTurn();
  assert.equal(db.transactions[0]?.requests[0]?.operation, "put");
  succeeded(db.transactions[0]);
  await remainsPending(put, "put resolved on request success before commit");
  assert.equal(db.closes, 0, "DB closed before the write transaction finished");
  db.transactions[0].abort();
  await assert.rejects(put, /simulated rollback/, "late rollback must reject put");
  assert.equal(db.closes, 1, "DB closed after rollback");
}

{
  const db = controlledIndexedDb();
  const store = new IndexedDbProgressStore(db.indexedDb);
  const deletion = store.delete(sample.scenarioHash);
  await nextTurn();
  assert.equal(db.transactions[0]?.requests[0]?.operation, "delete");
  succeeded(db.transactions[0]);
  await remainsPending(deletion, "delete resolved before transaction commit");
  db.transactions[0].abort();
  await assert.rejects(deletion, /simulated rollback/, "late rollback must reject delete");
  assert.equal(db.closes, 1);
}

{
  const db = controlledIndexedDb();
  const store = new IndexedDbProgressStore(db.indexedDb);
  const put = store.put(sample);
  await nextTurn();
  succeeded(db.transactions[0]);
  await remainsPending(put, "successful put still requires transaction completion");
  db.transactions[0].oncomplete?.();
  await put;
  assert.equal(db.closes, 1, "committed transaction closed its connection");
  assert.notEqual(db.transactions[0].requests[0].arg.save, sample,
    "stored record must not hold the caller's mutable object");
}

for (const [operation, result] of [
  ["get", { scenarioHash: sample.scenarioHash, save: sample }],
  ["list", [{ scenarioHash: sample.scenarioHash, save: sample }]],
]) {
  const db = controlledIndexedDb();
  const store = new IndexedDbProgressStore(db.indexedDb);
  const read = operation === "get" ? store.get(sample.scenarioHash) : store.list();
  await nextTurn();
  assert.equal(db.transactions[0]?.requests[0]?.operation,
    operation === "list" ? "getAll" : "get");
  succeeded(db.transactions[0], result);
  await remainsPending(read, operation + " resolved before readonly transaction completion");
  db.transactions[0].oncomplete?.();
  const value = await read;
  assert.deepEqual(operation === "get" ? value : value[0], sample);
  assert.notEqual(operation === "get" ? value : value[0], sample);
  assert.equal(db.closes, 1);
}

{
  const db = controlledIndexedDb();
  const store = new IndexedDbProgressStore(db.indexedDb);
  const put = store.put(sample);
  await nextTurn();
  const req = db.transactions[0].requests[0];
  req.error = new Error("simulated request failure");
  req.onerror?.();
  await assert.rejects(put, /simulated request failure/,
    "request-level errors must reject, not await commit forever");
  assert.equal(db.closes, 1);
}

console.log("PASS IndexedDB durability: request success never precedes commit; late aborts reject put/delete; read results wait for transaction completion.");
