import rawConfig from "../config.json";
import { readLimitedText } from "./http";

const HARERUYA_SEARCH =
  "https://www.hareruyamtg.com/ja/events/list?formats%5B%5D=7&isHoliday=true&isWeekday=true&term=";
const MTG_JP_COMMANDFEST = "https://mtg-jp.com/events/detail/0000042/";
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;

export interface EventInfo {
  title: string;
  url: string;
  source: string;
  dateText: string;
  location: string;
  kind: "event" | "announcement";
}

interface DiscoveryConfig {
  hareruya_search_terms: string[];
  include_terms: string[];
  exclude_terms: string[];
  players_convention_url: string;
}

interface LinkInfo {
  url: string;
  text: string;
}

export interface DiscoveryResult {
  events: EventInfo[];
  failures: string[];
}

const config = rawConfig as DiscoveryConfig;

export function normalize(value: string): string {
  return decodeEntities(value).replace(/\s+/gu, " ").trim();
}

export function parseLinks(document: string, baseUrl: string): LinkInfo[] {
  const links: LinkInfo[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu;
  for (const match of document.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const href = /\bhref\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1];
    if (!href) continue;
    const text = normalize(stripTags(match[2] ?? ""));
    if (!text) continue;
    try {
      links.push({ url: new URL(decodeEntities(href), baseUrl).toString(), text });
    } catch {
      // Ignore malformed links from third-party pages.
    }
  }
  return links;
}

export function accepted(title: string, activeConfig: Pick<DiscoveryConfig, "include_terms" | "exclude_terms"> = config): boolean {
  const folded = normalize(title).toLocaleLowerCase("ja");
  const included = activeConfig.include_terms.some((term) => folded.includes(term.toLocaleLowerCase("ja")));
  const excluded = activeConfig.exclude_terms.some((term) => folded.includes(term.toLocaleLowerCase("ja")));
  return included && !excluded;
}

export function firstDate(text: string): string {
  const normalized = normalize(text);
  return (
    /(20\d{2}年\s*\d{1,2}月\s*\d{1,2}日(?:\s*\d{1,2}時(?:\d{1,2}分)?)?)/u.exec(normalized)?.[1] ??
    /(20\d{2}[./-]\d{1,2}[./-]\d{1,2})/u.exec(normalized)?.[1] ??
    ""
  );
}

export function eventDateKey(text: string): string | null {
  const match = /(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/u.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function upcomingEvents(events: EventInfo[], todayKey = jstDateKey()): EventInfo[] {
  return events.filter((event) => {
    // An article's publication date is not an event date. Undated announcements
    // cannot safely be included in a future-events digest.
    if (event.kind !== "event") return false;
    const date = eventEndDateKey(event.dateText);
    return date !== null && date >= todayKey;
  });
}

function eventEndDateKey(text: string): string | null {
  const start = eventDateKey(text);
  if (!start) return null;
  const range = /20\d{2}年\s*\d{1,2}月\s*\d{1,2}日(?:[（(][^）)]*[）)])?\s*[-～〜~]\s*(?:(20\d{2})年)?(?:(\d{1,2})月)?(\d{1,2})日/u.exec(text);
  if (!range) return start;
  const month = Number(range[2] ?? start.slice(5, 7));
  const year = Number(range[1] ?? Number(start.slice(0, 4)) + (month < Number(start.slice(5, 7)) ? 1 : 0));
  const end = eventDateKey(`${year}-${month}-${range[3]}`);
  return end && end >= start ? end : start;
}

export function deduplicate(events: EventInfo[]): EventInfo[] {
  const unique = new Map<string, EventInfo>();
  for (const original of events) {
    const commandfest = /(コマンドフェスト\s*20\d{2}\s*[^\s）)\]]+)/iu.exec(original.title);
    const event = commandfest ? { ...original, title: normalize(commandfest[1]!) } : original;
    const key = commandfest
      ? `commandfest\u001f${event.dateText}\u001f${event.location}`
      : event.url.includes("hareruyamtg.com/ja/events/")
        ? event.url
        : `${event.source}\u001f${event.url}\u001f${normalize(event.title)}\u001f${normalize(event.dateText)}`;
    if (!unique.has(key)) unique.set(key, event);
  }
  return [...unique.values()].sort((left, right) =>
    `${eventDateKey(left.dateText) ?? ""}\u001f${left.title}`.localeCompare(`${eventDateKey(right.dateText) ?? ""}\u001f${right.title}`, "ja"),
  );
}

export async function discoverAll(): Promise<DiscoveryResult> {
  const sources = [
    ["晴れる屋", () => discoverHareruya(config)],
    ["マジック日本公式", () => discoverMtgJp()],
    ["プレイヤーズコンベンション", () => discoverPlayersConvention(config)],
  ] as const;
  const results = await Promise.allSettled(sources.map(([, discover]) => discover()));
  const events: EventInfo[] = [];
  const failures: string[] = [];
  results.forEach((result, index) => {
    const name = sources[index]![0];
    if (result.status === "fulfilled") {
      events.push(...result.value);
      console.log(JSON.stringify({ event: "discovery_source", source: name, count: result.value.length }));
    } else {
      failures.push(name);
      console.error(JSON.stringify({ event: "discovery_error", source: name, message: safeError(result.reason) }));
    }
  });
  if (failures.length === sources.length) throw new Error("all discovery sources failed");
  return { events: upcomingEvents(deduplicate(events)), failures };
}

async function discoverHareruya(activeConfig: DiscoveryConfig): Promise<EventInfo[]> {
  const pages: { url: string; document: string }[] = [];
  // Hareruya throttles bursts from one origin, so its small query set is
  // intentionally fetched in sequence.
  for (const term of activeConfig.hareruya_search_terms) {
    const url = `${HARERUYA_SEARCH}${encodeURIComponent(term)}`;
    try {
      pages.push({ url, document: await fetchText(url, MAX_HTML_BYTES) });
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) continue;
      throw error;
    }
  }
  const events: EventInfo[] = [];
  for (const { url, document } of pages) {
    for (const link of parseLinks(document, url)) {
      if (!link.url.includes("/ja/events/") || !link.url.endsWith("/detail") || !accepted(link.text, activeConfig)) continue;
      const dateText = firstDate(link.text);
      const title = fromFirstIncludeTerm(link.text, activeConfig);
      const withoutDate = normalize(link.text.replace(dateText, ""));
      const location = normalize(/^(.+?)\s+(?:統率者|コマンダー)/u.exec(withoutDate)?.[1] ?? "");
      events.push({ title, url: link.url, source: "晴れる屋イベント検索", dateText, location, kind: "event" });
    }
  }
  return events;
}

async function discoverMtgJp(): Promise<EventInfo[]> {
  return parseOfficialCommandFest(await fetchText(MTG_JP_COMMANDFEST, MAX_HTML_BYTES));
}

export function parseOfficialCommandFest(document: string): EventInfo[] {
  // This is the Japanese official event schedule, not the dated news feed.
  // It remains relevant even if an event was announced many months ago.
  const section = /<div\b[^>]*class=["'][^"']*\bevent-dates\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/iu.exec(document)?.[1];
  if (!section) throw new Error("Official CommandFest schedule markup changed");
  const text = normalize(stripTags(section));
  const events: EventInfo[] = [];
  let year = "";
  for (const match of text.matchAll(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日(?:[（(][^）)]*[）)])?\s*([^、,;]+?)(?=\s*(?:[、,;]|$))/gu)) {
    year = match[1] ?? year;
    if (!year) continue;
    const dateText = `${year}年${match[2]}月${match[3]}日`;
    const location = normalize(match[4]!);
    if (!eventDateKey(dateText) || !location || /[～〜~\d]/u.test(location)) continue;
    events.push({ title: `コマンドフェスト${year} ${location}`, url: MTG_JP_COMMANDFEST,
      source: "マジック日本公式", dateText, location, kind: "event" });
  }
  return events;
}

async function discoverPlayersConvention(activeConfig: DiscoveryConfig): Promise<EventInfo[]> {
  const url = activeConfig.players_convention_url;
  const document = await fetchText(url, MAX_HTML_BYTES);
  const scriptSources = [...document.matchAll(/<script[^>]+src=["']([^"']*\/app\.[^"']+\.js)["']/giu)]
    .slice(0, 10)
    .map((match) => new URL(match[1]!, url).toString());
  const scripts = await Promise.all(scriptSources.map((source) => fetchText(source, MAX_SCRIPT_BYTES)));
  const scriptText = scripts.join(" ");
  const text = normalize(stripTags(document));
  const body = `${text} ${scriptText}`;
  if (!body.includes("コマンドゾーン") && !body.toLocaleLowerCase("ja").includes("command zone")) return [];

  const rawTitle = normalize(/<title[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(document)?.[1] ?? "");
  let title = rawTitle.replace(/\s*\|.*$/u, "").trim();
  if (!title) title = "プレイヤーズコンベンション：コマンドゾーン";
  else if (!title.includes("コマンドゾーン")) title = `${title}：コマンドゾーン`;
  const titleYear = /(20\d{2})/u.exec(title)?.[1] ?? "20\\d{2}";
  const rangePattern = new RegExp(`(${titleYear}年\\d{1,2}月\\d{1,2}日[^"'<]{0,30}(?:-|～)[^"'<]{0,15}\\d{1,2}月\\d{1,2}日(?:（.）)?)`, "u");
  const dateText = normalize(rangePattern.exec(scriptText)?.[1] ?? firstDate(body));
  const location = normalize(/プレイヤーズコンベンション(.+?)(?:20\d{2}|：|$)/u.exec(title)?.[1] ?? "");
  return [{ title, url: new URL("commandzone", url).toString(), source: "プレイヤーズコンベンション公式", dateText, location, kind: "event" }];
}

async function fetchText(url: string, maxBytes: number): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ja,en;q=0.7",
      "User-Agent": "commander-event-alerts/2.0 (+https://github.com/seeton/commander-event-alerts)",
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new HttpError(response.status, url);
  return readLimitedText(response, maxBytes);
}

class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} (${new URL(url).hostname})`);
  }
}

function fromFirstIncludeTerm(text: string, activeConfig: DiscoveryConfig): string {
  const normalized = normalize(text);
  const folded = normalized.toLocaleLowerCase("ja");
  const positions = activeConfig.include_terms
    .map((term) => folded.indexOf(term.toLocaleLowerCase("ja")))
    .filter((position) => position >= 0);
  return positions.length > 0 ? normalize(normalized.slice(Math.min(...positions))) : normalized;
}

function jstDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function stripTags(value: string): string {
  return value.replace(/<script\b[\s\S]*?<\/script\s*>/giu, " ").replace(/<style\b[\s\S]*?<\/style\s*>/giu, " ").replace(/<[^>]+>/gu, " ");
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (entity, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named[code.toLowerCase()] ?? entity;
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "unknown error";
}
