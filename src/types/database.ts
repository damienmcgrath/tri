export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Database = {
  public: {
    Tables: {
      ai_conversations: {
        Row: {
          id: string;
          athlete_id: string;
          user_id: string;
          title: string;
          topic_classification: string | null;
          summary: string | null;
          summary_updated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          athlete_id?: string;
          user_id: string;
          title: string;
          topic_classification?: string | null;
          summary?: string | null;
          summary_updated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_conversations"]["Insert"]>;
      };
      ai_messages: {
        Row: {
          id: string;
          conversation_id: string;
          athlete_id: string;
          user_id: string;
          role: "user" | "assistant";
          content: string;
          metadata: Json;
          citations: Json;
          proposed_changes: Json | null;
          structured_content: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          athlete_id?: string;
          user_id: string;
          role: "user" | "assistant";
          content: string;
          metadata?: Json;
          citations?: Json;
          proposed_changes?: Json | null;
          structured_content?: Json | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_messages"]["Insert"]>;
      };
      conversation_summaries: {
        Row: {
          id: string;
          user_id: string;
          athlete_id: string;
          conversation_id: string;
          summary: string;
          key_topics: string[];
          key_decisions: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          athlete_id: string;
          conversation_id: string;
          summary: string;
          key_topics?: string[];
          key_decisions?: string[];
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversation_summaries"]["Insert"]>;
      };
      training_plans: {
        Row: {
          id: string;
          athlete_id: string;
          user_id: string;
          name: string;
          start_date: string;
          duration_weeks: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          athlete_id?: string;
          user_id: string;
          name: string;
          start_date: string;
          duration_weeks: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["training_plans"]["Insert"]>;
      };
      planned_sessions: {
        Row: {
          id: string;
          plan_id: string;
          athlete_id: string;
          user_id: string;
          date: string;
          sport: "swim" | "bike" | "run" | "strength" | "other";
          type: string;
          duration: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          athlete_id?: string;
          user_id: string;
          date: string;
          sport: "swim" | "bike" | "run" | "strength" | "other";
          type: string;
          duration: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["planned_sessions"]["Insert"]>;
      };
      completed_sessions: {
        Row: {
          id: string;
          athlete_id: string;
          user_id: string;
          garmin_id: string | null;
          date: string;
          sport: string;
          metrics: Json;
          source: "tcx_import" | "garmin_api";
          source_file_name: string | null;
          source_hash: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          athlete_id?: string;
          user_id: string;
          garmin_id: string | null;
          date: string;
          sport: string;
          metrics?: Json;
          source?: "tcx_import" | "garmin_api";
          source_file_name?: string | null;
          source_hash?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["completed_sessions"]["Insert"]>;
      };
      coach_plan_change_proposals: {
        Row: {
          id: string;
          athlete_id: string;
          user_id: string;
          target_session_id: string | null;
          title: string;
          rationale: string;
          change_summary: string;
          proposed_date: string | null;
          proposed_duration_minutes: number | null;
          status: "pending" | "approved" | "rejected";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          athlete_id: string;
          user_id: string;
          target_session_id?: string | null;
          title: string;
          rationale: string;
          change_summary: string;
          proposed_date?: string | null;
          proposed_duration_minutes?: number | null;
          status?: "pending" | "approved" | "rejected";
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["coach_plan_change_proposals"]["Insert"]>;
      };
      discipline_balance_snapshots: {
        Row: {
          id: string;
          user_id: string;
          athlete_id: string;
          snapshot_date: string;
          window_days: number;
          actual_distribution: Json;
          target_distribution: Json;
          target_race_id: string | null;
          deltas: Json;
          total_hours: number | null;
          hours_by_sport: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          athlete_id: string;
          snapshot_date: string;
          window_days?: number;
          actual_distribution: Json;
          target_distribution: Json;
          target_race_id?: string | null;
          deltas: Json;
          total_hours?: number | null;
          hours_by_sport?: Json | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["discipline_balance_snapshots"]["Insert"]>;
      };
      rebalancing_recommendations: {
        Row: {
          id: string;
          user_id: string;
          athlete_id: string;
          snapshot_id: string;
          recommendation_type: "add" | "swap" | "reduce" | "maintain";
          sport: string;
          summary: string;
          rationale: string;
          priority: number;
          status: "active" | "applied" | "dismissed";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          athlete_id: string;
          snapshot_id: string;
          recommendation_type: "add" | "swap" | "reduce" | "maintain";
          sport: string;
          summary: string;
          rationale: string;
          priority?: number;
          status?: "active" | "applied" | "dismissed";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["rebalancing_recommendations"]["Insert"]>;
      };
      race_profiles: {
        Row: {
          id: string;
          user_id: string;
          athlete_id: string;
          name: string;
          date: string;
          distance_type: "sprint" | "olympic" | "70.3" | "ironman" | "custom";
          priority: "A" | "B" | "C";
          course_profile: Json;
          ideal_discipline_distribution: Json | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          athlete_id: string;
          name: string;
          date: string;
          distance_type: "sprint" | "olympic" | "70.3" | "ironman" | "custom";
          priority?: "A" | "B" | "C";
          course_profile?: Json;
          ideal_discipline_distribution?: Json | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["race_profiles"]["Insert"]>;
      };
      seasons: {
        Row: {
          id: string;
          user_id: string;
          athlete_id: string;
          name: string;
          start_date: string;
          end_date: string;
          primary_goal: string | null;
          secondary_goals: string[];
          status: "planning" | "active" | "completed";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          athlete_id: string;
          name: string;
          start_date: string;
          end_date: string;
          primary_goal?: string | null;
          secondary_goals?: string[];
          status?: "planning" | "active" | "completed";
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["seasons"]["Insert"]>;
      };
      season_races: {
        Row: {
          id: string;
          season_id: string;
          race_profile_id: string;
        };
        Insert: {
          id?: string;
          season_id: string;
          race_profile_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["season_races"]["Insert"]>;
      };
      training_blocks: {
        Row: {
          id: string;
          season_id: string | null;
          plan_id: string | null;
          user_id: string;
          name: string;
          block_type: "Base" | "Build" | "Peak" | "Taper" | "Race" | "Recovery" | "Transition";
          start_date: string;
          end_date: string;
          target_race_id: string | null;
          emphasis: Json;
          notes: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          season_id?: string | null;
          plan_id?: string | null;
          user_id: string;
          name: string;
          block_type: "Base" | "Build" | "Peak" | "Taper" | "Race" | "Recovery" | "Transition";
          start_date: string;
          end_date: string;
          target_race_id?: string | null;
          emphasis?: Json;
          notes?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["training_blocks"]["Insert"]>;
      };
      profiles: {
        Row: {
          id: string;
          user_id: string;
          display_name: string | null;
          avatar_url: string | null;
          active_plan_id: string | null;
          race_name: string | null;
          race_date: string | null;
          locale: string;
          units: "metric" | "imperial";
          timezone: string;
          week_start_day: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          active_plan_id?: string | null;
          race_name?: string | null;
          race_date?: string | null;
          locale?: string;
          units?: "metric" | "imperial";
          timezone?: string;
          week_start_day?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      recovery_logs: {
        Row: {
          id: string;
          athlete_id: string;
          user_id: string;
          date: string;
          sleep_hours: number | null;
          fatigue_level: number | null;
          soreness_areas: string[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          athlete_id?: string;
          user_id: string;
          date: string;
          sleep_hours?: number | null;
          fatigue_level?: number | null;
          soreness_areas?: string[] | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["recovery_logs"]["Insert"]>;
      };
    };
  };
};
