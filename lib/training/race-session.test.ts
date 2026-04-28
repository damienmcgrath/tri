import { isRaceSession } from "./race-session";

describe("isRaceSession", () => {
  it("returns true when type contains the word race", () => {
    expect(isRaceSession({ type: "Olympic (race)" })).toBe(true);
    expect(isRaceSession({ type: "Race" })).toBe(true);
    expect(isRaceSession({ type: "RACE" })).toBe(true);
  });

  it("returns true when session_name contains the word race", () => {
    expect(isRaceSession({ type: "Other", session_name: "Joe Hannon Olympic (race)" })).toBe(true);
  });

  it("returns false for non-race sessions", () => {
    expect(isRaceSession({ type: "Easy Run" })).toBe(false);
    expect(isRaceSession({ type: "FTP", session_name: "Threshold" })).toBe(false);
    expect(isRaceSession({})).toBe(false);
    expect(isRaceSession(null)).toBe(false);
  });

  it("does not match substrings of other words", () => {
    expect(isRaceSession({ type: "Embrace" })).toBe(false);
    expect(isRaceSession({ session_name: "Tracer Drill" })).toBe(false);
  });
});
