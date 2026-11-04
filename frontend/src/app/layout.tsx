import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "LocalClips – Clip Generator (No API Credits)",
  description:
    "Generate clips from your video + SRT + AI JSON locally. No API credits needed – all rendering happens on your machine.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Toaster position="bottom-right" theme="dark" />
      </body>
    </html>
  );
}
