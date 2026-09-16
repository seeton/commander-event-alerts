import { describe, expect, it } from "vitest";
import {
  accepted,
  deduplicate,
  eventDateKey,
  parseLinks,
  parseOfficialCommandFest,
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

  it("excludes undated events and publication dates", () => {
    expect(upcomingEvents([sampleEvent({ dateText: "未定" }), sampleEvent({ kind: "announcement" })], "2026-08-01")).toEqual([]);
  });

  it("retains a multi-day event through its final day, including a month boundary", () => {
    const event = sampleEvent({ dateText: "2026年9月30日（水）- 10月1日（木）" });
    expect(upcomingEvents([event], "2026-10-01")).toHaveLength(1);
    expect(upcomingEvents([event], "2026-10-02")).toHaveLength(0);
  });

  it("sorts by calendar date rather than unpadded text", () => {
    expect(deduplicate([
      sampleEvent({ url: "https://example.com/18", title: "コマンダーサミット", dateText: "2026年10月18日" }),
      sampleEvent({ url: "https://example.com/3", title: "コマンダーサミット", dateText: "2026年10月3日" }),
    ])[0]?.dateText).toBe("2026年10月3日");
  });

  it("reads the persistent official schedule and carries the year to later dates", () => {
    const events = parseOfficialCommandFest('<div class="event-dates inner"><h2>- 開催日程 -</h2><p>2026年7月12日（日）大阪、　8月30日（日）横浜</p></div>');
    expect(events.map((event) => [event.dateText, event.location])).toEqual([["2026年7月12日", "大阪"], ["2026年8月30日", "横浜"]]);
    expect(upcomingEvents(events, "2026-08-01")).toHaveLength(1);
    expect(upcomingEvents(events, "2026-09-01")).toHaveLength(0);
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
