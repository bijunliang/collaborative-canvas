import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "THE COLLECTIVE VOID — AI MURAL",
  description: "Collaborative real-time canvas with AI image generation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/* SVG filter for hand-drawn pencil effect (slightly irregular but mostly straight) */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
          <defs>
            <filter id="pencil-sketch" x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.9" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            {/* Wavy organic strokes for generating-state rings (img 2 vibe) */}
            <filter id="generating-wavy" x="-35%" y="-35%" width="170%" height="170%">
              <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="2" result="gwNoise" />
              <feDisplacementMap in="SourceGraphic" in2="gwNoise" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
        {children}
      </body>
    </html>
  );
}
