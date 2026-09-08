import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

export const metadata: Metadata = {
  title: "fast-transfer — direct P2P file transfer",
  description:
    "Send files directly between browsers. No upload, no storage, encrypted end-to-end.",
};

const comicSans = localFont({
  src: "../fonts/ComicSans-Regular.ttf",
  variable: "--font-comic",
  weight: "400",
  style: "normal",
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={comicSans.variable}>
      <body>{children}</body>
    </html>
  );
}