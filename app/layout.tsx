import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Place Canvas",
  description: "Collaborative real-time canvas with AI image generation",
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
