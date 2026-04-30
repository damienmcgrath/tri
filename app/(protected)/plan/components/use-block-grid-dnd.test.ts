import {
  DROPPABLE_ID_SEPARATOR,
  makeDroppableId,
  parseDroppableId
} from "./use-block-grid-dnd";

describe("droppable id helpers", () => {
  it("round-trips a (weekId, date) pair through make + parse", () => {
    const id = makeDroppableId("wk-1", "2026-05-04");
    expect(id).toContain(DROPPABLE_ID_SEPARATOR);
    expect(parseDroppableId(id)).toEqual({ weekId: "wk-1", date: "2026-05-04" });
  });

  it("returns null for a malformed id", () => {
    expect(parseDroppableId("no-separator-here")).toBeNull();
  });

  it("preserves uuids that contain hyphens but not the separator", () => {
    const weekId = "11111111-1111-4111-8111-111111111111";
    const id = makeDroppableId(weekId, "2026-05-04");
    expect(parseDroppableId(id)).toEqual({ weekId, date: "2026-05-04" });
  });
});
