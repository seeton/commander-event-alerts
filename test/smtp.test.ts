import { describe, expect, it } from 'vitest';
import { sendSmtp, encodeMessage, validEmail, SmtpError, type OpenSocket } from '../src/worker/smtp';

const config={host:'smtp.example.com',user:'sender@example.com',password:'example-secret',from:'sender@example.com',name:'統率者通知'};
const mail={to:'reader@example.com',subject:'開催予定のお知らせ',text:'テスト\n.\n本文',messageId:'test-1',unsubscribeUrl:'https://example.com/unsubscribe?token=test'};
function fakeServer(finalReply='250 accepted\r\n') {
  const writes:string[]=[];
  let controller:ReadableStreamDefaultController<Uint8Array>;
  let closed=false;
  const enqueue=(text:string)=>controller.enqueue(new TextEncoder().encode(text));
  const readable=new ReadableStream<Uint8Array>({start(c){controller=c;enqueue('220 SMTP\r\n');}});
  let auth=0;
  let data=false;
  const writable=new WritableStream<Uint8Array>({write(bytes){
    const text=new TextDecoder().decode(bytes);writes.push(text);
    if (data) {if(finalReply) enqueue(finalReply);else {controller.close();closed=true;} return;}
    if(text.startsWith('EHLO')) enqueue('250-server\r\n250 AUTH LOGIN\r\n');
    else if(text.startsWith('AUTH')){auth=1;enqueue('334 Username\r\n');}
    else if(auth===1){auth=2;enqueue('334 Password\r\n');}
    else if(auth===2){auth=0;enqueue('235 authenticated\r\n');}
    else if(text.startsWith('DATA')){data=true;enqueue('354 go\r\n');}
    else enqueue('250 accepted\r\n');
  }});
  const open:OpenSocket=()=>({readable,writable,opened:Promise.resolve({}),closed:Promise.resolve(),async close(){if(!closed){closed=true;controller.close();}}});
  return {open,writes};
}
describe('individual SMTPS delivery',()=>{
  it('sends exactly one envelope recipient and no Bcc/Cc headers',async()=>{
    const server=fakeServer();await sendSmtp(config,mail,server.open);
    expect(server.writes.filter(x=>x.startsWith('RCPT TO'))).toEqual(['RCPT TO:<reader@example.com>\r\n']);
    const body=server.writes.at(-1)!;
    expect(body).toContain('To: <reader@example.com>');
    expect(body).not.toMatch(/\r\n(?:Bcc|Cc):/u);
    expect(body).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    expect(body).toContain('multipart/alternative');
  });
  it('marks a lost final acknowledgement uncertain',async()=>{
    const server=fakeServer('');
    await expect(sendSmtp(config,mail,server.open)).rejects.toMatchObject({uncertain:true});
  });
  it('does not leak server errors containing recipient details',async()=>{
    const server=fakeServer('550 reader@example.com rejected\r\n');
    await expect(sendSmtp(config,mail,server.open)).rejects.toEqual(new SmtpError('smtp_550',false));
  });
  it('rejects header/envelope injection',()=>{
    expect(validEmail('a@example.com\r\nRCPT TO:<b@example.com>')).toBe(false);
    expect(()=>encodeMessage(config,{...mail,to:'a@example.com,b@example.com'})).toThrow('invalid_address');
    expect(()=>encodeMessage(config,{...mail,messageId:'bad\r\nBcc:x'})).toThrow('invalid_address');
  });
});
