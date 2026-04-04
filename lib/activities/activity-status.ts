import { hasConfirmedPlannedSessionLink } from "@/lib/activities/completed-activities";

type ActivityClassification = "linked" | "extra" | "unreviewed";

/**
 * Single source of truth for determining an activity's classification.
 * - "linked": activity has a confirmed link to a planned session
 * - "extra": activity is explicitly marked as unplanned or has a rejected link
 * - "unreviewed": activity is not linked and not explicitly marked extra (new upload limbo)
 */
export function classifyActivityStatus(params: {
  activityId: string;
  isUnplanned: boolean;
  links: Array<{
    completed_activity_id: string;
    planned_session_id?: string | null;
    confirmation_status?: "suggested" | "confirmed" | "rejected" | null;
  }>;
}): ActivityClassification {
  const { activityId, isUnplanned, links } = params;

  const activityLinks = links.filter((link) => link.completed_activity_id === activityId);

  if (activityLinks.some(hasConfirmedPlannedSessionLink)) {
    return "linked";
  }

  if (isUnplanned) {
    return "extra";
  }

  if (activityLinks.some((link) => link.confirmation_status === "rejected")) {
    return "extra";
  }

  return "unreviewed";
}
