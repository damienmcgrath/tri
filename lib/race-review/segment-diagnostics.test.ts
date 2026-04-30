import { buildSegmentDiagnostics } from "./segment-diagnostics";
import type { RaceFacts, RaceSegmentData, RaceProfileForReview } from "@/lib/race-review";

const baseProfile: RaceProfileForReview = {
  id: "rp-1",
  name: "Test Olympic",
  date: "2026-04-15",
  distanceType: "olympic",
  idealDisciplineDistribution: { swim: 0.12, bike: 0.45, run: 0.43 }
};

function bikeSegment(overrides: Partial<RaceSegmentData> = {}): RaceSegmentData {
  return {
    activityId: "bike-1",
    role: "bike",
    segmentIndex: 2,
    sportType: "bike",
    durationSec: 4500,
    distanceM: 40000,
    avgHr: 155,
    avgPower: 220,
    metricsV2: {
      laps: [
        { index: 0, durationSec: 1500, avgPower: 222, avgHr: 152 },
        { index: 1, durationSec: 1500, avgPower: 220, avgHr: 156 },
        { index: 2, durationSec: 1500, avgPower: 218, avgHr: 158 }
      ]
    },
    ...overrides
  };
}

function runSegment(overrides: Partial<RaceSegmentData> = {}): RaceSegmentData {
  return {
    activityId: "run-1",
    role: "run",
    segmentIndex: 4,
    sportType: "run",
    durationSec: 2700,
    distanceM: 10000,
    avgHr: 160,
    avgPower: null,
    metricsV2: {
      laps: [
        { index: 0, durationSec: 600, avgPaceSecPerKm: 270, avgHr: 158, avgCadence: 178 },
        { index: 1, durationSec: 600, avgPaceSecPerKm: 268, avgHr: 160, avgCadence: 178 },
        { index: 2, durationSec: 600, avgPaceSecPerKm: 270, avgHr: 162, avgCadence: 176 },
        { index: 3, durationSec: 450, avgPaceSecPerKm: 272, avgHr: 164, avgCadence: 175 },
        { index: 4, durationSec: 450, avgPaceSecPerKm: 275, avgHr: 166, avgCadence: 174 }
      ]
    },
    ...overrides
  };
}

function swimSegment(): RaceSegmentData {
  return {
    activityId: "swim-1",
    role: "swim",
    segmentIndex: 0,
    sportType: "swim",
    durationSec: 1500,
    distanceM: 1500,
    avgHr: 145,
    avgPower: null,
    metricsV2: {
      laps: [
        { index: 0, durationSec: 750, avgPacePer100mSec: 100, avgHr: 142 },
        { index: 1, durationSec: 750, avgPacePer100mSec: 100, avgHr: 148 }
      ]
    }
  };
}

function t1Segment(durationSec: number): RaceSegmentData {
  return {
    activityId: "t1-1",
    role: "t1",
    segmentIndex: 1,
    sportType: "transition",
    durationSec,
    distanceM: null,
    avgHr: 145,
    avgPower: null,
    metricsV2: { laps: [{ index: 0, durationSec, avgHr: 145 }] }
  };
}

function t2Segment(durationSec: number): RaceSegmentData {
  return {
    activityId: "t2-1",
    role: "t2",
    segmentIndex: 3,
    sportType: "transition",
    durationSec,
    distanceM: null,
    avgHr: 158,
    avgPower: null,
    metricsV2: { laps: [{ index: 0, durationSec, avgHr: 158 }] }
  };
}

function makeFacts(overrides: Partial<RaceFacts> = {}): RaceFacts {
  const segments = overrides.segments ?? [swimSegment(), t1Segment(120), bikeSegment(), t2Segment(85), runSegment()];
  const totalDurationSec = segments.reduce((s, seg) => s + seg.durationSec, 0);
  return {
    bundle: {
      id: "rb-1",
      startedAt: "2026-04-15T07:00:00Z",
      endedAt: null,
      totalDurationSec,
      totalDistanceM: 51500,
      source: "garmin_multisport",
      goalTimeSec: 9000,
      goalStrategySummary: null,
      preRaceCtl: null,
      preRaceAtl: null,
      preRaceTsb: null,
      preRaceTsbState: null,
      taperComplianceScore: null,
      taperComplianceSummary: null,
      athleteRating: 4,
      athleteNotes: null,
      issuesFlagged: [],
      finishPosition: null,
      ageGroupPosition: null,
      subjectiveCapturedAt: "2026-04-15T20:00:00Z",
      inferredTransitions: false
    },
    segments,
    plannedSession: null,
    raceProfile: baseProfile,
    disciplineDistributionActual: {},
    disciplineDistributionDelta: null,
    pacing: {
      bike: { halvesAvailable: true, firstHalf: 222, lastHalf: 218, deltaPct: -1.8, unit: "watts" },
      run: { halvesAvailable: true, firstHalf: 269, lastHalf: 273, deltaPct: 1.5, unit: "sec_per_km" },
      swim: { halvesAvailable: true, firstHalf: 100, lastHalf: 100, deltaPct: 0, unit: "sec_per_100m" }
    },
    transitions: { t1DurationSec: 120, t2DurationSec: 85 },
    goalDeltaSec: totalDurationSec - 9000,
    hrDrift: { swim: 6, bike: 6, run: 8 },
    legStatus: { swim: null, bike: null, run: null },
    crossDisciplineSignal: { detected: false },
    emotionalFrameTriggered: false,
    ...overrides
  };
}

describe("buildSegmentDiagnostics", () => {
  it("produces one packet per discipline that has data", () => {
    const out = buildSegmentDiagnostics({
      facts: makeFacts(),
      ftpAtRace: 250,
      priorRace: null,
      comparableCandidates: []
    });
    expect(out.diagnostics.map((d) => d.discipline).sort()).toEqual(["bike", "run", "swim"]);
  });

  it("populates vsThreshold for bike when FTP is known, null for swim/run", () => {
    const out = buildSegmentDiagnostics({
      facts: makeFacts(),
      ftpAtRace: 250,
      priorRace: null,
      comparableCandidates: []
    });
    const bike = out.diagnostics.find((d) => d.discipline === "bike")!;
    expect(bike.referenceFrames.vsThreshold).not.toBeNull();
    expect(bike.referenceFrames.vsThreshold!.intensityFactor).toBeCloseTo(220 / 250, 2);
    expect(out.diagnostics.find((d) => d.discipline === "run")!.referenceFrames.vsThreshold).toBeNull();
    expect(out.diagnostics.find((d) => d.discipline === "swim")!.referenceFrames.vsThreshold).toBeNull();
  });

  it("vsThreshold is null when FTP unknown", () => {
    const out = buildSegmentDiagnostics({
      facts: makeFacts(),
      ftpAtRace: null,
      priorRace: null,
      comparableCandidates: []
    });
    expect(out.diagnostics.find((d) => d.discipline === "bike")!.referenceFrames.vsThreshold).toBeNull();
  });

  it("vsPriorRace is null when no prior race provided", () => {
    const out = buildSegmentDiagnostics({
      facts: makeFacts(),
      ftpAtRace: null,
      priorRace: null,
      comparableCandidates: []
    });
    for (const diag of out.diagnostics) {
      expect(diag.referenceFrames.vsPriorRace).toBeNull();
    }
  });

  it("vsPriorRace populates when prior race carries the same leg", () => {
    const out = buildSegmentDiagnostics({
      facts: makeFacts(),
      ftpAtRace: null,
      priorRace: {
        bundleId: "prior-rb",
        raceName: "Prior Olympic",
        raceDate: "2026-01-15",
        legDurations: { swim: 1700, bike: 4800, run: 2900 }
      },
      comparableCandidates: []
    });
    const bike = out.diagnostics.find((d) => d.discipline === "bike")!;
    expect(bike.referenceFrames.vsPriorRace).not.toBeNull();
    expect(bike.referenceFrames.vsPriorRace!.raceName).toBe("Prior Olympic");
    expect(bike.referenceFrames.vsPriorRace!.comparison).toMatch(/faster than|slower than|matched/);
  });

  it("vsBestComparableTraining null when pool is empty", () => {
    const out = buildSegmentDiagnostics({
      facts: makeFacts(),
      ftpAtRace: null,
      priorRace: null,
      comparableCandidates: []
    });
    for (const diag of out.diagnostics) {
      expect(diag.referenceFrames.vsBestComparableTraining).toBeNull();
    }
  });

  it("vsBestComparableTraining populates when a strong match exists", () => {
    const out = buildSegmentDiagnostics({
      facts: makeFacts(),
      ftpAtRace: null,
      priorRace: null,
      comparableCandidates: [
        {
          sessionId: "best-bike",
          date: "2026-04-01",
          sport: "bike",
          durationSec: 4500,
          sessionName: "Race-pace 40km TT",
          type: "tempo",
          sessionRole: "key"
        }
      ]
    });
    const bike = out.diagnostics.find((d) => d.discipline === "bike")!;
    expect(bike.referenceFrames.vsBestComparableTraining).not.toBeNull();
    expect(bike.referenceFrames.vsBestComparableTraining!.sessionId).toBe("best-bike");
  });

  it("transitions analysis is null for inferred transitions", () => {
    const facts = makeFacts({
      bundle: { ...makeFacts().bundle, inferredTransitions: true }
    });
    const out = buildSegmentDiagnostics({
      facts,
      ftpAtRace: null,
      priorRace: null,
      comparableCandidates: []
    });
    expect(out.transitionsAnalysis).toBeNull();
  });

  it("transitions analysis surfaces population medians for known distance", () => {
    const out = buildSegmentDiagnostics({
      facts: makeFacts(),
      ftpAtRace: null,
      priorRace: null,
      comparableCandidates: []
    });
    expect(out.transitionsAnalysis).not.toBeNull();
    expect(out.transitionsAnalysis!.t1!.populationMedianSec).toBe(150); // olympic
    expect(out.transitionsAnalysis!.t2!.populationMedianSec).toBe(90);
    expect(out.transitionsAnalysis!.t1!.summary).toMatch(/typical/);
  });
});
