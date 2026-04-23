import { classifyActivityStatus } from "./activity-status";

describe("classifyActivityStatus", () => {
  it("returns 'linked' when activity has a confirmed link", () => {
    expect(
      classifyActivityStatus({
        activityId: "a1",
        isUnplanned: false,
        links: [{ completed_activity_id: "a1", planned_session_id: "s1", confirmation_status: "confirmed" }]
      })
    ).toBe("linked");
  });

  it("returns 'linked' when link has null confirmation_status (legacy confirmed)", () => {
    expect(
      classifyActivityStatus({
        activityId: "a1",
        isUnplanned: false,
        links: [{ completed_activity_id: "a1", planned_session_id: "s1", confirmation_status: null }]
      })
    ).toBe("linked");
  });

  it("returns 'extra' when is_unplanned is true", () => {
    expect(
      classifyActivityStatus({
        activityId: "a1",
        isUnplanned: true,
        links: []
      })
    ).toBe("extra");
  });

  it("returns 'extra' when link has rejected confirmation_status", () => {
    expect(
      classifyActivityStatus({
        activityId: "a1",
        isUnplanned: false,
        links: [{ completed_activity_id: "a1", planned_session_id: "s1", confirmation_status: "rejected" }]
      })
    ).toBe("extra");
  });

  it("returns 'extra' for a rejected link with null planned_session_id (mark-as-extra sentinel)", () => {
    expect(
      classifyActivityStatus({
        activityId: "a1",
        isUnplanned: false,
        links: [{ completed_activity_id: "a1", planned_session_id: null, confirmation_status: "rejected" }]
      })
    ).toBe("extra");
  });

  it("returns 'unreviewed' for new upload with no links", () => {
    expect(
      classifyActivityStatus({
        activityId: "a1",
        isUnplanned: false,
        links: []
      })
    ).toBe("unreviewed");
  });

  it("returns 'unreviewed' for upload with only suggested links", () => {
    expect(
      classifyActivityStatus({
        activityId: "a1",
        isUnplanned: false,
        links: [{ completed_activity_id: "a1", planned_session_id: "s1", confirmation_status: "suggested" }]
      })
    ).toBe("unreviewed");
  });

  it("prefers 'linked' over 'extra' when both confirmed and rejected links exist", () => {
    expect(
      classifyActivityStatus({
        activityId: "a1",
        isUnplanned: true,
        links: [
          { completed_activity_id: "a1", planned_session_id: "s1", confirmation_status: "confirmed" },
          { completed_activity_id: "a1", planned_session_id: "s2", confirmation_status: "rejected" }
        ]
      })
    ).toBe("linked");
  });

  it("ignores links for other activities", () => {
    expect(
      classifyActivityStatus({
        activityId: "a1",
        isUnplanned: false,
        links: [{ completed_activity_id: "a2", planned_session_id: "s1", confirmation_status: "confirmed" }]
      })
    ).toBe("unreviewed");
  });
});
