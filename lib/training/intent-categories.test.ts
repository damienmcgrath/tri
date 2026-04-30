import {
  ALL_INTENT_CATEGORIES,
  INTENT_CATEGORIES_BY_DISCIPLINE,
  getIntentCategoriesForDiscipline,
  isCuratedIntent
} from "./intent-categories";

describe("intent-categories", () => {
  it("provides at least one option per discipline", () => {
    for (const options of Object.values(INTENT_CATEGORIES_BY_DISCIPLINE)) {
      expect(options.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicates within a single discipline", () => {
    for (const options of Object.values(INTENT_CATEGORIES_BY_DISCIPLINE)) {
      expect(new Set(options).size).toBe(options.length);
    }
  });

  it("union covers every discipline option", () => {
    for (const options of Object.values(INTENT_CATEGORIES_BY_DISCIPLINE)) {
      for (const opt of options) {
        expect(ALL_INTENT_CATEGORIES).toContain(opt);
      }
    }
  });

  it("falls back to 'other' when discipline is unknown", () => {
    expect(getIntentCategoriesForDiscipline("multi")).toEqual(INTENT_CATEGORIES_BY_DISCIPLINE.other);
    expect(getIntentCategoriesForDiscipline(null)).toEqual(INTENT_CATEGORIES_BY_DISCIPLINE.other);
  });

  it("isCuratedIntent recognises a known label and rejects free text", () => {
    expect(isCuratedIntent("Easy Z2", "run")).toBe(true);
    expect(isCuratedIntent("Easy Z2", "swim")).toBe(false);
    expect(isCuratedIntent("Custom blast", "run")).toBe(false);
    expect(isCuratedIntent(null, "run")).toBe(false);
  });
});
