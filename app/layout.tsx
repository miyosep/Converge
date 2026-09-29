import type { ReactNode } from "react";
import "./styles.css";
import "./components/plans-overview.css";
import "./components/scroll-story.css";
import "./components/planning-problems.css";

export const metadata = {
  title: "Converge",
  description: "Private group decisions with shared payment control",
  icons: { icon: "/images/converge-logo.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
