import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { verifyInitData } from '../../src/lib/initdata';

const TOKEN = '123456789:AAEhBOweik6ad9r_QwertyuiopASDFGHJKLzxc';

/**
 * Signs with Node's crypto, verifies with Web Crypto — so the test is a real
 * cross-implementation check, not the implementation agreeing with itself.
 */
function sign(fields: Record<string, string>, token = TOKEN): string {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const NOW = new Date('2026-09-05T12:00:00Z');
const authDate = String(Math.floor(NOW.getTime() / 1000));
const user = JSON.stringify({ id: 42, first_name: 'Alice', username: 'alice' });

describe('verifyInitData', () => {
  test('accepts a correctly signed payload', async () => {
    const initData = sign({ auth_date: authDate, query_id: 'AAA', user });
    const result = await verifyInitData(initData, TOKEN, { now: NOW });
    expect(result?.user.id).toBe(42);
    expect(result?.user.first_name).toBe('Alice');
  });

  test('includes `signature` in the check string', async () => {
    // Live Mini App launches carry `signature`, and Telegram hashes over it.
    // Excluding it made every real launch fail with bad-hash.
    const initData = sign({ auth_date: authDate, user, signature: 'abc123def456' });
    expect(await verifyInitData(initData, TOKEN, { now: NOW })).not.toBeNull();
  });

  test('rejects a payload where `signature` was tampered with', async () => {
    const initData = sign({ auth_date: authDate, user, signature: 'abc123def456' });
    expect(
      await verifyInitData(initData.replace('abc123def456', 'deadbeef'), TOKEN, { now: NOW }),
    ).toBeNull();
  });

  test('still verifies a payload with no signature at all', async () => {
    const initData = sign({ auth_date: authDate, user });
    expect(await verifyInitData(initData, TOKEN, { now: NOW })).not.toBeNull();
  });

  test('reports whether the signature-excluded variant would have matched', async () => {
    const { verifyInitDataDetailed } = await import('../../src/lib/initdata');
    // Signed WITHOUT signature, then signature appended: the old buggy shape.
    const legacy = `${sign({ auth_date: authDate, user })}&signature=abc123def456`;
    const result = await verifyInitDataDetailed(legacy, TOKEN, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('bad-hash');
      expect(result.legacyWouldMatch).toBe(true);
    }
  });

  test('rejects a tampered field', async () => {
    const initData = sign({ auth_date: authDate, user });
    const tampered = initData.replace('Alice', 'Mallory');
    expect(await verifyInitData(tampered, TOKEN, { now: NOW })).toBeNull();
  });

  test('rejects a payload signed with a different bot token', async () => {
    const initData = sign({ auth_date: authDate, user }, '987654321:OTHERTOKENOTHERTOKENOTHERTOKEN');
    expect(await verifyInitData(initData, TOKEN, { now: NOW })).toBeNull();
  });

  test('rejects a missing or empty hash', async () => {
    expect(await verifyInitData(`auth_date=${authDate}&user=${encodeURIComponent(user)}`, TOKEN, { now: NOW })).toBeNull();
    expect(await verifyInitData('', TOKEN, { now: NOW })).toBeNull();
  });

  test('rejects data older than 24 hours', async () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 24 * 60 * 60 - 1);
    const initData = sign({ auth_date: old, user });
    expect(await verifyInitData(initData, TOKEN, { now: NOW })).toBeNull();
  });

  test('accepts data just inside the window', async () => {
    const recent = String(Math.floor(NOW.getTime() / 1000) - 24 * 60 * 60 + 60);
    const initData = sign({ auth_date: recent, user });
    expect(await verifyInitData(initData, TOKEN, { now: NOW })).not.toBeNull();
  });

  test('rejects a valid signature with no user', async () => {
    const initData = sign({ auth_date: authDate, query_id: 'AAA' });
    expect(await verifyInitData(initData, TOKEN, { now: NOW })).toBeNull();
  });

  test('rejects a valid signature whose user is not a user', async () => {
    const initData = sign({ auth_date: authDate, user: '{"first_name":"Alice"}' });
    expect(await verifyInitData(initData, TOKEN, { now: NOW })).toBeNull();
  });

  test('rejects a missing auth_date even when the signature is valid', async () => {
    const initData = sign({ user });
    expect(await verifyInitData(initData, TOKEN, { now: NOW })).toBeNull();
  });

  test('handles values containing newlines and equals signs', async () => {
    const odd = JSON.stringify({ id: 7, first_name: 'A=B\nC' });
    const initData = sign({ auth_date: authDate, user: odd });
    expect((await verifyInitData(initData, TOKEN, { now: NOW }))?.user.id).toBe(7);
  });
});
