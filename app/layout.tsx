import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fieldy Lifelog",
  description: "Searchable Fieldy conversations, summaries, tasks, and recall.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
