import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export interface TokenClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must contain at least 8 characters');
  }
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltText, hashText] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, 'base64url');
    const actual = (await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signature(unsigned: string, secret: string): string {
  return createHmac('sha256', secret).update(unsigned).digest('base64url');
}

export function signToken(
  claims: Pick<TokenClaims, 'sub' | 'email'>,
  secret: string,
  now = new Date(),
  ttlSeconds = 3600,
): string {
  if (!claims.sub || !claims.email) throw new Error('Token subject and email are required');
  if (!secret) throw new Error('Token secret is required');
  const iat = Math.floor(now.getTime() / 1000);
  const payload: TokenClaims = { ...claims, iat, exp: iat + ttlSeconds };
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  return `${unsigned}.${signature(unsigned, secret)}`;
}

export function verifyToken(token: string, secret: string, now = new Date()): TokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token is malformed');
  const [headerText, payloadText, suppliedSignature] = parts;
  const unsigned = `${headerText}.${payloadText}`;
  const expected = Buffer.from(signature(unsigned, secret));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error('Token signature is invalid');
  }

  let header: { alg?: unknown };
  let payload: Partial<TokenClaims>;
  try {
    header = JSON.parse(Buffer.from(headerText, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Token is malformed');
  }
  if (header.alg !== 'HS256') throw new Error('Token algorithm is invalid');
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number'
  ) {
    throw new Error('Token claims are invalid');
  }
  if (payload.exp <= Math.floor(now.getTime() / 1000)) throw new Error('Token has expired');
  return payload as TokenClaims;
}
