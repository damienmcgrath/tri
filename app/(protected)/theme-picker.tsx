"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "tri.theme";

const THEMES = [
  { value: "coach-studio", label: "Coach Studio" },
  { value: "ember-night", label: "Ember Night" }
] as const;

type ThemeName = (typeof THEMES)[number]["value"];

const isTheme = (value: string | null): value is ThemeName => THEMES.some((theme) => theme.value === value);

const applyTheme = (theme: ThemeName) => {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.setAttribute("data-color-scheme", prefersDark ? "dark" : "light");
};

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeName>("coach-studio");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(STORAGE_KEY);
    const nextTheme = isTheme(storedTheme) ? storedTheme : "coach-studio";
    setTheme(nextTheme);
    applyTheme(nextTheme);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onSchemeChange = () => {
      const activeTheme = document.documentElement.getAttribute("data-theme");
      applyTheme(isTheme(activeTheme) ? activeTheme : nextTheme);
    };
    mediaQuery.addEventListener("change", onSchemeChange);

    return () => {
      mediaQuery.removeEventListener("change", onSchemeChange);
    };
  }, []);

  const onThemeChange = (nextTheme: ThemeName) => {
    setTheme(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  };

  return (
    <label className="mt-3 block border-t border-border pt-3 text-xs uppercase tracking-[0.15em] text-muted-foreground">
      Theme
      <select
        aria-label="Choose a theme"
        value={theme}
        onChange={(event) => onThemeChange(event.target.value as ThemeName)}
        className="mt-2 block w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm font-medium tracking-normal text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {THEMES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
