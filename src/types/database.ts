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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          athlete_id?: string;
          user_id: string;
          title: string;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          athlete_id?: string;
          user_id: string;
          role: "user" | "assistant";
          content: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_messages"]["Insert"]>;
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
