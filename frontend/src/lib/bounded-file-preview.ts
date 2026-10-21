export const FILE_PREVIEW_BYTE_LIMIT = 512 * 1024;

export class FilePreviewHttpError extends Error {
  constructor(public readonly status: number) {
    super(`The preview link could not be read (${status}). Refresh the link to check current access.`);
    this.name = "FilePreviewHttpError";
  }
}

export class FilePreviewLimitError extends Error {
  constructor() {
    super("This JSON file is too large for an inline preview. Download the original file to read it.");
    this.name = "FilePreviewLimitError";
  }
}

/** Budget decoded response bytes before decoding/parsing, including responses
 * without Content-Length and compressed responses whose stream is larger. */
export async function readBoundedFilePreview(
  response: Response,
  { json = false, limit = FILE_PREVIEW_BYTE_LIMIT, signal }: { json?: boolean; limit?: number; signal?: AbortSignal } = {},
): Promise<{ text: string; truncated: boolean; bytes: number }> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new FilePreviewHttpError(response.status);
  }
  const announced = Number(response.headers.get("content-length"));
  if (json && Number.isFinite(announced) && announced > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new FilePreviewLimitError();
  }
  if (!response.body) return { text: "", truncated: false, bytes: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const pieces: string[] = [];
  let bytes = 0;
  let truncated = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (done) break;
      if (!value.byteLength) continue;
      const remaining = limit - bytes;
      const accepted = value.subarray(0, remaining);
      pieces.push(decoder.decode(accepted, { stream: true }));
      bytes += accepted.byteLength;
      if (value.byteLength > remaining) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
    // A cut UTF-8 character stays buffered and is omitted, not rendered as a
    // replacement character. Complete streams still flush the decoder.
    if (!truncated) pieces.push(decoder.decode());
    if (json && truncated) throw new FilePreviewLimitError();
    return { text: pieces.join(""), truncated, bytes };
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
