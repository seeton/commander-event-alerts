import importlib.util
import os
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).parents[1] / "src" / "commander_alert.py"
SPEC = importlib.util.spec_from_file_location("commander_alert", MODULE_PATH)
alert = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = alert
SPEC.loader.exec_module(alert)


CONFIG = {
    "include_terms": ["コマンドフェスト", "コマンダーサミット", "コマンドゾーン"],
    "exclude_terms": ["レポート", "参加レポ"],
    "hareruya_search_terms": ["コマンダーサミット"],
}


class CommanderAlertTests(unittest.TestCase):
    def test_classifier_is_deliberately_conservative(self):
        self.assertTrue(alert.accepted("コマンダーサミット[予約可]", CONFIG))
        self.assertFalse(alert.accepted("毎週コマンダー交流会", CONFIG))
        self.assertFalse(alert.accepted("コマンドフェスト参加レポート", CONFIG))

    def test_link_parser_keeps_nested_text(self):
        document = """
        <a href="/ja/events/123/detail"><span>2026年09月23日 10時</span>
        <span>TC 東京</span><br class="smp"><span>統率者</span>
        <span><div>コマンダーサミット[予約可]</div></span></a>
        """
        links = alert.parse_links(document, "https://www.hareruyamtg.com/")
        self.assertEqual(links[0].url, "https://www.hareruyamtg.com/ja/events/123/detail")
        self.assertIn("コマンダーサミット", links[0].text)

    def test_hareruya_event_extraction(self):
        future = date.today() + timedelta(days=30)
        date_text = f"{future.year}年{future.month:02d}月{future.day:02d}日 10時"
        document = f"""
        <a href="https://www.hareruyamtg.com/ja/events/123/detail">
          <span>{date_text}</span><span>TC 東京</span><span>統率者</span>
          <span>コマンダーサミット[予約可]</span>
        </a>
        """
        with patch.object(alert, "fetch", return_value=document):
            events = alert.discover_hareruya(CONFIG)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].date_text, date_text)
        self.assertEqual(events[0].location, "TC 東京")

    def test_players_convention_requires_command_zone(self):
        config = {"players_convention_url": "https://example.test/pc"}
        future = date.today() + timedelta(days=60)
        document = f"""
        <title>Players Convention 横浜</title>
        <h2>コマンドゾーン</h2><p>{future.year}年{future.month}月{future.day}日</p>
        <p>パシフィコ横浜 展示ホールD</p>
        """
        with patch.object(alert, "fetch", return_value=document):
            events = alert.discover_players_convention(config)
        self.assertEqual(len(events), 1)
        self.assertIn("コマンドゾーン", events[0].title)

    def test_event_id_changes_when_reused_page_gets_a_new_date(self):
        first = alert.Event("PC：コマンドゾーン", "https://example.test", "公式", "2026-03-01")
        second = alert.Event("PC：コマンドゾーン", "https://example.test", "公式", "2026-10-01")
        self.assertNotEqual(first.event_id, second.event_id)

    def test_commandfest_packages_become_one_event(self):
        events = [
            alert.Event(
                "コマンドフェスト2026 横浜 VIPパッケージ",
                "https://example.test/vip",
                "晴れる屋イベント検索",
                "2026年08月30日 09時",
                "横浜",
            ),
            alert.Event(
                "コマンドフェスト2026 横浜 ベーシックパッケージ",
                "https://example.test/basic",
                "晴れる屋イベント検索",
                "2026年08月30日 09時",
                "横浜",
            ),
        ]
        result = alert.deduplicate(events)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].title, "コマンドフェスト2026 横浜")

    def test_resend_settings_use_restricted_testing_sender(self):
        environment = {
            "RESEND_API_KEY": "re_secret",
            "MAIL_TO": "receiver@example.com",
            "RESEND_FROM": "",
        }
        with patch.dict(os.environ, environment, clear=True):
            settings = alert.resend_settings()
        self.assertEqual(settings["api_key"], "re_secret")
        self.assertEqual(settings["sender"], "Commander Events <onboarding@resend.dev>")
        self.assertEqual(settings["recipients"], ["receiver@example.com"])


if __name__ == "__main__":
    unittest.main()
