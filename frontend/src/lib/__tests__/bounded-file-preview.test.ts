import { describe, expect, it, vi } from "vitest";
import { FilePreviewLimitError, readBoundedFilePreview } from "@/lib/bounded-file-preview";

describe("bounded File preview reads", () => {
  it.each([403, 404, 503])("rejects HTTP %s before decoding its body", async (status) => {
    const response = new Response("This is an error, never file content", { status });
    const bodyRead = vi.spyOn(response, "text");
    await expect(readBoundedFilePreview(response)).rejects.toMatchObject({ name: "FilePreviewHttpError", status });
    expect(bodyRead).not.toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
  });

  it("caps UTF-8 bytes without flushing a cut character", async () => {
    const result = await readBoundedFilePreview(new Response("한글한글"), { limit: 8 });
    expect(result).toEqual({ text: "한글", bytes: 8, truncated: true });
    expect(result.text).not.toContain("�");
  });

  it("cancels an unknown-length stream as soon as it exceeds the byte budget", async () => {
    const cancel = vi.fn();
    let reads = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { reads += 1; controller.enqueue(new TextEncoder().encode("abcd")); },
      cancel,
    }, { highWaterMark: 0 }));
    expect(await readBoundedFilePreview(response, { limit: 6 })).toEqual({ text: "abcdab", bytes: 6, truncated: true });
    expect(reads).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized JSON from both headers and the actual stream", async () => {
    await expect(readBoundedFilePreview(new Response("{}", { headers: { "content-length": "1000" } }), { json: true, limit: 8 })).rejects.toBeInstanceOf(FilePreviewLimitError);
    await expect(readBoundedFilePreview(new Response('["한글한글"]'), { json: true, limit: 8 })).rejects.toBeInstanceOf(FilePreviewLimitError);
  });

  it("aborts a pending stream and releases its reader", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const reading = readBoundedFilePreview(response, { signal: controller.signal });
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
  });
});
