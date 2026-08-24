#!/usr/bin/env python3
"""Find large Japanese Commander events and send one email per new listing."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen

USER_AGENT = "commander-event-alerts/1.0 (+GitHub Actions)"
HARERUYA_SEARCH = (
    "https://www.hareruyamtg.com/ja/events/list"
    "?formats%5B%5D=7&isHoliday=true&isWeekday=true&term={term}"
)
MTG_JP_TOPICS = "https://mtg-jp.com/reading/topics/?p={offset}&q=&mainTag=&tag=69"


@dataclass(frozen=True)
class Event:
    title: str
    url: str
    source: str
    date_text: str = ""
    location: str = ""
    kind: str = "event"

    @property
    def event_id(self) -> str:
        # BIG MAGIC reuses the Players Convention URL, so its date/title is part
        # of the identity. Other sources normally use a permanent detail URL.
        identity_url = self.url
        if "コマンドフェスト" in self.title or "commandfest" in self.title.casefold():
            # Hareruya exposes one URL per ticket package. The event, not the
            # package, is the unit the user wants to be notified about.
            identity_url = "commandfest-family"
        raw = "\x1f".join(
            (self.source, identity_url, normalize(self.title), normalize(self.date_text))
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


@dataclass(frozen=True)
class Link:
    url: str
    text: str


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def fetch(url: str, timeout: int = 25) -> str:
    request = Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.7"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset, errors="replace")
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RuntimeError(f"取得できませんでした: {url} ({exc})") from exc


class LinkParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.links: list[Link] = []
        self._href: str | None = None
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._href is not None:
            return
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if href:
            self._href = urljoin(self.base_url, href)
            self._parts = []

    def handle_endtag(self, tag: str) -> None:
        if self._href is None or tag != "a":
            return
        text = normalize(" ".join(self._parts))
        if text:
            self.links.append(Link(self._href, text))
        self._href = None
        self._parts = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._parts.append(data)


class TextAndTitleParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title_parts: list[str] = []
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        self.parts.append(data)
        if self._in_title:
            self.title_parts.append(data)

    @property
    def text(self) -> str:
        return normalize(" ".join(self.parts))

    @property
    def title(self) -> str:
        return normalize(" ".join(self.title_parts))


def parse_links(document: str, base_url: str) -> list[Link]:
    parser = LinkParser(base_url)
    parser.feed(document)
    return parser.links


def accepted(title: str, config: dict) -> bool:
    folded = normalize(title).casefold()
    include = any(term.casefold() in folded for term in config["include_terms"])
    exclude = any(term.casefold() in folded for term in config["exclude_terms"])
    return include and not exclude


def from_first_include_term(text: str, config: dict) -> str:
    folded = normalize(text).casefold()
    positions = [
        folded.find(term.casefold())
        for term in config["include_terms"]
        if folded.find(term.casefold()) >= 0
    ]
    return normalize(text)[min(positions) :] if positions else normalize(text)


DATE_PATTERNS = (
    re.compile(r"(20\d{2}年\s*\d{1,2}月\s*\d{1,2}日(?:\s*\d{1,2}時(?:\d{1,2}分)?)?)"),
    re.compile(r"(20\d{2}[./-]\d{1,2}[./-]\d{1,2})"),
)


def first_date(text: str) -> str:
    for pattern in DATE_PATTERNS:
        match = pattern.search(text)
        if match:
            return normalize(match.group(1))
    return ""


def parsed_date(text: str) -> date | None:
    match = re.search(r"(20\d{2})\D+(\d{1,2})\D+(\d{1,2})", text)
    if not match:
        return None
    try:
        return date(*(int(value) for value in match.groups()))
    except ValueError:
        return None


def discover_hareruya(config: dict) -> list[Event]:
    events: list[Event] = []
    for term in config["hareruya_search_terms"]:
        url = HARERUYA_SEARCH.format(term=quote(term))
        try:
            document = fetch(url)
        except RuntimeError as exc:
            # Hareruya responds with 404 rather than an empty result page.
            if "HTTP Error 404" in str(exc):
                continue
            raise
        for link in parse_links(document, url):
            if "/ja/events/" not in link.url or not link.url.endswith("/detail"):
                continue
            if not accepted(link.text, config):
                continue
            event_date = first_date(link.text)
            if (day := parsed_date(event_date)) and day < date.today() - timedelta(days=1):
                continue
            title = from_first_include_term(link.text, config)
            without_date = normalize(link.text.replace(event_date, "", 1))
            location_match = re.search(r"^(.+?)\s+(?:統率者|コマンダー)", without_date)
            location = normalize(location_match.group(1)) if location_match else ""
            events.append(
                Event(
                    title=title,
                    url=link.url,
                    source="晴れる屋イベント検索",
                    date_text=event_date,
                    location=location,
                )
            )
    return events


def publication_date(text: str) -> date | None:
    # The date at the start of an mtg-jp list item is the article date.
    match = re.search(r"(20\d{2})[.]\s*(\d{1,2})[.]\s*(\d{1,2})", text)
    if not match:
        return None
    try:
        return date(*(int(value) for value in match.groups()))
    except ValueError:
        return None


def discover_mtg_jp(config: dict) -> list[Event]:
    events: list[Event] = []
    cutoff = date.today() - timedelta(days=int(config["article_max_age_days"]))
    for page in range(int(config["mtg_jp_topic_pages"])):
        url = MTG_JP_TOPICS.format(offset=page * 20)
        for link in parse_links(fetch(url), url):
            if not re.search(r"/reading/.+/\d{7}/?$", link.url):
                continue
            if not accepted(link.text, config):
                continue
            published = publication_date(link.text)
            if published and published < cutoff:
                continue
            title = re.sub(
                r"^20\d{2}[.]\s*\d{1,2}[.]\s*\d{1,2}\s+\S+\s+",
                "",
                link.text,
            )
            events.append(
                Event(
                    title=normalize(title),
                    url=link.url,
                    source="マジック日本公式",
                    date_text=published.isoformat() if published else "",
                    kind="announcement",
                )
            )
    return events


def discover_players_convention(config: dict) -> list[Event]:
    url = config["players_convention_url"]
    document = fetch(url)
    parser = TextAndTitleParser()
    parser.feed(document)
    app_scripts = re.findall(
        r'<script[^>]+src=["\']([^"\']*/app\.[^"\']+\.js)["\']', document, re.I
    )
    script_text = " ".join(fetch(urljoin(url, source)) for source in app_scripts)
    body = parser.text + " " + script_text
    if "コマンドゾーン" not in body and "command zone" not in body.casefold():
        return []

    title = re.sub(r"\s*\|.*$", "", parser.title).strip()
    if not title:
        title = "プレイヤーズコンベンション：コマンドゾーン"
    elif "コマンドゾーン" not in title:
        title = f"{title}：コマンドゾーン"

    # The site is a JavaScript app. Its current event range is embedded in the
    # bundle; matching a range avoids mistaking a news-update date for the event.
    year_match = re.search(r"(20\d{2})", title)
    year = year_match.group(1) if year_match else r"20\d{2}"
    range_match = re.search(
        rf"({year}年\d{{1,2}}月\d{{1,2}}日[^\"'<]{{0,30}}(?:-|～)[^\"'<]{{0,15}}\d{{1,2}}月\d{{1,2}}日(?:（.）)?)",
        script_text,
    )
    date_text = normalize(range_match.group(1)) if range_match else first_date(body)
    city_match = re.search(r"プレイヤーズコンベンション(.+?)(?:20\d{2}|：|$)", title)
    location = normalize(city_match.group(1)) if city_match else ""

    if (day := parsed_date(date_text)) and day < date.today() - timedelta(days=1):
        return []
    return [
        Event(
            title=title,
            url=urljoin(url, "commandzone"),
            source="プレイヤーズコンベンション公式",
            date_text=date_text,
            location=location,
        )
    ]


def deduplicate(events: Iterable[Event]) -> list[Event]:
    unique: dict[str, Event] = {}
    for event in events:
        commandfest = re.search(
            r"(コマンドフェスト\s*20\d{2}\s*[^\s）)\]]+)", event.title, re.I
        )
        if commandfest:
            event = Event(
                title=normalize(commandfest.group(1)),
                url=event.url,
                source=event.source,
                date_text=event.date_text,
                location=event.location,
                kind=event.kind,
            )
            key = "\x1f".join(("commandfest", event.date_text, event.location))
        elif "hareruyamtg.com/ja/events/" in event.url:
            # Different search terms can return the same Hareruya detail URL.
            key = event.url
        else:
            key = event.event_id
        unique.setdefault(key, event)
    return sorted(unique.values(), key=lambda item: (item.date_text, item.title))


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_state(path: Path) -> dict:
    if not path.exists():
        return {"version": 1, "seen": {}}
    state = load_json(path)
    if state.get("version") != 1 or not isinstance(state.get("seen"), dict):
        raise ValueError(f"未対応の状態ファイルです: {path}")
    return state


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def render_text(events: list[Event]) -> str:
    lines = ["大規模な統率者イベントの新着情報です。", ""]
    for event in events:
        lines.append(f"■ {event.title}")
        if event.date_text:
            label = "掲載日" if event.kind == "announcement" else "開催日"
            lines.append(f"{label}: {event.date_text}")
        if event.location:
            lines.append(f"会場: {event.location}")
        lines.append(f"情報元: {event.source}")
        lines.append(event.url)
        lines.append("")
    lines.append("このメールは commander-event-alerts の GitHub Actions から送信されました。")
    return "\n".join(lines)


def render_html(events: list[Event]) -> str:
    cards = []
    for event in events:
        details = []
        if event.date_text:
            label = "掲載日" if event.kind == "announcement" else "開催日"
            details.append(f"{label}: {html.escape(event.date_text)}")
        if event.location:
            details.append(f"会場: {html.escape(event.location)}")
        details.append(f"情報元: {html.escape(event.source)}")
        cards.append(
            '<div style="margin:0 0 20px;padding:16px;border:1px solid #ddd;'
            'border-radius:8px">'
            f'<h2 style="font-size:18px;margin:0 0 10px">{html.escape(event.title)}</h2>'
            f'<p style="line-height:1.7;margin:0 0 12px">{"<br>".join(details)}</p>'
            f'<a href="{html.escape(event.url, quote=True)}">詳細を見る</a>'
            "</div>"
        )
    return (
        '<!doctype html><html lang="ja"><body style="font-family:sans-serif;'
        'max-width:680px;margin:24px auto;color:#222">'
        "<h1 style=\"font-size:22px\">大規模統率者イベントの新着</h1>"
        "<p>新しく見つかった開催情報だけをお知らせします。</p>"
        + "".join(cards)
        + '<p style="color:#777;font-size:12px">commander-event-alerts / GitHub Actions</p>'
        "</body></html>"
    )


def resend_settings() -> dict:
    required = ("RESEND_API_KEY", "MAIL_TO")
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError("GitHub Secrets が未設定です: " + ", ".join(missing))
    return {
        "api_key": os.environ["RESEND_API_KEY"],
        # resend.dev may send only to the email belonging to this Resend
        # account. That is exactly the single-recipient use case here.
        "sender": os.getenv("RESEND_FROM") or "Commander Events <onboarding@resend.dev>",
        "recipients": [value.strip() for value in os.environ["MAIL_TO"].split(",") if value.strip()],
    }


def send_message(subject: str, text_body: str, html_body: str) -> None:
    settings = resend_settings()
    payload = json.dumps(
        {
            "from": settings["sender"],
            "to": settings["recipients"],
            "subject": subject,
            "text": text_body,
            "html": html_body,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = Request(
        "https://api.resend.com/emails",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {settings['api_key']}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urlopen(request, timeout=25) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Resend API の送信に失敗しました: HTTP {exc.code} {detail}") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Resend API の送信に失敗しました: {exc}") from exc
    if not result.get("id"):
        raise RuntimeError(f"Resend API から送信IDが返りませんでした: {result}")


def discover(config: dict) -> tuple[list[Event], list[str]]:
    events: list[Event] = []
    errors: list[str] = []
    sources = (
        ("晴れる屋", discover_hareruya),
        ("マジック日本公式", discover_mtg_jp),
        ("プレイヤーズコンベンション", discover_players_convention),
    )
    for name, finder in sources:
        try:
            found = finder(config)
            events.extend(found)
            print(f"{name}: {len(found)}件", file=sys.stderr)
        except Exception as exc:  # Keep other independent sources useful.
            errors.append(f"{name}: {exc}")
    return deduplicate(events), errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path("config.json"))
    parser.add_argument("--state", type=Path, default=Path("data/seen.json"))
    parser.add_argument("--send", action="store_true", help="新着メールを送り、状態を保存する")
    parser.add_argument("--test-email", action="store_true", help="疎通確認メールだけを送る")
    args = parser.parse_args(argv)

    config = load_json(args.config)
    if args.test_email:
        now = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M JST")
        send_message(
            "[統率者イベント通知] テスト成功",
            f"メール通知の設定は正常です。\n送信時刻: {now}",
            f"<p>メール通知の設定は正常です。</p><p>送信時刻: {now}</p>",
        )
        print("テストメールを送信しました")
        return 0

    events, errors = discover(config)
    for error in errors:
        print(f"警告: {error}", file=sys.stderr)
    if len(errors) == 3:
        print("すべての情報元の取得に失敗しました", file=sys.stderr)
        return 1

    state = load_state(args.state)
    new_events = [event for event in events if event.event_id not in state["seen"]]
    print(json.dumps([asdict(event) for event in new_events], ensure_ascii=False, indent=2))

    if not args.send:
        print(f"dry-run: 全{len(events)}件 / 新着{len(new_events)}件", file=sys.stderr)
        return 0
    if not new_events:
        print("新着はありません")
        return 0

    send_message(
        f"[統率者イベント通知] 新着{len(new_events)}件",
        render_text(new_events),
        render_html(new_events),
    )
    seen_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for event in new_events:
        state["seen"][event.event_id] = {**asdict(event), "seen_at": seen_at}
    save_state(args.state, state)
    print(f"新着{len(new_events)}件をメールし、状態を保存しました")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
