"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "motion/react";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {/* Honor prefers-reduced-motion for all Motion animations (CSS handles
            transitions; this covers the JS layer). */}
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
