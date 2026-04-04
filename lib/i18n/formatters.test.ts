import {
  formatNumber,
  formatDistance,
  formatPace,
  formatDuration,
  formatDate,
  formatWeekday,
  formatTemperature,
  type FormatOptions,
} from "./formatters";

const en: FormatOptions = { locale: "en", units: "metric" };
const de: FormatOptions = { locale: "de", units: "metric" };
const fr: FormatOptions = { locale: "fr", units: "metric" };
const enImperial: FormatOptions = { locale: "en", units: "imperial" };

describe("formatNumber", () => {
  it("formats with locale-aware separators", () => {
    expect(formatNumber(1234.5, en, 1)).toBe("1,234.5");
    expect(formatNumber(1234.5, de, 1)).toBe("1.234,5");
  });

  it("respects decimal places", () => {
    expect(formatNumber(42, en, 0)).toBe("42");
    expect(formatNumber(3.14159, en, 2)).toBe("3.14");
  });
});

describe("formatDistance", () => {
  it("shows metres for short distances", () => {
    expect(formatDistance(400, en)).toBe("400\u202fm");
    // 1500m is at boundary — shows as km
    expect(formatDistance(1500, de)).toBe("1,50\u202fkm");
    expect(formatDistance(1400, de)).toBe("1.400\u202fm");
  });

  it("shows kilometres for longer distances (metric)", () => {
    expect(formatDistance(5000, en)).toBe("5.00\u202fkm");
    expect(formatDistance(42195, en)).toBe("42.2\u202fkm");
  });

  it("shows miles for imperial", () => {
    expect(formatDistance(5000, enImperial)).toBe("3.11\u202fmi");
    expect(formatDistance(42195, enImperial)).toBe("26.2\u202fmi");
  });

  it("shows yards for very short imperial distances", () => {
    expect(formatDistance(100, enImperial)).toBe("109\u202fyd");
  });
});

describe("formatPace", () => {
  it("formats min:sec/km for metric", () => {
    // 4:30/km = 270 seconds per km
    expect(formatPace(270, en)).toBe("4:30/km");
  });

  it("formats min:sec/mi for imperial", () => {
    // 270 sec/km * 1.60934 = ~434.5 sec/mi = 7:14/mi
    // 270 sec/km * 1.60934 = ~434.5 sec/mi = 7:15/mi (rounds up)
    expect(formatPace(270, enImperial)).toBe("7:15/mi");
  });

  it("pads seconds correctly", () => {
    // 5:05/km = 305 seconds
    expect(formatPace(305, en)).toBe("5:05/km");
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes in English", () => {
    expect(formatDuration(95, en)).toBe("1h 35min");
    expect(formatDuration(60, en)).toBe("1h");
    expect(formatDuration(45, en)).toBe("45min");
  });

  it("uses German abbreviations", () => {
    expect(formatDuration(95, de)).toBe("1 Std. 35 Min.");
    expect(formatDuration(60, de)).toBe("1 Std.");
    expect(formatDuration(45, de)).toBe("45 Min.");
  });

  it("uses French format (same as English)", () => {
    expect(formatDuration(95, fr)).toBe("1h 35min");
  });
});

describe("formatDate", () => {
  it("formats long dates for different locales", () => {
    const result = formatDate("2026-04-04", en, "long");
    expect(result).toContain("April");
    expect(result).toContain("2026");
    expect(result).toContain("4");
  });

  it("handles Date objects", () => {
    const d = new Date("2026-04-04T00:00:00.000Z");
    const result = formatDate(d, de, "long");
    expect(result).toContain("April");
    expect(result).toContain("2026");
  });

  it("formats medium dates", () => {
    const result = formatDate("2026-04-04", en, "medium");
    expect(result).toContain("Apr");
  });
});

describe("formatWeekday", () => {
  it("returns locale-aware weekday names", () => {
    // 2026-04-04 is a Saturday
    expect(formatWeekday("2026-04-04", en)).toBe("Saturday");
    expect(formatWeekday("2026-04-04", de)).toBe("Samstag");
    expect(formatWeekday("2026-04-04", fr)).toBe("samedi");
  });

  it("supports short format", () => {
    const result = formatWeekday("2026-04-04", en, "short");
    expect(result).toBe("Sat");
  });
});

describe("formatTemperature", () => {
  it("formats Celsius for metric", () => {
    expect(formatTemperature(24, en)).toBe("24\u00b0C");
    expect(formatTemperature(24, de)).toBe("24\u00b0C");
  });

  it("converts to Fahrenheit for imperial", () => {
    expect(formatTemperature(24, enImperial)).toBe("75\u00b0F");
    expect(formatTemperature(0, enImperial)).toBe("32\u00b0F");
  });
});
