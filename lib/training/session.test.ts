import { getOptionalSessionRoleLabel, getSessionDisplayName, normalizeSessionModel } from "./session";

describe("session helpers", () => {
  it("prefers explicit session names when non-generic", () => {
    expect(getSessionDisplayName({ sessionName: "Long Brick" })).toBe("Long Brick");
  });

  it("builds subtype + discipline fallback when explicit name is generic", () => {
    expect(getSessionDisplayName({ sessionName: "Session", subtype: "Aerobic", discipline: "swim" })).toBe("Aerobic Swim");
  });

  it("falls back to discipline-only label and never returns generic Session", () => {
    expect(getSessionDisplayName({ sessionName: "Session", discipline: "run" })).toBe("Run");
  });

  it("normalizes enriched session fields", () => {
    expect(
      normalizeSessionModel({
        sport: "bike",
        type: "Endurance",
        duration_minutes: 90,
        intent_category: "z2_endurance",
        session_role: "Key"
      })
    ).toMatchObject({
      discipline: "bike",
      subtype: "Endurance",
      durationMinutes: 90,
      intentCategory: "z2_endurance",
      role: "key"
    });
  });

  it("returns null optional role label when role is unset", () => {
    expect(getOptionalSessionRoleLabel({ sport: "run" })).toBeNull();
  });
});
