import { checkRateLimit, resetRateLimits } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows requests up to the configured limit", () => {
    const config = { maxRequests: 2, windowMs: 1000 };

    const first = checkRateLimit("chat", "user-1", config);
    const second = checkRateLimit("chat", "user-1", config);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
  });

  it("blocks requests over the configured limit", () => {
    const config = { maxRequests: 1, windowMs: 1000 };

    checkRateLimit("upload", "user-2", config);
    const blocked = checkRateLimit("upload", "user-2", config);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});
