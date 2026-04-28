export type RaceSessionLike = {
  type?: string | null;
  session_name?: string | null;
};

const RACE_PATTERN = /\brace\b/i;

export function isRaceSession(session: RaceSessionLike | null | undefined): boolean {
  if (!session) return false;
  if (session.type && RACE_PATTERN.test(session.type)) return true;
  if (session.session_name && RACE_PATTERN.test(session.session_name)) return true;
  return false;
}
