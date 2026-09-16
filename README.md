# Commander Event Alerts

[![Test](https://github.com/seeton/commander-event-alerts/actions/workflows/test.yml/badge.svg)](https://github.com/seeton/commander-event-alerts/actions/workflows/test.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

日本国内の**大規模な統率者イベントだけ**を、月初にメールで知らせる購読サービスです。利用者はGitHubの設定やリポジトリ作成をせず、フォームへメールアドレスを入力するだけで購読できます。

**公開ページ（現在は購読受付の準備中）:**

https://commander-event-alerts.asaiwing1104.workers.dev/

## 通知するイベント

- コマンドフェスト / CommandFest
- コマンダーサミット / コマサミ / コマサミサーガ
- プレイヤーズコンベンションのコマンドゾーン / Command Zone

毎週の店舗イベント、一般的な交流会、コマンダー・パーティー、開催後のレポートは対象外です。

通知は新着時の1回だけではありません。開催前なら月初ごとに同じイベントを再通知します。例えば10月10日のイベントが8月に発表済みなら、8月・9月・10月の月初メールに掲載されます。

## 利用者向けの流れ

1. 公開ページでメールアドレスを入力する
2. 届いた確認メールのリンクを開く（二重確認）
3. 毎月1日 09:15 JSTごろ、開催予定イベントの一覧が届く
4. 不要になったら、各メール末尾の専用リンクで配信停止する

メールアドレスや配信用APIキーをGitHubへ入力する必要はありません。

## 構成

- **Cloudflare Workers**: 購読フォーム、月次Cron、イベント取得
- **Buttondown**: 二重確認、購読者、配信停止状態、月次メールを管理

メールアドレスは公開リポジトリやCloudflareへ保存しません。Buttondownは独自ドメインなしでも共用送信基盤を利用でき、最初の100人は無料です。月ごとの一意なメール名で二重送信も防ぎます。

```text
購読フォーム → Buttondown → 確認メール

Cloudflare Cron → 公式ページを確認 → 開催前イベント → Buttondown配信
```

## 開発

必要なものはNode.js 20以降とCloudflare Wranglerです。

```bash
npm install
npm run cf-typegen
npm run typecheck
npm test
npm run dev
```

本番用の秘密情報はCloudflare Workers Secretsへ登録します。`.dev.vars`、`.env`、ソースコード、Issueには書かないでください。

| Secret | 用途 |
|---|---|
| `BUTTONDOWN_API_KEY` | 月次メールの作成と配信 |
| `ADMIN_TOKEN` | 手動プレビュー・配信APIの保護 |

購読フォームはButtondownへ直接送信されるため、Workerはメールアドレスを受け取りません。Buttondownの公開ユーザー名は `wrangler.jsonc` の通常変数です。`SERVICE_ENABLED` が `false` の間は、フォームとCron配信が停止します。

## 情報元

- [晴れる屋イベント検索](https://www.hareruyamtg.com/ja/events/list)
- [マジック：ザ・ギャザリング日本公式](https://mtg-jp.com/)
- [プレイヤーズコンベンション公式](https://ssl.bigmagic.net/players_convention/)

情報元ごとに独立して取得し、一部が一時停止しても残りの情報を利用します。すべての情報元に失敗した場合は配信しません。

## 制約と免責

- 本サービスは非公式で、Wizards of the Coast、晴れる屋、BIG MAGIC、その他イベント主催者とは関係ありません
- 情報元サイトの変更、掲載表記、通信障害などにより、取得漏れや誤検出が発生する可能性があります
- 開催日、会場、申込方法は、必ずリンク先の公式情報で確認してください
- 利用料金や無料枠は各事業者の都合で変わる可能性があります

不具合や対象イベントの提案は [Issues](https://github.com/seeton/commander-event-alerts/issues) へどうぞ。メールアドレスやAPIキーは書かないでください。

## ライセンス

[MIT License](LICENSE)
