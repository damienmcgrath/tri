import { Buffer } from "node:buffer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMultisportParseResult, parseFitFile, parseTcxFile } from "@/lib/workouts/activity-parser";
import { asMetricsRecord, getNestedString, getNestedValue } from "@/lib/workouts/metrics-v2";

type CompletedActivityBackfillRow = {
  id: string;
  upload_id: string | null;
  metrics_v2?: Record<string, unknown> | null;
};

type ActivityUploadBackfillRow = {
  id: string;
  file_type: "fit" | "tcx";
  raw_file_base64: string | null;
  storage_key: string | null;
};

function hasRichMetrics(metrics: Record<string, unknown> | null | undefined) {
  const record = asMetricsRecord(metrics);
  if (!record) return false;
  const summary = asMetricsRecord(getNestedValue(record, ["summary"]));
  const laps = getNestedValue(record, ["laps"]);
  const activityType = getNestedString(record, [["activity", "normalizedType"]]);
  const splits = asMetricsRecord(getNestedValue(record, ["splits"])) ?? asMetricsRecord(getNestedValue(record, ["halves"]));

  if (!summary || !Array.isArray(laps)) return false;

  if (activityType === "bike") {
    const power = asMetricsRecord(getNestedValue(record, ["power"]));
    const zones = asMetricsRecord(getNestedValue(record, ["zones"]));
    return Boolean(power?.normalizedPower) && Array.isArray(zones?.power);
  }

  if (activityType === "run") {
    const pace = asMetricsRecord(getNestedValue(record, ["pace"]));
    const cadence = asMetricsRecord(getNestedValue(record, ["cadence"]));
    const hrZones = getNestedValue(record, ["zones", "hr"]) ?? getNestedValue(record, ["zones", "heartRate"]);
    return Boolean(pace?.avgPaceSecPerKm) && Boolean(cadence?.avgCadence) && Boolean(splits) && Array.isArray(hrZones);
  }

  if (activityType === "swim") {
    const pace = asMetricsRecord(getNestedValue(record, ["pace"]));
    const stroke = asMetricsRecord(getNestedValue(record, ["stroke"]));
    const pool = asMetricsRecord(getNestedValue(record, ["pool"]));
    return Boolean(pace?.avgPacePer100mSec) && Boolean(splits) && (Boolean(stroke?.avgStrokeRateSpm) || Boolean(pool?.poolLengthM));
  }

  return true;
}

function withBackfillWarning(metrics: Record<string, unknown> | null | undefined) {
  const record = asMetricsRecord(metrics) ?? {};
  const quality = asMetricsRecord(record.quality) ?? {};
  const warnings = Array.isArray(quality.warnings)
    ? quality.warnings.filter((value): value is string => typeof value === "string")
    : [];

  return {
    ...record,
    quality: {
      ...quality,
      warnings: warnings.includes("backfilled_from_raw_upload")
        ? warnings
        : [...warnings, "backfilled_from_raw_upload"]
    }
  };
}

export async function backfillActivityMetrics(args: {
  supabase: SupabaseClient;
  userId: string;
  limit?: number;
  force?: boolean;
}) {
  const { data: activities, error: activitiesError } = await args.supabase
    .from("completed_activities")
    .select("id,upload_id,metrics_v2")
    .eq("user_id", args.userId)
    .eq("source", "upload")
    .order("created_at", { ascending: false });

  if (activitiesError) throw new Error(activitiesError.message);

  const uploadedActivities = ((activities ?? []) as CompletedActivityBackfillRow[])
    .filter((activity) => typeof activity.upload_id === "string");

  const candidateActivities = args.force
    ? uploadedActivities
    : uploadedActivities.filter((activity) => !hasRichMetrics(activity.metrics_v2));

  const activitiesToProcess = typeof args.limit === "number"
    ? candidateActivities.slice(0, args.limit)
    : candidateActivities;

  if (activitiesToProcess.length === 0) {
    return {
      attempted: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    };
  }

  const uploadIds = [...new Set(activitiesToProcess.map((activity) => activity.upload_id as string))];
  const { data: uploads, error: uploadsError } = await args.supabase
    .from("activity_uploads")
    .select("id,file_type,raw_file_base64,storage_key")
    .eq("user_id", args.userId)
    .in("id", uploadIds);

  if (uploadsError) throw new Error(uploadsError.message);

  const uploadById = new Map<string, ActivityUploadBackfillRow>(
    ((uploads ?? []) as ActivityUploadBackfillRow[]).map((upload) => [upload.id, upload])
  );

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const activity of activitiesToProcess) {
    const upload = uploadById.get(activity.upload_id as string);
    if (!upload) {
      skipped += 1;
      continue;
    }

    if (!upload.raw_file_base64) {
      skipped += 1;
      continue;
    }

    try {
      const bytes = Buffer.from(upload.raw_file_base64, "base64");
      const parsed = upload.file_type === "fit"
        ? await parseFitFile(bytes)
        : parseTcxFile(bytes.toString("utf8"));

      if (isMultisportParseResult(parsed)) {
        // Multisport uploads insert per-segment rows up-front; metrics-backfill
        // would need to know which segment maps to this row. Skip for now —
        // segment metrics are already populated at upload time.
        skipped += 1;
        continue;
      }

      const metricsV2 = withBackfillWarning(parsed.metricsV2);
      const { error: updateError } = await args.supabase
        .from("completed_activities")
        .update({
          sport_type: parsed.sportType,
          start_time_utc: parsed.startTimeUtc,
          end_time_utc: parsed.endTimeUtc,
          duration_sec: parsed.durationSec,
          distance_m: parsed.distanceM,
          avg_hr: parsed.avgHr,
          avg_power: parsed.avgPower,
          calories: parsed.calories,
          moving_duration_sec: parsed.movingDurationSec,
          elapsed_duration_sec: parsed.elapsedDurationSec,
          pool_length_m: parsed.poolLengthM,
          laps_count: parsed.lapsCount,
          avg_pace_per_100m_sec: parsed.avgPacePer100mSec,
          best_pace_per_100m_sec: parsed.bestPacePer100mSec,
          avg_stroke_rate_spm: parsed.avgStrokeRateSpm,
          avg_swolf: parsed.avgSwolf,
          avg_cadence: parsed.avgCadence,
          max_hr: parsed.maxHr,
          max_power: parsed.maxPower,
          elevation_gain_m: parsed.elevationGainM,
          elevation_loss_m: parsed.elevationLossM,
          activity_type_raw: parsed.activityTypeRaw,
          activity_subtype_raw: parsed.activitySubtypeRaw,
          activity_vendor: parsed.activityVendor,
          metrics_v2: metricsV2,
          parse_summary: parsed.parseSummary
        })
        .eq("id", activity.id)
        .eq("user_id", args.userId);

      if (updateError) {
        failed += 1;
        continue;
      }

      updated += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    attempted: activitiesToProcess.length,
    updated,
    skipped,
    failed
  };
}
