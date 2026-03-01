import { getWhyTodayMattersCopy, NEXT_ACTION_STATE } from "./next-action-copy";

describe("getWhyTodayMattersCopy", () => {
  it("returns key-session copy for key sessions today", () => {
    expect(
      getWhyTodayMattersCopy(NEXT_ACTION_STATE.SESSION_TODAY, {
        is_key: true,
        type: "Threshold"
      })
    ).toBe("Why today matters: protect quality—hit this as planned.");
  });

  it("returns easy-session copy for easy sessions today", () => {
    expect(
      getWhyTodayMattersCopy(NEXT_ACTION_STATE.SESSION_TODAY, {
        is_key: false,
        type: "Easy aerobic"
      })
    ).toBe("Why today matters: bank easy volume to support upcoming quality.");
  });

  it("returns no-session copy when no session is planned", () => {
    expect(getWhyTodayMattersCopy(NEXT_ACTION_STATE.NO_SESSION_TODAY)).toBe(
      "Why today matters: use the space to recover and protect your next key session."
    );
  });

  it("returns completed-today copy when today's session is already done", () => {
    expect(getWhyTodayMattersCopy(NEXT_ACTION_STATE.SESSION_DONE_TODAY)).toBe(
      "Why today matters: you showed up today—recover well to reinforce consistency."
    );
  });
});
