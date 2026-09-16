# Security Policy

## Secrets

`SMTP_PASSWORD`、`TOKEN_SECRET`、`ADMIN_TOKEN` はCloudflare Workers Secretsに保存してください。GitHub Actionsには `ALERTS_ADMIN_TOKEN` だけを渡します。SMTPパスワード・購読者アドレス・確認/解除トークンをソースコード、`.dev.vars` のコミット、Issue、Pull Request、ログへ書かないでください。

解除トークンを含むURLはアクセスログに残さない設定にしています。ログ設定の変更時にはこの前提を維持してください。確認/解除はGETで状態変更せず、POSTで確定します。SMTPの応答本文もログへ記録しません。

秘密情報を誤って公開した場合は、コミットから消すだけでは不十分です。該当サービスで直ちに無効化し、新しい値へローテーションしてください。

`TOKEN_SECRET` のローテーションでは既存の解除リンクが無効になります。漏えい時の対応には、購読者への案内と有効な解除方法の提供も含めてください。公開前は送信元のSPF/DKIM/DMARCと、本人所有アドレスによる到達・確認・解除を検証します。

## Reporting a vulnerability

秘密情報を含まない不具合はGitHub Issuesで報告できます。APIキーや個人情報を含む内容は公開Issueに投稿しないでください。
