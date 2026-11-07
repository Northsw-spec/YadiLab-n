declare module "@zip.js/zip.js" {
  export class BlobReader {
    constructor(blob: Blob);
  }
  export class BlobWriter {
    constructor(contentType?: string);
  }
  export class Uint8ArrayReader {
    constructor(bytes: Uint8Array);
  }
  export class Uint8ArrayWriter {
    constructor();
  }
  export interface Entry {
    readonly filename: string;
    readonly directory: boolean;
    readonly compressedSize?: number;
    readonly uncompressedSize?: number;
    getData(writer: Uint8ArrayWriter): Promise<Uint8Array>;
  }
  export class ZipReader {
    constructor(reader: BlobReader);
    getEntries(): Promise<Entry[]>;
    close(): Promise<void>;
  }
  export class ZipWriter {
    constructor(writer: BlobWriter);
    add(path: string, reader: Uint8ArrayReader, options?: { lastModDate?: Date; level?: number }): Promise<unknown>;
    close(): Promise<Blob>;
  }
}
