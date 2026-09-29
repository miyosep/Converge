import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Converge",
  description:
    "AI proposes. Humans approve. Smart contracts enforce. A group purchasing agent with on-chain spending policy.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
