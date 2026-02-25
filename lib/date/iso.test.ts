import { isValidIsoDate } from './iso';

describe('isValidIsoDate', () => {
  test('accepts valid ISO calendar dates', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });

  test('rejects invalid dates and malformed strings', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('26-02-10')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate(undefined)).toBe(false);
  });
});
