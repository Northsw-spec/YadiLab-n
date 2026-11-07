import type { ArchiveBackend, ArchiveEntryDescriptor, ArchiveReadSession, ArchiveWriteEntry } from "./types.js";

async function loadZipJs() {
  return import("@zip.js/zip.js");
}

export class ZipJsArchiveBackend implements ArchiveBackend {
  async open(input: Blob): Promise<ArchiveReadSession> {
    const { BlobReader, Uint8ArrayWriter, ZipReader } = await loadZipJs();
    const reader = new ZipReader(new BlobReader(input));
    const entries = await reader.getEntries();
    const descriptors: ArchiveEntryDescriptor[] = entries.map((entry) => ({
      path: entry.filename,
      directory: entry.directory,
      ...(typeof entry.compressedSize === "number" ? { compressedSize: entry.compressedSize } : {}),
      ...(typeof entry.uncompressedSize === "number" ? { uncompressedSize: entry.uncompressedSize } : {}),
      read: async () => entry.getData(new Uint8ArrayWriter()),
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
