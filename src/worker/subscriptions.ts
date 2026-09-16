import { randomToken, sha256Hex, signToken, verifyUnsubscribeToken } from './security';
import { validEmail, type SendMail } from './smtp';

export async function takeQuota(db: D1Database, key: string, limit: number, expires: number): Promise<boolean> {
  const row = await db.prepare(`INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count`).bind(key, expires, limit).first();
  return row !== null;
}

export async function subscribe(env: Cloudflare.Env, address: string, ip: string, send: SendMail, now = Date.now()): Promise<void> {
  const email = address.trim().toLowerCase();
  if (!validEmail(email)) throw new Error('invalid_email');
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / 86_400_000);
  const ipKey = await signToken(env.TOKEN_SECRET, 'rate-ip', `${day}:${ip}`);
  if (!(await takeQuota(env.DB, `ip:${hour}:${ipKey}`, 5, now + 86_400_000))) return;
  const emailKey = await signToken(env.TOKEN_SECRET, 'rate-email', email);
  if (!(await takeQuota(env.DB, `email:${hour}:${emailKey}`, 1, now + 86_400_000))) return;
  const existing = await env.DB.prepare('SELECT status FROM subscribers WHERE email=?').bind(email).first<{status: string}>();
  if (existing?.status === 'active' || existing?.status === 'bounced') return;
  if (!(await takeQuota(env.DB, `confirm:${day}`, 50, now + 172_800_000))) return;
  const token = randomToken();
  const hash = await sha256Hex(token);
  const id = crypto.randomUUID();
  const subscriber = await env.DB.prepare(`INSERT INTO subscribers(id,email,status,confirmation_hash,confirmation_expires,confirmation_requested,created_at)
    SELECT ?,?,'pending',?,?,?,? WHERE (SELECT COUNT(*) FROM subscribers WHERE email IS NOT NULL) < 300
    ON CONFLICT(email) DO UPDATE SET confirmation_hash=excluded.confirmation_hash,
    confirmation_expires=excluded.confirmation_expires,confirmation_requested=excluded.confirmation_requested
    WHERE subscribers.status='pending' AND subscribers.confirmation_requested < ? RETURNING id`)
    .bind(id,email,hash,now+86_400_000,now,now,now-3_600_000).first<{id: string}>();
  if (!subscriber) return;
  const link = `${env.PUBLIC_ORIGIN}/confirm?token=${token}`;
  await send({ to: email, subject: `【${env.APP_NAME}】購読の確認`, messageId: `confirm-${crypto.randomUUID()}`,
    text: `統率者の大型イベントを毎月1日に受け取るには、次のページで「購読を確定」を押してください。\n\n${link}\n\n有効期限は24時間です。\n心当たりがない場合は無視してください。確認しない限り配信されません。\n\n${env.APP_NAME}\n${env.PUBLIC_ORIGIN}` });
}

export async function confirmSubscription(db: D1Database, token: string, now = Date.now()): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/u.test(token)) return false;
  const result = await db.prepare(`UPDATE subscribers SET status='active',confirmed_at=?,confirmation_hash=NULL,confirmation_expires=NULL
    WHERE confirmation_hash=? AND confirmation_expires>=? AND status='pending'`).bind(now, await sha256Hex(token), now).run();
  return result.meta.changes === 1;
}

export async function unsubscribe(db: D1Database, secret: string, token: string): Promise<boolean> {
  const id = await verifyUnsubscribeToken(secret, token);
  if (!id) return false;
  await db.batch([
    db.prepare(`UPDATE subscribers SET status='unsubscribed',email=NULL,confirmation_hash=NULL,confirmation_expires=NULL WHERE id=?`).bind(id),
    db.prepare(`UPDATE deliveries SET status='cancelled' WHERE subscriber_id=? AND status='pending'`).bind(id),
  ]);
  return true;
}

export async function cleanup(db: D1Database, now = Date.now()): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(now),
    db.prepare(`DELETE FROM subscribers WHERE status='pending' AND confirmation_expires<?`).bind(now-86_400_000),
  ]);
}
