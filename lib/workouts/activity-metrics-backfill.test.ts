jest.mock("./activity-parser", () => ({
  parseFitFile: jest.fn(),
  parseTcxFile: jest.fn(),
  isMultisportParseResult: (result: unknown) =>
    typeof result === "object" && result !== null && (result as { kind?: string }).kind === "multisport"
}));

import { backfillActivityMetrics } from "./activity-metrics-backfill";
import { parseFitFile } from "./activity-parser";

describe("backfillActivityMetrics", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("reparses retained upload payloads and updates only rows missing rich metrics", async () => {
    const completedSelect = {
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          {
            id: "activity-needs-backfill",
            upload_id: "upload-fit-1",
            metrics_v2: { schemaVersion: 1 }
          },
          {
            id: "activity-already-rich",
            upload_id: "upload-fit-2",
            metrics_v2: {
              summary: { durationSec: 3600 },
              laps: [],
              activity: { normalizedType: "bike" },
              power: { normalizedPower: 210 },
              zones: { power: [] }
            }
          }
        ],
        error: null
      })
    };

    const uploadsSelect = {
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({
        data: [
          {
            id: "upload-fit-1",
            file_type: "fit",
            raw_file_base64: Buffer.from("fit-binary").toString("base64"),
            storage_key: null
          }
        ],
        error: null
      })
    };

    const updateEqUser = jest.fn().mockResolvedValue({ error: null });
    const updateEqId = jest.fn().mockReturnValue({ eq: updateEqUser });
    const completedUpdate = jest.fn().mockReturnValue({ eq: updateEqId });

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "completed_activities") {
          return {
            select: jest.fn(() => completedSelect),
            update: completedUpdate
          };
        }

        if (table === "activity_uploads") {
          return {
            select: jest.fn(() => uploadsSelect)
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      })
    } as any;

    (parseFitFile as jest.Mock).mockResolvedValue({
      sportType: "bike",
      startTimeUtc: "2026-03-14T11:29:41.000Z",
      endTimeUtc: "2026-03-14T12:29:41.000Z",
      durationSec: 3600,
      distanceM: 40000,
      avgHr: 145,
      avgPower: 180,
      calories: 950,
      movingDurationSec: 3600,
      elapsedDurationSec: 3660,
      lapsCount: 2,
      avgCadence: 84,
      maxHr: 171,
      maxPower: 310,
      activityTypeRaw: "cycling",
      activitySubtypeRaw: "indoor_cycling",
      activityVendor: "garmin",
      metricsV2: {
        summary: { durationSec: 3600 },
        activity: { normalizedType: "bike" },
        power: { normalizedPower: 195 },
        zones: { power: [{ zone: 2, durationSec: 600 }] },
        laps: [{ index: 1 }]
      },
      parseSummary: { records: 1000 }
    });

    const result = await backfillActivityMetrics({
      supabase,
      userId: "user-1"
    });

    expect(result).toEqual({
      attempted: 1,
      updated: 1,
      skipped: 0,
      failed: 0
    });
    expect(parseFitFile).toHaveBeenCalledTimes(1);
    expect(completedUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sport_type: "bike",
      metrics_v2: expect.objectContaining({
        power: { normalizedPower: 195 },
        quality: expect.objectContaining({
          warnings: ["backfilled_from_raw_upload"]
        })
      })
    }));
    expect(updateEqId).toHaveBeenCalledWith("id", "activity-needs-backfill");
    expect(updateEqUser).toHaveBeenCalledWith("user_id", "user-1");
  });
});
