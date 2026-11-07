import type { ArchiveBackend, ArchiveEntryDescriptor, ArchiveReadSession, ArchiveWriteEntry } from "./types.js";

export interface MemoryArchiveRecord {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly directory?: boolean;
  readonly compressedSize?: number;
  readonly uncompressedSize?: number;
}

const STORE = new Map<string, readonly MemoryArchiveRecord[]>();
let serial = 0;

export class MemoryArchiveBackend implements ArchiveBackend {
  private readonly initial: readonly MemoryArchiveRecord[] | undefined;

  constructor(initial?: readonly MemoryArchiveRecord[]) {
    this.initial = initial;
  }

  async open(input: Blob): Promise<ArchiveReadSession> {
    const key = await input.text();
    const records = this.initial ?? STORE.get(key) ?? [];
    const entries: ArchiveEntryDescriptor[] = records.map((record) => ({
      path: record.path,
      directory: record.directory ?? false,
      compressedSize: record.compressedSize ?? record.bytes.byteLength,
      uncompressedSize: record.uncompressedSize ?? record.bytes.byteLength,
      read: async () => new Uint8Array(record.bytes),
    }));
    return { entries, close: async () => {} };
  }

  async write(entries: readonly ArchiveWriteEntry[]): Promise<Blob> {
    const key = `memory-archive-${serial += 1}`;
    STORE.set(key, entries.map((entry) => ({ path: entry.path, bytes: new Uint8Array(entry.bytes) })));
    return new Blob([key], { type: "application/x-memory-archive" });
  }
}
