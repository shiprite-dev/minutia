import type { Metadata } from "next";

export const metadata: Metadata = { title: "My Actions" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
