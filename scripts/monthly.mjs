// No subscriber addresses or SMTP credentials enter the public Actions job.
import { setTimeout as sleep } from 'node:timers/promises';
const origin=process.env.ALERTS_ORIGIN;
const token=process.env.ALERTS_ADMIN_TOKEN;
if (!origin?.startsWith('https://') || !token) throw new Error('Missing delivery configuration');
async function request(path) {
  const response=await fetch(new URL(path,origin),{method:'POST',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(120_000)});
  if (!response.ok) throw new Error(`Delivery endpoint HTTP ${response.status}`);
  return response.json();
}
const prepared=await request('/api/admin/prepare');
if (prepared.status==='empty') { console.log('No upcoming confirmed events. No mail sent.'); process.exit(0); }
if (prepared.status!=='prepared' || !/^20\d{2}-\d{2}$/.test(prepared.month)) throw new Error('Unexpected campaign response');
let sent=0;
for (let index=0; index<220; index++) {
  const result=await request(`/api/admin/send-next?month=${prepared.month}`);
  if (result.status==='complete') { console.log(`Monthly delivery complete. Accepted in this run: ${sent}.`); process.exit(0); }
  if (result.status==='sent') sent++;
  else if (result.status!=='cancelled') throw new Error('Delivery stopped; review private delivery status before retrying.');
  await sleep(1500);
}
throw new Error('Safety limit reached; review delivery status.');
