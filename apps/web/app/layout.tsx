import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "fast-transfer — direct P2P file transfer",
  description:
    "Send files directly between browsers. No upload, no storage, encrypted end-to-end.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
<link href="https://fonts.googleapis.com/css2?family=Shantell+Sans:wght@300..800&display=swap" rel="stylesheet"></link>
      <body>{children}</body>
    </html>
  );
}
