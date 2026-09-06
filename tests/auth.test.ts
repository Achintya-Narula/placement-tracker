import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, signToken, verifyPassword, verifyToken } from '../src/domain/auth.ts';

test('hashes passwords with a unique salt and verifies the original password', async () => {
  const first = await hashPassword('correct horse battery staple');
  const second = await hashPassword('correct horse battery staple');

  assert.notEqual(first, second);
  assert.equal(first.startsWith('scrypt$'), true);
  assert.equal(await verifyPassword('correct horse battery staple', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
});

test('signs and verifies an expiring JWT', () => {
  const now = new Date('2026-09-06T10:00:00.000Z');
  const token = signToken(
    { sub: 'user-1', email: 'student@example.com' },
    'test-secret-long-enough',
    now,
    3600,
  );

  assert.deepEqual(verifyToken(token, 'test-secret-long-enough', new Date('2026-09-06T10:30:00.000Z')), {
    sub: 'user-1',
    email: 'student@example.com',
    iat: 1788688800,
    exp: 1788692400,
  });
});

test('rejects tampered and expired JWTs', () => {
  const now = new Date('2026-09-06T10:00:00.000Z');
  const token = signToken({ sub: 'user-1', email: 'student@example.com' }, 'secret', now, 60);
  const [header, payload, signature] = token.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'attacker', email: 'student@example.com', iat: 1, exp: 9_999_999_999 }))
    .toString('base64url');

  assert.throws(() => verifyToken(`${header}.${tamperedPayload}.${signature}`, 'secret', now), /Token signature is invalid/);
  assert.throws(() => verifyToken(token, 'secret', new Date('2026-09-06T10:01:01.000Z')), /Token has expired/);
});
