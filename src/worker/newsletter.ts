import type { EventInfo } from './discovery';
import { unsubscribeToken } from './security';
import { SmtpError, type SendMail } from './smtp';

export function jstMonthKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find(p=>p.type==='year')!.value}-${parts.find(p=>p.type==='month')!.value}`;
}

export function digestText(events: EventInfo[]): string {
  return ['今後開催予定の大規模な統率者イベントです。', '開催前のイベントを、月初に毎回お知らせします。', '',
    ...events.flatMap(event => [event.title, `開催日: ${event.dateText}`, ...(event.location ? [`会場: ${event.location}`] : []), `情報元: ${event.source}`, event.url, '']),
    '非公式の通知サービスです。日程・会場・申込方法はリンク先の公式情報で確認してください。'].join('\n');
}

export async function prepareCampaign(env: Cloudflare.Env, events: EventInfo[], now = new Date()): Promise<{month: string; status: string}> {
  const month = jstMonthKey(now);
  if (events.length === 0) return { month, status: 'empty' };
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM subscribers WHERE status='active'`).first<{n:number}>();
  if ((count?.n ?? 0) > 200) throw new Error('audience_requires_review');
  // Snapshot both the content and the confirmed audience exactly once per month.
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO campaigns(month,subject,body,created_at) VALUES(?,?,?,?)')
      .bind(month, `【${env.APP_NAME}】${month}・開催予定${events.length}件`, digestText(events), now.getTime()),
    env.DB.prepare(`INSERT OR IGNORE INTO deliveries(month,subscriber_id)
      SELECT ?,id FROM subscribers WHERE status='active' AND changes()=1`).bind(month),
  ]);
  return { month, status: 'prepared' };
}

export async function campaignStatus(db: D1Database, month: string): Promise<Record<string, number>> {
  const result = await db.prepare('SELECT status,COUNT(*) AS n FROM deliveries WHERE month=? GROUP BY status').bind(month).all<{status:string;n:number}>();
  return Object.fromEntries(result.results.map(row=>[row.status,row.n]));
}

export async function sendNext(env: Cloudflare.Env, month: string, send: SendMail, now = Date.now()): Promise<{status:string; code?: string}> {
  // SMTP cannot provide exactly-once delivery. Stale/ambiguous attempts require
  // manual reconciliation; never automatically put them back into pending.
  await env.DB.prepare(`UPDATE deliveries SET status='unknown',error_code='interrupted' WHERE month=? AND status='sending' AND attempted_at<?`).bind(month,now-120_000).run();
  const state = await campaignStatus(env.DB,month);
  if (state.unknown || state.failed) return {status:'needs_review'};
  if (state.sending) return {status:'busy'};
  const job = await env.DB.prepare(`UPDATE deliveries SET status='sending',attempted_at=?
    WHERE month=? AND subscriber_id=(SELECT subscriber_id FROM deliveries WHERE month=? AND status='pending' ORDER BY subscriber_id LIMIT 1)
    AND status='pending' AND NOT EXISTS(SELECT 1 FROM deliveries WHERE month=? AND status IN ('sending','failed','unknown'))
    RETURNING subscriber_id`).bind(now,month,month,month).first<{subscriber_id:string}>();
  if (!job) {
    const current = await campaignStatus(env.DB,month);
    return {status:current.unknown || current.failed ? 'needs_review' : current.sending ? 'busy' : 'complete'};
  }
  const id = job.subscriber_id;
  const subscriber = await env.DB.prepare(`SELECT email,status FROM subscribers WHERE id=?`).bind(id).first<{email:string|null;status:string}>();
  if (!subscriber?.email || subscriber.status !== 'active') {
    await env.DB.prepare(`UPDATE deliveries SET status='cancelled',finished_at=? WHERE month=? AND subscriber_id=?`).bind(now,month,id).run();
    return {status:'cancelled'};
  }
  const campaign = await env.DB.prepare('SELECT subject,body FROM campaigns WHERE month=?').bind(month).first<{subject:string;body:string}>();
  if (!campaign) throw new Error('missing_campaign');
  const link = `${env.PUBLIC_ORIGIN}/unsubscribe?token=${await unsubscribeToken(env.TOKEN_SECRET,id)}`;
  try {
    await send({to:subscriber.email,subject:campaign.subject,text:`${campaign.body}\n\n配信停止（いつでも解除できます）:\n${link}\n\n${env.APP_NAME}\n${env.PUBLIC_ORIGIN}`,unsubscribeUrl:link,messageId:`digest-${month}-${id}`});
    await env.DB.prepare(`UPDATE deliveries SET status='sent',finished_at=? WHERE month=? AND subscriber_id=?`).bind(Date.now(),month,id).run();
    return {status:'sent'};
  } catch (error) {
    const uncertain = !(error instanceof SmtpError) || error.uncertain;
    const code = error instanceof SmtpError ? error.code : 'uncertain_delivery';
    await env.DB.prepare(`UPDATE deliveries SET status=?,finished_at=?,error_code=? WHERE month=? AND subscriber_id=?`)
      .bind(uncertain?'unknown':'failed',Date.now(),code,month,id).run();
    return {status:'needs_review',code};
  }
}
