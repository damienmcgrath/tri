import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TriCoach AI",
  description: "Training companion for triathletes"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
