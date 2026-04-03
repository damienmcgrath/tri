import { checkRateLimit, resetRateLimits } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows requests up to the configured limit", async () => {
    const config = { maxRequests: 2, windowMs: 1000 };

    const first = await checkRateLimit("chat", "user-1", config);
    const second = await checkRateLimit("chat", "user-1", config);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
  });

  it("blocks requests over the configured limit", async () => {
    const config = { maxRequests: 1, windowMs: 1000 };

    await checkRateLimit("upload", "user-2", config);
    const blocked = await checkRateLimit("upload", "user-2", config);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});
