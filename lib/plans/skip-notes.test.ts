import { appendConfirmedSkipTag, appendSkipTag, clearSkipTag, hasConfirmedSkipTag, syncSkipTagForStatus } from './skip-notes';

describe('skip note tag helpers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-25T00:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('given plain notes, when skip status is applied, then a single skip tag is appended', () => {
    const tagged = appendSkipTag('Long ride', new Date());

    expect(tagged).toBe('Long ride\n[Skipped 2026-10-25]');
  });

  test('given existing skip tag, then no duplicate skip tag is appended', () => {
    const tagged = appendSkipTag('Long ride\n[Skipped 2026-10-25]', new Date());

    expect(tagged).toBe('Long ride\n[Skipped 2026-10-25]');
  });

  test('given skip tag in notes, when cleared, then tag is removed and null returned for empty notes', () => {
    expect(clearSkipTag('[Skipped 2026-10-25]')).toBeNull();
    expect(clearSkipTag('Tempo\n[Skipped 2026-10-25]')).toBe('Tempo');
  });

  test('given confirmed skip tag in notes, when cleared, then confirmation tag is also removed', () => {
    expect(clearSkipTag('Tempo\n[Skipped 2026-10-25]\n[Skip confirmed 2026-10-25]')).toBe('Tempo');
  });

  test('given skipped notes, when skip is confirmed, then a single confirmation tag is appended', () => {
    const tagged = appendConfirmedSkipTag('Tempo\n[Skipped 2026-10-25]', new Date());

    expect(tagged).toBe('Tempo\n[Skipped 2026-10-25]\n[Skip confirmed 2026-10-25]');
    expect(hasConfirmedSkipTag(tagged)).toBe(true);
  });

  test('given status transition, then skip tag behavior is deterministic', () => {
    expect(syncSkipTagForStatus('Tempo', 'skipped', new Date())).toBe('Tempo\n[Skipped 2026-10-25]');
    expect(syncSkipTagForStatus('Tempo\n[Skipped 2026-10-25]', 'planned', new Date())).toBe('Tempo');
  });
});
