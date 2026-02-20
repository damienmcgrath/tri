import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TriCoach AI",
  description: "Training plan and AI coaching companion for triathletes."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
