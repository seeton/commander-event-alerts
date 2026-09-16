import { connect } from 'cloudflare:sockets';
import { discoverAll } from './discovery';
import { landingPage, privacyPage, messagePage } from './pages';
import { constantTimeEqual } from './security';
import { sendSmtp, type SendMail, SmtpError, validEmail } from './smtp';
import { cleanup, subscribe, confirmSubscription, unsubscribe } from './subscriptions';
import { campaignStatus, jstMonthKey, prepareCampaign, sendNext } from './newsletter';
import { readLimitedText } from './http';

export function mailer(env: Cloudflare.Env): SendMail {
  return mail => sendSmtp({host:env.SMTP_HOST,user:env.SMTP_USER,password:env.SMTP_PASSWORD,from:env.SMTP_FROM,name:env.APP_NAME}, mail,
    host => connect({hostname:host,port:465}, {secureTransport:'on',allowHalfOpen:false}));
}

function ready(env: Cloudflare.Env): boolean {
  return String(env.SERVICE_ENABLED)==='true' && Boolean(env.SMTP_PASSWORD && env.TOKEN_SECRET?.length >= 32 && env.DB);
}

export default {
  // Housekeeping only: this daily trigger never sends email.
  async scheduled(_controller, env): Promise<void> { await cleanup(env.DB); },
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method==='GET' && url.pathname==='/') return html(landingPage({appName:env.APP_NAME,enabled:ready(env)}));
      if (request.method==='GET' && url.pathname==='/privacy') return html(privacyPage(env.APP_NAME));
      if (request.method==='GET' && url.pathname==='/healthz') return json({ok:true,acceptingSubscriptions:ready(env)});
      if (url.pathname.startsWith('/api/admin/')) {
        const secret = env.ADMIN_TOKEN?.trim();
        const supplied = request.headers.get('authorization')?.replace(/^Bearer /u,'') ?? '';
        if (!secret || !supplied || !(await constantTimeEqual(supplied,secret))) return json({message:'Unauthorized'},401);
        // Operator-only smoke test while public registration remains paused.
        // The recipient is a temporary Secret, never request input or a response field.
        if (request.method==='POST' && url.pathname==='/api/admin/test-mail') {
          if (!env.SMTP_PASSWORD || !env.TEST_RECIPIENT || !validEmail(env.TEST_RECIPIENT)) return json({status:'test_disabled'},503);
          try {
            await mailer(env)({to:env.TEST_RECIPIENT,subject:`【送信テスト】${env.APP_NAME}`,
              text:'これは運営者が実行した送信テストです。Cloudflare WorkersからXREAの暗号化SMTP接続を使い、1通ずつ送信しています。\n\nこのテストでは購読登録や月次メール配信は行いません。',
              messageId:`smtp-test-${crypto.randomUUID()}`});
            return json({status:'accepted'});
          } catch (error) {
            return json({status:'test_failed',code:error instanceof SmtpError ? error.code : 'request_failed',uncertain:error instanceof SmtpError && error.uncertain},502);
          }
        }
        if (request.method==='GET' && url.pathname==='/api/admin/preview') return json(await discoverAll());
        if (request.method==='GET' && url.pathname==='/api/admin/status') {
          const month=url.searchParams.get('month') ?? jstMonthKey(new Date());
          if (!/^20\d{2}-\d{2}$/u.test(month)) return json({message:'Invalid month'},400);
          return json({month,counts:await campaignStatus(env.DB,month)});
        }
        if (!ready(env)) return json({status:'disabled'},503);
        if (request.method==='POST' && url.pathname==='/api/admin/prepare') {
          await cleanup(env.DB);
          const discovery=await discoverAll();
          return json({...await prepareCampaign(env,discovery.events),eventCount:discovery.events.length,failures:discovery.failures});
        }
        if (request.method==='POST' && url.pathname==='/api/admin/send-next') {
          const month=url.searchParams.get('month') ?? '';
          if (month!==jstMonthKey(new Date())) return json({message:'Invalid month'},400);
          return json(await sendNext(env,month,mailer(env)));
        }
        return json({message:'Not found'},404);
      }
      if (request.method==='GET' && ['/confirm','/unsubscribe'].includes(url.pathname)) {
        const token=url.searchParams.get('token') ?? '';
        if (token.length > 150) return json({message:'Invalid token'},400);
        const confirming=url.pathname==='/confirm';
        return html(messagePage(confirming?'購読の確認':'配信停止', confirming?'下のボタンで月初のイベント通知を受け取ることに同意し、購読を確定します。':'下のボタンで今後の配信を停止し、登録アドレスを削除します。', {path:url.pathname,token,label:confirming?'購読を確定':'配信を停止'}));
      }
      if (request.method==='POST' && ['/api/subscribe','/confirm','/unsubscribe'].includes(url.pathname)) {
        const form=await readForm(request);
        const oneClick=url.pathname==='/unsubscribe' && form.get('List-Unsubscribe')==='One-Click';
        if (!oneClick && request.headers.get('origin')!==env.PUBLIC_ORIGIN) return json({message:'Forbidden'},403);
        if (url.pathname==='/unsubscribe') {
          const token=oneClick ? url.searchParams.get('token') ?? '' : form.get('token') ?? '';
          const ok=await unsubscribe(env.DB,env.TOKEN_SECRET,token);
          return html(messagePage(ok?'配信を停止しました':'リンクが無効です',ok?'今後の月次メールは配信されません。':'メールに記載されたリンクを確認してください。'),ok?200:400);
        }
        // Unsubscribe remains available even when registration/sending is paused.
        if (!ready(env)) return html(messagePage('公開準備中','現在、購読受付と配信を停止しています。'),503);
        if (url.pathname==='/confirm') {
          const ok=await confirmSubscription(env.DB,form.get('token') ?? '');
          return html(messagePage(ok?'購読を開始しました':'リンクが無効か、確認済みです',ok?'次回の月初から、開催予定の大型イベントをお届けします。':'期限切れの場合はトップページから登録し直してください。'),ok?200:400);
        }
        if (!form.get('website')) {
          await cleanup(env.DB);
          await subscribe(env,form.get('email') ?? '',request.headers.get('cf-connecting-ip') ?? 'unknown',mailer(env));
        }
        return html(messagePage('メールをご確認ください','登録可能な場合、購読確認メールを送信します。迷惑メールも確認してください。既に確認済みの場合、新たなメールは送りません。'));
      }
      return json({message:'Not found'},404);
    } catch (error) {
      const code=error instanceof SmtpError ? error.code : 'request_failed';
      console.error(JSON.stringify({event:'request_error',code}));
      return html(messagePage('処理できませんでした','しばらくしてからお試しください。メールアドレスの形式も確認してください。'),500);
    }
  },
} satisfies ExportedHandler<Cloudflare.Env>;

async function readForm(request: Request): Promise<URLSearchParams> {
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) throw new Error('unsupported_form');
  return new URLSearchParams(await readLimitedText(new Response(request.body),4096));
}
function html(body: string,status=200): Response {
  return new Response(body,{status,headers:{
    'content-type':'text/html; charset=utf-8','cache-control':'no-store',
    'content-security-policy':"default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'referrer-policy':'no-referrer','x-content-type-options':'nosniff','strict-transport-security':'max-age=31536000; includeSubDomains',
    'permissions-policy':'camera=(), microphone=(), geolocation=()',
  }});
}
function json(payload:unknown,status=200):Response {
  return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
