import { ArchiveReadLimitError, type ArchiveBackend, type ArchiveEntryDescriptor, type ArchiveReadSession, type ArchiveWriteEntry } from "./types.js";

async function loadZipJs() {
  return import("@zip.js/zip.js");
}

async function readZipEntryWithLimit(entry: { getData(writer: WritableStream): Promise<unknown> }, maximumBytes?: number): Promise<Uint8Array> {
  if (maximumBytes !== undefined && (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0)) throw new ArchiveReadLimitError();
  let total = 0;
  let limitExceeded = false;
  const chunks: Uint8Array[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      if (!(chunk instanceof Uint8Array)) throw new Error("ZIP reader produced a non-binary chunk.");
      if (maximumBytes !== undefined && chunk.byteLength > maximumBytes - total) {
        limitExceeded = true;
        throw new ArchiveReadLimitError();
      }
      total += chunk.byteLength;
      // The writer owns its chunks; retain an exact copy before ZipJS reuses a buffer.
      chunks.push(Uint8Array.from(chunk));
    },
  });
  try { await entry.getData(writable); }
  catch (error) {
    // ZipJS closes the supplied WritableStream after a sink error and can
    // replace that error with its close failure. Preserve the security cause.
    if (limitExceeded) throw new ArchiveReadLimitError();
    throw error;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export class ZipJsArchiveBackend implements ArchiveBackend {
  async open(input: Blob): Promise<ArchiveReadSession> {
    const { BlobReader, ZipReader } = await loadZipJs();
    const reader = new ZipReader(new BlobReader(input));
    const entries = await reader.getEntries();
    const descriptors: ArchiveEntryDescriptor[] = entries.map((entry) => ({
      path: entry.filename,
      directory: entry.directory,
      ...(typeof entry.compressedSize === "number" ? { compressedSize: entry.compressedSize } : {}),
      ...(typeof entry.uncompressedSize === "number" ? { uncompressedSize: entry.uncompressedSize } : {}),
      read: async (maximumBytes?: number) => readZipEntryWithLimit(entry, maximumBytes),
    }));
    return { entries: descriptors, close: async () => reader.close() };
  }

  async write(entries: readonly ArchiveWriteEntry[]): Promise<Blob> {
    const { BlobWriter, Uint8ArrayReader, ZipWriter } = await loadZipJs();
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    const stableDate = new Date("1980-01-01T00:00:00.000Z");
    for (const entry of entries) {
      await writer.add(entry.path, new Uint8ArrayReader(entry.bytes), { lastModDate: stableDate, level: 6 });
    }
    return writer.close();
  }
}
