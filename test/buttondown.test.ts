import { describe, expect, it } from "vitest";
import { monthlyMarkdown } from "../src/worker/buttondown";

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
});
