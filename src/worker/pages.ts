export function landingPage(options: {
  appName: string;
  buttondownUsername: string;
  enabled: boolean;
}): string {
  const form = options.enabled
    ? `<form action="https://buttondown.com/api/emails/embed-subscribe/${encodeURIComponent(options.buttondownUsername)}" method="post">
        <label for="email">通知先メールアドレス</label>
        <div class="row"><input id="email" name="email" type="email" autocomplete="email" inputmode="email" maxlength="254" placeholder="you@example.com" required><button type="submit">無料で購読</button></div>
        <input type="hidden" name="embed" value="1">
      </form>`
    : `<div class="preparing"><strong>ただいま公開準備中です。</strong><br>購読受付の開始まで、もう少しお待ちください。</div>`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(options.appName)}</title><meta name="description" content="コマフェスなど、国内の大規模な統率者イベントを月初にメールでお知らせします。"><style>${styles}</style></head>
<body><main>
  <section class="hero"><div class="eyebrow">COMMANDER EVENT ALERTS</div><h1>大きな統率者イベントだけ、<br><span>月初にまとめて。</span></h1><p class="lead">コマンドフェスト、コマンダーサミット、プレイヤーズコンベンションのコマンドゾーンなど。毎日の大量通知ではなく、これから開催される大規模イベントを月1回お届けします。</p>${form}<p class="fine">登録後に確認メールを送ります。確認が終わるまで配信は始まりません。いつでもメール内のリンクから解除できます。</p></section>
  <section class="how"><h2>届き方</h2><div class="steps"><article><b>01</b><h3>対象だけを収集</h3><p>公式・主要イベントページから、大規模な統率者イベントを絞り込みます。</p></article><article><b>02</b><h3>毎月1日に通知</h3><p>開催日を過ぎるまで、確定済みイベントを月初の一覧に含めます。</p></article><article><b>03</b><h3>不要なら即解除</h3><p>メールごとの配信停止リンクから、いつでも購読をやめられます。</p></article></div></section>
  <section class="example"><h2>たとえば</h2><p><strong>10月10日開催</strong>のイベントが8月に発表されたら、<strong>8月・9月・10月</strong>の月初メールに掲載。見落としを減らしつつ、毎日メールは送りません。</p></section>
</main><footer><a href="/privacy">プライバシー</a><span>非公式のコミュニティ向け通知サービスです。</span></footer></body></html>`;
}

export function privacyPage(appName: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>プライバシー | ${escapeHtml(appName)}</title><style>${styles}</style></head><body><main class="document"><a href="/">← 戻る</a><h1>プライバシーについて</h1><p>本サービスは、購読確認とイベント通知のためにメールアドレスを取り扱います。</p><h2>保存と利用</h2><ul><li>メールアドレス、購読確認、配信停止状態は、メール配信事業者Buttondownで管理します。</li><li>イベント通知、購読確認、配信停止のためにのみ利用します。</li><li>メールアドレスを公開GitHubリポジトリやCloudflare D1へ保存しません。</li></ul><h2>配信停止</h2><p>各月次メール末尾の「配信停止」リンクから、いつでも解除できます。</p><h2>外部サービス</h2><p>購読フォーム、購読確認、配信停止、メール配信にButtondownを利用します。</p><h2>連絡先</h2><p>不具合・プライバシーに関する連絡は、個人情報を含めず<a href="https://github.com/seeton/commander-event-alerts/issues">GitHub Issues</a>へお願いします。</p></main></body></html>`;
}

const styles = `:root{color-scheme:light;--ink:#201d19;--muted:#6f685f;--paper:#f5f0e6;--card:#fffdf8;--accent:#a46224;--line:#d9d0c3}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Yu Gothic UI",sans-serif;line-height:1.7}main{max-width:1040px;margin:auto;padding:72px 24px 44px}.hero{max-width:790px}.eyebrow{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.17em}h1{margin:14px 0 20px;font-family:Georgia,"Yu Mincho",serif;font-size:clamp(38px,7vw,72px);line-height:1.12;letter-spacing:-.035em}h1 span{color:var(--accent)}.lead{max-width:720px;font-size:18px;color:var(--muted)}form{margin:34px 0 14px;padding:22px;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 40px #59432310}label{display:block;margin-bottom:8px;font-weight:750}.row{display:flex;gap:10px}input{min-width:0;flex:1;padding:14px 15px;border:1px solid #b9afa1;border-radius:9px;background:#fff;font:inherit}button{padding:14px 22px;border:0;border-radius:9px;background:var(--ink);color:white;font:inherit;font-weight:750;cursor:pointer}.fine{font-size:13px;color:var(--muted)}.preparing{margin:34px 0 14px;padding:22px;background:#fff5d8;border:1px solid #e8c879;border-radius:14px}.how{margin-top:90px}.how h2,.example h2,.document h2{font-family:Georgia,"Yu Mincho",serif;font-size:28px}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.steps article,.example{padding:24px;background:var(--card);border:1px solid var(--line);border-radius:14px}.steps b{color:var(--accent);font-family:Georgia,serif}.steps h3{margin:6px 0}.steps p{margin:0;color:var(--muted)}.example{margin:48px 0}.example h2{margin-top:0}.example p{font-size:18px;margin-bottom:0}footer{display:flex;gap:24px;justify-content:space-between;max-width:1040px;margin:auto;padding:30px 24px 50px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}a{color:var(--accent)}.document{max-width:760px}.document h1{font-size:46px}.document p,.document li{color:#4f4941}@media(max-width:720px){main{padding-top:48px}.steps{grid-template-columns:1fr}.row{display:block}.row button{width:100%;margin-top:10px}footer{display:block}footer span{display:block;margin-top:10px}}`;

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
