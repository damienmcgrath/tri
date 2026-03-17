import { NextRequest, NextResponse } from "next/server";
import { isAgentPreviewEnabled } from "@/lib/agent-preview/config";
import { resetPreviewDatabase, getPreviewDatabase } from "@/lib/agent-preview/data";

const PREVIEW_USER_ID = "11111111-1111-4111-8111-111111111111";
const PREVIEW_PLAN_ID = "22222222-2222-4222-8222-222222222222";
const PREVIEW_WEEK_TWO_ID = "33333333-3333-4333-8333-333333333332";
const PREVIEW_UPLOAD_TWO_ID = "44444444-4444-4444-8444-444444444445";
const PREVIEW_ACTIVITY_FOUR_ID = "55555555-5555-4555-8555-555555555554";

export async function GET(request: NextRequest) {
  if (!isAgentPreviewEnabled()) {
    return NextResponse.json({ error: "Agent preview mode is disabled." }, { status: 404 });
  }

  resetPreviewDatabase();

  const db = getPreviewDatabase();

  // Week 2 planned sessions (Mar 17)
  db.sessions.push(
    {
      id: "77777777-7777-4777-8777-777777777779",
      user_id: PREVIEW_USER_ID,
      athlete_id: PREVIEW_USER_ID,
      plan_id: PREVIEW_PLAN_ID,
      week_id: PREVIEW_WEEK_TWO_ID,
      date: "2026-03-17",
      sport: "run",
      discipline: "run",
      type: "Easy Run",
      session_name: "Easy Run",
      target: "30 min easy aerobic",
      duration_minutes: 30,
      intent_category: "easy",
      session_role: "supporting",
      status: "planned",
      day_order: 1,
      notes: null,
      created_at: "2026-03-08T18:08:00.000Z",
      is_key: false,
      execution_result: null
    },
    {
      id: "77777777-7777-4777-8777-77777777777a",
      user_id: PREVIEW_USER_ID,
      athlete_id: PREVIEW_USER_ID,
      plan_id: PREVIEW_PLAN_ID,
      week_id: PREVIEW_WEEK_TWO_ID,
      date: "2026-03-17",
      sport: "swim",
      discipline: "swim",
      type: "Endurance Swim",
      session_name: "Endurance Swim",
      target: "60 min steady aerobic swim",
      duration_minutes: 60,
      intent_category: "easy",
      session_role: "supporting",
      status: "planned",
      day_order: 2,
      notes: null,
      created_at: "2026-03-08T18:09:00.000Z",
      is_key: false,
      execution_result: null
    }
  );

  // Unmatched uploaded bike activity on Mar 17
  db.completed_activities.push({
    id: PREVIEW_ACTIVITY_FOUR_ID,
    user_id: PREVIEW_USER_ID,
    upload_id: PREVIEW_UPLOAD_TWO_ID,
    sport_type: "bike",
    start_time_utc: "2026-03-17T07:10:00.000Z",
    end_time_utc: "2026-03-17T08:00:00.000Z",
    duration_sec: 3000,
    moving_duration_sec: 2970,
    elapsed_duration_sec: 3000,
    distance_m: 25000,
    avg_hr: 145,
    avg_power: 198,
    avg_cadence: 87,
    max_hr: 163,
    max_power: 312,
    elevation_gain_m: 210,
    elevation_loss_m: 208,
    calories: 620,
    avg_pace_per_100m_sec: null,
    avg_stroke_rate_spm: null,
    avg_swolf: null,
    pool_length_m: null,
    laps_count: 3,
    activity_vendor: "garmin",
    activity_type_raw: "cycling",
    activity_subtype_raw: "road",
    source: "upload",
    parse_summary: null,
    notes: null,
    schedule_status: "unscheduled",
    is_unplanned: false,
    is_race: false,
    created_at: "2026-03-17T08:05:00.000Z",
    updated_at: "2026-03-17T08:05:00.000Z",
    metrics_v2: {}
  });

  db.activity_uploads.push({
    id: PREVIEW_UPLOAD_TWO_ID,
    user_id: PREVIEW_USER_ID,
    filename: "garmin-mar17-bike.fit",
    file_type: "fit",
    created_at: "2026-03-17T08:05:00.000Z",
    status: "parsed",
    error_message: null
  });

  const next = request.nextUrl.searchParams.get("next") || "/dashboard";
  return NextResponse.redirect(new URL(next, request.url));
}

