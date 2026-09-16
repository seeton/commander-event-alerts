import { describe, expect, it } from "vitest";
import {
  accepted,
  deduplicate,
  eventDateKey,
  parseLinks,
  upcomingEvents,
  type EventInfo,
} from "../src/worker/discovery";

const classifier = {
  include_terms: ["コマンドフェスト", "コマンダーサミット", "コマンドゾーン"],
  exclude_terms: ["レポート", "参加レポ"],
};

describe("event discovery helpers", () => {
  it("classifies conservatively", () => {
    expect(accepted("コマンダーサミット[予約可]", classifier)).toBe(true);
    expect(accepted("毎週コマンダー交流会", classifier)).toBe(false);
    expect(accepted("コマンドフェスト参加レポート", classifier)).toBe(false);
  });

  it("extracts nested link text and resolves relative URLs", () => {
    const links = parseLinks(
      '<a class="event" href="/ja/events/123/detail"><span>2026年10月10日</span><strong>コマンダーサミット</strong></a>',
      "https://www.hareruyamtg.com/ja/",
    );
    expect(links).toEqual([{
      url: "https://www.hareruyamtg.com/ja/events/123/detail",
      text: "2026年10月10日 コマンダーサミット",
    }]);
  });

  it("validates calendar dates", () => {
    expect(eventDateKey("2026年10月10日 9時")).toBe("2026-10-10");
    expect(eventDateKey("2026年2月30日")).toBeNull();
  });

  it("keeps an event in every monthly digest through its event date", () => {
    const event = sampleEvent({ dateText: "2026年10月10日" });
    expect(upcomingEvents([event], "2026-08-01")).toHaveLength(1);
    expect(upcomingEvents([event], "2026-09-01")).toHaveLength(1);
    expect(upcomingEvents([event], "2026-10-01")).toHaveLength(1);
    expect(upcomingEvents([event], "2026-10-10")).toHaveLength(1);
    expect(upcomingEvents([event], "2026-10-11")).toHaveLength(0);
  });

  it("collapses CommandFest ticket packages into one event", () => {
    const events = [
      sampleEvent({ title: "コマンドフェスト2026 横浜 VIPパッケージ", url: "https://example.com/vip" }),
      sampleEvent({ title: "コマンドフェスト2026 横浜 ベーシックパッケージ", url: "https://example.com/basic" }),
    ];
    expect(deduplicate(events)).toHaveLength(1);
    expect(deduplicate(events)[0]?.title).toBe("コマンドフェスト2026 横浜");
  });
});

function sampleEvent(overrides: Partial<EventInfo> = {}): EventInfo {
  return {
    title: "コマンドフェスト2026 横浜",
    url: "https://example.com/event",
    source: "公式",
    dateText: "2026年10月10日",
    location: "横浜",
    kind: "event",
    ...overrides,
  };
}
