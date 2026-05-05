import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import {
  getFindingsForSession,
  supersedeFindings,
  upsertFindings
} from "./persist";
import type { Finding } from "./types";

type ChainResult = { data: unknown; error: unknown };

interface MockBuilderHandlers {
  onAwait?: jest.Mock<Promise<ChainResult>, []>;
  onMaybeSingle?: jest.Mock<Promise<ChainResult>, []>;
}

interface MockBuilder {
  upsert: jest.Mock;
  select: jest.Mock;
  update: jest.Mock;
  eq: jest.Mock;
  is: jest.Mock;
  order: jest.Mock;
  maybeSingle: jest.Mock<Promise<ChainResult>, []>;
  then: (resolve: (value: ChainResult) => void) => void;
}

function makeBuilder(handlers: MockBuilderHandlers): MockBuilder {
  const builder: MockBuilder = {
    upsert: jest.fn(() => builder),
    select: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    is: jest.fn(() => builder),
    order: jest.fn(() => builder),
    maybeSingle:
      handlers.onMaybeSingle ??
      jest.fn(async () => ({ data: null, error: null })),
    then: (resolve) => {
      const fn =
        handlers.onAwait ??
        (jest.fn(async () => ({ data: null, error: null })) as jest.Mock<
          Promise<ChainResult>,
          []
        >);
      return fn().then(resolve);
    }
  };
  return builder;
}

function makeSupabase(builders: MockBuilder[]): {
  client: SupabaseClient;
  from: jest.Mock;
} {
  let i = 0;
  const from = jest.fn((_table: string) => {
    const next = builders[i] ?? builders[builders.length - 1];
    i += 1;
    return next;
  });
  return {
    client: { from } as unknown as SupabaseClient,
    from
  };
}

const sampleFinding: Finding = {
  id: "drift_high",
  analyzer_id: "decoupling",
  analyzer_version: "1.0.0",
  category: "durability",
  polarity: "concern",
  severity: 2,
  headline: "Heart-rate drift exceeded threshold",
  evidence: [{ metric: "drift_pct", value: 8.4, unit: "%" }],
  reasoning: "Pa:Hr decoupling > 5% in second half of session.",
  prescription: {
    text: "Add a low-Z2 ride to rebuild aerobic depth.",
    confidence: "medium"
  },
  scope: "session"
};

describe("upsertFindings", () => {
  it("no-ops when findings array is empty", async () => {
    const { client, from } = makeSupabase([]);
    await upsertFindings("session-1", "user-1", [], client);
    expect(from).not.toHaveBeenCalled();
  });

  it("calls upsert with the correct conflict target and payload", async () => {
    const builder = makeBuilder({
      onAwait: jest.fn(async () => ({ data: null, error: null }))
    });
    const { client, from } = makeSupabase([builder]);

    await upsertFindings("session-1", "user-1", [sampleFinding], client);

    expect(from).toHaveBeenCalledWith("findings");
    expect(builder.upsert).toHaveBeenCalledTimes(1);
    const [payload, options] = builder.upsert.mock.calls[0];
    expect(options).toEqual({
      onConflict: "session_id,finding_id,analyzer_version"
    });
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      session_id: "session-1",
      user_id: "user-1",
      finding_id: "drift_high",
      analyzer_id: "decoupling",
      analyzer_version: "1.0.0",
      category: "durability",
      polarity: "concern",
      severity: 2,
      scope: "session",
      prescription: sampleFinding.prescription,
      // optional fields not set on the input become null in the row
      visual: null,
      conditional_on: null,
      scope_ref: null
    });
  });

  it("idempotent re-insert hits the same conflict target without throwing", async () => {
    const first = makeBuilder({
      onAwait: jest.fn(async () => ({ data: null, error: null }))
    });
    const second = makeBuilder({
      onAwait: jest.fn(async () => ({ data: null, error: null }))
    });
    const { client } = makeSupabase([first, second]);

    await upsertFindings("session-1", "user-1", [sampleFinding], client);
    await upsertFindings("session-1", "user-1", [sampleFinding], client);

    expect(first.upsert.mock.calls[0][1]).toEqual({
      onConflict: "session_id,finding_id,analyzer_version"
    });
    expect(second.upsert.mock.calls[0][1]).toEqual({
      onConflict: "session_id,finding_id,analyzer_version"
    });
  });

  it("propagates supabase errors", async () => {
    const builder = makeBuilder({
      onAwait: jest.fn(async () => ({
        data: null,
        error: { message: "boom" }
      }))
    });
    const { client } = makeSupabase([builder]);

    await expect(
      upsertFindings("session-1", "user-1", [sampleFinding], client)
    ).rejects.toThrow(/upsertFindings: boom/);
  });
});

describe("getFindingsForSession", () => {
  it("filters by session, excludes superseded rows, and maps DB rows to Finding", async () => {
    const builder = makeBuilder({
      onAwait: jest.fn(async () => ({
        data: [
          {
            id: "row-1",
            session_id: "session-1",
            user_id: "user-1",
            finding_id: "drift_high",
            analyzer_id: "decoupling",
            analyzer_version: "1.0.0",
            category: "durability",
            polarity: "concern",
            severity: 2,
            headline: "Heart-rate drift exceeded threshold",
            evidence: [{ metric: "drift_pct", value: 8.4, unit: "%" }],
            reasoning: "...",
            prescription: null,
            visual: null,
            conditional_on: null,
            scope: "session",
            scope_ref: null,
            generated_at: "2026-05-05T10:00:00.000Z",
            superseded_by: null
          }
        ],
        error: null
      }))
    });
    const { client } = makeSupabase([builder]);

    const result = await getFindingsForSession("session-1", client);

    expect(builder.eq).toHaveBeenCalledWith("session_id", "session-1");
    expect(builder.is).toHaveBeenCalledWith("superseded_by", null);
    expect(builder.order).toHaveBeenCalledWith("generated_at", {
      ascending: true
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "drift_high",
      analyzer_id: "decoupling",
      analyzer_version: "1.0.0",
      scope: "session"
    });
    // Optional unset fields are absent (not null) on the Finding shape.
    expect(result[0]).not.toHaveProperty("prescription");
    expect(result[0]).not.toHaveProperty("visual");
    expect(result[0]).not.toHaveProperty("scope_ref");
  });

  it("returns [] when no rows are found", async () => {
    const builder = makeBuilder({
      onAwait: jest.fn(async () => ({ data: [], error: null }))
    });
    const { client } = makeSupabase([builder]);
    const result = await getFindingsForSession("session-1", client);
    expect(result).toEqual([]);
  });

  it("propagates supabase errors", async () => {
    const builder = makeBuilder({
      onAwait: jest.fn(async () => ({
        data: null,
        error: { message: "denied" }
      }))
    });
    const { client } = makeSupabase([builder]);
    await expect(getFindingsForSession("s", client)).rejects.toThrow(
      /getFindingsForSession: denied/
    );
  });
});

describe("supersedeFindings", () => {
  it("inserts the new row, then points the old row's superseded_by at it", async () => {
    const insertBuilder = makeBuilder({
      onMaybeSingle: jest.fn(async () => ({
        data: { id: "new-row-id" },
        error: null
      }))
    });
    const updateBuilder = makeBuilder({
      onAwait: jest.fn(async () => ({ data: null, error: null }))
    });
    const { client, from } = makeSupabase([insertBuilder, updateBuilder]);

    await supersedeFindings(
      "old-row-id",
      sampleFinding,
      "user-1",
      "session-1",
      client
    );

    expect(from).toHaveBeenNthCalledWith(1, "findings");
    expect(insertBuilder.upsert).toHaveBeenCalledTimes(1);
    expect(insertBuilder.upsert.mock.calls[0][1]).toEqual({
      onConflict: "session_id,finding_id,analyzer_version"
    });
    expect(insertBuilder.select).toHaveBeenCalledWith("id");
    expect(insertBuilder.maybeSingle).toHaveBeenCalled();

    expect(from).toHaveBeenNthCalledWith(2, "findings");
    expect(updateBuilder.update).toHaveBeenCalledWith({
      superseded_by: "new-row-id"
    });
    expect(updateBuilder.eq).toHaveBeenCalledWith("id", "old-row-id");
  });

  it("throws if the insert returns no row id", async () => {
    const insertBuilder = makeBuilder({
      onMaybeSingle: jest.fn(async () => ({ data: null, error: null }))
    });
    const { client } = makeSupabase([insertBuilder]);

    await expect(
      supersedeFindings(
        "old-row-id",
        sampleFinding,
        "user-1",
        "session-1",
        client
      )
    ).rejects.toThrow(/insert returned no row id/);
  });

  it("propagates insert errors without attempting the update", async () => {
    const insertBuilder = makeBuilder({
      onMaybeSingle: jest.fn(async () => ({
        data: null,
        error: { message: "rls-denied" }
      }))
    });
    const updateBuilder = makeBuilder({
      onAwait: jest.fn(async () => ({ data: null, error: null }))
    });
    const { client, from } = makeSupabase([insertBuilder, updateBuilder]);

    await expect(
      supersedeFindings(
        "old-row-id",
        sampleFinding,
        "user-1",
        "session-1",
        client
      )
    ).rejects.toThrow(/supersedeFindings insert: rls-denied/);
    // Update never ran.
    expect(from).toHaveBeenCalledTimes(1);
    expect(updateBuilder.update).not.toHaveBeenCalled();
  });

  it("propagates update errors after the insert succeeded", async () => {
    const insertBuilder = makeBuilder({
      onMaybeSingle: jest.fn(async () => ({
        data: { id: "new-row-id" },
        error: null
      }))
    });
    const updateBuilder = makeBuilder({
      onAwait: jest.fn(async () => ({
        data: null,
        error: { message: "conflict" }
      }))
    });
    const { client } = makeSupabase([insertBuilder, updateBuilder]);

    await expect(
      supersedeFindings(
        "old-row-id",
        sampleFinding,
        "user-1",
        "session-1",
        client
      )
    ).rejects.toThrow(/supersedeFindings update: conflict/);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — gated behind SUPABASE_INTEGRATION=true so unit-test runs
// stay hermetic. Verifies the RLS policy round-trip end-to-end.
// ---------------------------------------------------------------------------

const integrationEnabled = process.env.SUPABASE_INTEGRATION === "true";
const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("findings persistence — Supabase integration", () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const userAEmail = process.env.SUPABASE_TEST_USER_A_EMAIL ?? "";
  const userAPassword = process.env.SUPABASE_TEST_USER_A_PASSWORD ?? "";
  const userBEmail = process.env.SUPABASE_TEST_USER_B_EMAIL ?? "";
  const userBPassword = process.env.SUPABASE_TEST_USER_B_PASSWORD ?? "";
  const userASessionId = process.env.SUPABASE_TEST_USER_A_SESSION_ID ?? "";

  function clientForUser(email: string, password: string) {
    const c = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return { c, email, password };
  }

  async function signIn(c: SupabaseClient, email: string, password: string) {
    const { data, error } = await c.auth.signInWithPassword({
      email,
      password
    });
    if (error || !data.user) throw error ?? new Error("no user");
    return data.user;
  }

  it("RLS happy path: a user can write and read their own findings", async () => {
    const { c } = clientForUser(userAEmail, userAPassword);
    const user = await signIn(c, userAEmail, userAPassword);

    const finding: Finding = {
      ...sampleFinding,
      analyzer_version: `int-${Date.now()}`
    };
    await upsertFindings(userASessionId, user.id, [finding], c);
    const read = await getFindingsForSession(userASessionId, c);
    expect(read.some((f) => f.analyzer_version === finding.analyzer_version)).toBe(
      true
    );
  });

  it("RLS denies cross-user reads of another user's session findings", async () => {
    const { c: ca } = clientForUser(userAEmail, userAPassword);
    const userA = await signIn(ca, userAEmail, userAPassword);
    const finding: Finding = {
      ...sampleFinding,
      analyzer_version: `int-cross-${Date.now()}`
    };
    await upsertFindings(userASessionId, userA.id, [finding], ca);

    const { c: cb } = clientForUser(userBEmail, userBPassword);
    await signIn(cb, userBEmail, userBPassword);
    const read = await getFindingsForSession(userASessionId, cb);
    // RLS hides rows; result must not contain user A's marker.
    expect(read.some((f) => f.analyzer_version === finding.analyzer_version)).toBe(
      false
    );
  });
});
