"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/actions-utils";
import { insertWithCompat, updateWithCompat, isMissingColumnError, SESSIONS_OPTIONAL_COLUMNS } from "@/lib/supabase/schema-compat";

const SESSIONS_OPTIONAL_COLUMNS_SET = new Set<string>(SESSIONS_OPTIONAL_COLUMNS);

// Plan / week / block server actions live in sibling files. Import them
// directly from `./actions-plan`, `./actions-week`, `./actions-block` —
// Next.js's `"use server"` directive on this file disallows re-exports
// (only async function declarations are allowed at the top level of a
// server-actions file).

const uuidSchema = z.string().uuid();




const createSessionSchema = z.object({
  planId: uuidSchema,
  weekId: uuidSchema,
  date: z.string().date(),
  sport: z.enum(["swim", "bike", "run", "strength", "other"]),
  sessionType: z.string().trim().max(100).optional(),
  sessionName: z.string().trim().max(200).optional(),
  intentCategory: z.string().trim().max(120).optional(),
  target: z.string().trim().max(2000).optional(),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  notes: z.string().trim().max(2000).optional(),
  distanceValue: z.union([z.literal(""), z.coerce.number().positive()]).optional(),
  distanceUnit: z.union([z.literal(""), z.enum(["m", "km", "mi", "yd"])]).optional(),
  dayOrder: z.coerce.number().int().min(0).max(100).optional(),
  isKey: z.coerce.boolean().optional(),
  sessionRole: z.union([z.literal(""), z.enum(["Key", "Supporting", "Recovery", "Optional"])]).optional()
});

const updateSessionSchema = createSessionSchema.extend({
  sessionId: uuidSchema,
  status: z.enum(["planned", "completed", "skipped"]).default("planned")
});

const deleteSessionSchema = z.object({
  sessionId: uuidSchema
});

const reorderSessionSchema = z.object({
  sessionId: uuidSchema,
  planId: uuidSchema,
  weekId: uuidSchema,
  date: z.string().date(),
  dayOrder: z.coerce.number().int().min(0).max(100)
});



const bulkReorderSessionSchema = z.object({
  planId: uuidSchema,
  weekId: uuidSchema,
  updates: z.array(reorderSessionSchema).max(200)
});





function isMissingTableError(error: { code?: string; message?: string } | null, tableName: string) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST205") {
    return true;
  }

  return (error.message ?? "").toLowerCase().includes(`could not find the table '${tableName.toLowerCase()}' in the schema cache`);
}

function getOptionalFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value === null ? undefined : value;
}

async function assertPlanOwnership(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, planId: string) {
  const { data: plan, error } = await supabase
    .from("training_plans")
    .select("id")
    .eq("id", planId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not validate plan ownership: ${error.message}`);
  }

  if (!plan) {
    throw new Error("Plan not found or not owned by current user.");
  }
}


function fallbackSessionType(sport: string, sessionType?: string | null) {
  const explicitType = sessionType?.trim();
  if (explicitType) {
    return explicitType;
  }

  if (sport === "swim") return "Swim";
  if (sport === "bike") return "Bike";
  if (sport === "run") return "Run";
  if (sport === "strength") return "Strength";
  return "Training";
}



async function assertWeekOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  weekId: string,
  planId?: string
) {
  const query = supabase
    .from("training_weeks")
    .select("id,plan_id,week_index,week_start_date,focus,notes,target_minutes,target_tss")
    .eq("id", weekId);

  if (planId) {
    query.eq("plan_id", planId);
  }

  const { data: week, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Could not validate week ownership: ${error.message}`);
  }

  if (!week) {
    throw new Error("Week not found.");
  }

  await assertPlanOwnership(supabase, userId, week.plan_id);

  return week;
}







export async function createSessionAction(formData: FormData) {
  const parsed = createSessionSchema.parse({
    planId: formData.get("planId"),
    weekId: formData.get("weekId"),
    date: formData.get("date"),
    sport: formData.get("sport"),
    sessionType: getOptionalFormValue(formData, "sessionType"),
    target: getOptionalFormValue(formData, "target"),
    durationMinutes: formData.get("durationMinutes"),
    notes: getOptionalFormValue(formData, "notes"),
    distanceValue: getOptionalFormValue(formData, "distanceValue"),
    distanceUnit: getOptionalFormValue(formData, "distanceUnit"),
    dayOrder: getOptionalFormValue(formData, "dayOrder"),
    isKey: getOptionalFormValue(formData, "isKey"),
    sessionRole: getOptionalFormValue(formData, "sessionRole")
  });

  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { data: daySessions, error: daySessionsError } = await supabase
    .from("sessions")
    .select("id")
    .eq("week_id", parsed.weekId)
    .eq("date", parsed.date);

  if (daySessionsError && !isMissingTableError(daySessionsError, "public.sessions")) {
    throw new Error(daySessionsError.message);
  }

  const canonicalPayload = {
    user_id: user.id,
    plan_id: parsed.planId,
    week_id: parsed.weekId,
    date: parsed.date,
    sport: parsed.sport,
    type: fallbackSessionType(parsed.sport, parsed.sessionType),
    session_name: parsed.sessionName?.length ? parsed.sessionName : null,
    intent_category: parsed.intentCategory?.length ? parsed.intentCategory : null,
    target: parsed.target || null,
    day_order: parsed.dayOrder ?? (daySessions?.length ?? 0),
    duration_minutes: parsed.durationMinutes,
    notes: parsed.notes ?? null,
    distance_value: parsed.distanceValue === "" ? null : parsed.distanceValue,
    distance_unit: parsed.distanceUnit === "" ? null : parsed.distanceUnit,
    status: "planned",
    is_key: Boolean(parsed.isKey) || parsed.sessionRole === "Key",
    session_role: parsed.sessionRole === "" ? null : parsed.sessionRole
  };

  await insertWithCompat(supabase, "sessions", canonicalPayload, SESSIONS_OPTIONAL_COLUMNS);

  revalidatePath("/plan");
  revalidatePath("/calendar");
}

export async function updateSessionAction(formData: FormData) {
  const parsed = updateSessionSchema.parse({
    sessionId: formData.get("sessionId"),
    planId: formData.get("planId"),
    weekId: formData.get("weekId"),
    date: formData.get("date"),
    sport: formData.get("sport"),
    sessionType: getOptionalFormValue(formData, "sessionType"),
    sessionName: getOptionalFormValue(formData, "sessionName"),
    intentCategory: getOptionalFormValue(formData, "intentCategory"),
    target: getOptionalFormValue(formData, "target"),
    durationMinutes: formData.get("durationMinutes"),
    notes: getOptionalFormValue(formData, "notes"),
    distanceValue: getOptionalFormValue(formData, "distanceValue"),
    distanceUnit: getOptionalFormValue(formData, "distanceUnit"),
    status: formData.get("status"),
    isKey: getOptionalFormValue(formData, "isKey"),
    sessionRole: getOptionalFormValue(formData, "sessionRole")
  });

  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const canonicalPayload = {
    plan_id: parsed.planId,
    week_id: parsed.weekId,
    date: parsed.date,
    sport: parsed.sport,
    type: fallbackSessionType(parsed.sport, parsed.sessionType),
    session_name: parsed.sessionName?.length ? parsed.sessionName : null,
    intent_category: parsed.intentCategory?.length ? parsed.intentCategory : null,
    target: parsed.target || null,
    notes: parsed.notes ?? null,
    distance_value: parsed.distanceValue === "" ? null : parsed.distanceValue,
    distance_unit: parsed.distanceUnit === "" ? null : parsed.distanceUnit,
    duration_minutes: parsed.durationMinutes,
    status: parsed.status,
    user_id: user.id,
    is_key: Boolean(parsed.isKey) || parsed.sessionRole === "Key",
    session_role: parsed.sessionRole === "" ? null : parsed.sessionRole
  };

  await updateWithCompat(supabase, "sessions", parsed.sessionId, canonicalPayload, SESSIONS_OPTIONAL_COLUMNS);

  revalidatePath("/plan");
  revalidatePath("/calendar");
}

const sessionDetailsSchema = z.object({
  sessionId: uuidSchema,
  planId: uuidSchema,
  weekId: uuidSchema,
  sport: z.enum(["swim", "bike", "run", "strength", "other"]),
  sessionType: z.string().trim().max(120).nullable().optional(),
  sessionName: z.string().trim().max(200).nullable().optional(),
  intentCategory: z.string().trim().max(120).nullable().optional(),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  target: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  sessionRole: z.enum(["Key", "Supporting", "Recovery"]).nullable().optional()
});

const createFromCellSchema = z.object({
  kind: z.enum(["session", "rest"]),
  planId: uuidSchema,
  weekId: uuidSchema,
  date: z.string().date(),
  sport: z.enum(["swim", "bike", "run", "strength", "other"]),
  sessionType: z.string().trim().max(120).nullable().optional(),
  sessionName: z.string().trim().max(200).nullable().optional(),
  intentCategory: z.string().trim().max(120).nullable().optional(),
  durationMinutes: z.coerce.number().int().min(0).max(1440),
  target: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  sessionRole: z.enum(["Key", "Supporting", "Recovery"]).nullable().optional()
});

export type CreateFromCellInput = z.infer<typeof createFromCellSchema>;

export type CreatedSessionRow = {
  id: string;
  plan_id: string;
  week_id: string;
  date: string;
  sport: string;
  type: string;
  session_name: string | null;
  intent_category: string | null;
  duration_minutes: number;
  target: string | null;
  notes: string | null;
  session_role: string | null;
  is_key: boolean | null;
};

/**
 * JSON-input variant of createSessionAction tailored for the empty-cell
 * create flow in SessionDrawer. Inserts a session (or a Rest day placeholder
 * when kind === "rest") and returns the new row mapped into DrawerSession
 * shape so the caller can splice it into local state.
 */
export async function createSessionFromCellAction(
  input: CreateFromCellInput
): Promise<CreatedSessionRow> {
  const parsed = createFromCellSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { data: daySessions, error: daySessionsError } = await supabase
    .from("sessions")
    .select("id")
    .eq("week_id", parsed.weekId)
    .eq("date", parsed.date);

  if (daySessionsError && !isMissingTableError(daySessionsError, "public.sessions")) {
    throw new Error(daySessionsError.message);
  }

  const isRest = parsed.kind === "rest";
  const sessionName = isRest
    ? "Rest day"
    : parsed.sessionName?.length
      ? parsed.sessionName
      : null;
  const type = isRest
    ? "Rest"
    : fallbackSessionType(parsed.sport, parsed.sessionType ?? sessionName);
  const intentCategory = isRest
    ? "Recovery"
    : parsed.intentCategory?.length
      ? parsed.intentCategory
      : null;
  const sessionRole = isRest ? "Recovery" : (parsed.sessionRole ?? null);
  const durationMinutes = isRest ? 0 : parsed.durationMinutes;
  const isKey = !isRest && sessionRole === "Key";

  const canonicalPayload = {
    user_id: user.id,
    plan_id: parsed.planId,
    week_id: parsed.weekId,
    date: parsed.date,
    sport: parsed.sport,
    type,
    session_name: sessionName,
    intent_category: intentCategory,
    target: parsed.target?.length ? parsed.target : null,
    day_order: daySessions?.length ?? 0,
    duration_minutes: durationMinutes,
    notes: parsed.notes?.length ? parsed.notes : null,
    status: "planned",
    is_key: isKey,
    session_role: sessionRole
  };

  // Insert with `.select("id").single()` so we can return the new row id;
  // fall back to a payload stripped of optional columns on missing-column
  // errors, mirroring insertWithCompat's behaviour.
  let insertResult = await supabase
    .from("sessions")
    .insert(canonicalPayload)
    .select("id")
    .single();

  if (insertResult.error && isMissingColumnError(insertResult.error)) {
    const stripped: Record<string, unknown> = { ...canonicalPayload };
    for (const col of SESSIONS_OPTIONAL_COLUMNS_SET) delete stripped[col];
    insertResult = await supabase
      .from("sessions")
      .insert(stripped)
      .select("id")
      .single();
  }

  if (insertResult.error) {
    throw new Error(insertResult.error.message);
  }

  const id = (insertResult.data as { id?: unknown } | null)?.id;
  if (typeof id !== "string") {
    throw new Error("Could not create session: missing id from insert response.");
  }

  revalidatePath("/plan");
  revalidatePath("/calendar");

  return {
    id,
    plan_id: parsed.planId,
    week_id: parsed.weekId,
    date: parsed.date,
    sport: parsed.sport,
    type,
    session_name: sessionName,
    intent_category: intentCategory,
    duration_minutes: durationMinutes,
    target: canonicalPayload.target,
    notes: canonicalPayload.notes,
    session_role: sessionRole,
    is_key: isKey
  };
}

export type SessionDetailsInput = z.infer<typeof sessionDetailsSchema>;

/**
 * JSON-input variant of updateSessionAction used by the SessionDrawer for
 * optimistic UX. Returns void; caller is responsible for splicing the new
 * values into local state before awaiting and reverting on rejection.
 */
export async function updateSessionDetailsAction(input: SessionDetailsInput) {
  const parsed = sessionDetailsSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const canonicalPayload = {
    sport: parsed.sport,
    type: fallbackSessionType(
      parsed.sport,
      parsed.sessionType ?? parsed.sessionName ?? undefined
    ),
    session_name: parsed.sessionName?.length ? parsed.sessionName : null,
    intent_category: parsed.intentCategory?.length ? parsed.intentCategory : null,
    target: parsed.target?.length ? parsed.target : null,
    notes: parsed.notes?.length ? parsed.notes : null,
    duration_minutes: parsed.durationMinutes,
    is_key: parsed.sessionRole === "Key",
    session_role: parsed.sessionRole ?? null,
    user_id: user.id
  };

  await updateWithCompat(supabase, "sessions", parsed.sessionId, canonicalPayload, SESSIONS_OPTIONAL_COLUMNS);

  revalidatePath("/plan");
  revalidatePath("/calendar");
}

export async function reorderSessionAction(input: z.infer<typeof reorderSessionSchema>) {
  const parsed = reorderSessionSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { error } = await supabase
    .from("sessions")
    .update({ date: parsed.date, day_order: parsed.dayOrder, week_id: parsed.weekId })
    .eq("id", parsed.sessionId)
    .eq("plan_id", parsed.planId);

  if (error && isMissingColumnError(error, "day_order")) {
    const { error: retryError } = await supabase
      .from("sessions")
      .update({ date: parsed.date, week_id: parsed.weekId })
      .eq("id", parsed.sessionId)
      .eq("plan_id", parsed.planId);

    if (retryError) {
      throw new Error(retryError.message);
    }
  } else if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/plan");
}

export async function deleteSessionAction(formData: FormData) {
  const parsed = deleteSessionSchema.parse({
    sessionId: formData.get("sessionId")
  });

  const { supabase } = await getAuthedClient();

  const { error } = await supabase.from("sessions").delete().eq("id", parsed.sessionId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/plan");
  revalidatePath("/calendar");
}

const rescheduleSessionSchema = z.object({
  sessionId: uuidSchema,
  planId: uuidSchema,
  targetWeekId: uuidSchema,
  targetDate: z.string().date()
});

export type RescheduleSessionInput = z.infer<typeof rescheduleSessionSchema>;

export type RescheduleSessionResult = {
  sessionId: string;
  weekId: string;
  date: string;
  dayOrder: number;
  removedRestIds: string[];
};

// "Rest" sentinel rows are emitted by createSessionFromCellAction with kind='rest'
// (type='Rest', duration_minutes=0). Keep the detector keyed on `type` so it
// stays consistent if we later switch sport away from "other".
function isRestRow(row: { type?: string | null }) {
  return (row.type ?? "").toLowerCase() === "rest";
}

/**
 * Moves a session to a different (week, day). If the target day has a Rest
 * sentinel row, that row is deleted first so the dragged session takes its
 * place (per spec §5.1: "Drop on a Rest cell promotes the cell to a session
 * day automatically"). day_order is computed server-side as the next slot
 * after the (rest-cleared) target day's existing sessions.
 */
export async function rescheduleSessionAction(
  input: RescheduleSessionInput
): Promise<RescheduleSessionResult> {
  const parsed = rescheduleSessionSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.targetWeekId, parsed.planId);

  const { data: targetDay, error: targetDayError } = await supabase
    .from("sessions")
    .select("id, type")
    .eq("week_id", parsed.targetWeekId)
    .eq("date", parsed.targetDate);

  if (targetDayError && !isMissingTableError(targetDayError, "public.sessions")) {
    throw new Error(targetDayError.message);
  }

  const removedRestIds: string[] = [];
  const survivingRows: Array<{ id: string }> = [];
  for (const row of targetDay ?? []) {
    if (row.id === parsed.sessionId) continue;
    if (isRestRow(row)) {
      removedRestIds.push(row.id as string);
    } else {
      survivingRows.push({ id: row.id as string });
    }
  }

  if (removedRestIds.length > 0) {
    const { error: deleteRestError } = await supabase
      .from("sessions")
      .delete()
      .in("id", removedRestIds);
    if (deleteRestError) {
      throw new Error(deleteRestError.message);
    }
  }

  const nextDayOrder = survivingRows.length;

  const { error: updateError } = await supabase
    .from("sessions")
    .update({
      date: parsed.targetDate,
      week_id: parsed.targetWeekId,
      day_order: nextDayOrder
    })
    .eq("id", parsed.sessionId)
    .eq("plan_id", parsed.planId);

  if (updateError && isMissingColumnError(updateError, "day_order")) {
    const { error: retryError } = await supabase
      .from("sessions")
      .update({ date: parsed.targetDate, week_id: parsed.targetWeekId })
      .eq("id", parsed.sessionId)
      .eq("plan_id", parsed.planId);
    if (retryError) {
      throw new Error(retryError.message);
    }
  } else if (updateError) {
    throw new Error(updateError.message);
  }

  revalidatePath("/plan");
  revalidatePath("/calendar");

  return {
    sessionId: parsed.sessionId,
    weekId: parsed.targetWeekId,
    date: parsed.targetDate,
    dayOrder: nextDayOrder,
    removedRestIds
  };
}

const duplicateSessionSchema = z.object({
  sessionId: uuidSchema,
  planId: uuidSchema,
  targetWeekId: uuidSchema,
  targetDate: z.string().date()
});

export type DuplicateSessionInput = z.infer<typeof duplicateSessionSchema>;

export type DuplicateSessionResult = {
  created: CreatedSessionRow;
  removedRestIds: string[];
};

/**
 * Duplicates an existing session to a (week, day). If a Rest sentinel
 * occupies the target day it is deleted before insert (matching the drop-on-
 * Rest semantics in rescheduleSessionAction). Returns the new row plus any
 * removed Rest ids so the caller can reconcile local state.
 */
export async function duplicateSessionAction(
  input: DuplicateSessionInput
): Promise<DuplicateSessionResult> {
  const parsed = duplicateSessionSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.targetWeekId, parsed.planId);

  const { data: source, error: sourceError } = await supabase
    .from("sessions")
    .select(
      "id, plan_id, user_id, sport, type, session_name, intent_category, target, notes, duration_minutes, status, is_key, session_role"
    )
    .eq("id", parsed.sessionId)
    .maybeSingle();

  if (sourceError) {
    throw new Error(sourceError.message);
  }
  if (!source || source.user_id !== user.id || source.plan_id !== parsed.planId) {
    throw new Error("Session not found or not owned by current user.");
  }

  const { data: daySessions, error: daySessionsError } = await supabase
    .from("sessions")
    .select("id, type")
    .eq("week_id", parsed.targetWeekId)
    .eq("date", parsed.targetDate);

  if (daySessionsError && !isMissingTableError(daySessionsError, "public.sessions")) {
    throw new Error(daySessionsError.message);
  }

  const removedRestIds: string[] = [];
  let surviving = 0;
  for (const row of (daySessions ?? []) as Array<{ id: string; type: string | null }>) {
    if (isRestRow(row)) {
      removedRestIds.push(row.id);
    } else {
      surviving += 1;
    }
  }

  if (removedRestIds.length > 0) {
    const { error: deleteRestError } = await supabase
      .from("sessions")
      .delete()
      .in("id", removedRestIds);
    if (deleteRestError) {
      throw new Error(deleteRestError.message);
    }
  }

  const canonicalPayload = {
    user_id: user.id,
    plan_id: parsed.planId,
    week_id: parsed.targetWeekId,
    date: parsed.targetDate,
    sport: source.sport,
    type: source.type,
    session_name: source.session_name ?? null,
    intent_category: source.intent_category ?? null,
    target: source.target ?? null,
    notes: source.notes ?? null,
    duration_minutes: source.duration_minutes,
    day_order: surviving,
    status: "planned",
    is_key: source.is_key ?? false,
    session_role: source.session_role ?? null
  };

  let insertResult = await supabase
    .from("sessions")
    .insert(canonicalPayload)
    .select("id")
    .single();

  if (insertResult.error && isMissingColumnError(insertResult.error)) {
    const stripped: Record<string, unknown> = { ...canonicalPayload };
    for (const col of SESSIONS_OPTIONAL_COLUMNS_SET) delete stripped[col];
    insertResult = await supabase
      .from("sessions")
      .insert(stripped)
      .select("id")
      .single();
  }

  if (insertResult.error) {
    throw new Error(insertResult.error.message);
  }

  const id = (insertResult.data as { id?: unknown } | null)?.id;
  if (typeof id !== "string") {
    throw new Error("Could not duplicate session: missing id from insert response.");
  }

  revalidatePath("/plan");
  revalidatePath("/calendar");

  return {
    created: {
      id,
      plan_id: parsed.planId,
      week_id: parsed.targetWeekId,
      date: parsed.targetDate,
      sport: source.sport as string,
      type: source.type as string,
      session_name: canonicalPayload.session_name,
      intent_category: canonicalPayload.intent_category,
      duration_minutes: canonicalPayload.duration_minutes as number,
      target: canonicalPayload.target,
      notes: canonicalPayload.notes,
      session_role: canonicalPayload.session_role as string | null,
      is_key: canonicalPayload.is_key as boolean | null
    },
    removedRestIds
  };
}

const convertSessionToRestSchema = z.object({
  sessionId: uuidSchema,
  planId: uuidSchema,
  weekId: uuidSchema,
  date: z.string().date()
});

export type ConvertSessionToRestInput = z.infer<typeof convertSessionToRestSchema>;

export type ConvertSessionToRestResult = {
  deletedSessionId: string;
  restCreated: CreatedSessionRow | null;
};

/**
 * Replaces a session with a Rest sentinel for that day. Deletes the source
 * session and, if no other non-rest sessions remain on that day, inserts a
 * Rest row (matching the shape produced by createSessionFromCellAction with
 * kind='rest').
 */
export async function convertSessionToRestAction(
  input: ConvertSessionToRestInput
): Promise<ConvertSessionToRestResult> {
  const parsed = convertSessionToRestSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { error: deleteError } = await supabase
    .from("sessions")
    .delete()
    .eq("id", parsed.sessionId)
    .eq("plan_id", parsed.planId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const { data: remaining, error: remainingError } = await supabase
    .from("sessions")
    .select("id, type")
    .eq("week_id", parsed.weekId)
    .eq("date", parsed.date);

  if (remainingError && !isMissingTableError(remainingError, "public.sessions")) {
    throw new Error(remainingError.message);
  }

  const remainingRows = (remaining ?? []) as Array<{ id: string; type: string | null }>;
  const hasOtherSessions = remainingRows.some((row) => !isRestRow(row));
  const hasExistingRest = remainingRows.some((row) => isRestRow(row));

  if (hasOtherSessions || hasExistingRest) {
    revalidatePath("/plan");
    revalidatePath("/calendar");
    return { deletedSessionId: parsed.sessionId, restCreated: null };
  }

  const restCreated = await createSessionFromCellAction({
    kind: "rest",
    planId: parsed.planId,
    weekId: parsed.weekId,
    date: parsed.date,
    sport: "other",
    sessionName: null,
    intentCategory: null,
    durationMinutes: 0,
    target: null,
    notes: null,
    sessionRole: "Recovery"
  });

  return { deletedSessionId: parsed.sessionId, restCreated };
}




export async function bulkReorderSessionsAction(input: z.infer<typeof bulkReorderSessionSchema>) {
  const parsed = bulkReorderSessionSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  for (const update of parsed.updates) {
    const { error } = await supabase
      .from("sessions")
      .update({ date: update.date, day_order: update.dayOrder, week_id: update.weekId })
      .eq("id", update.sessionId)
      .eq("plan_id", parsed.planId);

    if (error && isMissingColumnError(error, "day_order")) {
      const { error: retryError } = await supabase
        .from("sessions")
        .update({ date: update.date, week_id: update.weekId })
        .eq("id", update.sessionId)
        .eq("plan_id", parsed.planId);

      if (retryError) {
        throw new Error(retryError.message);
      }
    } else if (error) {
      throw new Error(error.message);
    }
  }

  revalidatePath("/plan");
}
