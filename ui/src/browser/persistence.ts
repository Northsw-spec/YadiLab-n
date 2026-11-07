import type { SaveState } from "../../../core-model/src/generated/contracts.js";

export interface ProgressStore {
  put(save: SaveState): Promise<void>;
  get(scenarioHash: string): Promise<SaveState | undefined>;
  delete(scenarioHash: string): Promise<void>;
  list(): Promise<readonly SaveState[]>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MemoryProgressStore implements ProgressStore {
  private readonly saves = new Map<string, SaveState>();

  async put(save: SaveState): Promise<void> {
    this.saves.set(save.scenarioHash, clone(save));
  }

  async get(scenarioHash: string): Promise<SaveState | undefined> {
    const save = this.saves.get(scenarioHash);
    return save ? clone(save) : undefined;
  }

  async delete(scenarioHash: string): Promise<void> {
    this.saves.delete(scenarioHash);
  }

  async list(): Promise<readonly SaveState[]> {
    return [...this.saves.values()].map(clone).sort((a, b) => a.scenarioHash.localeCompare(b.scenarioHash, "en"));
  }
}

interface StoredProgressRecord {
  readonly scenarioHash: string;
  readonly save: SaveState;
}

export class IndexedDbProgressStore implements ProgressStore {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly indexedDb: IDBFactory;

  constructor(indexedDb: IDBFactory, dbName = "app-progress", storeName = "progress") {
    this.indexedDb = indexedDb;
    this.dbName = dbName;
    this.storeName = storeName;
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.indexedDb.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName, { keyPath: "scenarioHash" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
    });
  }

  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T> {
    const db = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        // An individual IDBRequest can succeed and the surrounding transaction
        // can STILL abort. Never report a durable put/delete or successful read
        // until the transaction's oncomplete event has fired.
        let tx: IDBTransaction;
        try {
          tx = db.transaction(this.storeName, mode);
        } catch (error) {
          reject(error);
          return;
        }
        let receivedResult = false;
        let result!: T;
        tx.oncomplete = () => {
          if (!receivedResult) {
            reject(new Error("IndexedDB transaction completed without a request result."));
            return;
          }
          resolve(result);
        };
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
        const stageResult = (value: T) => {
          result = value;
          receivedResult = true;
        };
        try {
          run(tx.objectStore(this.storeName), stageResult, reject);
        } catch (error) {
          try { tx.abort(); } catch { /* Transaction may already be inactive. */ }
          reject(error);
        }
      });
    } finally {
      db.close();
    }
  }

  async put(save: SaveState): Promise<void> {
    await this.transaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.put({ scenarioHash: save.scenarioHash, save: clone(save) } satisfies StoredProgressRecord);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB put failed."));
    });
  }

  async get(scenarioHash: string): Promise<SaveState | undefined> {
    return this.transaction<SaveState | undefined>("readonly", (store, resolve, reject) => {
      const request = store.get(scenarioHash);
      request.onsuccess = () => {
        const record = request.result as StoredProgressRecord | undefined;
        resolve(record ? clone(record.save) : undefined);
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB get failed."));
    });
  }

  async delete(scenarioHash: string): Promise<void> {
    await this.transaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.delete(scenarioHash);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed."));
    });
  }

  async list(): Promise<readonly SaveState[]> {
    return this.transaction<readonly SaveState[]>("readonly", (store, resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const records = (request.result as StoredProgressRecord[]).map((x) => clone(x.save));
        resolve(records.sort((a, b) => a.scenarioHash.localeCompare(b.scenarioHash, "en")));
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB list failed."));
    });
  }
}

export interface PersistentStorageManager {
  persist?: () => Promise<boolean>;
}

export async function requestPersistentStorage(storage: PersistentStorageManager | undefined): Promise<boolean | undefined> {
  if (!storage?.persist) return undefined;
  return storage.persist();
}
