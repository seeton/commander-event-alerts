import { afterEach, describe, expect, it, vi } from 'vitest';
import * as buttondown from '../src/buttondown';
import { monthInfo, runMonthly } from '../src/monthly';

const event={title:'コマンドフェスト',url:'https://example.com/event',source:'公式',dateText:'2026年10月10日',location:'東京',kind:'event' as const};
const discover=async()=>({events:[event],failures:[]});
afterEach(()=>vi.restoreAllMocks());
describe('monthly runner',()=>{
  it('uses the Japanese date at month boundaries',()=>{
    expect(monthInfo(new Date('2026-09-30T15:00:00Z'))).toEqual({key:'2026-10',label:'2026年10月',date:'2026-10-01'});
  });
  it('fails closed without contacting either service when delivery is disabled',async()=>{
    const fetcher=vi.spyOn(globalThis,'fetch');
    const discovery=vi.fn(discover);
    expect(await runMonthly({mode:'send',enabled:'false',discover:discovery})).toMatchObject({status:'disabled'});
    expect(fetcher).not.toHaveBeenCalled();expect(discovery).not.toHaveBeenCalled();
  });
  it('previews public event content without any provider access or API key',async()=>{
    const fetcher=vi.spyOn(globalThis,'fetch');
    const result=await runMonthly({mode:'preview',discover,now:new Date('2026-08-01')});
    expect(result).toMatchObject({status:'preview',eventCount:1});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires the API key before a send or read-only API check',async()=>{
    await expect(runMonthly({mode:'send',enabled:'true',discover})).rejects.toThrow('missing_api_key');
    await expect(runMonthly({mode:'check'})).rejects.toThrow('missing_api_key');
  });
  it('checks only campaign status, never creating or publishing a message',async()=>{
    const lookup=vi.spyOn(buttondown,'findMonthlyEmail').mockResolvedValue({id:'email',slug:'commander-events-2026-09',status:'sent'});
    const send=vi.spyOn(buttondown,'sendMonthlyNewsletter');
    expect(await runMonthly({mode:'check',apiKey:'test',now:new Date('2026-09-16')})).toEqual({status:'connected',month:'2026-09',emailStatus:'sent'});
    expect(lookup).toHaveBeenCalledOnce();expect(send).not.toHaveBeenCalled();
  });
  it('includes a known October event in August, September, and October but not November',async()=>{
    const send=vi.spyOn(buttondown,'sendMonthlyNewsletter').mockResolvedValue({duplicate:false});
    for(const month of ['08','09','10']) {
      expect(await runMonthly({mode:'send',enabled:'true',apiKey:'test',discover,now:new Date(`2026-${month}-01`)})).toMatchObject({status:'queued',eventCount:1});
    }
    expect(await runMonthly({mode:'send',enabled:'true',apiKey:'test',discover,now:new Date('2026-11-01')})).toMatchObject({status:'empty'});
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map(call=>call[3])).toEqual(['2026-08','2026-09','2026-10']);
  });
  it('does not send empty digests or swallow discovery failures',async()=>{
    const send=vi.spyOn(buttondown,'sendMonthlyNewsletter');
    expect(await runMonthly({mode:'send',enabled:'true',apiKey:'test',discover:async()=>({events:[],failures:[]})})).toMatchObject({status:'empty'});
    await expect(runMonthly({mode:'send',enabled:'true',apiKey:'test',discover:async()=>{throw new Error('sources unavailable');}})).rejects.toThrow('sources unavailable');
    expect(send).not.toHaveBeenCalled();
  });
});
