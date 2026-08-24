# Commander Event Alerts

日本国内の**大規模な統率者イベントだけ**を毎日チェックし、新しい開催情報をメールで知らせる GitHub Actions です。

対象は次のような、イベント名から大規模開催と判断できるものに限定しています。

- コマンドフェスト / CommandFest
- コマンダーサミット / コマサミ / コマサミサーガ
- プレイヤーズコンベンションのコマンドゾーン / Command Zone

毎週の店舗イベント、コマンダー交流会、コマンダー・パーティー、開催後のレポートは通知しません。情報元は晴れる屋イベント検索、マジック日本公式のコマンダー記事、プレイヤーズコンベンション公式です。

## セットアップ（Resend）

個人メールのSMTPアカウントは使用しません。通知専用の [Resend](https://resend.com/) APIを利用します。無料枠は月3,000通・1日100通です。

Resendのアカウントメールと通知先を同じアドレスにすれば、独自ドメインなしで `onboarding@resend.dev` から送信できます。Resendで送信専用権限のAPIキーを作成し、リポジトリの **Settings → Secrets and variables → Actions** で次をRepository secretsに登録します。

| Secret | 値 |
|---|---|
| `RESEND_API_KEY` | `re_` で始まる送信専用APIキー |
| `MAIL_TO` | 通知を受け取るメールアドレス（複数ならカンマ区切り） |

APIキーはコードやログには出力されません。独自ドメインを追加した場合だけ、任意で `RESEND_FROM` もRepository secretに設定できます。

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

外部パッケージや有料APIは使いません。公式ページを取得して固有イベント名で絞り込み、URL・タイトル・開催日の組み合わせを通知IDにします。メール送信にはResendの無料APIを使います。GitHub Actions が通知履歴をコミットするため、ランナーが毎回新しくなっても重複通知を防げます。
