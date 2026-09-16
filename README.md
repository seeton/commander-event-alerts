# Commander Event Alerts

[![Test](https://github.com/seeton/commander-event-alerts/actions/workflows/test.yml/badge.svg)](https://github.com/seeton/commander-event-alerts/actions/workflows/test.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

日本国内の**大規模な統率者イベントだけ**を、月初にメールで知らせる購読サービスです。利用者はGitHubの設定やリポジトリ作成をせず、フォームへメールアドレスを入力するだけで購読できます。

**公開ページ（XREAへの移行・送信認証・実送信テスト完了までは購読受付停止）:**

https://commander-event-alerts.asaiwing1104.workers.dev/

## 通知するイベント

- コマンドフェスト / CommandFest
- コマンダーサミット / コマサミ / コマサミサーガ
- プレイヤーズコンベンションのコマンドゾーン / Command Zone

毎週の店舗イベント、一般的な交流会、コマンダー・パーティー、開催後のレポートは対象外です。

通知は新着時の1回だけではありません。開催前なら月初ごとに同じイベントを再通知します。例えば10月10日のイベントが8月に発表済みなら、8月・9月・10月の月初メールに掲載されます。

## 利用者向けの流れ

1. 公開ページでメールアドレスを入力する
2. 届いた確認メールのリンクを開き「購読を確定」を押す（二重確認・24時間有効）
3. 毎月1日 09:15 JSTごろ、開催予定イベントの一覧が届く
4. 不要になったら、各メール末尾の専用リンクで配信停止する

メールアドレスや配信用APIキーをGitHubへ入力する必要はありません。

## 構成

- **Cloudflare Workers + D1**: 購読フォーム、二重確認、配信停止、イベント取得、非公開の購読者・送信履歴
- **GitHub Actions**: 毎月1日にWorkerの配信処理を順番に実行（宛先情報は取得しない）
- **既存のXREAメール**: TLSで保護したSMTP認証を使い、1人ずつ配信

メールアドレスはCloudflare D1内で管理し、公開リポジトリやGitHub Actionsのログには保存しません。送信元SMTPパスワードもCloudflare Secretだけに保存します。BCCではなく1人ずつ配信し、メールごとの専用配信停止リンクを付けます。解除時は稼働中DBからアドレスを削除します（プロバイダーのバックアップ・配送ログは別途保管期間があります）。

```text
購読フォーム → Worker / D1 → XREA → 確認メール

月初のActions → Workerで月次一覧と宛先を確定 → 1人ずつXREAで送信
```

## 開発

必要なものはNode.js 24以降とCloudflare Wranglerです。テストは1 workerで実行します。

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
| `SMTP_PASSWORD` | 既存XREAメールアカウントのパスワード（変更・再発行は不要） |
| `TOKEN_SECRET` | 解除リンクと不正登録防止ハッシュの署名用。32文字以上のランダム値 |
| `ADMIN_TOKEN` | 管理APIの保護。Actionsの `ALERTS_ADMIN_TOKEN` Secretにも同じ値を保存 |

`wrangler d1 create commander-event-alerts` でDBを作り、返されたIDを `wrangler.jsonc` の `DB` bindingに設定してから `wrangler d1 migrations apply commander-event-alerts --remote` を実行します。テストはローカルのD1を使い、実在する宛先への送信は行いません。

`SERVICE_ENABLED=false` の間は登録と送信を停止します。配信停止だけは常に利用できます。GitHubリポジトリ変数 `DELIVERY_ENABLED=true` も設定しない限りActionsは送信しません。公開前にSMTP認証、SPF/DKIM/DMARC、本人所有の宛先で受信・確認・停止を検証してください。旧Buttondownからの自動インポートは行いません。所有者を含め、XREA版で購読を確認する必要があります。

### 送信と障害時の扱い

- `POST /api/admin/prepare`: 今月の本文と確認済み宛先を一度だけ確定。後からの登録は翌月から。
- `POST /api/admin/send-next?month=YYYY-MM`: 未送信の1人分を取得・送信。現在のJST月だけを許可。
- `GET /api/admin/status?month=YYYY-MM`: アドレスを含まない状態別件数。
- 各APIは `Authorization: Bearer ...` が必要。GETプレビューは従来の `/api/admin/preview`。
- SMTPは厳密な「必ず1回」を保証できません。DATA後に応答を失った場合や、送信後のDB更新に失敗した場合は `unknown` にして自動再送せず、XREAの配送状況とDBを手動照合します。
- 処理中断で残った `sending` も2分後に `unknown` として停止。確認せず `pending` に戻さないでください。
- 送信間隔は最低1.5秒。同月再実行では送信済みを飛ばします。Actionsは30分で停止し、次の実行へ履歴を引き継げます。失敗・不明がある月は要確認です。
- 100人程度を想定。安全弁として月次対象200人超は自動配信を停止します。確認メールは全体50通/日、同一IP5回/時、同一アドレス1回/時を上限にしています。
- バウンス通知は送信元メールで監視してください。恒久的な宛先不達はD1の購読状態を `bounced` に変更して停止し、原因確認まで再送しないでください。
- 公開GitHubのスケジュールは遅延や長期無活動による無効化があり得ます。厳密な09:15到着保証はありません。
- `TOKEN_SECRET` の変更は既存の解除リンクを無効化するので、通常運用では変更しないでください。
- Cloudflareの毎日03:27 JSTのCronは期限切れデータの掃除専用です。メールは送りません。

XREAの送信上限は送受信量や契約プランによる目安で、公開メルマガへの無制限利用を保証するものではありません。希望者の確認済み購読だけを扱い、通常使用量・サーバー負荷の範囲で運用します。

## 情報元

- [晴れる屋イベント検索](https://www.hareruyamtg.com/ja/events/list)
- [マジック日本公式・コマンドフェスト開催日程](https://mtg-jp.com/events/detail/0000042/)
- [プレイヤーズコンベンション公式](https://ssl.bigmagic.net/players_convention/)

情報元ごとに独立して取得し、一部が一時停止しても残りの情報を利用します。すべての情報元に失敗した場合は配信しません。

開催日の分からない告知や記事の掲載日は、開催予定イベントとして配信しません。公式の開催日程ページは、告知の古さに関係なく毎月確認します。

## 制約と免責

- 本サービスは非公式で、Wizards of the Coast、晴れる屋、BIG MAGIC、その他イベント主催者とは関係ありません
- 情報元サイトの変更、掲載表記、通信障害などにより、取得漏れや誤検出が発生する可能性があります
- 開催日、会場、申込方法は、必ずリンク先の公式情報で確認してください
- 利用料金や無料枠は各事業者の都合で変わる可能性があります

不具合や対象イベントの提案は [Issues](https://github.com/seeton/commander-event-alerts/issues) へどうぞ。メールアドレスやAPIキーは書かないでください。

## ライセンス

[MIT License](LICENSE)
