export const NEXT_ACTION_STATE = {
  SESSION_TODAY: "SESSION_TODAY",
  NO_SESSION_TODAY: "NO_SESSION_TODAY",
  MISSED_KEY: "MISSED_KEY"
} as const;

export type NextActionState = (typeof NEXT_ACTION_STATE)[keyof typeof NEXT_ACTION_STATE];

type NextActionSession = {
  is_key?: boolean | null;
  type?: string | null;
  title?: string | null;
  intent?: string | null;
  intensity?: string | null;
};

function isEasySession(session: NextActionSession | null | undefined) {
  if (!session) return false;

  const normalizedIntent = (session.intent ?? "").toLowerCase();
  const normalizedIntensity = (session.intensity ?? "").toLowerCase();
  if ([normalizedIntent, normalizedIntensity].some((value) => ["easy", "recovery", "endurance"].includes(value))) {
    return true;
  }

  const descriptor = `${session.title ?? ""} ${session.type ?? ""}`.toLowerCase();
  return /(easy|recovery|endurance)/i.test(descriptor);
}

export function getWhyTodayMattersCopy(state: NextActionState, session?: NextActionSession | null) {
  if (state === NEXT_ACTION_STATE.MISSED_KEY) {
    return "Why today matters: reschedule to protect the week’s intent.";
  }

  if (state === NEXT_ACTION_STATE.NO_SESSION_TODAY) {
    return "Why today matters: use the space to recover and protect your next key session.";
  }

  if (session?.is_key) {
    return "Why today matters: protect quality—hit this as planned.";
  }

  if (isEasySession(session)) {
    return "Why today matters: bank easy volume to support upcoming quality.";
  }

  return "Why today matters: stay consistent—this keeps your week on track.";
}
