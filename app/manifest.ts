import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tri.AI — Training Companion for Triathletes",
    short_name: "Tri.AI",
    description: "Training companion for triathletes",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon-192x192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src: "/icon-512x512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
      },
      {
        src: "/icon-maskable-512x512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
