# Commander Event Alerts

日本国内の**大規模な統率者イベントだけ**を毎日チェックし、新しい開催情報をメールで知らせる GitHub Actions です。

対象は次のような、イベント名から大規模開催と判断できるものに限定しています。

- コマンドフェスト / CommandFest
- コマンダーサミット / コマサミ / コマサミサーガ
- プレイヤーズコンベンションのコマンドゾーン / Command Zone

毎週の店舗イベント、コマンダー交流会、コマンダー・パーティー、開催後のレポートは通知しません。情報元は晴れる屋イベント検索、マジック日本公式のコマンダー記事、プレイヤーズコンベンション公式です。

## セットアップ（Gmail の場合）

リポジトリの **Settings → Secrets and variables → Actions** で、Repository secrets に次を登録します。

| Secret | 値 |
|---|---|
| `SMTP_USER` | 送信に使う Gmail アドレス |
| `SMTP_PASSWORD` | Google アカウントで発行した16桁のアプリ パスワード |
| `MAIL_TO` | 通知を受け取るメールアドレス（複数ならカンマ区切り） |

Gmail の通常のログインパスワードは使用しません。Google アカウントで2段階認証を有効にして、`アプリ パスワード`を発行してください。

Gmail 以外を使う場合は Repository variables に `SMTP_HOST` と `SMTP_PORT` を追加します。既定値は `smtp.gmail.com` と `465`（SSL）です。必要なら Repository secret の `MAIL_FROM` も設定できます。

## 動作確認

1. GitHub の **Actions → Commander Event Alert → Run workflow** を開く
2. `Send only a test email` をオンにして実行する
3. テストメールが届いたら、同じ画面からオフのままもう一度実行する

オフでの初回実行では、現在見つかる対象イベントをメールします。以後は [`data/seen.json`](data/seen.json) に記録済みのものを再送しません。定期確認は毎朝 6:15 JST です。

## 通知対象を変える

[`config.json`](config.json) の `include_terms` と `exclude_terms` を編集します。`include_terms` は誤通知を防ぐため、イベントの固有名だけを入れるのがおすすめです。

ローカルでメールを送らず検出結果を確認できます。

```bash
python3 src/commander_alert.py
python3 -m unittest discover -s tests -v
```

## 仕組み

外部パッケージや有料APIは使いません。公式ページを取得して固有イベント名で絞り込み、URL・タイトル・開催日の組み合わせを通知IDにします。GitHub Actions が通知履歴をコミットするため、ランナーが毎回新しくなっても重複通知を防げます。

