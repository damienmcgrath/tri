import { getSwimSubtypeTag, getSwimTypeLabel } from "./discipline";

describe("getSwimTypeLabel", () => {
  it("returns Pool Swim for pool", () => {
    expect(getSwimTypeLabel("pool")).toBe("Pool Swim");
  });

  it("returns Open Water for open_water", () => {
    expect(getSwimTypeLabel("open_water")).toBe("Open Water");
  });

  it.each([null, undefined, "", "lake", "unknown"])("returns null for %s", (value) => {
    expect(getSwimTypeLabel(value as string | null | undefined)).toBeNull();
  });
});

describe("getSwimSubtypeTag", () => {
  it("returns Pool tag for pool", () => {
    expect(getSwimSubtypeTag("pool")).toBe("Pool");
  });

  it("returns OWS tag for open_water", () => {
    expect(getSwimSubtypeTag("open_water")).toBe("OWS");
  });

  it("returns null for unknown values", () => {
    expect(getSwimSubtypeTag(null)).toBeNull();
    expect(getSwimSubtypeTag("foo")).toBeNull();
  });
});
