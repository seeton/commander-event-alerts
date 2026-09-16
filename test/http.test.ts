import { describe, expect, it } from "vitest";
import { readLimitedText } from "../src/http";

describe("bounded response reader", () => {
  it("decodes split multibyte characters", async () => {
    const bytes = new TextEncoder().encode("統率者");
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, 2));
      controller.enqueue(bytes.slice(2));
      controller.close();
    } });
    expect(await readLimitedText(new Response(stream), 9)).toBe("統率者");
  });

  it("rejects a chunked response as soon as it exceeds the limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(11)); },
      cancel() { cancelled = true; },
    });
    await expect(readLimitedText(new Response(stream), 10)).rejects.toThrow("size limit");
    expect(cancelled).toBe(true);
  });
});
