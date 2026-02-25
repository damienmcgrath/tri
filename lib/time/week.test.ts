import { getDublinWeekKey } from './week';

describe('Dublin week boundaries', () => {
  test('given a Monday in Dublin, then week key is that same date', () => {
    expect(getDublinWeekKey(new Date('2026-03-09T08:00:00.000Z'))).toBe('2026-03-09');
  });

  test('given Sunday night crossing DST end, then week key remains prior Monday', () => {
    expect(getDublinWeekKey(new Date('2026-10-25T23:30:00.000Z'))).toBe('2026-10-19');
  });
});
