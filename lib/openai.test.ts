describe("getCoachRequestTimeoutMs", () => {
  const originalTimeout = process.env.OPENAI_COACH_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.OPENAI_COACH_TIMEOUT_MS;
    } else {
      process.env.OPENAI_COACH_TIMEOUT_MS = originalTimeout;
    }

    jest.resetModules();
  });

  test("defaults to 60 seconds when unset", async () => {
    delete process.env.OPENAI_COACH_TIMEOUT_MS;

    const { getCoachRequestTimeoutMs } = await import("./openai");

    expect(getCoachRequestTimeoutMs()).toBe(60_000);
  });

  test("uses a valid configured timeout", async () => {
    process.env.OPENAI_COACH_TIMEOUT_MS = "45000";

    const { getCoachRequestTimeoutMs } = await import("./openai");

    expect(getCoachRequestTimeoutMs()).toBe(45_000);
  });

  test("falls back to the default when configured timeout is invalid", async () => {
    process.env.OPENAI_COACH_TIMEOUT_MS = "not-a-number";

    const { getCoachRequestTimeoutMs } = await import("./openai");

    expect(getCoachRequestTimeoutMs()).toBe(60_000);
  });
});
