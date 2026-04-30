"use client";

import { useEffect, useState } from "react";

// Phone < 640px (Tailwind sm), tablet 640–767px (Tailwind sm to md),
// desktop ≥ 768px (Tailwind md+). See spec issue #320.
const PHONE_MAX = 640;
const TABLET_MAX = 767;

export type Viewport = {
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
};

function readViewport(): Viewport {
  if (typeof window === "undefined") {
    return { isPhone: false, isTablet: false, isDesktop: true };
  }
  const width = window.innerWidth;
  const isPhone = width <= PHONE_MAX;
  const isTablet = !isPhone && width <= TABLET_MAX;
  return { isPhone, isTablet, isDesktop: !isPhone && !isTablet };
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() => ({
    isPhone: false,
    isTablet: false,
    isDesktop: true
  }));

  useEffect(() => {
    setViewport(readViewport());
    const onResize = () => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return viewport;
}
