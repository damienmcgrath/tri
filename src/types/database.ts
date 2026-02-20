export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Database = {
  public: {
    Tables: {
      ai_conversations: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
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
          user_id: string;
          role: "user" | "assistant";
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
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
          user_id: string;
          name: string;
          start_date: string;
          duration_weeks: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          start_date: string;
          duration_weeks: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["training_plans"]["Insert"]>;
      };
      planned_sessions: {
        Row: {
          id: string;
          plan_id: string;
          date: string;
          sport: "swim" | "bike" | "run" | "strength" | "other";
          session_type: string;
          duration_minutes: number;
          intensity: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          date: string;
          sport: "swim" | "bike" | "run" | "strength" | "other";
          session_type: string;
          duration_minutes: number;
          intensity?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["planned_sessions"]["Insert"]>;
      };
      completed_sessions: {
        Row: {
          id: string;
          user_id: string;
          garmin_id: string | null;
          date: string;
          sport: string;
          metrics: Json;
          completion_status: "completed" | "missed" | "partial";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          garmin_id?: string | null;
          date: string;
          sport: string;
          metrics?: Json;
          completion_status?: "completed" | "missed" | "partial";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["completed_sessions"]["Insert"]>;
      };
      recovery_logs: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          sleep_hours: number | null;
          fatigue_level: number | null;
          soreness_areas: string[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
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
