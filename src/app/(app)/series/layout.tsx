import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Series", template: "%s | Minutia" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
