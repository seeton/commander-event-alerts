import { discoverAll, upcomingEvents, type DiscoveryResult } from './discovery';
import { findMonthlyEmail, monthlyMarkdown, sendMonthlyNewsletter } from './buttondown';

export type RunMode = 'preview' | 'check' | 'send';
export function monthInfo(now = new Date()): { key: string; label: string; date: string } {
  const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const key = date.slice(0,7);
  return {key, label:`${key.slice(0,4)}年${Number(key.slice(5))}月`, date};
}

export async function runMonthly(options: {
  mode: RunMode;
  enabled?: string;
  apiKey?: string;
  now?: Date;
  discover?: () => Promise<DiscoveryResult>;
}) {
  const month = monthInfo(options.now);
  // Fail closed before network calls, including in manually started workflows.
  if (options.mode === 'send' && options.enabled !== 'true') return {status:'disabled',month:month.key};
  const key = options.apiKey?.trim();
  if (options.mode !== 'preview' && !key) throw new Error('missing_api_key');
  if (options.mode === 'check') {
    const email = await findMonthlyEmail(key!,`【統率者大型大会アラート】${month.label}`,`commander-events-${month.key}`);
    // Only campaign state, never subscriber records, is read or returned.
    return {status:'connected',month:month.key,emailStatus:email?.status ?? 'not_created'};
  }
  const discovery = await (options.discover ?? discoverAll)();
  const events = upcomingEvents(discovery.events,month.date);
  if (options.mode === 'preview') return {status:'preview',month:month.key,eventCount:events.length,failures:discovery.failures,body:monthlyMarkdown(events)};
  if (!events.length) return {status:'empty',month:month.key,failures:discovery.failures};
  const result = await sendMonthlyNewsletter({apiKey:key!},events,month.label,month.key);
  return {status:result.duplicate?'already_queued':'queued',month:month.key,eventCount:events.length,failures:discovery.failures};
}
