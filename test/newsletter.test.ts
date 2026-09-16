import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribe, confirmSubscription, unsubscribe } from '../src/worker/subscriptions';
import { unsubscribeToken, verifyUnsubscribeToken } from '../src/worker/security';
import { prepareCampaign, sendNext, campaignStatus, jstMonthKey } from '../src/worker/newsletter';
import { SmtpError, type Mail } from '../src/worker/smtp';

let mf:Miniflare;
let env:Cloudflare.Env;
const now=new Date('2026-10-01T00:15:00Z').getTime();
const events=[{title:'コマンドフェスト',url:'https://example.com/event',dateText:'2026年10月10日',location:'東京',source:'公式',kind:'event' as const}];
const noSend=vi.fn<(mail:Mail)=>Promise<void>>().mockResolvedValue(undefined);
beforeAll(async()=>{
  mf=new Miniflare(convertV4MiniflareOptions({name:'test',modules:true,scriptPath:'.wrangler/test-build/index.js',compatibilityDate:'2026-09-16',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_NAME:'統率者大型大会アラート',SERVICE_ENABLED:'true',PUBLIC_ORIGIN:'https://commander-event-alerts.asaiwing1104.workers.dev',SMTP_HOST:'s323.xrea.com',SMTP_USER:'info@setn.shop',SMTP_FROM:'info@setn.shop',SMTP_PASSWORD:'test-only',TOKEN_SECRET:'a'.repeat(64),ADMIN_TOKEN:'test-admin'}}));
  const db=await mf.getD1Database('DB');
  await db.exec((await readFile(new URL('../migrations/0001_subscriptions.sql',import.meta.url),'utf8')).replaceAll('\n',' '));
  env={DB:db,APP_NAME:'統率者大型大会アラート',SERVICE_ENABLED:'false',PUBLIC_ORIGIN:'https://commander-event-alerts.asaiwing1104.workers.dev',SMTP_HOST:'s323.xrea.com',SMTP_USER:'info@setn.shop',SMTP_FROM:'info@setn.shop',SMTP_PASSWORD:'test-only',TOKEN_SECRET:'a'.repeat(64),ADMIN_TOKEN:'test-admin'};
});
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{
  noSend.mockClear();
  await env.DB.batch(['DELETE FROM deliveries','DELETE FROM campaigns','DELETE FROM subscribers','DELETE FROM rate_limits'].map(sql=>env.DB.prepare(sql)));
});
async function active(email:string) {
  const id=crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO subscribers(id,email,status,confirmation_requested,created_at,confirmed_at) VALUES(?,?,'active',?,?,?)`).bind(id,email,now,now,now).run();
  return id;
}
describe('confirmed subscriptions and private unsubscribe',()=>{
  it('requires a valid, unexpired confirmation and stores only its hash',async()=>{
    await subscribe(env,'reader@example.com','test-ip',noSend,now);
    const content=noSend.mock.calls[0]![0].text;
    const token=/confirm\?token=([a-f0-9]{64})/u.exec(content)![1]!;
    const row=await env.DB.prepare('SELECT * FROM subscribers').first();
    expect(row?.status).toBe('pending');expect(row?.confirmation_hash).not.toBe(token);
    expect(await confirmSubscription(env.DB,'0'.repeat(64),now)).toBe(false);
    expect(await confirmSubscription(env.DB,token,now+1000)).toBe(true);
    expect(await confirmSubscription(env.DB,token,now+2000)).toBe(false);
  });
  it('does not resend confirmations to active addresses or repeatedly requested addresses',async()=>{
    await active('active@example.com');
    await subscribe(env,'active@example.com','test-ip',noSend,now);
    await subscribe(env,'pending@example.com','test-ip',noSend,now);
    await subscribe(env,'pending@example.com','test-ip',noSend,now+1000);
    expect(noSend).toHaveBeenCalledTimes(1);
  });
  it('rejects expired confirmation tokens',async()=>{
    await subscribe(env,'reader@example.com','test-ip',noSend,now);
    const token=/confirm\?token=([a-f0-9]{64})/u.exec(noSend.mock.calls[0]![0].text)![1]!;
    expect(await confirmSubscription(env.DB,token,now+86_400_001)).toBe(false);
  });
  it('rejects tampered/purpose-swapped tokens and deletes the address on unsubscribe',async()=>{
    const id=await active('reader@example.com');
    await prepareCampaign(env,events,new Date(now));
    const token=await unsubscribeToken(env.TOKEN_SECRET,id);
    expect(await verifyUnsubscribeToken(env.TOKEN_SECRET,token+'x')).toBeNull();
    expect(await unsubscribe(env.DB,env.TOKEN_SECRET,token)).toBe(true);
    expect((await env.DB.prepare('SELECT email FROM subscribers WHERE id=?').bind(id).first())?.email).toBeNull();
    expect(await sendNext(env,'2026-10',noSend,now)).toEqual({status:'complete'});
    expect(noSend).not.toHaveBeenCalled();
  });
});
describe('monthly campaign idempotency',()=>{
  it('uses the Japanese calendar at a month boundary',()=>{
    expect(jstMonthKey(new Date('2026-09-30T15:00:00Z'))).toBe('2026-10');
  });
  it('snapshots once, sends individually, and includes the same event again next month',async()=>{
    await active('first@example.com');await active('second@example.com');
    await prepareCampaign(env,events,new Date('2026-08-01T00:15:00Z'));
    await sendNext(env,'2026-08',noSend,now);await sendNext(env,'2026-08',noSend,now);
    expect(await sendNext(env,'2026-08',noSend,now)).toEqual({status:'complete'});
    await prepareCampaign(env,events,new Date('2026-08-01T00:15:00Z'));
    expect((await campaignStatus(env.DB,'2026-08')).sent).toBe(2);
    expect(await sendNext(env,'2026-08',noSend,now)).toEqual({status:'complete'});
    await prepareCampaign(env,events,new Date('2026-09-01T00:15:00Z'));
    await sendNext(env,'2026-09',noSend,now);
    expect(noSend).toHaveBeenCalledTimes(3);
    expect(noSend.mock.calls[0]![0].unsubscribeUrl).not.toBe(noSend.mock.calls[1]![0].unsubscribeUrl);
    expect(noSend.mock.calls[2]![0].text).toContain('2026年10月10日');
  });
  it('does not add late subscribers to an already snapshotted month',async()=>{
    await active('first@example.com');await prepareCampaign(env,events,new Date(now));
    await active('late@example.com');await prepareCampaign(env,events,new Date(now));
    expect((await campaignStatus(env.DB,'2026-10')).pending).toBe(1);
  });
  it('serializes concurrent sends',async()=>{
    await active('first@example.com');await active('second@example.com');await prepareCampaign(env,events,new Date(now));
    let release:()=>void=()=>{};
    const held=vi.fn(async()=>new Promise<void>(resolve=>{release=resolve;}));
    const first=sendNext(env,'2026-10',held,now);
    await vi.waitFor(()=>expect(held).toHaveBeenCalledTimes(1));
    expect(await sendNext(env,'2026-10',noSend,now)).toEqual({status:'busy'});
    release();await first;
    expect(noSend).not.toHaveBeenCalled();
  });
  it('holds ambiguous delivery for manual review instead of retrying',async()=>{
    await active('reader@example.com');await prepareCampaign(env,events,new Date(now));
    const uncertain=vi.fn().mockRejectedValue(new SmtpError('connection_closed',true));
    expect((await sendNext(env,'2026-10',uncertain,now)).status).toBe('needs_review');
    expect(await sendNext(env,'2026-10',noSend,now)).toEqual({status:'needs_review'});
    expect(noSend).not.toHaveBeenCalled();expect((await campaignStatus(env.DB,'2026-10')).unknown).toBe(1);
  });
});

describe('real Workers HTTP handlers',()=>{
  const origin='https://commander-event-alerts.asaiwing1104.workers.dev';
  it('does not expose subscriber information through unauthenticated admin APIs',async()=>{
    const response=await mf.dispatchFetch(`${origin}/api/admin/status`);
    expect(response.status).toBe(401);
  });
  it('protects the operator test and disables it without an explicitly configured recipient',async()=>{
    expect((await mf.dispatchFetch(`${origin}/api/admin/test-mail`,{method:'POST'})).status).toBe(401);
    const response=await mf.dispatchFetch(`${origin}/api/admin/test-mail`,{method:'POST',headers:{authorization:'Bearer test-admin'}});
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({status:'test_disabled'});
  });
  it('rejects cross-site subscription requests before any SMTP send',async()=>{
    const response=await mf.dispatchFetch(`${origin}/api/subscribe`,{method:'POST',headers:{origin:'https://evil.example','content-type':'application/x-www-form-urlencoded'},body:'email=reader%40example.com'});
    expect(response.status).toBe(403);
  });
  it('does not confirm a subscription just by visiting a link',async()=>{
    await subscribe(env,'reader@example.com','test-ip',noSend,now);
    const token=/confirm\?token=([a-f0-9]{64})/u.exec(noSend.mock.calls[0]![0].text)![1]!;
    const response=await mf.dispatchFetch(`${origin}/confirm?token=${token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await env.DB.prepare('SELECT status FROM subscribers').first())?.status).toBe('pending');
  });
  it('keeps scanner GETs read-only but accepts token-authenticated one-click POSTs',async()=>{
    const id=await active('reader@example.com');
    const token=await unsubscribeToken(env.TOKEN_SECRET,id);
    const url=`${origin}/unsubscribe?token=${token}`;
    expect((await mf.dispatchFetch(url)).status).toBe(200);
    expect((await env.DB.prepare('SELECT status FROM subscribers').first())?.status).toBe('active');
    const response=await mf.dispatchFetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'});
    expect(response.status).toBe(200);
    expect((await env.DB.prepare('SELECT email FROM subscribers').first())?.email).toBeNull();
  });
  it('escapes tokens in confirmation forms',async()=>{
    const response=await mf.dispatchFetch(`${origin}/confirm?token=${encodeURIComponent('\"><script>evil()</script>')}`);
    expect(await response.text()).not.toContain('<script>evil()');
  });
});
