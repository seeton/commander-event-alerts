# Security Policy

## Secrets

`RESEND_API_KEY`、`MAIL_TO`、`RESEND_FROM` はGitHubのRepository secretsに保存してください。ソースコード、`config.json`、Issue、Pull Request、Actionsのログには書かないでください。

APIキーを誤って公開した場合は、コミットから消すだけでは不十分です。Resendでそのキーを直ちに削除し、新しいキーを作成してください。

## Reporting a vulnerability

秘密情報を含まない不具合はGitHub Issuesで報告できます。APIキーや個人情報を含む内容は公開Issueに投稿しないでください。
