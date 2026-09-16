export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash[index]! ^ rightHash[index]!;
  }
  return difference === 0;
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

export function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function signToken(secret: string, purpose: string, value: string): Promise<string> {
  if (secret.length < 32) throw new Error('Token secret is not configured');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${purpose}:${value}`)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function unsubscribeToken(secret: string, id: string): Promise<string> {
  return `${id}.${await signToken(secret, 'unsubscribe', id)}`;
}

export async function verifyUnsubscribeToken(secret: string, token: string): Promise<string | null> {
  const match = /^([a-f0-9-]{36})\.([a-f0-9]{64})$/u.exec(token);
  if (!match) return null;
  return await constantTimeEqual(match[2]!, await signToken(secret, 'unsubscribe', match[1]!)) ? match[1]! : null;
}
