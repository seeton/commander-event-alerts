# Commander Event Alerts

[![Test](https://github.com/seeton/commander-event-alerts/actions/workflows/test.yml/badge.svg)](https://github.com/seeton/commander-event-alerts/actions/workflows/test.yml)

日本国内の大規模な統率者イベントだけを、月初にメールで知らせるサービスです。

**公開準備中：Buttondownのアカウント審査待ち。自動配信は無効です。**

購読ページ（承認後に利用可能）: https://buttondown.com/commander-events-jp

利用者はGitHubアカウントやAPIキーを用意する必要はありません。

## 構成は2つだけ

- **GitHub Actions**: 毎月1日09:15 JSTごろに公式イベント情報を取得し、Buttondownへ配信を指示
- **Buttondown**: 標準の購読ページ、購読確認、メール配送、解除、配信履歴

Google Forms、Cloudflare Workers/D1、自作SMTP、独自ドメインは使いません。送信元はButtondown標準ドメインを使います。購読者アドレスはButtondownだけで管理し、GitHubへ取り込みません。

## 対象と配信ルール

- コマンドフェスト / CommandFest
- コマンダーサミット / コマサミ / コマサミサーガ
- プレイヤーズコンベンションのコマンドゾーン / Command Zone

毎週の店舗イベント、一般交流会、コマンダー・パーティー、開催後のレポートは除外します。

開催前なら月初ごとに繰り返し掲載します。10月10日のイベントが8月に判明していれば、8月・9月・10月のメールに掲載します。開催日不明の告知は含めず、対象が0件なら送りません。

## 利用者の流れ

1. Buttondownの購読ページにメールアドレスを入力
2. 届いた確認メールから購読を確定
3. 毎月初めに開催予定の一覧を受け取る
4. メール末尾の解除リンクでいつでも停止

## 開発と運用

Node.js 24以降を使います。

```sh
npm ci
npm run typecheck
npm test
npm run preview
```

プレビューは公開イベント情報だけを読み、メール送信や購読者取得を行いません。APIキーも不要です。

GitHubリポジトリの **Settings → Secrets and variables → Actions** に設定します。

| 種類 | 名前 | 内容 |
|---|---|---|
| Secret | `BUTTONDOWN_API_KEY` | EmailsのRead & writeとSendingのみ許可した既存キー |
| Variable | `DELIVERY_ENABLED` | 承認・受信確認後だけ `true`。それまでは `false` |

APIキーはソース、Issue、ログに書かないでください。Subscribersの読み書き権限は不要です。

「Monthly newsletter」の手動実行は3種類です。

- `preview`（初期値）: 公開イベントの一覧を確認。送信しない
- `check`: Buttondownとの接続と今月の配信状態を読取確認。メール作成・配信しない
- `send`: 今月分を送信。`DELIVERY_ENABLED=true` が必要

審査中に配信を試したり、短時間に購読・解除を繰り返したりしないでください。承認後は確認済みの運営者宛てで受信を確かめてから公開します。すでに送った2026年9月分を再送する必要はありません。

### 二重送信と失敗時

月ごとの固定slugとButtondown上の送信状態を使います。送信済み・送信待ちなら再送しません。同じ月の実行はActions側でも直列化します。API書込には冪等キーを付け、通信失敗を無条件でリトライしません。

中断後に再実行すると既存下書きから再開します。paused、errored、suppressed等の状態は自動で解除・再送せず、運営者の確認で止まります。同月のメールを削除したりslugや件名を変えたりすると重複判定を妨げるので避けてください。

一部の情報元が失敗した場合は成功した情報だけを利用し、失敗した情報元の名前をログに残します。全情報元が失敗した場合は配信しません。

## 公開・費用について

Buttondownは現行の案内では100購読者まで無料で、APIと標準の送信ドメインを使えます。追加の有料Forms機能は使わず、標準購読ページを利用します。100人を超える場合は料金を確認し、無断で有料プランへ切り替えません。

- [Buttondown料金](https://buttondown.com/pricing)
- [API](https://buttondown.com/features/api)
- [アカウント審査](https://docs.buttondown.com/account-review)

審査や再審査、迷惑メール判定はなくせません。GitHubの定期実行にも遅延があり、公開リポジトリは60日間活動がないとスケジュールが無効になる場合があります。Actionsの通知・実行履歴を定期確認してください。毎月のメール到着や無料条件の永続性を保証するものではありません。

## 情報元・免責

- [晴れる屋イベント検索](https://www.hareruyamtg.com/ja/events/list)
- [マジック日本公式](https://mtg-jp.com/events/detail/0000042/)
- [プレイヤーズコンベンション公式](https://ssl.bigmagic.net/players_convention/)

主催者とは無関係の非公式サービスです。取得漏れや誤検出があり得ます。日程・会場・参加条件はリンク先の公式情報で確認してください。

不具合・イベントの提案は[Issues](https://github.com/seeton/commander-event-alerts/issues)へ。メールアドレスやAPIキーは書かないでください。

[MIT License](LICENSE)
