import { executeCoachTool } from "@/lib/coach/tool-handlers";
import {
  createServiceRoleClient,
  createUserScopedClient,
  readSupabaseTestEnv,
  seedCoachSecurityDataset,
  type SeededCoachDataset
} from "@/test/helpers/supabase-rls";

describe("coach tool handlers - Supabase RLS integration", () => {
  const env = readSupabaseTestEnv();

  const runIfConfigured = env ? describe : describe.skip;

  runIfConfigured("with local/test Supabase configured", () => {
    let dataset: SeededCoachDataset;

    beforeAll(async () => {
      if (!env) {
        return;
      }

      jest.setTimeout(30_000);
      const admin = createServiceRoleClient(env);
      dataset = await seedCoachSecurityDataset(admin);
    });

    it("user A can read own athlete-linked rows through coaching tool path", async () => {
      if (!env) {
        return;
      }

      const userAClient = await createUserScopedClient(env, dataset.athleteA.email, dataset.athleteA.password);
      const result = await executeCoachTool(
        "get_recent_sessions",
        { daysBack: 3650 },
        {
          supabase: userAClient,
          ctx: {
            userId: dataset.athleteA.userId,
            athleteId: dataset.athleteA.userId,
            email: dataset.athleteA.email
          }
        }
      );

      expect(result).toMatchObject({
        completed: expect.arrayContaining([
          expect.objectContaining({
            sport: "run"
          })
        ]),
        planned: expect.arrayContaining([
          expect.objectContaining({
            id: dataset.athleteA.sessionId,
            sport: "run"
          })
        ])
      });
    });

    it("user A cannot read user B rows and user B cannot read user A rows", async () => {
      if (!env) {
        return;
      }

      const userAClient = await createUserScopedClient(env, dataset.athleteA.email, dataset.athleteA.password);
      const userBClient = await createUserScopedClient(env, dataset.athleteB.email, dataset.athleteB.password);

      const { data: userASeesB, error: userAReadError } = await userAClient
        .from("sessions")
        .select("id")
        .eq("id", dataset.athleteB.sessionId);
      const { data: userBSeesA, error: userBReadError } = await userBClient
        .from("sessions")
        .select("id")
        .eq("id", dataset.athleteA.sessionId);

      expect(userAReadError).toBeNull();
      expect(userBReadError).toBeNull();
      expect(userASeesB).toEqual([]);
      expect(userBSeesA).toEqual([]);
    });

    it("user A cannot create a proposal for user B session, but can for own session", async () => {
      if (!env) {
        return;
      }

      const userAClient = await createUserScopedClient(env, dataset.athleteA.email, dataset.athleteA.password);

      await expect(
        executeCoachTool(
          "create_plan_change_proposal",
          {
            title: "Try to alter B",
            rationale: "Should fail",
            changeSummary: "Move to easy day",
            targetSessionId: dataset.athleteB.sessionId
          },
          {
            supabase: userAClient,
            ctx: {
              userId: dataset.athleteA.userId,
              athleteId: dataset.athleteA.userId,
              email: dataset.athleteA.email
            }
          }
        )
      ).rejects.toThrow("not owned by current athlete");

      const ownProposal = await executeCoachTool(
        "create_plan_change_proposal",
        {
          title: "Adjust own session",
          rationale: "High fatigue",
          changeSummary: "Cut 10 minutes",
          targetSessionId: dataset.athleteA.sessionId,
          proposedDurationMinutes: 40
        },
        {
          supabase: userAClient,
          ctx: {
            userId: dataset.athleteA.userId,
            athleteId: dataset.athleteA.userId,
            email: dataset.athleteA.email
          }
        }
      );

      expect(ownProposal).toMatchObject({
        title: "Adjust own session",
        status: "pending",
        proposedDurationMinutes: 40
      });
    });
  });
});
