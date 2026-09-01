import { describe, expect, test } from 'vitest';
import { decodeGroupPayload, encodeGroupPayload, joinLink } from '../../src/lib/deeplink';

describe('group deep-link payload', () => {
  test('round-trips a supergroup id', () => {
    const id = -1001234567890;
    expect(decodeGroupPayload(encodeGroupPayload(id))).toBe(id);
  });

  test('round-trips a basic group id', () => {
    expect(decodeGroupPayload(encodeGroupPayload(-987654))).toBe(-987654);
  });

  test('uses only characters Telegram allows in a start payload', () => {
    for (const id of [-1001234567890, -1, -999999999999999, -100000000000000]) {
      expect(encodeGroupPayload(id)).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  test('stays inside the 64-character payload limit', () => {
    expect(encodeGroupPayload(-1001234567890).length).toBeLessThanOrEqual(64);
  });

  test('rejects a payload that is not a group payload', () => {
    expect(decodeGroupPayload('join')).toBeNull();
    expect(decodeGroupPayload('')).toBeNull();
  });

  test('rejects corrupt or non-numeric payloads', () => {
    expect(decodeGroupPayload('g!!!!')).toBeNull();
    expect(decodeGroupPayload('g' + btoa('drop table'))).toBeNull();
  });

  test('builds a tappable link', () => {
    expect(joinLink('daily_games_bot', -100123)).toMatch(
      /^https:\/\/t\.me\/daily_games_bot\?start=g[A-Za-z0-9_-]+$/,
    );
  });
});
