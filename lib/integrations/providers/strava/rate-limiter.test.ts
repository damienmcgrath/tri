import {
  parseRateLimitHeaders,
  shouldThrottle,
  StravaRateLimitError,
  type RateLimitInfo
} from "./rate-limiter";

describe("parseRateLimitHeaders", () => {
  it("parses valid rate limit headers", () => {
    const headers = new Headers({
      "x-ratelimit-limit": "100,1000",
      "x-ratelimit-usage": "42,350"
    });

    const result = parseRateLimitHeaders(headers);
    expect(result).toEqual({
      limit15min: 100,
      limitDaily: 1000,
      usage15min: 42,
      usageDaily: 350
    });
  });

  it("returns null when headers are missing", () => {
    expect(parseRateLimitHeaders(new Headers())).toBeNull();
    expect(parseRateLimitHeaders(new Headers({ "x-ratelimit-limit": "100,1000" }))).toBeNull();
    expect(parseRateLimitHeaders(new Headers({ "x-ratelimit-usage": "42,350" }))).toBeNull();
  });

  it("returns null when headers are malformed", () => {
    const headers = new Headers({
      "x-ratelimit-limit": "abc,def",
      "x-ratelimit-usage": "42,350"
    });
    expect(parseRateLimitHeaders(headers)).toBeNull();
  });
});

describe("shouldThrottle", () => {
  it("returns false when well below limit", () => {
    const info: RateLimitInfo = {
      limit15min: 100,
      limitDaily: 1000,
      usage15min: 50,
      usageDaily: 200
    };
    expect(shouldThrottle(info)).toBe(false);
  });

  it("returns true when at 80% of 15-min limit", () => {
    const info: RateLimitInfo = {
      limit15min: 100,
      limitDaily: 1000,
      usage15min: 80,
      usageDaily: 200
    };
    expect(shouldThrottle(info)).toBe(true);
  });

  it("returns true when over 80% of 15-min limit", () => {
    const info: RateLimitInfo = {
      limit15min: 100,
      limitDaily: 1000,
      usage15min: 95,
      usageDaily: 200
    };
    expect(shouldThrottle(info)).toBe(true);
  });

  it("returns false at 79% of 15-min limit", () => {
    const info: RateLimitInfo = {
      limit15min: 100,
      limitDaily: 1000,
      usage15min: 79,
      usageDaily: 200
    };
    expect(shouldThrottle(info)).toBe(false);
  });
});

describe("StravaRateLimitError", () => {
  it("has correct name and properties", () => {
    const err = new StravaRateLimitError("Rate limited", 900000);
    expect(err.name).toBe("StravaRateLimitError");
    expect(err.message).toBe("Rate limited");
    expect(err.retryAfterMs).toBe(900000);
    expect(err).toBeInstanceOf(Error);
  });
});
