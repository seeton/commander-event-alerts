# Security Policy

## Secrets

`BUTTONDOWN_API_KEY` と `ADMIN_TOKEN` はCloudflare Workers Secretsに保存してください。ソースコード、`.dev.vars` のコミット、Issue、Pull Request、ログには書かないでください。

秘密情報を誤って公開した場合は、コミットから消すだけでは不十分です。該当サービスで直ちに無効化し、新しい値へローテーションしてください。

## Reporting a vulnerability

秘密情報を含まない不具合はGitHub Issuesで報告できます。APIキーや個人情報を含む内容は公開Issueに投稿しないでください。
