export type Sport = "swim" | "bike" | "run" | "strength" | "other";

export type BlockType =
  | "Base"
  | "Build"
  | "Peak"
  | "Taper"
  | "Race"
  | "Recovery"
  | "Transition";

export type WeekFocus = "Build" | "Recovery" | "Taper" | "Race" | "Custom";

export type SeedSession = {
  date: string;
  sport: Sport;
  sessionName: string;
  durationMinutes: number;
  discipline?: string;
  subtype?: string;
  target?: string;
  notes?: string;
  dayOrder?: number;
  reconstructed?: boolean;
};

export type SeedWeek = {
  weekIndex: number;
  weekStartDate: string;
  focus: WeekFocus;
  notes?: string;
  sessions: SeedSession[];
};

export type SeedBlock = {
  name: string;
  blockType: BlockType;
  startDate: string;
  endDate: string;
  emphasis: string[];
  weeks: SeedWeek[];
};

export type SeedPlan = {
  seasonName: string;
  raceName: string;
  raceDate: string;
  planName: string;
  planStartDate: string;
  durationWeeks: number;
  blocks: SeedBlock[];
};
