import { EnterpriseImportError } from "./types.js";

/**
 * diagrams.net: base64(raw-DEFLATE(encodeURIComponent(mxGraphModel XML))).
 * The output budget is enforced WHILE streaming. Never use unbounded
 * Response.arrayBuffer(), external endpoints or ZIP/XML utilities.
 */
const MAX_BASE64_CHARS = 512 * 1024;
const MAX_COMPRESSED_BYTES = 384 * 1024;
export const MAX_INFLATED_PAGE_BYTES = 1024 * 1024;
const fail = (code: string): never => { throw new EnterpriseImportError(code, code); };

export interface DrawioInflationBudget {
  inflatedBytes: number;
}
function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  if (!text || text.length > MAX_BASE64_CHARS || text.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    fail("DRAWIO_BASE64_INVALID");
  }
  if (typeof atob !== "function") fail("DRAWIO_BASE64_UNAVAILABLE");
  const binary: string = (() => {
    try { return atob(text); }
    catch { throw new EnterpriseImportError("DRAWIO_BASE64_INVALID","DRAWIO_BASE64_INVALID"); }
  })();
  if (binary.length < 1 || binary.length > MAX_COMPRESSED_BYTES) {
    fail("DRAWIO_COMPRESSED_SIZE_INVALID");
  }
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
  return data;
}

/** Strict local streaming decompression and URI decoding, never raw XML leakage. */
export async function decodeDrawioCompressedPage(
  content: string, budget: DrawioInflationBudget,
): Promise<Uint8Array> {
  if (!budget || !Number.isSafeInteger(budget.inflatedBytes) ||
      budget.inflatedBytes < 0 || budget.inflatedBytes > 4 * MAX_INFLATED_PAGE_BYTES) {
    fail("DRAWIO_INFLATE_BUDGET_INVALID");
  }
  const binary = decodeBase64(content);
  if (typeof DecompressionStream !== "function" || typeof ReadableStream !== "function") {
    fail("DRAWIO_DEFLATE_UNAVAILABLE");
  }
  const reader = (() => {
    try {
      const source = new ReadableStream<BufferSource>({
        start(controller) { controller.enqueue(binary); controller.close(); },
      });
      return source.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    } catch {
      throw new EnterpriseImportError("DRAWIO_DEFLATE_UNAVAILABLE","DRAWIO_DEFLATE_UNAVAILABLE");
    }
  })();

  const chunks: Uint8Array[] = [];
  let inflated = 0;
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { finished = true; break; }
      if (!(value instanceof Uint8Array) || value.byteLength === 0) continue;
      inflated += value.byteLength;
      if (inflated > MAX_INFLATED_PAGE_BYTES ||
          budget.inflatedBytes + inflated > 4 * MAX_INFLATED_PAGE_BYTES) {
        fail("DRAWIO_INFLATE_LIMIT");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof EnterpriseImportError && error.code === "DRAWIO_INFLATE_LIMIT") throw error;
    fail("DRAWIO_DEFLATE_INVALID");
  } finally {
    if (!finished) {
      try { await reader.cancel(); } catch { /* source was invalidated */ }
    }
    reader.releaseLock();
  }
  if (inflated < 1) fail("DRAWIO_INFLATE_EMPTY");
  budget.inflatedBytes += inflated;

  // encodeURIComponent produces ASCII, not raw XML UTF-8. URI decoding
  // must be performed ONCE and only AFTER byte-wise bounded decompression.
  const pieces: string[] = [];
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]!;
      if (byte < 0x21 || byte > 0x7e) fail("DRAWIO_URI_ASCII_INVALID");
    }
    for (let i = 0; i < chunk.length; i += 8192) {
      pieces.push(String.fromCharCode(...chunk.subarray(i, i + 8192)));
    }
  }
  const decoded: string = (() => {
    try { return decodeURIComponent(pieces.join("")); }
    catch { throw new EnterpriseImportError("DRAWIO_URI_INVALID","DRAWIO_URI_INVALID"); }
  })();
  const xml = new TextEncoder().encode(decoded);
  if (xml.length < 1 || xml.length > MAX_INFLATED_PAGE_BYTES) {
    fail("DRAWIO_DECODED_SIZE_INVALID");
  }
  return xml;
}
