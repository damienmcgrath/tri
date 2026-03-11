import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const REQUIRED_ENV = [
  "SUPABASE_TEST_URL",
  "SUPABASE_TEST_ANON_KEY",
  "SUPABASE_TEST_SERVICE_ROLE_KEY"
] as const;

type RequiredEnv = Record<(typeof REQUIRED_ENV)[number], string>;

export type SeededAthlete = {
  userId: string;
  email: string;
  password: string;
  planId: string;
  sessionId: string;
};

export type SeededCoachDataset = {
  athleteA: SeededAthlete;
  athleteB: SeededAthlete;
};

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

export function readSupabaseTestEnv(): RequiredEnv | null {
  const values = Object.fromEntries(REQUIRED_ENV.map((key) => [key, process.env[key] ?? ""])) as RequiredEnv;
  const missing = REQUIRED_ENV.filter((key) => !values[key]);

  if (missing.length > 0) {
    return null;
  }

  return values;
}

export function createServiceRoleClient(env: RequiredEnv) {
  return createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
}

async function createAuthUser(supabaseAdmin: SupabaseClient, email: string, password: string) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (error || !data.user) {
    throw new Error(`Failed to create auth user ${email}: ${error?.message ?? "unknown"}`);
  }

  return data.user.id;
}

export async function seedCoachSecurityDataset(supabaseAdmin: SupabaseClient): Promise<SeededCoachDataset> {
  const suffix = randomId();
  const athleteAEmail = `coach-athlete-a-${suffix}@example.com`;
  const athleteBEmail = `coach-athlete-b-${suffix}@example.com`;
  const password = `Supabase!${suffix}`;

  const athleteAId = await createAuthUser(supabaseAdmin, athleteAEmail, password);
  const athleteBId = await createAuthUser(supabaseAdmin, athleteBEmail, password);

  const { error: profileError } = await supabaseAdmin.from("profiles").insert([
    { id: athleteAId, display_name: "Athlete A", race_name: "Race A" },
    { id: athleteBId, display_name: "Athlete B", race_name: "Race B" }
  ]);

  if (profileError) {
    throw new Error(`Failed to seed profiles: ${profileError.message}`);
  }

  const { data: plans, error: plansError } = await supabaseAdmin
    .from("training_plans")
    .insert([
      { user_id: athleteAId, athlete_id: athleteAId, name: "A Plan", start_date: "2026-03-01", duration_weeks: 8 },
      { user_id: athleteBId, athlete_id: athleteBId, name: "B Plan", start_date: "2026-03-01", duration_weeks: 8 }
    ])
    .select("id,athlete_id")
    .order("created_at", { ascending: true });

  if (plansError || !plans || plans.length !== 2) {
    throw new Error(`Failed to seed training plans: ${plansError?.message ?? "unknown"}`);
  }

  const planA = plans.find((plan) => plan.athlete_id === athleteAId);
  const planB = plans.find((plan) => plan.athlete_id === athleteBId);

  if (!planA || !planB) {
    throw new Error("Seeded plans did not map to both athletes.");
  }

  const { data: sessions, error: sessionsError } = await supabaseAdmin
    .from("sessions")
    .insert([
      {
        user_id: athleteAId,
        athlete_id: athleteAId,
        plan_id: planA.id,
        date: "2026-03-10",
        sport: "run",
        type: "tempo",
        duration_minutes: 50,
        status: "planned"
      },
      {
        user_id: athleteBId,
        athlete_id: athleteBId,
        plan_id: planB.id,
        date: "2026-03-10",
        sport: "bike",
        type: "interval",
        duration_minutes: 60,
        status: "planned"
      }
    ])
    .select("id,athlete_id");

  if (sessionsError || !sessions || sessions.length !== 2) {
    throw new Error(`Failed to seed sessions: ${sessionsError?.message ?? "unknown"}`);
  }

  const sessionA = sessions.find((session) => session.athlete_id === athleteAId);
  const sessionB = sessions.find((session) => session.athlete_id === athleteBId);

  if (!sessionA || !sessionB) {
    throw new Error("Seeded sessions did not map to both athletes.");
  }

  const { error: completedError } = await supabaseAdmin.from("completed_sessions").insert([
    {
      user_id: athleteAId,
      athlete_id: athleteAId,
      garmin_id: `garmin-a-${suffix}`,
      date: "2026-03-08",
      sport: "run",
      metrics: { duration: 2800 }
    },
    {
      user_id: athleteBId,
      athlete_id: athleteBId,
      garmin_id: `garmin-b-${suffix}`,
      date: "2026-03-08",
      sport: "bike",
      metrics: { duration: 3600 }
    }
  ]);

  if (completedError) {
    throw new Error(`Failed to seed completed sessions: ${completedError.message}`);
  }

  const { error: proposalsError } = await supabaseAdmin.from("coach_plan_change_proposals").insert([
    {
      user_id: athleteAId,
      athlete_id: athleteAId,
      target_session_id: sessionA.id,
      title: "A baseline proposal",
      rationale: "Recover better",
      change_summary: "Reduce intensity"
    },
    {
      user_id: athleteBId,
      athlete_id: athleteBId,
      target_session_id: sessionB.id,
      title: "B baseline proposal",
      rationale: "Build volume",
      change_summary: "Add aerobic block"
    }
  ]);

  if (proposalsError) {
    throw new Error(`Failed to seed coach proposals: ${proposalsError.message}`);
  }

  return {
    athleteA: {
      userId: athleteAId,
      email: athleteAEmail,
      password,
      planId: planA.id,
      sessionId: sessionA.id
    },
    athleteB: {
      userId: athleteBId,
      email: athleteBEmail,
      password,
      planId: planB.id,
      sessionId: sessionB.id
    }
  };
}

export async function createUserScopedClient(env: RequiredEnv, email: string, password: string) {
  const client = createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    throw new Error(`Failed to sign in ${email}: ${error.message}`);
  }

  return client;
}
