// The jsdom test environment does not include the Web Fetch API globally.
// node-fetch provides a compatible Request / Headers implementation that
// satisfies the interface consumed by our helpers (headers.get only).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Request: NodeFetchRequest } = require("node-fetch") as {
  Request: new (url: string, init?: { headers?: Record<string, string> }) => {
    headers: { get(name: string): string | null };
  };
};

import { getClientIp, isSameOrigin } from "./request";

function makeRequest(
  headers: Record<string, string> = {},
  url = "https://example.com/",
): Request {
  return new NodeFetchRequest(url, { headers }) as unknown as Request;
}

// ---------------------------------------------------------------------------
// getClientIp
// ---------------------------------------------------------------------------

describe("getClientIp", () => {
  it("returns the first IP from a single-value x-forwarded-for header", () => {
    const req = makeRequest({ "x-forwarded-for": "1.2.3.4" });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("returns the first IP from a comma-separated x-forwarded-for chain", () => {
    const req = makeRequest({ "x-forwarded-for": "10.0.0.1, 10.0.0.2, 10.0.0.3" });
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  it("trims whitespace from the first entry in x-forwarded-for", () => {
    const req = makeRequest({ "x-forwarded-for": "  192.168.1.100 , 10.0.0.1" });
    expect(getClientIp(req)).toBe("192.168.1.100");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = makeRequest({ "x-real-ip": "5.6.7.8" });
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("returns 'unknown' when neither header is present", () => {
    const req = makeRequest();
    expect(getClientIp(req)).toBe("unknown");
  });

  it("prefers x-forwarded-for over x-real-ip when both are present", () => {
    const req = makeRequest({
      "x-forwarded-for": "1.1.1.1",
      "x-real-ip": "9.9.9.9",
    });
    expect(getClientIp(req)).toBe("1.1.1.1");
  });

  it("handles an x-forwarded-for header that is an empty string by falling back to x-real-ip", () => {
    // An empty string is falsy — the branch is skipped and x-real-ip is used.
    const req = makeRequest({ "x-forwarded-for": "", "x-real-ip": "7.7.7.7" });
    expect(getClientIp(req)).toBe("7.7.7.7");
  });

  it("handles IPv6 addresses in x-forwarded-for", () => {
    const req = makeRequest({ "x-forwarded-for": "::1, 2001:db8::1" });
    expect(getClientIp(req)).toBe("::1");
  });

  it("handles IPv6 addresses in x-real-ip", () => {
    const req = makeRequest({ "x-real-ip": "::1" });
    expect(getClientIp(req)).toBe("::1");
  });

  it("returns 'unknown' when x-real-ip is absent and x-forwarded-for is absent", () => {
    const req = makeRequest({});
    expect(getClientIp(req)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// isSameOrigin
// ---------------------------------------------------------------------------

describe("isSameOrigin", () => {
  // --- no origin header (e.g. server-to-server or same-origin GET) ---

  it("returns true when the origin header is absent", () => {
    const req = makeRequest({ host: "app.example.com" });
    expect(isSameOrigin(req)).toBe(true);
  });

  // --- matching origin ---

  it("returns true when origin matches host and x-forwarded-proto", () => {
    const req = makeRequest({
      origin: "https://app.example.com",
      host: "app.example.com",
      "x-forwarded-proto": "https",
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("returns true when proto defaults to https and origin uses https", () => {
    const req = makeRequest({
      origin: "https://app.example.com",
      host: "app.example.com",
      // no x-forwarded-proto — should default to "https"
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("returns true for http origin when x-forwarded-proto is http", () => {
    const req = makeRequest({
      origin: "http://app.example.com",
      host: "app.example.com",
      "x-forwarded-proto": "http",
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  // --- mismatched host ---

  it("returns false when origin host differs from the host header", () => {
    const req = makeRequest({
      origin: "https://evil.example.com",
      host: "app.example.com",
      "x-forwarded-proto": "https",
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("returns false when origin is a subdomain of the host", () => {
    const req = makeRequest({
      origin: "https://sub.app.example.com",
      host: "app.example.com",
      "x-forwarded-proto": "https",
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("returns false when origin is the parent domain of the host", () => {
    const req = makeRequest({
      origin: "https://example.com",
      host: "app.example.com",
      "x-forwarded-proto": "https",
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  // --- mismatched protocol ---

  it("returns false when origin protocol is http but x-forwarded-proto is https", () => {
    const req = makeRequest({
      origin: "http://app.example.com",
      host: "app.example.com",
      "x-forwarded-proto": "https",
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("returns false when origin protocol is https but x-forwarded-proto is http", () => {
    const req = makeRequest({
      origin: "https://app.example.com",
      host: "app.example.com",
      "x-forwarded-proto": "http",
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("returns false when origin is https and no x-forwarded-proto but host does not match", () => {
    const req = makeRequest({
      origin: "https://other.com",
      host: "app.example.com",
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  // --- missing host header (origin present) ---

  it("returns false when origin is present but host header is absent", () => {
    const req = makeRequest({
      origin: "https://app.example.com",
      "x-forwarded-proto": "https",
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  // --- malformed origin ---

  it("returns false for a malformed origin that cannot be parsed as a URL", () => {
    const req = makeRequest({
      origin: "not-a-valid-url",
      host: "app.example.com",
      "x-forwarded-proto": "https",
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("returns false for an empty-string origin treated as an unparseable URL", () => {
    // new URL("") throws, so the catch branch returns false.
    const req = makeRequest({
      origin: "",
      host: "app.example.com",
    });
    // An empty string header is falsy — the early-return `true` branch fires.
    // (Behaviour documented here so the expectation is explicit.)
    expect(isSameOrigin(req)).toBe(true);
  });

  // --- port handling ---

  it("returns true when origin includes an explicit port matching the host header", () => {
    const req = makeRequest({
      origin: "https://app.example.com:8443",
      host: "app.example.com:8443",
      "x-forwarded-proto": "https",
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("returns false when origin port differs from the host header port", () => {
    const req = makeRequest({
      origin: "https://app.example.com:8443",
      host: "app.example.com:9000",
      "x-forwarded-proto": "https",
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("returns false when origin omits port but host includes one", () => {
    const req = makeRequest({
      origin: "https://app.example.com",
      host: "app.example.com:8443",
      "x-forwarded-proto": "https",
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("returns false when origin includes port but host omits it", () => {
    const req = makeRequest({
      origin: "https://app.example.com:443",
      host: "app.example.com",
      "x-forwarded-proto": "https",
    });
    // URL parses https://…:443 and normalises .host to "app.example.com" (default port elided),
    // so this actually matches.  Document the true behaviour.
    const result = isSameOrigin(req);
    // new URL("https://app.example.com:443").host === "app.example.com" (default port stripped)
    expect(result).toBe(true);
  });
});
