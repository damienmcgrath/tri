"use client";

import { useEffect, useState } from "react";

type ThemeOption = {
  label: string;
  value: string;
  description: string;
};

const THEME_OPTIONS: ThemeOption[] = [
  {
    label: "Default",
    value: "default",
    description: "Current cool-performance palette."
  },
  {
    label: "Clinical Coral",
    value: "clinical-coral",
    description: "Cool clinical surfaces with restrained coral accents."
  },
  {
    label: "Carbon Coach",
    value: "carbon-coach",
    description: "Dark-first graphite UI with crisp borders and coral performance accents."
  }
];

const STORAGE_KEY = "tri-theme";
const DEFAULT_THEME = "clinical-coral";

export function ThemePicker() {
  const [theme, setTheme] = useState(DEFAULT_THEME);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME;
    setTheme(savedTheme);
    if (savedTheme === "default") {
      document.documentElement.removeAttribute("data-theme");
      return;
    }

    document.documentElement.setAttribute("data-theme", savedTheme);
  }, []);

  const onChangeTheme = (nextTheme: string) => {
    setTheme(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);

    if (nextTheme === "default") {
      document.documentElement.removeAttribute("data-theme");
      return;
    }

    document.documentElement.setAttribute("data-theme", nextTheme);
  };

  return (
    <div className="surface p-6">
      <h2 className="text-lg font-semibold text-[hsl(var(--fg))]">Theme</h2>
      <p className="mt-1 text-sm text-muted">Choose your visual preset.</p>

      <div className="mt-4 grid gap-2">
        {THEME_OPTIONS.map((option) => {
          const active = option.value === theme;

          return (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 py-2.5 transition hover:border-[hsl(var(--accent-performance)/0.42)]"
            >
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={active}
                onChange={(event) => onChangeTheme(event.target.value)}
                className="mt-1 h-4 w-4 border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] text-[hsl(var(--accent-performance))] focus:ring-[hsl(var(--ring)/0.4)]"
              />
              <span>
                <span className="block text-sm font-medium text-[hsl(var(--fg))]">{option.label}</span>
                <span className="block text-xs text-muted">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
