/** A deliberately small SMTPS client: one authenticated recipient per connection.
 * Server replies are never put in errors/logs (they can contain addresses).
 */
export interface Mail { to: string; subject: string; text: string; unsubscribeUrl?: string; messageId: string }
export interface SmtpConfig { host: string; user: string; password: string; from: string; name: string }
export interface MailSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  closed: Promise<void>;
  close(): Promise<void>;
}
export type OpenSocket = (host: string) => MailSocket;
export type SendMail = (mail: Mail) => Promise<void>;

export class SmtpError extends Error {
  constructor(readonly code: string, readonly uncertain = false) { super(code); }
}

export function validEmail(value: string): boolean {
  // SMTPUTF8/quoted local parts are intentionally not supported.
  const parts = value.split('@');
  return value.length <= 254 && parts.length === 2 && (parts[0]?.length ?? 0) <= 64 &&
    /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/u.test(value) &&
    !parts[1]!.includes('..');
}

export async function sendSmtp(config: SmtpConfig, mail: Mail, open: OpenSocket): Promise<void> {
  const message = encodeMessage(config, mail);
  if (!config.password || /[\r\n\0]/u.test(config.user + config.password)) throw new SmtpError('invalid_configuration');
  const socket = open(config.host);
  // Mark the closed promise handled even if the handshake fails first.
  void socket.closed.catch(() => undefined);
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataStarted = false;
  let rejected = false;
  const timer = setTimeout(() => { void socket.close().catch(() => undefined); }, 18_000);
  async function reply(expected: number[]): Promise<void> {
    let total = 0;
    let responseCode: number | undefined;
    for (;;) {
      let end = buffer.indexOf('\r\n');
      while (end < 0) {
        const part = await reader.read();
        if (part.done) throw new SmtpError('connection_closed', dataStarted);
        buffer += decoder.decode(part.value, { stream: true });
        total += part.value.length;
        if (total > 16_384) throw new SmtpError('reply_too_large', dataStarted);
        end = buffer.indexOf('\r\n');
      }
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const match = /^(\d{3})([ -])/u.exec(line);
      if (!match) throw new SmtpError('invalid_reply', dataStarted);
      const code = Number(match[1]);
      if (responseCode !== undefined && responseCode !== code) throw new SmtpError('invalid_reply', dataStarted);
      responseCode = code;
      if (match[2] === '-') continue;
      if (!expected.includes(code)) {
        rejected = code >= 400 && code < 600;
        throw new SmtpError(`smtp_${code}`, dataStarted && !rejected);
      }
      return;
    }
  }
  async function command(value: string, expected: number[]): Promise<void> {
    await writer.write(new TextEncoder().encode(value + '\r\n'));
    await reply(expected);
  }
  try {
    await socket.opened;
    await reply([220]);
    await command(`EHLO ${config.from.split('@')[1]}`, [250]);
    await command('AUTH LOGIN', [334]);
    await command(base64(config.user), [334]);
    await command(base64(config.password), [235]);
    await command(`MAIL FROM:<${config.from}>`, [250]);
    await command(`RCPT TO:<${mail.to}>`, [250, 251]);
    await command('DATA', [354]);
    dataStarted = true;
    await writer.write(new TextEncoder().encode(message + '\r\n.\r\n'));
    await reply([250]);
    // A 250 after DATA is acceptance. A subsequent QUIT failure must not retry.
  } catch (error) {
    if (error instanceof SmtpError) throw error;
    throw new SmtpError('transport_error', dataStarted && !rejected);
  } finally {
    clearTimeout(timer);
    await socket.close().catch(() => undefined);
    reader.releaseLock();
    writer.releaseLock();
  }
}

export function encodeMessage(config: Pick<SmtpConfig, 'from' | 'name'>, mail: Mail): string {
  if (!validEmail(config.from) || !validEmail(mail.to) || !/^[a-zA-Z0-9._-]{1,150}$/u.test(mail.messageId)) {
    throw new SmtpError('invalid_address');
  }
  if (mail.text.length > 100_000 || mail.subject.length > 500 || config.name.length > 100) throw new SmtpError('message_too_large');
  const headers = [
    `From: ${encodedWords(config.name)} <${config.from}>`, `To: <${mail.to}>`,
    `Subject: ${encodedWords(mail.subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${mail.messageId}@${config.from.split('@')[1]}>`,
    'MIME-Version: 1.0',
  ];
  if (mail.unsubscribeUrl) {
    const url = new URL(mail.unsubscribeUrl);
    if (url.protocol !== 'https:' || /[\r\n<>]/u.test(mail.unsubscribeUrl)) throw new SmtpError('invalid_unsubscribe_url');
    headers.push(`List-Unsubscribe: <${mail.unsubscribeUrl}>`, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  }
  const boundary = 'commander-' + mail.messageId;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const text = mail.text.replace(/\r?\n/gu, '\r\n');
  const html = '<!doctype html><html lang="ja"><meta charset="utf-8"><body><pre style="white-space:pre-wrap;font-family:sans-serif">' +
    mail.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') + '</pre></body></html>';
  const part = (type: string, body: string) => `--${boundary}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(body).match(/.{1,76}/gu)?.join('\r\n') ?? ''}`;
  return `${headers.join('\r\n')}\r\n\r\n${part('text/plain', text)}\r\n${part('text/html', html)}\r\n--${boundary}--`;
}

function base64(value: string): string {
  return btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(''));
}
function encodedWords(value: string): string {
  // Split on code points so each RFC 2047 word stays below 75 bytes.
  return Array.from(value).reduce<string[]>((parts, character, index) => {
    if (index % 10 === 0) parts.push('');
    parts[parts.length - 1] += character;
    return parts;
  }, []).map(part => `=?UTF-8?B?${base64(part)}?=`).join('\r\n ');
}
