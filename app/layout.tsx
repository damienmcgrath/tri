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
  return (
    <html lang="en" data-theme="coach-journal">
      <body>{children}</body>
    </html>
  );
}
