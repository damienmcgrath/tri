import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tri.AI",
  description: "Training companion for triathletes"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeInitScript = `(() => {
    const storageKey = "tri.theme";
    const fallbackTheme = "clinical-coral";
    const supportedThemes = new Set(["coach-studio", "clinical-coral", "ember-night"]);
    const storedTheme = window.localStorage.getItem(storageKey);
    const theme = storedTheme && supportedThemes.has(storedTheme) ? storedTheme : fallbackTheme;
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-color-scheme", colorScheme);
  })();`;

  return (
    <html lang="en" data-theme="clinical-coral">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
