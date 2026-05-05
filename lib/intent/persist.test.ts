import type { SupabaseClient } from "@supabase/supabase-js";

import { loadResolvedIntent, saveResolvedIntent } from "./persist";
import type { ResolvedIntent } from "./types";

type ChainResult = { data: unknown; error: unknown };

interface BuilderHandlers {
  onAwait?: () => Promise<ChainResult>;
  onMaybeSingle?: () => Promise<ChainResult>;
}

function makeBuilder(handlers: BuilderHandlers) {
  const builder: Record<string, unknown> = {};
  builder.update = jest.fn(() => builder);
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.maybeSingle = jest.fn(
    handlers.onMaybeSingle ?? (async () => ({ data: null, error: null })),
  );
  builder.then = (resolve: (value: ChainResult) => void) => {
    const fn = handlers.onAwait ?? (async () => ({ data: null, error: null }));
    return fn().then(resolve);
  };
  return builder;
}

function makeSupabase(builders: ReturnType<typeof makeBuilder>[]) {
  let i = 0;
  const from = jest.fn((_table: string) => {
    const next = builders[i] ?? builders[builders.length - 1];
    i += 1;
    return next;
  });
  return { client: { from } as unknown as SupabaseClient, from };
}

const sampleIntent: ResolvedIntent = {
  source: "athlete_described",
  type: "threshold",
  structure: "intervals",
  blocks: [
    {
      index: 0,
      duration_min: 15,
      type: "warmup",
    },
    {
      index: 1,
      duration_min: 8,
      type: "work",
      target_watts: [240, 260],
    },
    {
      index: 2,
      duration_min: 5,
      type: "easy",
    },
  ],
  athlete_notes: "1 hour easy then 4 × 8 min at threshold",
  resolved_at: "2026-05-05T10:00:00.000Z",
  parser_version: "1.0.0",
};

describe("saveResolvedIntent", () => {
  it("updates resolved_intent and resolved_intent_source on the planned session", async () => {
    const builder = makeBuilder({
      onAwait: async () => ({ data: null, error: null }),
    });
    const { client, from } = makeSupabase([builder]);

    await saveResolvedIntent("session-1", sampleIntent, client);

    expect(from).toHaveBeenCalledWith("sessions");
    expect(builder.update).toHaveBeenCalledWith({
      resolved_intent: sampleIntent,
      resolved_intent_source: "athlete_described",
    });
    expect(builder.eq).toHaveBeenCalledWith("id", "session-1");
  });

  it("throws when the update returns an error", async () => {
    const builder = makeBuilder({
      onAwait: async () => ({ data: null, error: { message: "rls denied" } }),
    });
    const { client } = makeSupabase([builder]);

    await expect(saveResolvedIntent("session-1", sampleIntent, client)).rejects.toThrow(
      /saveResolvedIntent: rls denied/,
    );
  });
});

describe("loadResolvedIntent", () => {
  it("returns null when no row is found", async () => {
    const builder = makeBuilder({
      onMaybeSingle: async () => ({ data: null, error: null }),
    });
    const { client } = makeSupabase([builder]);

    const result = await loadResolvedIntent("session-1", client);
    expect(result).toBeNull();
  });

  it("returns null when resolved_intent is null on the row", async () => {
    const builder = makeBuilder({
      onMaybeSingle: async () => ({
        data: { resolved_intent: null, resolved_intent_source: null },
        error: null,
      }),
    });
    const { client } = makeSupabase([builder]);

    const result = await loadResolvedIntent("session-1", client);
    expect(result).toBeNull();
  });

  it("returns the typed ResolvedIntent when present", async () => {
    const builder = makeBuilder({
      onMaybeSingle: async () => ({
        data: {
          resolved_intent: sampleIntent,
          resolved_intent_source: sampleIntent.source,
        },
        error: null,
      }),
    });
    const { client, from } = makeSupabase([builder]);

    const result = await loadResolvedIntent("session-1", client);

    expect(from).toHaveBeenCalledWith("sessions");
    expect(builder.select).toHaveBeenCalledWith(
      "resolved_intent,resolved_intent_source",
    );
    expect(builder.eq).toHaveBeenCalledWith("id", "session-1");
    expect(result).toEqual(sampleIntent);
  });

  it("returns null when the persisted JSON fails validation", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const builder = makeBuilder({
      onMaybeSingle: async () => ({
        data: {
          resolved_intent: { source: "garbage" },
          resolved_intent_source: "garbage",
        },
        error: null,
      }),
    });
    const { client } = makeSupabase([builder]);

    const result = await loadResolvedIntent("session-1", client);
    expect(result).toBeNull();
    warnSpy.mockRestore();
  });

  it("throws when the select fails", async () => {
    const builder = makeBuilder({
      onMaybeSingle: async () => ({ data: null, error: { message: "boom" } }),
    });
    const { client } = makeSupabase([builder]);

    await expect(loadResolvedIntent("session-1", client)).rejects.toThrow(
      /loadResolvedIntent: boom/,
    );
  });
});
