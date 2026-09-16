import { afterEach, describe, expect, it, vi } from "vitest";
import { monthlyMarkdown, sendMonthlyNewsletter } from "../src/worker/buttondown";

describe("monthly email", () => {
  const events = [{
    title: "コマンドフェスト[特別]",
    url: "https://example.com/event?a=1&b=2",
    source: "公式",
    dateText: "2026年10月10日",
    location: "東京",
    kind: "event" as const,
  }];

  it("renders the event details", () => {
    expect(monthlyMarkdown(events)).toContain("2026年10月10日");
    expect(monthlyMarkdown(events)).toContain("公式情報を見る");
  });

  it("escapes untrusted event data in Markdown", () => {
    const body = monthlyMarkdown(events);
    expect(body).toContain("コマンドフェスト\\[特別\\]");
    expect(body).toContain("https://example.com/event?a=1&b=2");
  });

  it("does not allow raw HTML or new lines in event titles", () => {
    expect(monthlyMarkdown([{ ...events[0]!, title: "<img src=x>\n# spam" }])).toContain("\\<img src=x\\> \\# spam");
  });
});

describe("monthly delivery recovery", () => {
  afterEach(() => vi.unstubAllGlobals());
  const config = { apiKey: "test-key" };
  const draft = { id: "email-test", slug: "commander-events-2026-10", status: "draft" };
  const send = () => sendMonthlyNewsletter(config, [], "2026年10月", "2026-10");
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const mock = (...responses: Response[]) => {
    const fetcher = vi.fn();
    responses.forEach((value) => fetcher.mockResolvedValueOnce(value));
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  };

  it("creates a draft and explicitly publishes it with separate idempotency keys", async () => {
    const fetcher = mock(response({ results: [], next: null }), response(draft, 201), response(draft), response({ ...draft, status: "about_to_send" }));
    expect(await send()).toEqual({ id: draft.id, duplicate: false });
    const create = fetcher.mock.calls[1]![1];
    const publish = fetcher.mock.calls[3]![1];
    expect(JSON.parse(create.body).status).toBe("draft");
    expect(create.headers["X-Idempotency-Key"]).toHaveLength(64);
    expect(publish.headers["X-Idempotency-Key"]).not.toBe(create.headers["X-Idempotency-Key"]);
    expect(fetcher.mock.calls[3]![0]).toMatch(/\/emails\/email-test\/publish$/u);
  });

  it("skips a queued or sent monthly email without creating or publishing", async () => {
    const sent = { ...draft, status: "sent" };
    const fetcher = mock(response({ results: [sent], next: null }), response(sent));
    expect(await send()).toEqual({ id: draft.id, duplicate: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("resumes an existing draft after a previous publication failure", async () => {
    const fetcher = mock(response({ results: [draft], next: null }), response(draft), response({ ...draft, status: "about_to_send" }));
    expect((await send()).duplicate).toBe(false);
    expect(fetcher.mock.calls.every(([url]) => url !== "https://api.buttondown.com/v1/emails")).toBe(true);
  });

  it("verifies status on a slug collision instead of assuming successful delivery", async () => {
    mock(response({ results: [], next: null }), response({ code: "slug_already_exists" }, 400), response({ results: [draft], next: null }), response(draft), response({ ...draft, status: "about_to_send" }));
    expect((await send()).duplicate).toBe(false);
  });

  it("does not swallow unrelated conflicts or leak provider error details", async () => {
    mock(response({ results: [], next: null }), response({ code: "conflict", detail: "private@example.com" }, 409), response({ results: [], next: null }));
    await expect(send()).rejects.toThrow("Buttondown HTTP 409: conflict");
  });

  it("stops on suppressed or uncertain states", async () => {
    const suppressed = { ...draft, status: "suppressed" };
    const fetcher = mock(response({ results: [suppressed], next: null }), response(suppressed));
    await expect(send()).rejects.toThrow("manual review");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reads current status after an idempotent create replays an old draft", async () => {
    const fetcher = mock(response({ results: [], next: null }), response(draft), response({ ...draft, status: "sent" }));
    expect((await send()).duplicate).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
