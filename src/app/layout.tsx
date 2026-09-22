import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./context.css";
const geist = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
export const metadata: Metadata = {
  title: "WORLD SIGNAL — What changed?",
  description:
    "A window into a changing world. Explore unusual activity across earthquakes, wildfires, internet connectivity and aviation. Interactive demonstration with clearly labeled synthetic data.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
