"use client";

import { useEffect, useState } from "react";

const steps = [
  "Gathering session data",
  "Analyzing execution quality",
  "Reviewing weekly patterns",
  "Building your debrief",
];

export default function DebriefLoading() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="space-y-6">
      <div className="surface mx-auto max-w-md rounded-xl p-6">
        <div className="flex flex-col items-center gap-4">
          {/* Spinner */}
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--border))] border-t-[hsl(var(--accent-performance))]" />

          {/* Current step message */}
          <p className="text-sm font-medium text-primary">
            {steps[activeStep]}&hellip;
          </p>

          {/* Step dots */}
          <div className="flex gap-2">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                  i <= activeStep
                    ? "bg-[hsl(var(--accent-performance))]"
                    : "bg-[hsl(var(--border))]"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Faded skeleton underneath */}
      <div className="animate-pulse opacity-40 space-y-4">
        <div className="surface p-4">
          <div className="h-3 w-20 rounded bg-[hsl(var(--surface-2))]" />
          <div className="mt-2 h-7 w-48 rounded bg-[hsl(var(--surface-2))]" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="surface h-28 p-4">
              <div className="h-3 w-24 rounded bg-[hsl(var(--surface-2))]" />
              <div className="mt-3 h-10 w-16 rounded bg-[hsl(var(--surface-2))]" />
            </div>
          ))}
        </div>
        <div className="surface space-y-3 p-4">
          <div className="h-4 w-full rounded bg-[hsl(var(--surface-2))]" />
          <div className="h-4 w-5/6 rounded bg-[hsl(var(--surface-2))]" />
          <div className="h-4 w-4/6 rounded bg-[hsl(var(--surface-2))]" />
        </div>
      </div>
    </section>
  );
}
